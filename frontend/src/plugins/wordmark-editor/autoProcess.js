// 從 wut-collage-tool/src/bgRemoval.js 複製 fullAutoProcess（亮度去背預設流程，2026-10-20）
import {
  autoLumExtractSoft,
  cleanWhiteMask,
  trimTransparent,
  trimTransparentRect,
  computeOtsuThreshold,
  detectNeedsInvert,
  smartCropFrameRect,
} from './imageProcessor.js';

/**
 * Default pipeline: luminosity threshold on the original canvas. Fast, no AI needed.
 * Threshold is auto-detected per image (Otsu's method) unless explicitly passed in.
 * Also strips decorative frame elements (e.g. author-handle header / "What'z Ur
 * Type?" footer band that many submissions share) via smartCropFrame, unless
 * disabled — these share the same template and are not part of the artwork.
 */
export function fullAutoProcess(sourceCanvas, options = {}) {
  const {
    padding = 8,
    trim = true,
    smartCrop = true,
    // 保留原圖反鋸齒：不要用單一黑白門檻把字邊硬切掉。
    // 約 ±20 亮度級距，才能涵蓋掃描／照片字邊實際的灰階過渡；
    // 再窄會把 1px 反鋸齒壓成硬切，看起來就有鋸齒。
    softness = 40,
  } = options;
  const threshold =
    options.threshold !== undefined ? options.threshold : computeOtsuThreshold(sourceCanvas);
  // 記住首次自動判定的明暗方向，精修面板切換黑白/灰階時沿用，避免被 UI 預設蓋掉。
  const keepBright =
    options.keepBright !== undefined
      ? options.keepBright
      : !detectNeedsInvert(sourceCanvas);
  const raw = autoLumExtractSoft(sourceCanvas, { threshold, keepBright, softness, bgLum: options.bgLum });
  // 保留智慧裁切前的版本，讓使用者之後可以在編輯介面一鍵還原（若誤裁掉想要的部分）
  const preTrim = trim ? trimTransparentRect(raw, padding) : { canvas: raw, dx: 0, dy: 0 };
  const preSmartCropCanvas = preTrim.canvas;
  const preSmartCropRect = { x: preTrim.dx, y: preTrim.dy, w: preSmartCropCanvas.width, h: preSmartCropCanvas.height };

  // 先 trim → 再 smartCrop：先把透明留白裁掉讓畫布變小，
  // smartCropFrameRect 在小圖上工作時 emptyThreshold 更嚴，
  // 孤立的噪點像素才能被正確辨識成獨立 band 並清除。
  let result = raw;
  let dx = 0;
  let dy = 0;
  if (trim) {
    const t = trimTransparentRect(result, padding);
    result = t.canvas;
    dx += t.dx;
    dy += t.dy;
  }
  if (smartCrop) {
    const sc = smartCropFrameRect(result, { padding });
    result = sc.canvas;
    dx += sc.dx;
    dy += sc.dy;
  }
  if (trim) {
    const t = trimTransparentRect(result, padding);
    result = t.canvas;
    dx += t.dx;
    dy += t.dy;
  }
  // result 相對於 sourceCanvas 的裁切範圍；重新調整去背參數時要沿用同一個範圍，
  // 而不是每次都跳回未裁切的完整原圖。
  const cropRect = { x: dx, y: dy, w: result.width, h: result.height };
  return {
    canvas: result,
    bgRemovedCanvas: null,
    threshold,
    keepBright,
    lumStyle: 'soft',
    softness,
    preSmartCropCanvas,
    preSmartCropRect,
    cropRect,
  };
}

