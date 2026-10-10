// png.mjs - a tiny PNG decoder (node:zlib only) for tests that look at pixels: "is the canvas blank?", "how far apart are
// two screenshots?". Handles the 8-bit RGB / RGBA, non-interlaced PNGs that Chromium produces.
import zlib from 'node:zlib';

/** @returns {{ w: number, h: number, px: Buffer }} px is RGBA, row-major */
export function decodePng(buf) {
  let p = 8, w, h, bd, ct; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; if (data[12]) throw new Error('interlaced PNG'); }
    else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  if (bd !== 8 || (ct !== 2 && ct !== 6)) throw new Error(`unsupported PNG bit depth ${bd} / colour type ${ct}`);
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[x] = v & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) px[(y * w + x) * 4 + k] = k < 3 || bpp === 4 ? line[x * bpp + k] : 255;
    prev = line;
  }
  return { w, h, px };
}

/** Number of distinct colours among a sample of pixels, and the share of pixels that differ from the most common one. */
export function colourSpread(img) {
  const seen = new Map();
  for (let i = 0; i < img.w * img.h; i++) { const k = img.px.readUInt32BE(i * 4); seen.set(k, (seen.get(k) || 0) + 1); }
  const top = Math.max(...seen.values());
  return { colours: seen.size, nonBackground: 1 - top / (img.w * img.h) };
}

/** Pixel difference between two same-sized images: share of pixels that differ at all and by more than `tol` (any channel). */
export function diffPng(a, b, tol = 24) {
  if (a.w !== b.w || a.h !== b.h) return { sizeMismatch: `${a.w}x${a.h} vs ${b.w}x${b.h}` };
  const n = a.w * a.h; let any = 0, over = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let c = 0; c < 3; c++) { const d = Math.abs(a.px[i * 4 + c] - b.px[i * 4 + c]); if (d > m) m = d; sum += d; }
    if (m > 0) any++;
    if (m > tol) over++;
  }
  return { pctAny: +(100 * any / n).toFixed(4), pctOver: +(100 * over / n).toFixed(4), meanAbs: +(sum / (n * 3)).toFixed(4), pixels: n };
}

/**
 * pixelmatch's perceptual colour distance (YIQ, the metric behind Playwright's toHaveScreenshot, default threshold 0.2):
 * share of pixels whose colour differs by more than the threshold. Anti-aliased silhouette edges that differ by a few grey
 * levels do not count; a visibly different pixel does.
 */
export function diffPerceptual(a, b, threshold = 0.2) {
  if (a.w !== b.w || a.h !== b.h) return { sizeMismatch: `${a.w}x${a.h} vs ${b.w}x${b.h}` };
  const max = 35215 * threshold * threshold, n = a.w * a.h; let bad = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4, dr = a.px[o] - b.px[o], dg = a.px[o + 1] - b.px[o + 1], db = a.px[o + 2] - b.px[o + 2];
    if (!dr && !dg && !db) continue;
    const y = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223, iq = dr * 0.59597799 - dg * 0.2741761 - db * 0.32180189, q = dr * 0.21147017 - dg * 0.52261711 + db * 0.31114694;
    if (0.5053 * y * y + 0.299 * iq * iq + 0.1957 * q * q > max) bad++;
  }
  return { pctPerceptual: +(100 * bad / n).toFixed(4) };
}
