// 從 wut-collage-tool/src/imageProcessor.js 複製（2026-10-20）
/**
 * ????????????????? normalize
 */

export function parseAuthorName(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  const cleaned = base.replace(/\s+bw$/i, '').replace(/\s*\(\d+\)$/, '');
  return cleaned.startsWith('@') ? cleaned : `@${cleaned}`;
}

export async function loadImageFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function canvasFromImage(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return c;
}

export function detectNeedsInvert(canvas) {
  const { width, height } = canvas;
  if (!width || !height) return false;

  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const threshold = computeOtsuThreshold(canvas);
  // 背景通常佔據外圈的大多數。以每張圖自己的 Otsu 門檻判斷外圈屬於
  // 亮群或暗群，比固定用亮度 200 更能處理米白、灰底、壓縮雜訊與靠邊文字。
  const band = Math.max(1, Math.min(32, Math.floor(Math.min(width, height) * 0.06)));
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 20000)));
  const deadband = 6;
  let bright = 0;
  let dark = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (x >= band && x < width - band && y >= band && y < height - band) continue;
      const i = (y * width + x) * 4;
      if (data[i + 3] < 20) continue;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum >= threshold + deadband) bright++;
      else if (lum <= threshold - deadband) dark++;
    }
  }

  if (bright === dark) {
    // 單色或極低對比圖片沒有可靠的分群資訊，沿用中間灰作保守 fallback。
    return threshold >= 128;
  }
  return bright > dark;
}

export function binarizeToWhiteTransparent(sourceCanvas, options = {}) {
  const {
    threshold = 128,
    whiteTolerance = 24,
    invert = false,
    minNoiseArea = 12,
  } = options;

  const src = sourceCanvas.getContext('2d').getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width;
  out.height = sourceCanvas.height;
  const dst = out.getContext('2d').createImageData(out.width, out.height);

  const w = out.width;
  const h = out.height;
  const mask = new Uint8Array(w * h);

  for (let i = 0, p = 0; i < src.data.length; i += 4, p++) {
    const r = src.data[i];
    const g = src.data[i + 1];
    const b = src.data[i + 2];
    const a = src.data[i + 3];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    let isContent = false;
    if (a > 20) {
      isContent = invert ? lum < 255 - threshold : lum < threshold;
      if (Math.abs(r - g) < 15 && Math.abs(g - b) < 15 && lum > 255 - whiteTolerance) {
        isContent = false;
      }
    }
    mask[p] = isContent ? 1 : 0;
  }

  if (minNoiseArea > 0) removeSmallComponents(mask, w, h, minNoiseArea);

  paintBinaryWhiteMask(dst, mask);
  out.getContext('2d').putImageData(dst, 0, 0);
  return out;
}


function removeSmallComponents(mask, w, h, minArea) {
  const visited = new Uint8Array(mask.length);
  const queue = [];

  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || visited[p]) continue;
    queue.length = 0;
    queue.push(p);
    visited[p] = 1;
    const component = [p];

    while (queue.length) {
      const cur = queue.pop();
      const x = cur % w;
      const y = (cur / w) | 0;
      const neighbors = [];
      if (x > 0) neighbors.push(cur - 1);
      if (x < w - 1) neighbors.push(cur + 1);
      if (y > 0) neighbors.push(cur - w);
      if (y < h - 1) neighbors.push(cur + w);
      for (const n of neighbors) {
        if (mask[n] && !visited[n]) {
          visited[n] = 1;
          queue.push(n);
          component.push(n);
        }
      }
    }

    if (component.length < minArea) {
      for (const idx of component) mask[idx] = 0;
    }
  }
}

function erodeMask(mask, w, h, radius) {
  const copy = new Uint8Array(mask);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!copy[p]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !copy[ny * w + nx]) {
            mask[p] = 0;
            break;
          }
        }
        if (!mask[p]) break;
      }
    }
  }
}

/**
 * Clean AI bg-removed output: harden alpha, remove speckles, optional erode halos.
 */
export function cleanWhiteMask(canvas, options = {}) {
  const {
    alphaThreshold = 36,
    minNoiseArea = 24,
    erodePx = 1,
    autoInvert = true,
  } = options;

  const { width, height } = canvas;
  const src = canvas.getContext('2d').getImageData(0, 0, width, height);
  const mask = new Uint8Array(width * height);
  const band = Math.max(1, Math.min(24, Math.floor(Math.min(width, height) * 0.05)));
  let opaqueEdge = 0;
  let edgeSamples = 0;
  let opaqueTotal = 0;

  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    const isOpaque = src.data[i + 3] >= alphaThreshold;
    if (isOpaque) opaqueTotal++;
    const x = p % width;
    const y = (p / width) | 0;
    if (x < band || x >= width - band || y < band || y >= height - band) {
      edgeSamples++;
      if (isOpaque) opaqueEdge++;
    }
  }

  // 正常 AI 去背後，外圈應以透明像素為主。若外圈和全圖大多仍不透明，
  // 通常代表模型保留了背景、挖空了字；先反轉 alpha，再統一漆成白色。
  const shouldInvert =
    autoInvert &&
    edgeSamples > 0 &&
    opaqueEdge / edgeSamples >= 0.7 &&
    opaqueTotal / mask.length >= 0.5;

  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    const isOpaque = src.data[i + 3] >= alphaThreshold;
    mask[p] = (shouldInvert ? !isOpaque : isOpaque) ? 1 : 0;
  }

  if (minNoiseArea > 0) removeSmallComponents(mask, width, height, minNoiseArea);
  if (erodePx > 0) erodeMask(mask, width, height, erodePx);

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const dst = out.getContext('2d').createImageData(width, height);
  paintBinaryWhiteMask(dst, mask);
  out.getContext('2d').putImageData(dst, 0, 0);
  return out;
}

export function cropCanvas(canvas, x, y, w, h) {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w));
  out.height = Math.max(1, Math.round(h));
  out.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
  return out;
}

/**
 * 跟 trimTransparent 一樣，但額外回報裁切後畫布左上角相對於原畫布的位移(dx,dy)。
 * 裁切一律是 1:1 擷取（不縮放），呼叫端可以用這個位移把版面上的擺放位置
 * 正確平移，而不是誤用「置中」去猜測新位置。
 */
export function trimTransparentRect(canvas, padding = 8) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX <= minX) return { canvas, dx: 0, dy: 0 };

  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
  return { canvas: out, dx: minX, dy: minY };
}

export function trimTransparent(canvas, padding = 8) {
  return trimTransparentRect(canvas, padding).canvas;
}

/**
 * Many submitted artworks share the same template: a small author-handle line
 * near the top and a "What'z Ur Type?" branding footer near the bottom, both
 * separated from the actual typography subject by large empty gaps and much
 * smaller in ink area. This scans horizontal bands (via row-wise pixel
 * projection), keeps the band with the most ink as the "main subject", and
 * discards any other band that both touches the top/bottom edge zone and is
 * much smaller than the main band — i.e. decorative frame text, not content.
 */
export function smartCropFrame(canvas, options = {}) {
  return smartCropFrameRect(canvas, options).canvas;
}

/**
 * 跟 smartCropFrame 一樣，但額外回報最終畫布相對於原畫布的位移(dx,dy)，
 * 讓呼叫端能正確平移版面上的擺放位置。
 */
export function smartCropFrameRect(canvas, options = {}) {
  const {
    gapRatioOfWidth = 0.006, // 一列裡非透明像素低於此比例，視為「近乎空白列」（放嚴一點，減少誤把稀疏筆畫當空白）
    minGapRatioOfHeight = 0.012, // 連續空白列至少要達到這個高度比例，才算真正的分隔帶（再放寬，避免抓不到較窄的真實間隔而漏切）
    minGapPx = 3,          // 連續空白列的最小絕對高度（避免圖太小時比例算出 0）
    edgeZone = 0.26,        // 上下各這個比例的高度視為「邊緣區」（放寬涵蓋範圍）
    minAreaRatio = 0.35,    // 副帶狀區域面積小於主體這個比例，才會被視為裝飾框
    bleed = 6,              // 丟棄裝飾框時，往主體方向多清幾列，避免殘留反鋸齒邊緣的一絲痕跡
    padding = 8,
  } = options;

  const { width, height } = canvas;
  const ctx = canvas.getContext('2d');
  const src = ctx.getImageData(0, 0, width, height);
  const data = src.data;

  const rowInk = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    let count = 0;
    const rowBase = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[rowBase + x * 4 + 3] > 10) count++;
    }
    rowInk[y] = count;
  }

  // 筆畫尖端等稀疏區域的墨量會很低，但不代表那是分隔帶——
  // 只有「連續夠多列」都近乎空白，才視為真正把兩個帶狀區域隔開的空隙。
  const emptyThreshold = Math.max(1, Math.floor(width * gapRatioOfWidth));
  const minGapRows = Math.max(minGapPx, Math.round(height * minGapRatioOfHeight));
  const isNearEmptyRow = rowInk.map((v) => v <= emptyThreshold);

  // 把長度不足 minGapRows 的空白段落，視為雜訊直接併回內容（不當作分隔）
  const isRealGapRow = new Array(height).fill(false);
  {
    let runStart = -1;
    for (let y = 0; y <= height; y++) {
      const empty = y < height && isNearEmptyRow[y];
      if (empty) {
        if (runStart === -1) runStart = y;
      } else if (runStart !== -1) {
        if (y - runStart >= minGapRows) {
          for (let k = runStart; k < y; k++) isRealGapRow[k] = true;
        }
        runStart = -1;
      }
    }
  }

  const bands = [];
  let bandStart = -1;
  for (let y = 0; y <= height; y++) {
    const isGap = y === height || isRealGapRow[y];
    if (!isGap) {
      if (bandStart === -1) bandStart = y;
    } else if (bandStart !== -1) {
      bands.push({ start: bandStart, end: y - 1 });
      bandStart = -1;
    }
  }

  // 只有一個色塊區域（沒有明顯分隔），代表沒有獨立的邊框元素，不處理
  if (bands.length <= 1) return { canvas, dx: 0, dy: 0 };

  const bandsWithArea = bands.map((b) => ({
    ...b,
    area: rowInk.slice(b.start, b.end + 1).reduce((a, v) => a + v, 0),
  }));
  const mainBand = bandsWithArea.reduce((a, b) => (b.area > a.area ? b : a));

  const topEdge = height * edgeZone;
  const bottomEdge = height * (1 - edgeZone);

  const discardBands = bandsWithArea.filter((b) => {
    if (b === mainBand) return false;
    const nearEdge = b.end <= topEdge || b.start >= bottomEdge;
    const small = b.area < mainBand.area * minAreaRatio;
    return nearEdge && small;
  });

  if (!discardBands.length) return { canvas, dx: 0, dy: 0 };

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  for (const b of discardBands) {
    // 往主體方向（貼近 mainBand 的那一側）多清 bleed 列，
    // 把反鋸齒邊緣殘留的一絲痕跡一併清乾淨。
    const isAboveMain = b.end < mainBand.start;
    const start = isAboveMain ? b.start : Math.max(0, b.start - bleed);
    const end = isAboveMain ? Math.min(height - 1, b.end + bleed) : b.end;
    for (let y = start; y <= end; y++) {
      const rowBase = y * width * 4;
      for (let x = 0; x < width; x++) {
        data[rowBase + x * 4 + 3] = 0;
      }
    }
  }
  out.getContext('2d').putImageData(src, 0, 0);
  return trimTransparentRect(out, padding);
}

export function cloneCanvas(canvas) {
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  c.getContext('2d').drawImage(canvas, 0, 0);
  return c;
}

/**
 * Otsu's method: find the luminosity threshold that best separates
 * foreground (typography) from background for THIS specific image,
 * by maximizing between-class variance over the luminance histogram.
 */
export function computeOtsuThreshold(sourceCanvas) {
  const { width, height } = sourceCanvas;
  const data = sourceCanvas.getContext('2d').getImageData(0, 0, width, height).data;
  const hist = new Array(256).fill(0);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 20) continue;
    const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    hist[lum]++;
    total++;
  }
  if (!total) return 140;

  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];

  // 背景/前景之間常有一段完全沒有像素的空白區（灰階值不連續），此區間內
  // between-class variance 是一段平坦的最大值，取這段的中點而非邊界，
  // 才會落在視覺上真正的「灰階間隙中央」，兩個方向（黑底/白底）都適用。
  let sumB = 0;
  let weightB = 0;
  let maxVariance = -1;
  let bestStart = 140;
  let bestEnd = 140;
  for (let t = 0; t < 256; t++) {
    weightB += hist[t];
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;
    sumB += t * hist[t];
    const meanB = sumB / weightB;
    const meanF = (sumAll - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (variance > maxVariance + 1e-6) {
      maxVariance = variance;
      bestStart = t;
      bestEnd = t;
    } else if (Math.abs(variance - maxVariance) <= 1e-6) {
      bestEnd = t;
    }
  }
  return Math.round((bestStart + bestEnd) / 2);
}

/**
 * Luminosity-based extraction from the original image.
 * Auto-detects light vs dark background; keeps the text/graphic pixels
 * and outputs them as white-on-transparent. Works well for typography
 * on photographic or colored backgrounds.
 *
 * When `threshold` is omitted, each image gets its own optimal cutoff via
 * Otsu's method instead of a fixed value — better handles varying contrast.
 */
export function autoLumExtract(sourceCanvas, options = {}) {
  const { threshold: thresholdOpt, minNoiseArea = 12, keepBright: keepBrightOpt } = options;
  const keepBright = keepBrightOpt !== undefined ? keepBrightOpt : !detectNeedsInvert(sourceCanvas);
  const threshold = thresholdOpt !== undefined ? thresholdOpt : computeOtsuThreshold(sourceCanvas);
  const { width, height } = sourceCanvas;
  const src = sourceCanvas.getContext('2d').getImageData(0, 0, width, height);
  const d = src.data;
  const mask = new Uint8Array(width * height);

  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    if (d[i + 3] < 20) continue;
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    mask[p] = keepBright ? (lum >= threshold ? 1 : 0) : (lum < threshold ? 1 : 0);
  }

  if (minNoiseArea > 0) removeSmallComponents(mask, width, height, minNoiseArea);

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const dst = out.getContext('2d').createImageData(width, height);
  paintBinaryWhiteMask(dst, mask);
  out.getContext('2d').putImageData(dst, 0, 0);
  return out;
}

/** Transparent pixels must stay white; otherwise scale interpolation mixes in black and looks jagged. */
function fillWhiteRgb(imageData) {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i + 1] = d[i + 2] = 255;
  }
}

function paintBinaryWhiteMask(imageData, mask) {
  const d = imageData.data;
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] = mask[p] ? 255 : 0;
  }
}

/**
 * 依原圖短邊決定柔邊半徑：大圖排版時會縮小，固定 1px 柔邊會被縮成看不見，
 * 所以大圖要用比較多「來源像素」的 blur，縮放後在畫面上大約仍是 1px。
 */
function applySizeAwareEdgeBlur(canvas) {
  const minDim = Math.min(canvas.width, canvas.height);
  const radius = Math.min(1.4, Math.max(0.45, minDim / 2600));
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  ctx.filter = `blur(${radius.toFixed(2)}px)`;
  ctx.drawImage(canvas, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  fillWhiteRgb(img);
  ctx.filter = 'none';
  ctx.putImageData(img, 0, 0);
  return out;
}

/**
 * Soft/grayscale variant of autoLumExtract: instead of a hard cutoff,
 * pixels near the (auto-detected) threshold get partial alpha, producing
 * anti-aliased white / semi-transparent-white edges rather than a binary mask.
 */
export function autoLumExtractSoft(sourceCanvas, options = {}) {
  const {
    keepBright: keepBrightOpt,
    softness = 40,
    threshold: thresholdOpt,
    spatialBlur = true,
    // 已去背原圖鋪上的底色亮度（見 wordmark-editor/editor.js）：和底色一樣的像素原本是透明的，一律不保留
    bgLum,
  } = options;
  const keepBright = keepBrightOpt !== undefined ? keepBrightOpt : !detectNeedsInvert(sourceCanvas);
  const threshold = thresholdOpt !== undefined ? thresholdOpt : computeOtsuThreshold(sourceCanvas);
  const { width, height } = sourceCanvas;
  const src = sourceCanvas.getContext('2d').getImageData(0, 0, width, height);
  const d = src.data;

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const dst = out.getContext('2d').createImageData(width, height);
  fillWhiteRgb(dst);
  const half = Math.max(1, softness) / 2;

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 20) continue;
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (bgLum !== undefined && Math.abs(lum - bgLum) < 1.5) continue;
    const signedDist = keepBright ? lum - threshold : threshold - lum;
    let alpha;
    if (signedDist <= -half) alpha = 0;
    else if (signedDist >= half) alpha = 255;
    else {
      // Hermite smoothstep: gentler than a linear ramp, closer to real AA.
      let t = (signedDist + half) / (half * 2);
      t = t * t * (3 - 2 * t);
      alpha = Math.round(t * 255);
    }
    if (alpha <= 0) continue;
    dst.data[i + 3] = alpha;
  }

  out.getContext('2d').putImageData(dst, 0, 0);
  return spatialBlur ? applySizeAwareEdgeBlur(out) : out;
}

/**
 * Convert all non-transparent pixels to white, preserving alpha.
 * Gives clean anti-aliased white silhouettes from AI bg-removed images —
 * much better than hard threshold binarization.
 */
export function toWhiteMask(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  fillWhiteRgb(imageData);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  out.getContext('2d').putImageData(imageData, 0, 0);
  return out;
}
