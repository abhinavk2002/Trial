/* localStorage persistence + CSV/JSON export. Single-user, single-device by design. */

const LISTS_KEY = 'otx.lists.v1';
const TERMS_KEY = 'otx.terms.v1';
const THEME_KEY = 'otx.theme';

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

export const getLists = () => read(LISTS_KEY, []);

export function saveList(entry) {
  const lists = getLists();
  const i = lists.findIndex((l) => l.id === entry.id);
  if (i >= 0) lists[i] = entry;
  else lists.unshift(entry);
  lists.sort((a, b) => (b.listDate || '').localeCompare(a.listDate || ''));
  persist(lists);
  return entry;
}

export function deleteList(id) {
  persist(getLists().filter((l) => l.id !== id));
}

export function replaceAll(lists) {
  persist(lists);
}

function persist(lists) {
  try {
    localStorage.setItem(LISTS_KEY, JSON.stringify(lists));
  } catch (err) {
    throw new Error('Browser storage is full — export a backup and delete older lists.');
  }
}

export const getTerms = () => read(TERMS_KEY, null);
export const setTerms = (terms) => localStorage.setItem(TERMS_KEY, JSON.stringify(terms));

export const getTheme = () => localStorage.getItem(THEME_KEY) || 'light';
export const setTheme = (t) => localStorage.setItem(THEME_KEY, t);

/* --------------------------------------------------------------- export - */

const COLUMNS = [
  ['listDate', 'List date'],
  ['unit', 'Unit / theatre'],
  ['serial', 'Sl no'],
  ['name', 'Patient name'],
  ['age', 'Age'],
  ['sex', 'Sex'],
  ['hospNo', 'Hospital no'],
  ['diagnosis', 'Diagnosis'],
  ['procedure', 'Procedure planned'],
  ['surgeon', 'Surgeon / unit'],
  ['mine', 'Study case'],
  ['matched', 'Matched terms'],
  ['raw', 'Raw OCR line'],
];

const escapeCsv = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows, meta = {}) {
  const head = COLUMNS.map(([, label]) => label).join(',');
  const body = rows.map((r) =>
    COLUMNS.map(([key]) => {
      if (key === 'listDate') return escapeCsv(r.listDate ?? meta.listDate ?? '');
      if (key === 'unit') return escapeCsv(r.unit ?? meta.unit ?? '');
      if (key === 'mine') return r.mine ? 'YES' : '';
      if (key === 'matched') return escapeCsv((r.matched || []).join('; '));
      return escapeCsv(r[key]);
    }).join(',')
  );
  // BOM keeps Excel happy with any non-ASCII in names.
  return '﻿' + [head, ...body].join('\r\n');
}

export function download(filename, content, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
