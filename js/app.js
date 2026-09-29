/* UI glue: capture → crop → preprocess → grid read (or OCR fallback) → review → save. */

import { fileToBitmap, preprocess } from './preprocess.js';
import { recognise } from './ocr.js';
import { parseCases, flagCase, DEFAULT_STRONG, DEFAULT_SUPPORT } from './parse.js';
import { deskewRegion, detectTable, eraseTableLines, extractTableRows, splitAgeSex } from './table.js';
import * as store from './storage.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/** Review-table columns, in display order. */
export const FIELDS = [
  { key: 'serial', label: 'S.No', cls: 'narrow' },
  { key: 'name', label: 'Name' },
  { key: 'age', label: 'Age', cls: 'narrow' },
  { key: 'sex', label: 'Sex', cls: 'narrow' },
  { key: 'crNo', label: 'CR No.' },
  { key: 'ward', label: 'Ward / bed' },
  { key: 'diagnosis', label: 'Diagnosis' },
  { key: 'procedure', label: 'Procedure' },
  { key: 'duration', label: 'Duration', cls: 'narrow' },
  { key: 'special', label: 'Special requirement' },
  { key: 'surgeon', label: 'Surgeon / team' },
  { key: 'anaesthesia', label: 'Anaes.', cls: 'narrow' },
  { key: 'serology', label: 'Serology', cls: 'narrow' },
  { key: 'bloodGroup', label: 'Blood group' },
  { key: 'position', label: 'Position' },
  { key: 'remarks', label: 'Remarks' },
];

const state = {
  bitmap: null,
  canvas: null,
  thumb: '',
  rows: [],
  editingId: null,
  crop: null,                       // in preprocessed-canvas pixels
  opts: { rotate: 0, contrast: 1.4, threshold: 12, psm: '6' },
};

const blankRow = () => ({
  id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  serial: '', name: '', age: '', sex: '', crNo: '', ward: '',
  diagnosis: '', procedure: '', duration: '', special: '', surgeon: '',
  anaesthesia: '', serology: '', bloodGroup: '', position: '', remarks: '',
  raw: '', mine: false, matched: [], lowConf: [], manualFlag: false,
});

/* ------------------------------------------------------------------ chrome */

function toast(msg, ms = 3200) {
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
    state.crop = null;
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
    drawCropBox();
  }, 120);
}

$$('[data-rotate]').forEach((btn) => btn.addEventListener('click', () => {
  state.opts.rotate = (state.opts.rotate + Number(btn.dataset.rotate) + 360) % 360;
  state.crop = null;                 // rotation invalidates the old selection
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
  state.crop = null;
  fileInput.value = '';
  $('#previewCard').classList.add('hidden');
});

/* ------------------------------------------------------------ crop select */

const previewCanvas = $('#previewCanvas');
const cropBox = $('#cropBox');
let dragStart = null;

const canvasPoint = (ev) => {
  const rect = previewCanvas.getBoundingClientRect();
  return {
    x: ((ev.clientX - rect.left) / rect.width) * previewCanvas.width,
    y: ((ev.clientY - rect.top) / rect.height) * previewCanvas.height,
  };
};

previewCanvas.addEventListener('pointerdown', (ev) => {
  if (!state.canvas) return;
  previewCanvas.setPointerCapture(ev.pointerId);
  dragStart = canvasPoint(ev);
  state.crop = null;
  drawCropBox();
});

previewCanvas.addEventListener('pointermove', (ev) => {
  if (!dragStart) return;
  const p = canvasPoint(ev);
  state.crop = {
    x0: Math.min(dragStart.x, p.x), y0: Math.min(dragStart.y, p.y),
    x1: Math.max(dragStart.x, p.x), y1: Math.max(dragStart.y, p.y),
  };
  drawCropBox();
});

previewCanvas.addEventListener('pointerup', () => {
  dragStart = null;
  // A tap rather than a drag means "no selection".
  if (state.crop && (state.crop.x1 - state.crop.x0 < 40 || state.crop.y1 - state.crop.y0 < 40)) {
    state.crop = null;
  }
  drawCropBox();
});

$('#cropReset').addEventListener('click', () => { state.crop = null; drawCropBox(); });

function drawCropBox() {
  const info = $('#cropInfo');
  if (!state.crop || !state.canvas) {
    cropBox.classList.add('hidden');
    info.textContent = 'whole image';
    return;
  }
  const rect = previewCanvas.getBoundingClientRect();
  const stage = previewCanvas.parentElement.getBoundingClientRect();
  const sx = rect.width / previewCanvas.width;
  const sy = rect.height / previewCanvas.height;
  cropBox.classList.remove('hidden');
  cropBox.style.left = `${(rect.left - stage.left) + state.crop.x0 * sx}px`;
  cropBox.style.top = `${(rect.top - stage.top) + state.crop.y0 * sy}px`;
  cropBox.style.width = `${(state.crop.x1 - state.crop.x0) * sx}px`;
  cropBox.style.height = `${(state.crop.y1 - state.crop.y0) * sy}px`;
  info.textContent = `${Math.round(state.crop.x1 - state.crop.x0)} × ${Math.round(state.crop.y1 - state.crop.y0)} px selected`;
}
window.addEventListener('resize', drawCropBox);

/* --------------------------------------------------------------------- OCR */

$('#runOcr').addEventListener('click', async () => {
  if (!state.canvas) return toast('Load a photo first.');

  const btn = $('#runOcr');
  btn.disabled = true;
  $('#progressWrap').classList.remove('hidden');
  setProgress(0.02, 'Loading the OCR engine (first run downloads it)…');

  try {
    const result = await extract();
    if (!result.rows.length) {
      toast('No cases found — try selecting just the table, or set “Sharpen text” to 0.');
    } else {
      const append = $('#appendMode').checked;
      state.rows = append ? [...state.rows, ...result.rows] : result.rows;
      if (!append) state.editingId = null;
      renderReview();
      showTab('review');
      const mine = result.rows.filter((r) => r.mine).length;
      toast(`${result.rows.length} case${result.rows.length === 1 ? '' : 's'} read via ${result.path} · ${mine} flagged as yours`);
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

/**
 * Read the selected region. A ruled table is read cell by cell from its grid;
 * anything else falls back to inferring structure from the text itself.
 */
async function extract() {
  const onProgress = (p, label) => setProgress(p, label);
  const terms = currentTerms();

  setProgress(0.05, 'Straightening the page…');
  const deskewed = deskewRegion(state.canvas, state.crop || {
    x0: 0, y0: 0, x1: state.canvas.width, y1: state.canvas.height,
  });

  const table = detectTable(deskewed);

  if (table && table.xs.length >= 5 && table.ys.length >= 2) {
    setProgress(0.1, 'Found the table grid — reading cells…');
    eraseTableLines(deskewed, table);
    const { lines, text } = await recognise(deskewed.canvas, { psm: '6', raw: true, onProgress });
    const { rows: records, mapping } = extractTableRows(lines, table);

    $('#rawText').textContent =
      `Read as a ruled table: ${table.xs.length - 1} columns × ${table.ys.length - 1} bands, `
      + `page straightened by ${deskewed.skew.toFixed(1)}°.\n`
      + `Columns found: ${mapping.filter(Boolean).join(', ')}\n\n${text.trim()}`;

    const rows = records.map((rec) => {
      const row = blankRow();
      Object.assign(row, rec.cells);
      const { age, sex } = splitAgeSex(rec.cells.ageSex);
      row.age = age;
      row.sex = sex;
      row.raw = Object.values(rec.cells).join(' ');
      for (const key of ['name', 'crNo', 'diagnosis', 'procedure']) {
        if (!row[key]) row.lowConf.push(key);
      }
      const { mine, matched } = flagCase(row, terms);
      row.mine = mine;
      row.matched = matched;
      return row;
    });

    if (rows.length) return { rows, path: 'table grid' };
  }

  // Fallback: no usable grid, so read it as free text.
  setProgress(0.1, 'No table grid found — reading as text…');
  const { lines, text, rejected } = await recognise(deskewed.canvas, { psm: state.opts.psm, onProgress });
  const noiseNote = rejected.length
    ? `\n\n— ${rejected.length} line(s) ignored as noise —\n${rejected.map((r) => r.text).join('\n')}`
    : '';
  $('#rawText').textContent = `Read as free text (no ruled grid detected).\n\n${text.trim() || '(nothing recognised)'}${noiseNote}`;

  const rows = parseCases(lines, terms).map((c) => {
    const row = blankRow();
    row.serial = c.serial;
    row.name = c.name;
    row.age = c.age;
    row.sex = c.sex;
    row.crNo = c.hospNo;
    row.diagnosis = c.diagnosis;
    row.procedure = c.procedure;
    row.surgeon = c.surgeon;
    row.raw = c.raw;
    row.mine = c.mine;
    row.matched = c.matched;
    row.lowConf = c.lowConf;
    return row;
  });
  return { rows, path: 'free text' };
}

function setProgress(p, label) {
  $('#progressBar').style.width = `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
  if (label) $('#progressText').textContent = label;
}

/* ------------------------------------------------------------------ review */

function renderHead() {
  const head = $('#casesHead');
  if (head.children.length) return;
  head.innerHTML =
    '<th class="c-mine" title="Is this one of your study cases?">Mine</th>'
    + FIELDS.map((f) => `<th class="${f.cls || ''}">${f.label}</th>`).join('')
    + '<th class="c-act"></th>';
}

function renderReview() {
  renderHead();
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
      td.dataset.field = field.key;
      if (field.cls) td.className = field.cls;
      td.textContent = row[field.key] || '';
      if (row.lowConf.includes(field.key)) td.classList.add('low-conf');

      td.addEventListener('input', () => {
        row[field.key] = td.textContent.trim();
        td.classList.remove('low-conf');
      });
      td.addEventListener('blur', () => {
        if (field.key === 'diagnosis' || field.key === 'procedure') refreshFlag(row, tr);
      });
      tr.appendChild(td);

      if (field.key === 'procedure' && row.matched?.length) {
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
  const row = blankRow();
  row.serial = String(state.rows.length + 1);
  state.rows.push(row);
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
      state.rows = entry.rows.map((r) => ({ ...blankRow(), ...r }));
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
