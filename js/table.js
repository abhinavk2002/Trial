/*
 * Grid-based table extraction for the AIIMS Bhopal paediatric surgery OT list.
 *
 * The form is ruled and its layout is identical every day, so rather than
 * guessing structure from word spacing we read the printed rules: vertical ones
 * give the columns, horizontal ones give the patient rows. Every OCR word is
 * then dropped into the cell its centre falls in, which is what makes wrapped
 * text work — a four-line diagnosis is still one cell.
 *
 * One quirk of this particular form drives the design: its horizontal rules do
 * not cross the whole table. The right-hand columns are divided at their own
 * heights, so row bands are measured over the left columns only, where the
 * divisions correspond to actual patients.
 */

import { estimateSkew, findGridLines, buildCells, eraseLines } from './grid.js';

/** The columns as printed, in order, with the field each maps to. */
export const COLUMN_SPEC = [
  { key: 'serial', header: 's no', aliases: ['s.no', 'sl no', 'sr no', 'no'] },
  { key: 'name', header: 'name', aliases: ['patient name'] },
  { key: 'ageSex', header: 'age/sex', aliases: ['age sex', 'age'] },
  { key: 'crNo', header: 'cr no', aliases: ['cr no.', 'crno', 'uhid'] },
  { key: 'ward', header: 'ward/bed no', aliases: ['ward bed no', 'ward', 'ward/bed'] },
  { key: 'diagnosis', header: 'diagnosis', aliases: ['dignosis'] },
  { key: 'procedure', header: 'procedure', aliases: ['procedure planned'] },
  { key: 'serology', header: 'viral serology', aliases: ['serology'] },
  { key: 'bloodGroup', header: 'blood group and availability', aliases: ['blood group', 'blood'] },
  { key: 'duration', header: 'duration', aliases: ['durat ion', 'durat'] },
  { key: 'special', header: 'special requirement', aliases: ['special req', 'special'] },
  { key: 'position', header: 'position', aliases: [] },
  { key: 'surgeon', header: 'operating surgeon and team', aliases: ['operating surgeon', 'surgeon and team', 'surgeon'] },
  { key: 'anaesthesia', header: 'anesthesia', aliases: ['anaesthesia', 'anesthesi a', 'anesthesi'] },
  { key: 'remarks', header: 'remarks', aliases: [] },
];

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = new Uint16Array(b.length + 1);
  let cur = new Uint16Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Deskew a region of the preprocessed canvas into a fresh canvas. */
export function deskewRegion(canvas, crop) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const gray = new Uint8ClampedArray(w * h);
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) gray[p] = data[i];

  const region = {
    x0: Math.max(0, Math.round(crop?.x0 ?? 0)),
    y0: Math.max(0, Math.round(crop?.y0 ?? 0)),
    x1: Math.min(w, Math.round(crop?.x1 ?? w)),
    y1: Math.min(h, Math.round(crop?.y1 ?? h)),
  };
  const cw = Math.max(1, region.x1 - region.x0);
  const ch = Math.max(1, region.y1 - region.y0);

  const skew = estimateSkew(gray, w, h, { region });

  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  const octx = out.getContext('2d', { willReadFrequently: true });
  octx.fillStyle = '#fff';
  octx.fillRect(0, 0, cw, ch);
  octx.save();
  octx.translate(cw / 2, ch / 2);
  octx.rotate((-skew * Math.PI) / 180);
  octx.drawImage(canvas, region.x0, region.y0, cw, ch, -cw / 2, -ch / 2, cw, ch);
  octx.restore();

  return { canvas: out, skew, width: cw, height: ch };
}

function toBinary(canvas) {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) g[p] = d[i] < 128 ? 0 : 255;
  return g;
}

/**
 * Locate the table. Columns come from the vertical rules; row bands are then
 * measured across the left-hand columns only (see the note at the top).
 */
export function detectTable(deskewed) {
  const w = deskewed.width, h = deskewed.height;
  const g = toBinary(deskewed.canvas);

  const { xs } = findGridLines(g, w, h, {
    minVFrac: 0.10, minHFrac: 9, gapTolerance: 4, mergeWithin: 20,
  });
  if (xs.length < 4) return null;

  // Left columns: up to the procedure column, or 40% across if we found few.
  const leftEnd = xs.length > 7 ? xs[7] : xs[Math.max(1, Math.floor(xs.length * 0.4))];

  // Prefer the setting that finds the MOST plausible rules: a row division that
  // is faint in one place still separates two patients, and missing it merges
  // two cases into one. Spurious extras are cheaper — they yield a blank band.
  let ys = [];
  for (const frac of [0.45, 0.55, 0.65, 0.75]) {
    const found = findGridLines(g, w, h, {
      minHFrac: frac, minVFrac: 9, gapTolerance: 8, mergeWithin: 14,
      hRegion: { x0: xs[0], x1: leftEnd },
    }).ys;
    if (found.length > ys.length && found.length <= 40) ys = found;
  }
  if (ys.length < 2) return null;

  return { xs, ys, cells: buildCells(xs, ys), width: w, height: h, binary: g };
}

/** Paint the rules out so OCR does not read them as pipes and dashes. */
export function eraseTableLines(deskewed, table) {
  const ctx = deskewed.canvas.getContext('2d');
  eraseLines(ctx, table.xs, table.ys, deskewed.width, deskewed.height, 3);
  return deskewed.canvas;
}

/** Put every OCR word into the cell its centre lands in. */
function assignWords(lines, table) {
  const grid = new Map();                 // "row:col" -> words[]
  const colOf = (x) => {
    for (let c = 0; c < table.xs.length - 1; c++) {
      if (x >= table.xs[c] && x < table.xs[c + 1]) return c;
    }
    return -1;
  };
  const rowOf = (y) => {
    for (let r = 0; r < table.ys.length - 1; r++) {
      if (y >= table.ys[r] && y < table.ys[r + 1]) return r;
    }
    return -1;
  };

  for (const line of lines) {
    for (const word of line.words || []) {
      if (!word.bbox) continue;
      const cx = (word.bbox.x0 + word.bbox.x1) / 2;
      const cy = (word.bbox.y0 + word.bbox.y1) / 2;
      const c = colOf(cx), r = rowOf(cy);
      if (c < 0 || r < 0) continue;
      const key = `${r}:${c}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(word);
    }
  }

  // Read each cell in reading order so wrapped text comes back in sequence.
  const text = new Map();
  for (const [key, words] of grid) {
    words.sort((a, b) => {
      const dy = (a.bbox.y0 + a.bbox.y1) / 2 - (b.bbox.y0 + b.bbox.y1) / 2;
      if (Math.abs(dy) > 8) return dy;
      return a.bbox.x0 - b.bbox.x0;
    });
    text.set(key, words.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim());
  }
  return text;
}

/**
 * Work out which detected column is which field.
 *
 * The columns are matched to the printed sequence *in order* rather than each
 * one independently: the form's column order never changes, so alignment can
 * carry a column whose header OCR'd badly, and it cannot produce the crossed-up
 * assignment that independent matching does when two headers read alike (the
 * form has both "S.No" and "CR NO."). Missing rules simply leave a gap.
 */
function mapColumns(cellText, table, headerRows) {
  const nCols = table.xs.length - 1;

  const headerFor = (c) => norm(headerRows
    .map((r) => cellText.get(`${r}:${c}`) || '')
    .join(' '));

  // Similarity of a detected column's header to a spec, 0..1.
  const affinity = (text, spec) => {
    if (!text) return 0.35;                       // unreadable: neutral, let order decide
    let best = 0;
    for (const candidate of [spec.header, ...spec.aliases]) {
      const cand = norm(candidate);
      if (!cand) continue;
      let s;
      if (text === cand) s = 1;
      else if (text.includes(cand) || cand.includes(text)) s = 0.9;
      else {
        const dist = levenshtein(text, cand);
        s = 1 - dist / Math.max(text.length, cand.length);
      }
      if (s > best) best = s;
    }
    return best;
  };

  const headers = [];
  for (let c = 0; c < nCols; c++) headers.push(headerFor(c));

  // Needleman-Wunsch style alignment of detected columns to COLUMN_SPEC.
  const S = COLUMN_SPEC.length;
  const GAP = -0.25;
  const dp = Array.from({ length: nCols + 1 }, () => new Float64Array(S + 1).fill(-Infinity));
  const from = Array.from({ length: nCols + 1 }, () => new Int8Array(S + 1));
  dp[0][0] = 0;
  for (let i = 0; i <= nCols; i++) {
    for (let j = 0; j <= S; j++) {
      if (dp[i][j] === -Infinity) continue;
      if (i < nCols && j < S) {                      // match column i to spec j
        const v = dp[i][j] + affinity(headers[i], COLUMN_SPEC[j]);
        if (v > dp[i + 1][j + 1]) { dp[i + 1][j + 1] = v; from[i + 1][j + 1] = 1; }
      }
      if (j < S) {                                   // spec j not present (missing rule)
        const v = dp[i][j] + GAP;
        if (v > dp[i][j + 1]) { dp[i][j + 1] = v; from[i][j + 1] = 2; }
      }
      if (i < nCols) {                               // extra detected column
        const v = dp[i][j] + GAP;
        if (v > dp[i + 1][j]) { dp[i + 1][j] = v; from[i + 1][j] = 3; }
      }
    }
  }

  const mapping = new Array(nCols).fill(null);
  let i = nCols, j = S;
  while (i > 0 || j > 0) {
    const step = from[i][j];
    if (step === 1) { mapping[i - 1] = COLUMN_SPEC[j - 1].key; i--; j--; }
    else if (step === 2) { j--; }
    else if (step === 3) { i--; }
    else break;
  }
  return mapping;
}

/** Strip the debris left where the printed rules were painted out. */
const cleanCellText = (t) => (t || '')
  .split(/\s+/)
  .filter((tok) => /[A-Za-z0-9]/.test(tok))
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

/** "1Y/F", "68D/F", "5 MTH /M", "4y/M" → { age, sex }. */
export function splitAgeSex(raw) {
  const t = (raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return { age: '', sex: '' };

  const sexMatch = t.match(/\b([MF])\b\s*$/i) || t.match(/[/\\]\s*([MF])\b/i) || t.match(/\b(male|female)\b/i);
  let sex = '';
  if (sexMatch) {
    const s = sexMatch[1].toUpperCase();
    sex = s.startsWith('M') ? 'M' : 'F';
  }

  const num = t.match(/(\d{1,3})\s*([a-z]*)/i);
  let age = '';
  if (num) {
    const unitRaw = (num[2] || '').toLowerCase();
    const rest = t.toLowerCase();
    let unit = 'y';
    if (/^d/.test(unitRaw) || /\bdays?\b/.test(rest)) unit = 'd';
    else if (/^m(th|on|o)/.test(unitRaw) || /\bmth|month/.test(rest)) unit = 'm';
    else if (/^y/.test(unitRaw) || /\byrs?|year/.test(rest)) unit = 'y';
    else if (/\bmth\b|\bmonths?\b/.test(rest)) unit = 'm';
    age = `${num[1]} ${unit}`;
  }
  return { age, sex };
}

/**
 * Full extraction. Returns one record per patient row, keyed by the form's own
 * column names, plus the raw cell text for anything unmapped.
 */
export function extractTableRows(lines, table) {
  const cellText = assignWords(lines, table);
  const nRows = table.ys.length - 1;
  const nCols = table.xs.length - 1;

  const rowText = (r) => {
    const parts = [];
    for (let c = 0; c < nCols; c++) {
      const t = cleanCellText(cellText.get(`${r}:${c}`));
      if (t) parts.push(t);
    }
    return parts.join(' ');
  };

  // Header rows are the leading bands that mention the printed column names.
  const headerRows = [];
  for (let r = 0; r < nRows; r++) {
    const t = norm(rowText(r));
    const isHeader = ['name', 'diagnosis', 'procedure', 'cr no', 'age', 'remarks']
      .filter((k) => t.includes(k)).length >= 2;
    if (isHeader) headerRows.push(r);
    else if (headerRows.length) break;
  }
  if (!headerRows.length) headerRows.push(0);

  const mapping = mapColumns(cellText, table, headerRows);
  const firstDataRow = Math.max(...headerRows) + 1;

  const rows = [];
  for (let r = firstDataRow; r < nRows; r++) {
    const record = { cells: {} };
    let filled = 0;
    for (let c = 0; c < nCols; c++) {
      const t = cleanCellText(cellText.get(`${r}:${c}`));
      if (!t) continue;
      filled++;
      const key = mapping[c];
      if (key) record.cells[key] = record.cells[key] ? `${record.cells[key]} ${t}` : t;
      else record.cells[`col${c}`] = t;
    }
    // Ignore the blank band that usually follows the last patient.
    if (filled < 2) continue;
    rows.push(record);
  }

  return { rows, mapping, headerRows, cellText };
}
