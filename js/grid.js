/*
 * Table-grid detection.
 *
 * The OT list is a ruled table, which is a gift: the printed rules tell us
 * exactly where every cell is. That beats inferring columns from word spacing,
 * and it is the only approach that survives text wrapping inside a cell — a
 * diagnosis spilling over four lines still belongs to one cell, even though OCR
 * reports four text lines crossing every column.
 *
 * Pipeline: estimate skew → find the long horizontal/vertical rules → turn them
 * into cell rectangles → erase the rules so OCR does not read them as pipes.
 */

/** Sample dark pixels once; every later pass reuses the list. */
function darkPixels(gray, w, h, step = 2, region) {
  const { x0 = 0, y0 = 0, x1 = w, y1 = h } = region || {};
  const pts = [];
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      if (gray[y * w + x] < 128) pts.push(x, y);
    }
  }
  return pts;
}

/**
 * Estimate page rotation by looking for the angle at which the printed rules
 * line up — the angle whose ink histogram contains the strongest few peaks.
 *
 * Scoring on the top handful of bins, rather than on overall spikiness, is what
 * makes this work on a photo of paper on a desk: dense text and the dark
 * background carry far more ink than the rules do, and any measure of total
 * concentration follows them instead of the table. A rule is the only thing that
 * puts most of a scanline's width into one bin, so that is what we look for.
 */
export function estimateSkew(gray, w, h, opts = {}) {
  const maxDeg = opts.maxDeg ?? 8;
  const pts = darkPixels(gray, w, h, 2, opts.region);
  if (pts.length < 500) return 0;

  const region = opts.region || {};
  const x0 = region.x0 ?? 0, x1 = region.x1 ?? w;
  const cx = (x0 + x1) / 2;
  const peaks = opts.peaks ?? 6;
  const OFFSET = 512;

  const score = (deg) => {
    const t = Math.tan((deg * Math.PI) / 180);
    const hist = new Float64Array(h + OFFSET * 2);
    for (let i = 0; i < pts.length; i += 2) {
      const b = Math.round(pts[i + 1] - t * (pts[i] - cx)) + OFFSET;
      if (b >= 0 && b < hist.length) hist[b]++;
    }
    // Sum of the strongest few bins: several rules agreeing on one angle.
    const top = [];
    for (let i = 0; i < hist.length; i++) {
      if (top.length < peaks) { top.push(hist[i]); top.sort((a, b) => a - b); }
      else if (hist[i] > top[0]) { top[0] = hist[i]; top.sort((a, b) => a - b); }
    }
    return top.reduce((a, b) => a + b, 0);
  };

  let best = 0, bestScore = -Infinity;
  for (let d = -maxDeg; d <= maxDeg; d += 0.25) {
    const s = score(d);
    if (s > bestScore) { bestScore = s; best = d; }
  }
  for (let d = best - 0.25; d <= best + 0.25; d += 0.05) {
    const s = score(d);
    if (s > bestScore) { bestScore = s; best = d; }
  }
  return best;
}

/**
 * Find printed rules by looking for long runs of ink along each axis.
 * A run threshold works better than a simple ink count because a dense row of
 * text can have as much ink as a rule, but never in one unbroken run.
 *
 * `region` restricts the scan. That matters on this form: its horizontal rules
 * do not run the full width — the right-hand columns are divided at their own
 * heights — so row bands are found by scanning only the left columns, where the
 * divisions line up with the actual patient rows.
 */
export function findGridLines(gray, w, h, opts = {}) {
  const minHFrac = opts.minHFrac ?? 0.45;
  const minVFrac = opts.minVFrac ?? 0.30;
  const gapTolerance = opts.gapTolerance ?? 4;
  const mergeWithin = opts.mergeWithin ?? 12;

  const hx0 = opts.hRegion?.x0 ?? 0, hx1 = opts.hRegion?.x1 ?? w;
  const vy0 = opts.vRegion?.y0 ?? 0, vy1 = opts.vRegion?.y1 ?? h;
  const hSpan = hx1 - hx0, vSpan = vy1 - vy0;

  const horizontal = [];
  for (let y = 0; y < h; y++) {
    const run = longestRun((i) => gray[y * w + (hx0 + i)] < 128, hSpan, gapTolerance);
    if (run >= hSpan * minHFrac) horizontal.push(y);
  }

  const vertical = [];
  for (let x = 0; x < w; x++) {
    const run = longestRun((i) => gray[(vy0 + i) * w + x] < 128, vSpan, gapTolerance);
    if (run >= vSpan * minVFrac) vertical.push(x);
  }

  return {
    ys: mergeClose(groupRuns(horizontal), mergeWithin),
    xs: mergeClose(groupRuns(vertical), mergeWithin),
  };
}

/** A rule printed thick, or doubled, shows up as two or three neighbours. */
function mergeClose(values, within) {
  const out = [];
  for (const v of values) {
    if (out.length && v - out[out.length - 1] <= within) {
      out[out.length - 1] = Math.round((out[out.length - 1] + v) / 2);
    } else out.push(v);
  }
  return out;
}

function longestRun(isInk, n, gapTolerance) {
  let best = 0, cur = 0, gap = 0;
  for (let i = 0; i < n; i++) {
    if (isInk(i)) { cur += gap + 1; gap = 0; if (cur > best) best = cur; }
    else if (cur > 0 && gap < gapTolerance) gap++;
    else { cur = 0; gap = 0; }
  }
  return best;
}

/** Collapse adjacent line indices (a rule is 2–4px thick) into one centre. */
function groupRuns(indices, maxGap = 4) {
  const out = [];
  let start = null, prev = null;
  for (const i of indices) {
    if (start === null) { start = prev = i; continue; }
    if (i - prev <= maxGap) { prev = i; continue; }
    out.push(Math.round((start + prev) / 2));
    start = prev = i;
  }
  if (start !== null) out.push(Math.round((start + prev) / 2));
  return out;
}

/**
 * Build cell rectangles from the detected rules, dropping bands too thin to
 * hold text (double rules, or the shadow under one).
 */
export function buildCells(xs, ys, minW = 12, minH = 10) {
  const cells = [];
  for (let r = 0; r < ys.length - 1; r++) {
    const y0 = ys[r], y1 = ys[r + 1];
    if (y1 - y0 < minH) continue;
    for (let c = 0; c < xs.length - 1; c++) {
      const x0 = xs[c], x1 = xs[c + 1];
      if (x1 - x0 < minW) continue;
      cells.push({ row: r, col: c, x0, y0, x1, y1 });
    }
  }
  return cells;
}

/** Paint the rules white so OCR cannot mistake them for punctuation. */
export function eraseLines(ctx, xs, ys, w, h, thickness = 3) {
  ctx.fillStyle = '#fff';
  for (const y of ys) ctx.fillRect(0, y - thickness, w, thickness * 2 + 1);
  for (const x of xs) ctx.fillRect(x - thickness, 0, thickness * 2 + 1, h);
}
