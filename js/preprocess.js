/*
 * Image preparation for OCR.
 *
 * Tesseract does far better on a large, flat, high-contrast bitmap than on a raw
 * phone photo, so before recognition we: honour EXIF rotation, upscale to a
 * working width, convert to grayscale, stretch contrast, and (optionally) run an
 * adaptive threshold that kills the uneven shadow across a photographed page.
 */

const WORK_WIDTH = 2000;   // px — enough detail for small handwriting without being slow
const MAX_WIDTH = 3200;

export async function fileToBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Safari fallbacks: decode through an <img>.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }
}

/**
 * @param {ImageBitmap|HTMLImageElement} src
 * @param {{rotate:number, contrast:number, threshold:number}} opts
 *        rotate    — degrees, multiple of 90
 *        contrast  — 0.6 … 2.5
 *        threshold — 0 disables; otherwise the offset below local mean (higher = bolder text)
 * @returns {HTMLCanvasElement}
 */
export function preprocess(src, opts) {
  const { rotate = 0, contrast = 1.4, threshold = 12 } = opts || {};
  const sw = src.width, sh = src.height;

  const scale = Math.min(MAX_WIDTH / sw, Math.max(1, WORK_WIDTH / sw));
  const w = Math.round(sw * scale), h = Math.round(sh * scale);

  const turned = rotate === 90 || rotate === 270;
  const canvas = document.createElement('canvas');
  canvas.width = turned ? h : w;
  canvas.height = turned ? w : h;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  ctx.restore();

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const gray = toGray(img);
  stretchContrast(gray, contrast);

  if (threshold > 0) {
    // Order matters: thresholding a noisy image turns sensor grain into specks
    // that OCR happily reads as punctuation, so despeckle first.
    medianFilter(gray, canvas.width, canvas.height);
    adaptiveThreshold(gray, canvas.width, canvas.height, threshold);
  }

  writeBack(img, gray);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function toGray(img) {
  const d = img.data;
  const out = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    out[p] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
  }
  return out;
}

function writeBack(img, gray) {
  const d = img.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    d[i] = d[i + 1] = d[i + 2] = gray[p];
    d[i + 3] = 255;
  }
}

/** Percentile-clipped contrast stretch — robust against a few very dark/bright pixels. */
function stretchContrast(gray, amount) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

  const clip = gray.length * 0.005;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > clip) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > clip) { hi = v; break; } }
  if (hi - lo < 16) { lo = 0; hi = 255; }

  const span = hi - lo;
  const mid = 128;
  for (let i = 0; i < gray.length; i++) {
    let v = ((gray[i] - lo) / span) * 255;
    v = mid + (v - mid) * amount;
    gray[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
}

/**
 * 3×3 median — removes isolated grain while leaving letter strokes intact,
 * which an averaging blur would not do.
 */
function medianFilter(gray, w, h) {
  const out = new Uint8ClampedArray(gray.length);
  const win = new Uint8Array(9);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { out[i] = gray[i]; continue; }

      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) win[n++] = gray[i + dy * w + dx];
      }
      // Insertion sort beats a generic sort at this size.
      for (let a = 1; a < 9; a++) {
        const v = win[a];
        let b = a - 1;
        while (b >= 0 && win[b] > v) { win[b + 1] = win[b]; b--; }
        win[b + 1] = v;
      }
      out[i] = win[4];
    }
  }
  gray.set(out);
}

/**
 * Sauvola-lite: threshold each pixel against the mean of its neighbourhood,
 * computed in O(1) per pixel from an integral image. This is what removes the
 * shadow gradient you get photographing a page under theatre lights.
 */
function adaptiveThreshold(gray, w, h, offset) {
  const win = Math.max(15, (Math.min(w, h) / 28) | 0) | 1; // odd window
  const r = win >> 1;

  // Integral image with a 1px border so the window lookups stay branch-free.
  const iw = w + 1;
  const integral = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      integral[(y + 1) * iw + (x + 1)] = integral[y * iw + (x + 1)] + rowSum;
    }
  }

  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const area = (y1 - y0 + 1) * (x1 - x0 + 1);
      const sum =
        integral[(y1 + 1) * iw + (x1 + 1)] -
        integral[y0 * iw + (x1 + 1)] -
        integral[(y1 + 1) * iw + x0] +
        integral[y0 * iw + x0];
      const mean = sum / area;
      out[y * w + x] = gray[y * w + x] < mean - offset ? 0 : 255;
    }
  }
  gray.set(out);
}
