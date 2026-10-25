/**
 * 把上傳的字圖轉成網站用的白字透明 WebP。
 * - 已有透明背景：透明度就是字，不再用亮度算一次
 * - 沒有透明背景（黑白、灰階）：外圈當紙色，紙色全透明、墨色不透明，中間灰階照比例保留；黑底白字會反過來
 * 長邊收到 800px。超過 100KB 才再壓，並保住透明。
 */
import sharp from "sharp";

const ANALYZE_MAX = 1600;
const OUT_MAX = 800;
const COMPRESS_MIN = 100 * 1024;

function luminance(r, g, b) {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

function alphaFromTransparent(data, n) {
  const alpha = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) alpha[i] = data[i * 4 + 3];
  return alpha;
}

function alphaFromInk(data, width, height) {
  const n = width * height;
  const lum = new Uint8Array(n);
  for (let i = 0; i < n; i++) lum[i] = luminance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);

  const ring = [];
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.03));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= band && x < width - band && y >= band && y < height - band) continue;
      ring.push(lum[y * width + x]);
    }
  }
  ring.sort((a, b) => a - b);
  const bg = ring[ring.length >> 1] ?? 255;

  const hist = new Uint32Array(256);
  for (const v of lum) hist[v]++;
  const darkInk = bg >= 128;
  const tail = n * 0.005;
  let inkLevel = darkInk ? 0 : 255;
  let acc = 0;
  if (darkInk) {
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= tail) {
        inkLevel = v;
        break;
      }
    }
  } else {
    for (let v = 255; v >= 0; v--) {
      acc += hist[v];
      if (acc >= tail) {
        inkLevel = v;
        break;
      }
    }
  }
  const span = Math.max(1, Math.abs(bg - inkLevel));
  const alpha = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const t = (darkInk ? bg - lum[i] : lum[i] - bg) / span;
    const a = Math.round(Math.max(0, Math.min(1, t)) * 255);
    alpha[i] = a < 8 ? 0 : a;
  }
  return alpha;
}

function accentHex(data, alpha) {
  let r = 0;
  let g = 0;
  let b = 0;
  let w = 0;
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i];
    if (a < 128) continue;
    r += data[i * 4] * a;
    g += data[i * 4 + 1] * a;
    b += data[i * 4 + 2] * a;
    w += a;
  }
  if (!w) return undefined;
  r = Math.round(r / w);
  g = Math.round(g / w);
  b = Math.round(b / w);
  if (Math.max(r, g, b) - Math.min(r, g, b) < 18) return undefined;
  const hex = (v) => v.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function crop(alpha, width, height) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] <= 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error("圖裡找不到字");
  const pad = 8;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  return { x0, y0, x1, y1 };
}

async function toWebp(raw, width, height) {
  let out = await sharp(raw, { raw: { width, height, channels: 4 } })
    .resize({ width: OUT_MAX, height: OUT_MAX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90, effort: 4 })
    .toBuffer();
  if (out.length <= COMPRESS_MIN) return out;
  const smaller = await sharp(out).webp({ quality: 60, alphaQuality: 70, effort: 6 }).toBuffer();
  const meta = await sharp(smaller).metadata();
  if (meta.hasAlpha && smaller.length < out.length) return smaller;
  return out;
}

export async function renderWordmark(buf) {
  let data;
  let info;
  try {
    ({ data, info } = await sharp(buf, { limitInputPixels: 20_000_000, sequentialRead: true })
    .rotate()
    .resize({ width: ANALYZE_MAX, height: ANALYZE_MAX, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true }));
  } catch (err) {
    if (/pixel limit|exceeds/i.test(err.message)) throw new Error("字圖太大，請把長邊縮到 4000px 以內再傳");
    throw err;
  }

  const width = info.width;
  const height = info.height;
  const n = width * height;
  let clear = 0;
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 250) clear++;
  const fromAlpha = clear > n * 0.01;
  const alpha = fromAlpha ? alphaFromTransparent(data, n) : alphaFromInk(data, width, height);
  const accent = fromAlpha ? accentHex(data, alpha) : undefined;
  const { x0, y0, x1, y1 } = crop(alpha, width, height);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const raw = Buffer.alloc(cw * ch * 4);
  let sum = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const a = alpha[(y + y0) * width + (x + x0)];
      const k = (y * cw + x) * 4;
      raw[k] = raw[k + 1] = raw[k + 2] = 255;
      raw[k + 3] = a;
      sum += a;
    }
  }
  const webp = await toWebp(raw, cw, ch);
  const ink = Math.round((sum / 255 / (cw * ch)) * 1000) / 1000;
  return { webp, ink, accent, source: fromAlpha ? "cutout" : "direct" };
}
