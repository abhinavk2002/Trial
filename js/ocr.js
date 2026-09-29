/*
 * Tesseract wrapper. Keeps a single worker alive across extractions so the
 * ~15 MB engine + language data is only fetched and initialised once.
 */

let workerPromise = null;

async function getWorker(onProgress) {
  if (!workerPromise) {
    // Set window.OTX_OCR_PATHS = { workerPath, corePath, langPath } to serve the
    // engine and language data from your own copy instead of the CDN — useful if
    // the hospital network blocks jsdelivr, or to make the app fully offline.
    const paths = (typeof window !== 'undefined' && window.OTX_OCR_PATHS) || {};

    workerPromise = Tesseract.createWorker('eng', 1, {
      ...paths,
      logger: (m) => {
        if (!onProgress) return;
        if (m.status === 'recognizing text') onProgress(m.progress, 'Reading the list…');
        else onProgress(m.progress * 0.9, capitalise(m.status));
      },
    }).catch((err) => {
      workerPromise = null;           // let the next attempt retry the download
      throw err;
    });
  }
  return workerPromise;
}

function capitalise(s = '') {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * @param {HTMLCanvasElement} canvas  preprocessed image
 * @param {{psm?:string, raw?:boolean, onProgress?:Function}} opts
 *        raw — skip noise filtering. Used by the grid reader, where the table's
 *        own rules supply the structure and a short cell like "GA" or "1 HR" is
 *        real content that the line filter would otherwise discard.
 * @returns {Promise<{text:string, lines:Array, rejected:Array}>}
 */
export async function recognise(canvas, opts = {}) {
  const worker = await getWorker(opts.onProgress);

  await worker.setParameters({
    tessedit_pageseg_mode: String(opts.psm || '6'),
    preserve_interword_spaces: '1',
  });

  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  const rejected = [];
  return { text: data.text || '', lines: extractLines(data, rejected, opts.raw === true), rejected };
}

const WORD_CONF_FLOOR = 30;
const LINE_CONF_FLOOR = 40;
const SOLO_LETTER_CONF = 60;   // a lone letter must be confidently read to survive

/**
 * Drop the fragments that grain and paper texture produce, while keeping the
 * things a real row depends on — digits, M/F, and anything read confidently.
 */
function keepWord(w) {
  const t = (w.text || '').trim();
  if (!t) return false;
  const conf = typeof w.confidence === 'number' ? w.confidence : 100;
  if (conf < WORD_CONF_FLOOR) return false;

  const alnum = t.replace(/[^A-Za-z0-9]/g, '');
  if (!alnum) return conf >= SOLO_LETTER_CONF;                       // pure punctuation
  if (alnum.length === 1 && !/[0-9MF]/i.test(alnum)) return conf >= SOLO_LETTER_CONF;
  return true;
}

/**
 * Is this line the scanner reading the paper itself rather than the list?
 *
 * The test is for *substantive* words, not for the ratio of short ones: a real
 * row often picks up a few speckle fragments at its edges, so counting those
 * against it throws away good data. Noise lines, by contrast, almost never
 * produce two words of four or more characters.
 */
function isJunkLine(text, confidence) {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  if (typeof confidence === 'number' && confidence < LINE_CONF_FLOOR) return true;

  const alnum = (t) => t.replace(/[^A-Za-z0-9]/g, '');
  const substantive = tokens.filter((t) => alnum(t).length >= 4).length;
  const hasIdNumber = tokens.some((t) => /^\d{4,}$/.test(alnum(t)));

  return substantive < 2 && !(substantive === 1 && hasIdNumber);
}

/**
 * tesseract.js has moved the line structure around between majors, so dig for it
 * rather than trusting one shape; fall back to plain text if all else fails.
 */
function extractLines(data, rejected, raw = false) {
  const lines = [];

  const push = (line) => {
    const words = (line.words || [])
      .filter((w) => (raw ? !!(w.text && w.text.trim()) : keepWord(w)))
      .map((w) => ({
        text: w.text.trim(),
        bbox: w.bbox || null,
        confidence: typeof w.confidence === 'number' ? w.confidence : null,
      }));
    // Rebuild the text from surviving words so dropped speckle really is gone.
    const text = (words.length ? words.map((w) => w.text).join(' ') : line.text || '').replace(/\s+$/, '');
    const confidence = typeof line.confidence === 'number' ? line.confidence : null;
    if (!text.trim()) return;
    if (!raw && isJunkLine(text, confidence)) {
      rejected.push({ text, confidence });
      return;
    }
    lines.push({
      text,
      bbox: line.bbox || null,
      confidence: typeof line.confidence === 'number' ? line.confidence : null,
      words,
    });
  };

  if (Array.isArray(data.blocks)) {
    for (const block of data.blocks) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) push(line);
      }
      for (const line of block.lines || []) push(line);   // some builds skip paragraphs
    }
  }
  if (!lines.length && Array.isArray(data.lines)) data.lines.forEach(push);

  if (!lines.length && data.text) {
    data.text.split('\n').forEach((t) => {
      if (t.trim()) lines.push({ text: t.replace(/\s+$/, ''), bbox: null, confidence: null, words: [] });
    });
  }

  if (lines.length && lines.every((l) => l.bbox)) {
    lines.sort((a, b) => a.bbox.y0 - b.bbox.y0);
  }
  return lines;
}

export async function terminate() {
  if (!workerPromise) return;
  try { (await workerPromise).terminate(); } catch { /* already gone */ }
  workerPromise = null;
}
