/*
 * Turns OCR output into patient rows, then decides which rows are study cases.
 *
 * Two things make this awkward and shape the whole file:
 *  1. An OT list is a table, but OCR hands back lines of text. Where a word's
 *     bounding box is available we recover columns from the horizontal gaps;
 *     otherwise we fall back to run-of-spaces / punctuation splitting.
 *  2. A single case often wraps onto two or three printed lines. Serial numbers
 *     are the only reliable row delimiter, so a line without one is treated as a
 *     continuation of the case above it.
 */

/* ------------------------------------------------------------------ terms - */

export const DEFAULT_STRONG = [
  'chordee',
  'chordee correction',
  'correction of chordee',
  "byar's flap",
  'byars flap',
  'byar flap',
  'orthoplasty',
  'penile curvature',
  'ventral curvature',
  'penile torsion',
  'dorsal plication',
  'nesbit',
];

export const DEFAULT_SUPPORT = [
  'hypospadias',
  'urethroplasty',
  'snodgrass',
  'tip repair',
  'tubularized incised plate',
  'urethral plate',
  'glanuloplasty',
  'magpi',
  'urethrocutaneous fistula',
  'chordee release',
  'penile degloving',
  'staged repair',
];

const OPERATIVE_WORDS = [
  'repair', 'correction', 'correct', 'plasty', 'release', 'straightening',
  'reconstruction', 'excision', 'flap', 'graft', 'redo', 'stage', 'staged',
  'plication', 'degloving', 'surgery', 'operation',
];

const DIAGNOSIS_HINTS = [
  'hypospadias', 'chordee', 'phimosis', 'hernia', 'hydrocele', 'undescended',
  'utd', 'cryptorchidism', 'torsion', 'stricture', 'fistula', 'epispadias',
  'curvature', 'atresia', 'stenosis', 'cyst', 'appendicitis', 'intussusception',
  'megaureter', 'reflux', 'valve', 'puv', 'ca ', 'carcinoma', 'trauma', 'burn',
  'fracture', 'abscess', 'polyp', 'fissure', 'fistula in ano', 'wilms', 'teratoma',
];

const PROCEDURE_HINTS = [
  'repair', 'plasty', 'ectomy', 'ostomy', 'otomy', 'pexy', 'scopy', 'graft',
  'flap', 'excision', 'exploration', 'release', 'correction', 'reduction',
  'closure', 'dilatation', 'biopsy', 'circumcision', 'herniotomy', 'orchidopexy',
  'urethroplasty', 'suturing', 'debridement', 'drainage', 'reconstruction',
];

const NAME_TITLES = ['master', 'mast', 'mr', 'mrs', 'ms', 'miss', 'baby', 'b/o', 'bo', 'kum', 'kumari', 'kum.'];

/** Suffixes that mark a word as the name of an operation. */
const PROCEDURE_SUFFIXES = ['ectomy', 'ostomy', 'otomy', 'pexy', 'plasty', 'scopy', 'rhaphy', 'desis'];

/** Words that belong to the operation but sit in front of the operative word. */
const PROCEDURE_MODIFIERS = [
  'byar', 'byars', 'byar’s', 'snodgrass', 'nesbit', 'tip', 'duckett', 'mathieu', 'magpi',
  'open', 'lap', 'laparoscopic', 'staged', 'stage', 'single', 'two', 'redo', 'rt', 'lt',
  'closed', 'elective', 'emergency', 'examination', 'incision', 'wide', 'total', 'partial',
  'right', 'left', 'bilateral', 'dorsal', 'ventral', 'dartos', 'preputial', 'buccal',
];

/** A patient's name stops as soon as clinical or anatomical vocabulary starts. */
const NAME_STOP_WORDS = [
  'rt', 'lt', 'right', 'left', 'bilateral', 'bl', 'mid', 'distal', 'proximal', 'severe',
  'mild', 'moderate', 'acute', 'chronic', 'post', 'with', 'for', 'penile', 'penoscrotal',
  'scrotal', 'coronal', 'subcoronal', 'glanular', 'perineal', 'inguinal', 'umbilical',
  'abdominal', 'anterior', 'posterior', 'recurrent', 'congenital', 'operated', 'k/c/o', 'c/o',
];

/* ------------------------------------------------------------- primitives - */

const norm = (s) => (s || '')
  .toLowerCase()
  .replace(/['’`]/g, '')
  .replace(/[^a-z0-9/\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const tight = (s) => norm(s).replace(/\s/g, '');

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Uint16Array(b.length + 1);
  let cur = new Uint16Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/**
 * Substring match first, then a fuzzy pass over word windows.
 *
 * Comparison happens on space-stripped text because OCR both mangles letters and
 * invents word breaks: "Byar's flap" can come back as "Byar s flcp". Windows of
 * n-1, n and n+1 words cover the split/joined cases.
 *
 * Short tokens are never fuzzed. Surgical abbreviations are three letters and
 * differ from each other by one: fuzzing "TIP repair" (tubularised incised
 * plate) happily matches "TEF repair" (tracheo-oesophageal fistula), which is a
 * different operation on a different patient. A term containing a short token
 * therefore requires that token literally, and a term that IS short is matched
 * exactly or not at all. Precision matters more than recall here — a missed row
 * is one tick in the review table, a false one is a wrong case in the study.
 */
export function fuzzyFind(haystack, term) {
  const hay = norm(haystack);
  const needle = norm(term);
  if (!hay || !needle) return null;
  if (hay.includes(needle)) return term;

  const needleTokens = needle.split(' ');
  const shortTokens = needleTokens.filter((t) => t.length <= 3);
  if (shortTokens.length) {
    // Every short token must appear verbatim, as a whole word.
    const hayTokens = new Set(hay.split(' '));
    if (!shortTokens.every((t) => hayTokens.has(t))) return null;
  }

  const needleTight = tight(needle);
  if (needleTight.length < 5) return null;
  if (tight(hay).includes(needleTight)) return term;

  const words = hay.split(' ');
  const n = needleTokens.length;
  const tolerance = needleTight.length < 12 ? 1 : needleTight.length < 20 ? 2 : 3;
  const sizes = [...new Set([n, n + 1, Math.max(1, n - 1)])];

  for (const size of sizes) {
    for (let i = 0; i + size <= words.length; i++) {
      const slice = words.slice(i, i + size);
      const window = slice.join('');
      if (Math.abs(window.length - needleTight.length) > tolerance) continue;
      if (levenshtein(window, needleTight) <= tolerance) return slice.join(' ');
    }
  }
  return null;
}

/** Collapse near-identical hits ("chordee" inside "chordee correction") for display. */
function dedupeMatches(matches) {
  const kept = [];
  for (const m of matches) {
    const t = tight(m);
    const dupe = kept.some((k) => {
      const kt = tight(k);
      return kt.includes(t) || t.includes(kt) || levenshtein(kt, t) <= 2;
    });
    if (!dupe) kept.push(m);
  }
  return kept;
}

/* --------------------------------------------------------------- columns - */

/** Split one OCR line into table cells using the gaps between word boxes. */
function lineToCells(line) {
  const words = (line.words || []).filter((w) => w.text && w.text.trim());

  if (words.length && words.every((w) => w.bbox)) {
    const heights = words.map((w) => w.bbox.y1 - w.bbox.y0).filter((h) => h > 0);
    const medHeight = median(heights) || 20;

    const gaps = [];
    for (let i = 1; i < words.length; i++) {
      gaps.push(Math.max(0, words[i].bbox.x0 - words[i - 1].bbox.x1));
    }

    // The median gap is useless here: on a wide table more than half of all gaps
    // ARE column gaps, which drags the threshold above them and merges every
    // column into one. The 25th percentile tracks ordinary word spacing instead,
    // floored and capped against text height so a sparse line stays sane.
    const wordGap = percentile(gaps, 0.25) || medHeight * 0.3;
    const breakAt = Math.min(
      Math.max(wordGap * 2.5, medHeight * 0.8),
      medHeight * 2.5
    );

    const cells = [];
    let cur = [words[0]];
    for (let i = 1; i < words.length; i++) {
      if (gaps[i - 1] >= breakAt) { cells.push(cur); cur = []; }
      cur.push(words[i]);
    }
    cells.push(cur);

    return cells.map((group) => ({
      text: group.map((w) => w.text).join(' ').trim(),
      x0: group[0].bbox.x0,
      confidence: avg(group.map((w) => w.confidence).filter((c) => c != null)),
    })).filter((c) => c.text);
  }

  // No geometry: fall back to wide whitespace, then pipes/tabs.
  const raw = line.text || '';
  const parts = raw.includes('|') ? raw.split('|') : raw.split(/\s{2,}|\t+/);
  return parts.map((t) => t.trim()).filter(Boolean)
    .map((t) => ({ text: t, x0: null, confidence: line.confidence ?? null }));
}

/** Strip the punctuation crumbs OCR leaves at the edges of a cell. */
const cleanCell = (t) => (t || '')
  .replace(/^[^A-Za-z0-9(]+/, '')
  .replace(/[^A-Za-z0-9)\].]+$/, '')
  .trim();

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

const percentile = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
};

/* ------------------------------------------------------------ field regex - */

// A serial is a small number followed either by punctuation, or by a space and a
// letter — "1.", "2)", "3 -" and a bare "4 Master Kiran" all occur on real lists.
const SERIAL_RE = /^\(?\s*(\d{1,2})\s*(?:[).:\-–\]]+\s*|\s+(?=[A-Za-z]))/;
const BARE_SERIAL_RE = /^\(?(\d{1,2})\s*[).:\-–\]]?$/;
const ID_LABELLED_RE = /\b(?:uhid|u\.?h\.?i\.?d|cr\.?\s*no|crno|cr|mrd|mr\.?\s*no|ip\.?\s*no|ipd?|op\.?\s*no|reg\.?\s*no|hosp\.?\s*no|hospital\s*no)\b[\s.:#-]*([a-z]{0,3}[-/]?\d{3,12})/i;
const ID_BARE_RE = /\b(\d{4,12})\b/;   // hospital numbers run short in some units
const SEX_ONLY_RE = /^\(?(m|f|male|female|boy|girl)\)?$/i;

const AGE_PATTERNS = [
  { re: /\b(\d{1,2})\s*(?:1\/2|½)?\s*(?:yrs?|years?|y\.?o\.?|y)\b/i, unit: 'y' },
  { re: /\b(\d{1,2})\s*(?:months?|mnths?|mths?|mos?|m0s)\b/i, unit: 'm' },
  { re: /\b(\d{1,2})\s*(?:days?|dys?)\b/i, unit: 'd' },
];
const AGE_SEX_RE = /\b(\d{1,2})\s*(?:yrs?|y)?\s*[/\\]\s*([mf])\b/i;
const SEX_AGE_RE = /\b([mf])\s*[/\\]\s*(\d{1,2})\s*(?:yrs?|y)?\b/i;
const SEX_WORD_RE = /\b(male|female|boy|girl)\b/i;
const SURGEON_RE = /\b(?:dr|prof|consultant)\b\.?\s*([a-z][a-z.\s]{1,28})/i;
// OCR frequently glues the title to the name ("DrRao"). Only trusted at the end
// of a row, so it cannot swallow words that merely start with "dr" (drainage…).
const SURGEON_GLUED_RE = /\bdr([a-z]{2,12})\s*$/i;

/**
 * @returns {{age:string, sex:string, spans:Array<[number,number]>}}
 *          spans are the character ranges consumed, so callers can cut them out.
 */
// OCR confuses digits with these letters constantly, and a serial column of one
// or two characters gives it no context to get it right — "5." becomes "S.".
const DIGIT_LOOKALIKES = { s: '5', o: '0', l: '1', i: '1', b: '8', z: '2', g: '6', q: '9', t: '7' };

/**
 * Read a leading serial number, tolerating both junk in front of it and
 * letter/digit confusion. Returns null when the line does not start a case.
 */
function serialPrefix(text) {
  const t = cleanCell(text);
  if (!t) return null;

  const direct = t.match(SERIAL_RE);
  if (direct) return { serial: direct[1], rest: t.slice(direct[0].length).trim() };

  const alt = t.match(/^([A-Za-z0-9]{1,2})\s*[).:]\s*(?=$|[A-Za-z])/);
  if (alt) {
    const digits = alt[1].replace(/[a-z]/gi, (ch) => DIGIT_LOOKALIKES[ch.toLowerCase()] ?? ch);
    if (/^\d{1,2}$/.test(digits)) return { serial: digits, rest: t.slice(alt[0].length).trim() };
  }
  return null;
}

function extractAgeSex(text) {
  let age = '', sex = '';
  const spans = [];

  let m = text.match(AGE_SEX_RE);
  if (m) {
    age = `${m[1]} y`; sex = m[2].toUpperCase();
    spans.push([m.index, m.index + m[0].length]);
  }
  if (!age && (m = text.match(SEX_AGE_RE))) {
    sex = m[1].toUpperCase(); age = `${m[2]} y`;
    spans.push([m.index, m.index + m[0].length]);
  }

  let ageEnd = spans.length ? spans[0][1] : -1;
  if (!age) {
    for (const { re, unit } of AGE_PATTERNS) {
      const hit = text.match(re);
      if (hit) {
        age = `${hit[1]} ${unit}`;
        ageEnd = hit.index + hit[0].length;
        spans.push([hit.index, ageEnd]);
        break;
      }
    }
  }

  if (!sex) {
    const w = text.match(SEX_WORD_RE);
    if (w) {
      sex = /^(male|boy)$/i.test(w[1]) ? 'M' : 'F';
      spans.push([w.index, w.index + w[0].length]);
    } else if (ageEnd >= 0) {
      // A lone M/F counts only when it sits right beside the age ("11 months M"),
      // otherwise it collides with initials in names.
      const tail = text.slice(ageEnd, ageEnd + 6);
      const bare = tail.match(/^[\s/,.-]*([MF])\b/i);
      if (bare) {
        sex = bare[1].toUpperCase();
        spans.push([ageEnd + bare.index, ageEnd + bare.index + bare[0].length]);
      }
    }
  }
  return { age, sex, spans };
}

/** Remove character ranges from a string, leaving a single space in their place. */
function cutSpans(text, spans) {
  let out = text;
  [...spans].sort((a, b) => b[0] - a[0]).forEach(([s, e]) => {
    out = `${out.slice(0, s)} ${out.slice(e)}`;
  });
  return out.replace(/\s{2,}/g, ' ').trim();
}

/* ------------------------------------------------------- row construction - */

function isHeaderLine(text) {
  const t = norm(text);
  if (!t) return false;
  const hits = ['name', 'age', 'sex', 'diagnosis', 'procedure', 'operation', 'surgeon', 'uhid', 'sl no', 'sr no', 'hosp']
    .filter((k) => t.includes(k)).length;
  return hits >= 2 && t.length < 140;
}

function isNoiseLine(text) {
  const t = norm(text);
  if (!t) return true;
  if (t.replace(/[^a-z0-9]/g, '').length < 3) return true;
  return /^(signature|sign|consultant|hod|prepared by|note|nb|anaesthetist|remarks|department of|govt|government|hospital|operation theatre|ot list|theatre list|date|list for)\b/.test(t);
}

// A serial as its own token ("3." / "(4)"), or glued to what follows ("3.Master").
const EMBEDDED_SERIAL_RE = /^\(?(\d{1,2})\s*[).:]\s*(?=$|[A-Za-z])/;

/**
 * OCR regularly merges two table rows into a single text line when the photo is
 * skewed or the rows sit close together. A serial number appearing partway
 * through a line is the giveaway, so cut there and recover both cases.
 */
function splitMergedRows(line) {
  const words = line.words || [];

  if (words.length >= 6) {
    const cuts = [];
    for (let i = 3; i < words.length - 2; i++) {
      if (EMBEDDED_SERIAL_RE.test(words[i].text)) cuts.push(i);
    }
    if (cuts.length) {
      const pieces = [];
      let start = 0;
      for (const cut of [...cuts, words.length]) {
        const slice = words.slice(start, cut);
        if (slice.length) {
          pieces.push({
            ...line,
            words: slice,
            text: slice.map((w) => w.text).join(' '),
            bbox: slice[0].bbox && slice[slice.length - 1].bbox
              ? { ...slice[0].bbox, x1: slice[slice.length - 1].bbox.x1 }
              : line.bbox,
          });
        }
        start = cut;
      }
      return pieces;
    }
    return [line];
  }

  // Text-only fallback (no word geometry available).
  const parts = line.text.split(/\s+(?=\(?\d{1,2}[).]\s*[A-Za-z])/);
  if (parts.length < 2) return [line];
  return parts
    .filter((t) => t.trim())
    .map((t) => ({ ...line, text: t.trim(), words: [] }));
}

/** Group OCR lines into one entry per case. */
function groupIntoRows(rawLines) {
  const lines = rawLines.flatMap(splitMergedRows);
  const usable = lines.filter((l) => !isHeaderLine(l.text) && !isNoiseLine(l.text));
  const cellLines = usable.map((l) => ({ line: l, cells: lineToCells(l) }));

  const startsRow = ({ line, cells }) =>
    serialPrefix(line.text) !== null ||
    (cells.length > 1 && BARE_SERIAL_RE.test(cleanCell(cells[0].text)));

  const anySerial = cellLines.some(startsRow);
  const rows = [];

  for (const item of cellLines) {
    if (!anySerial || startsRow(item) || !rows.length) {
      rows.push({ cells: [...item.cells], raw: [item.line.text], confidence: [item.line.confidence] });
    } else {
      const last = rows[rows.length - 1];
      last.cells.push(...item.cells);
      last.raw.push(item.line.text);
      last.confidence.push(item.line.confidence);
    }
  }
  return rows;
}

/* ------------------------------------------------------ cell → field map - */

function looksClinical(text) {
  const t = norm(text);
  return DIAGNOSIS_HINTS.some((k) => t.includes(k)) || PROCEDURE_HINTS.some((k) => t.includes(k));
}

function looksProcedural(text) {
  const t = norm(text);
  const proc = PROCEDURE_HINTS.filter((k) => t.includes(k)).length;
  const diag = DIAGNOSIS_HINTS.filter((k) => t.includes(k)).length;
  return proc > diag;
}

function looksLikeName(text) {
  const t = text.trim();
  if (!t || /\d{3,}/.test(t)) return false;
  const words = norm(t).split(' ');
  if (words.some((w) => NAME_TITLES.includes(w))) return true;
  const letters = t.replace(/[^a-zA-Z]/g, '').length;
  return letters >= 3 && words.length <= 4 && !looksClinical(t);
}

const isProcedureWord = (w) => {
  const t = norm(w);
  return PROCEDURE_HINTS.some((k) => t.includes(k.trim())) || PROCEDURE_SUFFIXES.some((s) => t.endsWith(s));
};

const isNameStopWord = (w) => {
  const t = norm(w);
  if (!t) return true;
  return NAME_STOP_WORDS.includes(t) || DIAGNOSIS_HINTS.some((k) => t.includes(k.trim())) || isProcedureWord(t);
};

/** Leading words of a row that are the patient's name rather than the diagnosis. */
function takeName(words) {
  const name = [];
  for (const w of words) {
    const t = norm(w);
    if (!t) break;
    if (NAME_TITLES.includes(t)) { name.push(w); continue; }
    if (name.length >= 4 || /\d/.test(w) || isNameStopWord(w)) break;
    name.push(w);
    if (name.length >= 3) break;   // names on OT lists are rarely longer
  }
  return { name: name.join(' ').trim(), rest: words.slice(name.length) };
}

/** Split the clinical remainder into diagnosis and planned procedure. */
function splitClinical(text) {
  const sep = text.match(/\s+(?:[-–—:]|for|planned for|posted for)\s+/i);
  if (sep && sep.index > 0) {
    return {
      diagnosis: text.slice(0, sep.index).trim(),
      procedure: text.slice(sep.index + sep[0].length).trim(),
    };
  }

  const words = text.split(/\s+/).filter(Boolean);
  let cut = words.findIndex(isProcedureWord);
  if (cut < 0) return { diagnosis: text.trim(), procedure: '' };

  // Pull in the words that qualify the operation ("Byar's" flap, "Rt" orchidopexy).
  while (cut > 0 && PROCEDURE_MODIFIERS.includes(norm(words[cut - 1]))) cut--;
  if (cut === 0) return { diagnosis: '', procedure: text.trim() };

  return {
    diagnosis: words.slice(0, cut).join(' ').trim(),
    procedure: words.slice(cut).join(' ').trim(),
  };
}

/**
 * Fallback for rows OCR gives back as one undifferentiated string — common with
 * tight handwriting, where there are no wide gaps to recover columns from.
 * Fields are carved out by pattern, most distinctive first, and whatever survives
 * is the name plus clinical text.
 */
function carveRow(text) {
  const out = { serial: '', name: '', age: '', sex: '', hospNo: '', diagnosis: '', procedure: '', surgeon: '' };
  let t = text.trim();

  const sm = t.match(SERIAL_RE);
  if (sm) { out.serial = sm[1]; t = t.slice(sm[0].length).trim(); }

  const dr = t.match(/\b(?:dr|prof)\b\.?\s*[a-z][a-z.]*(?:\s+[a-z][a-z.]*){0,2}/i);
  if (dr) {
    out.surgeon = dr[0].replace(/\s+/g, ' ').trim();
    t = cutSpans(t, [[dr.index, dr.index + dr[0].length]]);
  }

  const labelled = t.match(ID_LABELLED_RE);
  if (labelled) {
    out.hospNo = labelled[1];
    t = cutSpans(t, [[labelled.index, labelled.index + labelled[0].length]]);
  } else {
    const bare = t.match(ID_BARE_RE);
    if (bare) {
      out.hospNo = bare[1];
      t = cutSpans(t, [[bare.index, bare.index + bare[0].length]]);
    }
  }

  const { age, sex, spans } = extractAgeSex(t);
  out.age = age;
  out.sex = sex;
  if (spans.length) t = cutSpans(t, spans);

  const { name, rest } = takeName(t.split(/\s+/).filter(Boolean));
  out.name = name;
  Object.assign(out, splitClinical(rest.join(' ')));
  return out;
}

function buildCase(row, index) {
  const cells = row.cells.map((c) => ({ ...c, text: cleanCell(c.text) })).filter((c) => c.text);
  const rawText = row.raw.join(' ');
  const taken = new Set();
  const take = (i) => { taken.add(i); };

  const out = {
    id: `${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    serial: '', name: '', age: '', sex: '', hospNo: '',
    diagnosis: '', procedure: '', surgeon: '',
    raw: rawText,
    mine: false, matched: [], lowConf: [],
    manualFlag: false,
  };

  // 1 — serial number, either as its own cell or a prefix on the first cell.
  if (cells.length) {
    const bare = cells[0].text.match(BARE_SERIAL_RE);
    if (bare) {
      out.serial = bare[1];
      take(0);
    } else {
      const prefix = serialPrefix(cells[0].text);
      if (prefix) {
        out.serial = prefix.serial;
        cells[0].text = prefix.rest;
        if (!cells[0].text) take(0);
      }
    }
  }

  // A cell is only consumed when the match accounts for nearly all of it —
  // otherwise a stray number would swallow a cell holding the whole case.
  const consumeIfMostly = (i, matchText) =>
    cells[i].text.length <= matchText.length + 6 ? (take(i), true) : false;

  // 2 — hospital number: prefer an explicitly labelled one anywhere in the row.
  const labelled = rawText.match(ID_LABELLED_RE);
  if (labelled) {
    out.hospNo = labelled[1];
    cells.forEach((c, i) => { if (!taken.has(i) && c.text.includes(labelled[1])) consumeIfMostly(i, labelled[0]); });
  } else {
    for (let i = 0; i < cells.length; i++) {
      if (taken.has(i)) continue;
      const m = cells[i].text.match(ID_BARE_RE);
      if (m) { out.hospNo = m[1]; consumeIfMostly(i, m[0]); break; }
    }
  }

  // 3 — age and sex, from a dedicated cell where possible.
  for (let i = 0; i < cells.length; i++) {
    if (taken.has(i)) continue;
    const solo = cells[i].text.match(SEX_ONLY_RE);   // a column holding just "M"
    if (solo) {
      out.sex = out.sex || (/^(m|male|boy)$/i.test(solo[1]) ? 'M' : 'F');
      take(i);
      continue;
    }
    const { age, sex, spans } = extractAgeSex(cells[i].text);
    if (age || (sex && cells[i].text.length <= 8)) {
      out.age = out.age || age;
      out.sex = out.sex || sex;
      const span = spans.length ? cells[i].text.slice(spans[0][0], spans[spans.length - 1][1]) : '';
      consumeIfMostly(i, span);
    }
    if (out.age && out.sex) break;
  }
  if (!out.age || !out.sex) {
    const fallback = extractAgeSex(rawText);
    out.age = out.age || fallback.age;
    out.sex = out.sex || fallback.sex;
  }

  // 4 — surgeon.
  for (let i = cells.length - 1; i >= 0; i--) {          // surgeon sits at the right
    if (taken.has(i)) continue;
    const cell = cells[i].text;
    if (/\b(dr|prof)\b/i.test(cell)) {
      const m = cell.match(SURGEON_RE);
      out.surgeon = (m ? `Dr ${m[1].trim()}` : cell).replace(/\s+/g, ' ');
      take(i);
      break;
    }
    const glued = cell.match(SURGEON_GLUED_RE);
    if (glued) {
      out.surgeon = `Dr ${glued[1]}`;
      const remainder = cell.slice(0, glued.index).trim();
      if (remainder) cells[i].text = remainder;          // keep the rest of the cell
      else take(i);
      break;
    }
  }

  // 5 — name: leftmost remaining cell that reads like a person, not a condition.
  for (let i = 0; i < cells.length; i++) {
    if (taken.has(i)) continue;
    if (looksLikeName(cells[i].text)) { out.name = cells[i].text; take(i); break; }
    if (looksClinical(cells[i].text)) break;   // we've reached the clinical columns
  }

  // 6 — whatever is left is clinical text: first chunk diagnosis, rest procedure.
  const rest = cells.filter((_, i) => !taken.has(i)).map((c) => c.text);
  if (rest.length === 1) {
    if (looksProcedural(rest[0])) out.procedure = rest[0];
    else out.diagnosis = rest[0];
  } else if (rest.length > 1) {
    const procStart = rest.findIndex((t, i) => i > 0 && looksProcedural(t));
    if (procStart > 0) {
      out.diagnosis = rest.slice(0, procStart).join(' ');
      out.procedure = rest.slice(procStart).join(' ');
    } else {
      out.diagnosis = rest[0];
      out.procedure = rest.slice(1).join(' ');
    }
  }

  // Nothing landed in name but we do have leftovers — take the first as the name.
  if (!out.name && !out.diagnosis && out.procedure) { out.diagnosis = out.procedure; out.procedure = ''; }
  if (!out.name) {
    const spare = cells.find((c, i) => !taken.has(i) && !looksClinical(c.text));
    if (spare) out.name = spare.text;
  }

  // Column recovery failed, or the row arrived as one blob: carve it by pattern.
  const columnsWorked = cells.length >= 3 && out.name && (out.diagnosis || out.procedure);
  if (!columnsWorked) {
    const carved = carveRow(rawText);
    for (const key of ['serial', 'name', 'age', 'sex', 'hospNo', 'diagnosis', 'procedure', 'surgeon']) {
      if (carved[key] && !out[key]) out[key] = carved[key];
    }
    // A single blob split into name + clinical text beats one field holding everything.
    if (carved.name && carved.diagnosis) {
      out.name = carved.name;
      out.diagnosis = carved.diagnosis;
      out.procedure = carved.procedure || out.procedure;
    }
  }

  const conf = avg(row.confidence.filter((c) => c != null));
  if (conf != null && conf < 72) out.lowConf.push('name', 'diagnosis', 'procedure');
  if (!out.name) out.lowConf.push('name');
  if (!out.age) out.lowConf.push('age');
  if (!out.hospNo) out.lowConf.push('hospNo');

  return out;
}

/* ------------------------------------------------------------- flagging - */

/**
 * Decide whether a row is one of the study's chordee cases.
 * Strong term anywhere → yes. Supporting term → yes only with an operative word,
 * which keeps a plain "hypospadias" follow-up review out of the operative set.
 */
export function flagCase(row, terms) {
  const strong = terms?.strong?.length ? terms.strong : DEFAULT_STRONG;
  const support = terms?.support?.length ? terms.support : DEFAULT_SUPPORT;

  const haystack = [row.diagnosis, row.procedure, row.raw].filter(Boolean).join(' ; ');
  const matched = [];

  for (const term of strong) {
    if (fuzzyFind(haystack, term)) matched.push(term);
  }
  if (matched.length) return { mine: true, matched: dedupeMatches(matched) };

  const supportHits = dedupeMatches(support.filter((term) => fuzzyFind(haystack, term)));
  if (supportHits.length) {
    const operative = OPERATIVE_WORDS.some((w) => fuzzyFind(haystack, w));
    return { mine: operative, matched: supportHits };
  }
  return { mine: false, matched: [] };
}

/* ------------------------------------------------------------- entry pt - */

export function parseCases(lines, terms) {
  return groupIntoRows(lines)
    .map(buildCase)
    .filter((c) => c.name || c.diagnosis || c.procedure || c.hospNo)
    .map((c) => {
      const { mine, matched } = flagCase(c, terms);
      c.mine = mine;
      c.matched = matched;
      return c;
    });
}
