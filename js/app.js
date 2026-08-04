/* UI glue: capture → preprocess → OCR → parse → review → save. */

import { fileToBitmap, preprocess } from './preprocess.js';
import { recognise } from './ocr.js';
import { parseCases, flagCase, DEFAULT_STRONG, DEFAULT_SUPPORT } from './parse.js';
import * as store from './storage.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  bitmap: null,
  canvas: null,
  thumb: '',
  rows: [],
  editingId: null,      // set when a saved list is reopened
  opts: { rotate: 0, contrast: 1.4, threshold: 12, psm: '6' },
};

/* ------------------------------------------------------------------ chrome */

function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tabpanel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'saved') renderSaved();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  store.setTheme(theme);
}
$('#themeToggle').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});
applyTheme(store.getTheme());

/* ----------------------------------------------------------------- intake */

const dropzone = $('#dropzone');
const fileInput = $('#fileInput');

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => e.target.files[0] && loadFile(e.target.files[0]));

['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); }));
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

document.addEventListener('paste', (e) => {
  const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
  if (item) loadFile(item.getAsFile());
});

async function loadFile(file) {
  if (!file.type.startsWith('image/')) return toast('That file is not an image.');
  try {
    state.bitmap = await fileToBitmap(file);
    state.opts.rotate = 0;
    state.thumb = makeThumb(state.bitmap);
    $('#previewCard').classList.remove('hidden');
    renderPreview();
    $('#previewCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    toast('Could not open that image.');
  }
}

function makeThumb(bitmap) {
  const scale = Math.min(1, 360 / bitmap.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * scale);
  c.height = Math.round(bitmap.height * scale);
  c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.55);
}

/* -------------------------------------------------------------- preprocess */

let previewTimer = null;
function renderPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    if (!state.bitmap) return;
    state.canvas = preprocess(state.bitmap, state.opts);
    const target = $('#previewCanvas');
    target.width = state.canvas.width;
    target.height = state.canvas.height;
    target.getContext('2d').drawImage(state.canvas, 0, 0);
  }, 120);
}

$$('[data-rotate]').forEach((btn) => btn.addEventListener('click', () => {
  state.opts.rotate = (state.opts.rotate + Number(btn.dataset.rotate) + 360) % 360;
  renderPreview();
}));

$('#contrast').addEventListener('input', (e) => {
  state.opts.contrast = Number(e.target.value);
  $('#contrastOut').textContent = e.target.value;
  renderPreview();
});
$('#threshold').addEventListener('input', (e) => {
  state.opts.threshold = Number(e.target.value);
  $('#thresholdOut').textContent = e.target.value;
  renderPreview();
});
$('#psm').addEventListener('change', (e) => { state.opts.psm = e.target.value; });

$('#clearImage').addEventListener('click', () => {
  state.bitmap = null;
  state.canvas = null;
  state.thumb = '';
  fileInput.value = '';
  $('#previewCard').classList.add('hidden');
});

/* --------------------------------------------------------------------- OCR */

$('#runOcr').addEventListener('click', async () => {
  if (!state.canvas) return toast('Load a photo first.');

  const btn = $('#runOcr');
  btn.disabled = true;
  $('#progressWrap').classList.remove('hidden');
  setProgress(0.02, 'Loading the OCR engine (first run downloads it)…');

  try {
    const { text, lines, rejected } = await recognise(state.canvas, {
      psm: state.opts.psm,
      onProgress: (p, label) => setProgress(p, label),
    });

    const noiseNote = rejected.length
      ? `\n\n— ${rejected.length} line(s) ignored as noise —\n${rejected.map((r) => r.text).join('\n')}`
      : '';
    $('#rawText').textContent = (text.trim() || '(nothing recognised)') + noiseNote;
    const rows = parseCases(lines, currentTerms());

    if (!rows.length) {
      toast('No rows recognised — try rotating, or set “Sharpen text” to 0.');
    } else {
      state.rows = rows;
      state.editingId = null;
      renderReview();
      showTab('review');
      const mine = rows.filter((r) => r.mine).length;
      toast(`${rows.length} case${rows.length === 1 ? '' : 's'} found · ${mine} flagged as yours`);
    }
  } catch (err) {
    console.error(err);
    toast(err?.message?.includes('network') || err?.name === 'TypeError'
      ? 'Could not download the OCR engine — check the connection and retry.'
      : 'Extraction failed. See the console for details.');
  } finally {
    setProgress(1, 'Done');
    btn.disabled = false;
    setTimeout(() => $('#progressWrap').classList.add('hidden'), 900);
  }
});

function setProgress(p, label) {
  $('#progressBar').style.width = `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
  if (label) $('#progressText').textContent = label;
}

/* ------------------------------------------------------------------ review */

const FIELDS = ['serial', 'name', 'age', 'sex', 'hospNo', 'diagnosis', 'procedure', 'surgeon'];

function renderReview() {
  const has = state.rows.length > 0;
  $('#reviewEmpty').classList.toggle('hidden', has);
  $('#reviewBody').classList.toggle('hidden', !has);
  $('#reviewCount').classList.toggle('hidden', !has);
  $('#reviewCount').textContent = state.rows.length;
  if (!has) return;

  const onlyMine = $('#onlyMine').checked;
  const tbody = $('#casesTable tbody');
  tbody.innerHTML = '';

  state.rows.forEach((row) => {
    if (onlyMine && !row.mine) return;
    const tr = document.createElement('tr');
    tr.dataset.id = row.id;
    tr.classList.toggle('is-mine', !!row.mine);

    const check = document.createElement('td');
    check.innerHTML = `<input type="checkbox" ${row.mine ? 'checked' : ''} aria-label="Study case" />`;
    check.querySelector('input').addEventListener('change', (e) => {
      row.mine = e.target.checked;
      row.manualFlag = true;
      tr.classList.toggle('is-mine', row.mine);
      updateStats();
    });
    tr.appendChild(check);

    FIELDS.forEach((field) => {
      const td = document.createElement('td');
      td.contentEditable = 'true';
      td.spellcheck = false;
      td.dataset.field = field;
      td.textContent = row[field] || '';
      if (row.lowConf.includes(field)) td.classList.add('low-conf');

      td.addEventListener('input', () => {
        row[field] = td.textContent.trim();
        td.classList.remove('low-conf');
      });
      td.addEventListener('blur', () => {
        if (field === 'diagnosis' || field === 'procedure') refreshFlag(row, tr);
      });
      tr.appendChild(td);

      if (field === 'procedure' && row.matched?.length) {
        const note = document.createElement('span');
        note.className = 'match-note';
        note.textContent = `matched: ${row.matched.join(', ')}`;
        td.appendChild(note);
      }
    });

    const act = document.createElement('td');
    act.innerHTML = '<button class="row-del" title="Delete row">✕</button>';
    act.querySelector('button').addEventListener('click', () => {
      state.rows = state.rows.filter((r) => r.id !== row.id);
      renderReview();
    });
    tr.appendChild(act);

    tbody.appendChild(tr);
  });

  updateStats();
}

/** Re-run flagging after an edit, unless the user has overridden it by hand. */
function refreshFlag(row, tr) {
  if (row.manualFlag) return;
  const { mine, matched } = flagCase(row, currentTerms());
  row.mine = mine;
  row.matched = matched;
  tr.classList.toggle('is-mine', mine);
  tr.querySelector('input[type="checkbox"]').checked = mine;
  updateStats();
}

function updateStats() {
  $('#statTotal').textContent = state.rows.length;
  $('#statMine').textContent = state.rows.filter((r) => r.mine).length;
  $('#statDate').textContent = $('#listDate').value || '—';
  $('#reviewCount').textContent = state.rows.length;
}

$('#onlyMine').addEventListener('change', renderReview);

$('#addRow').addEventListener('click', () => {
  state.rows.push({
    id: `${Date.now().toString(36)}-manual-${Math.random().toString(36).slice(2, 7)}`,
    serial: String(state.rows.length + 1),
    name: '', age: '', sex: '', hospNo: '', diagnosis: '', procedure: '', surgeon: '',
    raw: '', mine: false, matched: [], lowConf: [], manualFlag: false,
  });
  renderReview();
});

/* ------------------------------------------------------------------- save */

$('#saveList').addEventListener('click', () => {
  if (!state.rows.length) return toast('Nothing to save.');
  const listDate = $('#listDate').value || new Date().toISOString().slice(0, 10);
  const entry = {
    id: state.editingId || `list-${Date.now().toString(36)}`,
    listDate,
    unit: $('#listUnit').value.trim(),
    thumb: state.thumb,
    savedAt: new Date().toISOString(),
    rows: state.rows,
  };
  try {
    store.saveList(entry);
    state.editingId = entry.id;
    toast(`Saved — ${entry.rows.filter((r) => r.mine).length} of ${entry.rows.length} marked as yours.`);
  } catch (err) {
    toast(err.message);
  }
});

$('#exportCsvMine').addEventListener('click', () => exportRows(state.rows.filter((r) => r.mine), 'my-cases'));
$('#exportCsvAll').addEventListener('click', () => exportRows(state.rows, 'ot-list'));

function exportRows(rows, prefix) {
  if (!rows.length) return toast('No rows to export.');
  const listDate = $('#listDate').value || new Date().toISOString().slice(0, 10);
  store.download(`${prefix}-${listDate}.csv`, store.toCsv(rows, { listDate, unit: $('#listUnit').value.trim() }));
}

/* ------------------------------------------------------------ saved lists */

function renderSaved() {
  const wrap = $('#savedList');
  const lists = store.getLists();
  wrap.innerHTML = '';

  if (!lists.length) {
    wrap.innerHTML = '<div class="card"><p class="muted">No lists saved yet.</p></div>';
    return;
  }

  lists.forEach((entry) => {
    const mine = entry.rows.filter((r) => r.mine).length;
    const el = document.createElement('div');
    el.className = 'saved-item';
    el.innerHTML = `
      <div>
        <div class="saved-title">${escapeHtml(entry.listDate)} ${entry.unit ? `· ${escapeHtml(entry.unit)}` : ''}</div>
        <div class="saved-meta">${entry.rows.length} cases · <span class="badge">${mine} yours</span></div>
      </div>
      <div class="actions">
        <button class="mini" data-act="open">Open</button>
        <button class="mini" data-act="csv">CSV</button>
        <button class="mini" data-act="del">Delete</button>
      </div>`;

    el.querySelector('[data-act="open"]').addEventListener('click', () => {
      state.rows = entry.rows;
      state.editingId = entry.id;
      state.thumb = entry.thumb || '';
      $('#listDate').value = entry.listDate;
      $('#listUnit').value = entry.unit || '';
      renderReview();
      showTab('review');
    });
    el.querySelector('[data-act="csv"]').addEventListener('click', () =>
      store.download(`ot-list-${entry.listDate}.csv`, store.toCsv(entry.rows, entry)));
    el.querySelector('[data-act="del"]').addEventListener('click', () => {
      if (!confirm(`Delete the list from ${entry.listDate}? This cannot be undone.`)) return;
      store.deleteList(entry.id);
      if (state.editingId === entry.id) state.editingId = null;
      renderSaved();
    });

    wrap.appendChild(el);
  });
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

$('#exportAllCsv').addEventListener('click', () => {
  const rows = store.getLists().flatMap((l) =>
    l.rows.map((r) => ({ ...r, listDate: l.listDate, unit: l.unit })));
  if (!rows.length) return toast('Nothing saved yet.');
  store.download(`all-cases-${new Date().toISOString().slice(0, 10)}.csv`, store.toCsv(rows));
});

$('#exportAllJson').addEventListener('click', () => {
  store.download(
    `ot-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), lists: store.getLists() }, null, 2),
    'application/json'
  );
});

$('#importJson').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.lists)) throw new Error('bad shape');
    if (!confirm(`Restore ${data.lists.length} list(s)? This replaces what is currently saved here.`)) return;
    store.replaceAll(data.lists);
    renderSaved();
    toast('Backup restored.');
  } catch {
    toast('That file is not a valid backup.');
  } finally {
    e.target.value = '';
  }
});

$('#wipeAll').addEventListener('click', () => {
  if (!confirm('Delete every saved list from this browser? Export a backup first if unsure.')) return;
  store.replaceAll([]);
  renderSaved();
  toast('All saved lists deleted.');
});

/* --------------------------------------------------------------- settings */

function currentTerms() {
  const saved = store.getTerms();
  return {
    strong: saved?.strong?.length ? saved.strong : DEFAULT_STRONG,
    support: saved?.support?.length ? saved.support : DEFAULT_SUPPORT,
  };
}

function fillTerms(terms) {
  $('#strongTerms').value = terms.strong.join('\n');
  $('#supportTerms').value = terms.support.join('\n');
}

const parseTerms = (value) => value.split('\n').map((s) => s.trim()).filter(Boolean);

$('#saveTerms').addEventListener('click', () => {
  store.setTerms({ strong: parseTerms($('#strongTerms').value), support: parseTerms($('#supportTerms').value) });
  state.rows.forEach((row) => {
    if (row.manualFlag) return;
    const { mine, matched } = flagCase(row, currentTerms());
    row.mine = mine;
    row.matched = matched;
  });
  renderReview();
  toast('Terms saved and rows re-checked.');
});

$('#resetTerms').addEventListener('click', () => {
  store.setTerms({ strong: DEFAULT_STRONG, support: DEFAULT_SUPPORT });
  fillTerms({ strong: DEFAULT_STRONG, support: DEFAULT_SUPPORT });
  toast('Terms reset to defaults.');
});

/* ------------------------------------------------------------------- init */

$('#listDate').value = new Date().toISOString().slice(0, 10);
$('#listDate').addEventListener('change', updateStats);
fillTerms(currentTerms());
renderReview();
