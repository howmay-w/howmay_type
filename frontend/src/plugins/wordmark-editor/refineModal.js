// 從 wut-collage-tool/src/refineModal.js 複製（2026-10-20），供字圖管理頁的精修視窗使用
import {
  cloneCanvas,
  cropCanvas,
  cleanWhiteMask,
  autoLumExtract,
  autoLumExtractSoft,
  computeOtsuThreshold,
  detectNeedsInvert,
  smartCropFrameRect,
  trimTransparentRect,
} from './imageProcessor.js';
// 管理頁只用亮度去背，不載入 AI 模型
const fullAiProcess = async () => {
  throw new Error('字圖管理頁不支援 AI 去背');
};

const CROP_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CROP_HANDLE_R = 7;

function normalizeRect(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.max(8, Math.abs(x2 - x1)),
    h: Math.max(8, Math.abs(y2 - y1)),
  };
}

function clampRect(rect, maxW, maxH) {
  const x = Math.max(0, Math.min(rect.x, maxW - 8));
  const y = Math.max(0, Math.min(rect.y, maxH - 8));
  const w = Math.max(8, Math.min(rect.w, maxW - x));
  const h = Math.max(8, Math.min(rect.h, maxH - y));
  return { x, y, w, h };
}

export function createRefineController(dialog, callbacks) {
  const canvas = dialog.querySelector('#refineCanvas');
  const ctx = canvas.getContext('2d');
  const titleEl = dialog.querySelector('#refineTitle');
  const canvasWrap = dialog.querySelector('.refine-canvas-wrap');
  const refineTools = dialog.querySelector('#refineTools');

  // ① 去背方式
  const bgModeBtns = dialog.querySelectorAll('[data-bg-mode]');
  const lumControls = dialog.querySelector('#lumControls');
  const aiControls = dialog.querySelector('#aiControls');
  const lumThreshSlider = dialog.querySelector('#lumThreshSlider');
  const lumThreshVal = dialog.querySelector('#lumThreshVal');
  const lumThreshLabelLeft = dialog.querySelector('#lumThreshLabelLeft');
  const lumThreshLabelRight = dialog.querySelector('#lumThreshLabelRight');
  const lumStyleBtns = dialog.querySelectorAll('[data-lum-style]');
  const autoThreshBtn = dialog.querySelector('#autoThreshBtn');
  const softContrastField = dialog.querySelector('#softContrastField');
  const softContrastSlider = dialog.querySelector('#softContrastSlider');
  const softContrastVal = dialog.querySelector('#softContrastVal');
  const brightDarkBtns = dialog.querySelectorAll('[data-bright]');
  const alphaThreshSlider = dialog.querySelector('#alphaThreshSlider');
  const alphaThreshVal = dialog.querySelector('#alphaThreshVal');
  const noiseAreaSlider = dialog.querySelector('#noiseAreaSlider');
  const noiseAreaVal = dialog.querySelector('#noiseAreaVal');
  const applyBgBtn = dialog.querySelector('#applyBgBtn');

  // ② 工具
  const toolBtns = dialog.querySelectorAll('[data-tool]');
  const brushSizeEl = dialog.querySelector('#brushSize');
  const brushValEl = dialog.querySelector('#brushVal');
  const brushSizeGroup = dialog.querySelector('#brushSizeGroup');

  // 底部
  const undoBtn = dialog.querySelector('#undoBtn');
  const redoBtn = dialog.querySelector('#redoBtn');
  const trimBtn = dialog.querySelector('#trimBtn');
  const restoreSmartCropBtn = dialog.querySelector('#restoreSmartCropBtn');
  const resetSessionBtn = dialog.querySelector('#resetSessionBtn');
  const cropActionBtns = dialog.querySelector('#cropActionBtns');
  const confirmCropBtn = dialog.querySelector('#confirmCropBtn');
  const clearCropBtn = dialog.querySelector('#clearCropBtn');

  // 筆刷游標
  const cursorEl = document.createElement('div');
  cursorEl.className = 'brush-cursor';
  canvasWrap.appendChild(cursorEl);

  // --- State ---
  let state = null;
  let tool = 'erase';   // 'erase' | 'crop'
  let bgMode = 'lum';
  let lumStyle = 'soft'; // 'hard' | 'soft'
  let keepBright = true;
  let drawing = false;
  let cropRect = null;
  let cropDrag = null;
  let history = [];
  let offsetHistory = []; // 對應 history 每一筆快照時，相對於開啟精修當下畫布的累積裁切位移
  let historyIndex = -1;
  // 相對於「開啟精修時的 processedCanvas」的累積裁切位移；用來在確認時
  // 正確平移版面上的擺放位置，而不是靠新舊尺寸比例去猜測（那樣在非置中裁切時會跑位）。
  let cropOffsetX = 0;
  let cropOffsetY = 0;
  // 開啟精修當下，processedCanvas 相對於原始 sourceCanvas 的裁切範圍；
  // 重新調整去背參數時要沿用這個範圍，不能每次都跳回未裁切的完整原圖。
  let baseSourceDx = 0;
  let baseSourceDy = 0;

  // --- History ---
  function updateHistoryButtons() {
    if (undoBtn) undoBtn.disabled = historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = historyIndex >= history.length - 1;
  }

  function pushHistory() {
    if (!state?.working) return;
    history = history.slice(0, historyIndex + 1);
    offsetHistory = offsetHistory.slice(0, historyIndex + 1);
    history.push(cloneCanvas(state.working));
    offsetHistory.push({ x: cropOffsetX, y: cropOffsetY });
    historyIndex = history.length - 1;
    updateHistoryButtons();
  }

  function undo() {
    if (historyIndex <= 0 || !state?.working) return;
    historyIndex -= 1;
    state.working = cloneCanvas(history[historyIndex]);
    cropOffsetX = offsetHistory[historyIndex].x;
    cropOffsetY = offsetHistory[historyIndex].y;
    cropRect = null;
    fitCanvas();
  }

  function redo() {
    if (historyIndex >= history.length - 1 || !state?.working) return;
    historyIndex += 1;
    state.working = cloneCanvas(history[historyIndex]);
    cropOffsetX = offsetHistory[historyIndex].x;
    cropOffsetY = offsetHistory[historyIndex].y;
    cropRect = null;
    fitCanvas();
  }

  // --- Canvas rendering ---
  function computeFitSize(working) {
    const maxW = canvasWrap.clientWidth - 24;
    const maxH = window.innerHeight * 0.65;
    const ratio = Math.min(maxW / working.width, maxH / working.height, 1);
    return {
      width: Math.round(working.width * ratio),
      height: Math.round(working.height * ratio),
    };
  }

  // 棋盤格 + 50% 黑底：讓白色去背作品在預覽中更容易辨識
  function drawPreviewBackground(ctx, w, h) {
    const tile = 16;
    const c1 = '#3a3a3a';
    const c2 = '#262626';
    for (let y = 0; y < h; y += tile) {
      for (let x = 0; x < w; x += tile) {
        const odd = ((x / tile) + (y / tile)) % 2;
        ctx.fillStyle = odd ? c1 : c2;
        ctx.fillRect(x, y, tile, tile);
      }
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, w, h);
  }

  function getImageScale() {
    return {
      sx: canvas.width / state.working.width,
      sy: canvas.height / state.working.height,
    };
  }

  function initDefaultCropRect() {
    const w = state.working.width;
    const h = state.working.height;
    cropRect = { x: 0, y: 0, w, h };
  }

  function cropRectToCanvas(rect) {
    const { sx, sy } = getImageScale();
    return {
      x: rect.x * sx,
      y: rect.y * sy,
      w: rect.w * sx,
      h: rect.h * sy,
    };
  }

  function getCropHandlePositions(rect) {
    const { x, y, w, h } = cropRectToCanvas(rect);
    return {
      nw: [x, y],
      n: [x + w / 2, y],
      ne: [x + w, y],
      e: [x + w, y + h / 2],
      se: [x + w, y + h],
      s: [x + w / 2, y + h],
      sw: [x, y + h],
      w: [x, y + h / 2],
    };
  }

  function hitTestCropHandle(canvasX, canvasY) {
    if (!cropRect) return null;
    const handles = getCropHandlePositions(cropRect);
    for (const name of CROP_HANDLES) {
      const [hx, hy] = handles[name];
      if (Math.abs(canvasX - hx) <= CROP_HANDLE_R && Math.abs(canvasY - hy) <= CROP_HANDLE_R) {
        return name;
      }
    }
    return null;
  }

  function resizeCropRect(handle, orig, curX, curY, centerScale = false) {
    const maxW = state.working.width;
    const maxH = state.working.height;
    const cx = orig.x + orig.w / 2;
    const cy = orig.y + orig.h / 2;

    // Shift：以裁切框中心為錨，對邊／四邊一起收放
    if (centerScale) {
      let halfW = orig.w / 2;
      let halfH = orig.h / 2;
      switch (handle) {
        case 'nw':
        case 'ne':
        case 'sw':
        case 'se':
          halfW = Math.max(4, Math.abs(curX - cx));
          halfH = Math.max(4, Math.abs(curY - cy));
          break;
        case 'e':
        case 'w':
          halfW = Math.max(4, Math.abs(curX - cx));
          break;
        case 'n':
        case 's':
          halfH = Math.max(4, Math.abs(curY - cy));
          break;
        default:
          break;
      }
      // 若超出畫布邊界，等比內縮，維持中心
      halfW = Math.min(halfW, cx, maxW - cx);
      halfH = Math.min(halfH, cy, maxH - cy);
      return {
        x: cx - halfW,
        y: cy - halfH,
        w: Math.max(8, halfW * 2),
        h: Math.max(8, halfH * 2),
      };
    }

    let x1 = orig.x;
    let y1 = orig.y;
    let x2 = orig.x + orig.w;
    let y2 = orig.y + orig.h;
    switch (handle) {
      case 'nw': x1 = curX; y1 = curY; break;
      case 'n': y1 = curY; break;
      case 'ne': x2 = curX; y1 = curY; break;
      case 'e': x2 = curX; break;
      case 'se': x2 = curX; y2 = curY; break;
      case 's': y2 = curY; break;
      case 'sw': x1 = curX; y2 = curY; break;
      case 'w': x1 = curX; break;
      default: break;
    }
    return clampRect(normalizeRect(x1, y1, x2, y2), maxW, maxH);
  }

  function drawCropHandles(rx, ry, rw, rh) {
    const points = [
      [rx, ry], [rx + rw / 2, ry], [rx + rw, ry],
      [rx + rw, ry + rh / 2], [rx + rw, ry + rh],
      [rx + rw / 2, ry + rh], [rx, ry + rh], [rx, ry + rh / 2],
    ];
    ctx.fillStyle = '#4a90e2';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    for (const [hx, hy] of points) {
      ctx.beginPath();
      ctx.arc(hx, hy, CROP_HANDLE_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  function drawCropOverlay() {
    if (!cropRect) initDefaultCropRect();
    const { sx, sy } = getImageScale();
    const rx = cropRect.x * sx;
    const ry = cropRect.y * sy;
    const rw = cropRect.w * sx;
    const rh = cropRect.h * sy;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.rect(rx, ry, rw, rh);
    ctx.clip();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawPreviewBackground(ctx, canvas.width, canvas.height);
    ctx.drawImage(state.working, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
    ctx.setLineDash([]);
    drawCropHandles(rx, ry, rw, rh);
  }

  function fitCanvas() {
    if (!state?.working) return;
    const fit = computeFitSize(state.working);
    canvas.width = fit.width;
    canvas.height = fit.height;
    redraw();
  }

  // 亮度參數通常只會更新像素，不會改變 working viewport 的尺寸。
  // 此時保留既有 canvas 幾何，只重繪內容，避免重新設定 width/height 造成
  // flex 置中與 CSS max-width 再次計算，讓預覽看起來整張跳動。
  function redrawOrFit(previousWidth, previousHeight) {
    if (
      state?.working
      && state.working.width === previousWidth
      && state.working.height === previousHeight
    ) {
      redraw();
      return;
    }
    fitCanvas();
  }

  function redraw() {
    if (!state?.working) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawPreviewBackground(ctx, canvas.width, canvas.height);
    ctx.drawImage(state.working, 0, 0, canvas.width, canvas.height);
    if (tool === 'crop') drawCropOverlay();
  }

  // --- 工具切換 UI ---
  function updateCropActionButtons() {
    const has = tool === 'crop' && !!cropRect;
    if (confirmCropBtn) confirmCropBtn.disabled = !has;
    if (clearCropBtn) clearCropBtn.disabled = !has;
  }

  function setTool(t) {
    tool = t;
    toolBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === t));

    const isCrop = t === 'crop';
    canvas.classList.toggle('crop-active', isCrop);
    canvas.style.cursor = isCrop ? 'crosshair' : 'none';
    cursorEl.style.display = 'none';
    canvasWrap?.classList.toggle('crop-mode', isCrop);

    brushSizeGroup?.classList.toggle('hidden', isCrop);
    cropActionBtns?.classList.toggle('hidden', !isCrop);
    confirmCropBtn?.classList.toggle('hidden', !isCrop);
    clearCropBtn?.classList.toggle('hidden', !isCrop);

    if (isCrop) {
      fitCanvas();
      if (!cropRect) initDefaultCropRect();
      updateCropActionButtons();
      redraw();
    } else {
      cropRect = null;
      cropDrag = null;
      updateCropActionButtons();
      redraw();
    }
  }

  toolBtns.forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  brushSizeEl.addEventListener('input', () => {
    brushValEl.textContent = brushSizeEl.value;
  });

  // --- 筆刷游標 ---
  function updateCursor(clientX, clientY) {
    if (tool === 'crop' || !state?.working) { cursorEl.style.display = 'none'; return; }
    const wrapRect = canvasWrap.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const cssR = Number(brushSizeEl.value) * (canvasRect.width / (state.working.width || 1));
    const size = Math.max(4, cssR * 2);
    cursorEl.style.left = (clientX - wrapRect.left) + 'px';
    cursorEl.style.top = (clientY - wrapRect.top) + 'px';
    cursorEl.style.width = size + 'px';
    cursorEl.style.height = size + 'px';
    cursorEl.style.display = 'block';
  }

  canvas.addEventListener('mousemove', (e) => {
    if (tool === 'crop') {
      const displayPos = canvasPosDisplay(e);
      const handle = hitTestCropHandle(displayPos.x, displayPos.y);
      canvas.style.cursor = handle ? cropHandleCursor(handle) : (cropRect && pointInCrop(canvasPos(e).x, canvasPos(e).y) ? 'move' : 'crosshair');
      return;
    }
    updateCursor(e.clientX, e.clientY);
  });
  canvas.addEventListener('mouseleave', () => {
    if (tool !== 'crop') cursorEl.style.display = 'none';
  });

  // --- Pointer ---
  function canvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width) * (state.working.width / canvas.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height) * (state.working.height / canvas.height),
    };
  }

  function canvasPosDisplay(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function cropHandleCursor(handle) {
    const map = {
      nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
      se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
    };
    return map[handle] || 'crosshair';
  }

  function pointInCrop(x, y) {
    return cropRect && x >= cropRect.x && x <= cropRect.x + cropRect.w && y >= cropRect.y && y <= cropRect.y + cropRect.h;
  }

  function paint(e) {
    const { x, y } = canvasPos(e);
    const r = Number(brushSizeEl.value);
    const wctx = state.working.getContext('2d');
    wctx.save();
    wctx.beginPath();
    wctx.arc(x, y, r, 0, Math.PI * 2);
    wctx.globalCompositeOperation = 'destination-out';
    wctx.fillStyle = 'rgba(0,0,0,1)';
    wctx.fill();
    wctx.restore();
    redraw();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (tool === 'crop') {
      const pos = canvasPos(e);
      const displayPos = canvasPosDisplay(e);
      const handle = hitTestCropHandle(displayPos.x, displayPos.y);
      if (handle) {
        cropDrag = { mode: 'resize', handle, orig: { ...cropRect } };
      } else if (cropRect && pointInCrop(pos.x, pos.y)) {
        cropDrag = { mode: 'move', startX: pos.x, startY: pos.y, orig: { ...cropRect } };
      } else {
        cropDrag = { mode: 'draw', startX: pos.x, startY: pos.y };
        cropRect = { x: pos.x, y: pos.y, w: 1, h: 1 };
      }
      canvas.setPointerCapture(e.pointerId);
      updateCropActionButtons();
      redraw();
      return;
    }
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    paint(e);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (tool === 'crop' && cropDrag) {
      const pos = canvasPos(e);
      const maxW = state.working.width;
      const maxH = state.working.height;
      if (cropDrag.mode === 'draw') {
        cropRect = clampRect(normalizeRect(cropDrag.startX, cropDrag.startY, pos.x, pos.y), maxW, maxH);
      } else if (cropDrag.mode === 'resize') {
        cropRect = resizeCropRect(
          cropDrag.handle,
          cropDrag.orig,
          pos.x,
          pos.y,
          e.shiftKey,
        );
      } else {
        cropRect = clampRect({
          x: cropDrag.orig.x + pos.x - cropDrag.startX,
          y: cropDrag.orig.y + pos.y - cropDrag.startY,
          w: cropDrag.orig.w,
          h: cropDrag.orig.h,
        }, maxW, maxH);
      }
      updateCropActionButtons();
      redraw();
      return;
    }
    if (drawing) paint(e);
  });

  canvas.addEventListener('pointerup', () => {
    if (drawing) { drawing = false; pushHistory(); }
    if (cropDrag) cropDrag = null;
  });

  // --- ① 去背方式 ---
  function setBgMode(m) {
    bgMode = m;
    bgModeBtns.forEach(b => b.classList.toggle('active', b.dataset.bgMode === m));
    setVisible(lumControls, m === 'lum');
    setVisible(aiControls, m === 'ai');
    updateApplyBgState();
  }

  function setVisible(el, visible) {
    if (!el) return;
    el.style.display = visible ? '' : 'none';
  }

  function updateApplyBgState() {
    if (!applyBgBtn) return;
    // 亮度模式的滑桿/切換已經是即時預覽，這顆按鈕在該模式下沒有用處；
    // AI 模式則仍需要它來觸發第一次的 AI 去背（重的非同步操作，無法用滑桿即時觸發）。
    if (bgMode === 'lum') {
      applyBgBtn.classList.add('hidden');
      return;
    }
    const needsAi = !state?.item?.bgRemovedCanvas;
    applyBgBtn.classList.toggle('hidden', !needsAi);
    applyBgBtn.disabled = false;
    applyBgBtn.textContent = '執行 AI 去背';
    applyBgBtn.title = '首次執行需下載 AI 模型，稍候片刻';
  }

  bgModeBtns.forEach(btn => btn.addEventListener('click', () => setBgMode(btn.dataset.bgMode)));

  // 對比度（10~100，越高越銳利）換算成柔和模式的過渡帶寬度（亮度級距）。
  // 高對比 → 窄過渡（較銳、易鋸齒）；低對比 → 寬過渡（較柔、易出半透明底）。
  const SOFT_MIN = 6;
  const SOFT_MAX = 140;
  // 已去背的原圖（字圖管理頁 item.preCut）：深淺全在透明度裡，柔和範圍放寬到整個亮度範圍，
  // 對比度調到最低時幾乎原樣保留漸層
  const SOFT_MAX_PRECUT = 300;
  const softMax = () => (state?.item?.preCut ? SOFT_MAX_PRECUT : SOFT_MAX);
  function contrastToSoftness(contrastPct) {
    const t = Math.max(10, Math.min(100, contrastPct)) / 100;
    return softMax() - t * (softMax() - SOFT_MIN);
  }

  // 依目前的 亮度風格(hard/soft) + 閾值 + 對比度 + 明暗 設定，重新計算亮度去背預覽（不含雜訊清理，速度優先）。
  // 去背參數只改變「保留哪些像素」，不該影響目前已經裁切到的範圍——所以從原圖重新產生
  // 完整遮罩後，還是裁回目前這個 viewport（baseSourceDx/Dy + 本次已裁切的位移）。
  function runLumPreview() {
    if (!state?.item?.sourceCanvas) return;
    const previousWidth = state.working?.width ?? 0;
    const previousHeight = state.working?.height ?? 0;
    const threshold = Number(lumThreshSlider.value);
    let result =
      lumStyle === 'soft'
        ? autoLumExtractSoft(state.item.sourceCanvas, {
            threshold,
            keepBright,
            softness: contrastToSoftness(Number(softContrastSlider.value)),
            bgLum: state.item.preCutBg,
          })
        : autoLumExtract(state.item.sourceCanvas, { threshold, keepBright, minNoiseArea: 0 });
    // 字圖管理頁：畫面若還是「目前的字圖」（尺寸、位置和原圖對不上），
    // 改用自動去背的範圍（item.lumViewport）從原圖重新產生
    const vp = state.item.lumViewport;
    const cur = state.item.currentSize;
    if (vp && cur && state.working && state.working.width === cur.w && state.working.height === cur.h) {
      baseSourceDx = vp.x;
      baseSourceDy = vp.y;
      cropOffsetX = 0;
      cropOffsetY = 0;
      result = cropCanvas(result, vp.x, vp.y, vp.w, vp.h);
    } else if (state.working) {
      result = cropCanvas(
        result,
        baseSourceDx + cropOffsetX,
        baseSourceDy + cropOffsetY,
        state.working.width,
        state.working.height,
      );
    }
    state.working = result;
    // 重新去背過：存檔時不再當成「原圖直接用」（見 editor.js 的 saveWordmark）
    state.item.lumChanged = true;
    state.item.lastLumThreshold = threshold;
    state.item.lastKeepBright = keepBright;
    cropRect = null;
    pushHistory();
    redrawOrFit(previousWidth, previousHeight);
  }

  // AI 模式：套用 alpha 閾值 / 雜訊去除的即時預覽（AI 去背本身仍需按鈕觸發，見 applyBgBtn）
  function runAiPreview() {
    if (!state?.item?.bgRemovedCanvas) return;
    state.working = cleanWhiteMask(state.item.bgRemovedCanvas, {
      alphaThreshold: Number(alphaThreshSlider.value),
      minNoiseArea: Number(noiseAreaSlider.value),
      erodePx: 0,
    });
    cropOffsetX = 0;
    cropOffsetY = 0;
    cropRect = null;
    pushHistory();
    fitCanvas();
  }

  function setLumStyle(style) {
    lumStyle = style;
    lumStyleBtns.forEach(b => b.classList.toggle('active', b.dataset.lumStyle === style));
    softContrastField?.classList.toggle('hidden', style !== 'soft');
    // 臨界值滑桿在兩種風格下意義相同（決定保留哪些亮度的像素），標籤不隨風格改變，
    // 避免跟「邊緣柔和度」滑桿的柔和/銳利字眼混淆。
    //
    // 切換黑白／灰階時必須沿用目前 keepBright（含開啟精修時還原的自動判定），
    // 不能讓預設「白字深底」蓋掉原本對黑底白字／白底黑字的結果。
    runLumPreview();
  }

  lumStyleBtns.forEach(btn => btn.addEventListener('click', () => setLumStyle(btn.dataset.lumStyle)));

  autoThreshBtn?.addEventListener('click', () => {
    if (!state?.item?.sourceCanvas) return;
    const auto = computeOtsuThreshold(state.item.sourceCanvas);
    lumThreshSlider.value = String(auto);
    if (lumThreshVal) lumThreshVal.textContent = String(auto);
    runLumPreview();
  });

  brightDarkBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      keepBright = btn.dataset.bright === 'true';
      if (state?.item) state.item.lastKeepBright = keepBright;
      // 字圖管理頁：已去背的透明原圖要換成對應的底色，深色的字才不會和底色混在一起（見 editor.js）
      state?.item?.reflatten?.(keepBright);
      brightDarkBtns.forEach(b => b.classList.toggle('active', b.dataset.bright === String(keepBright)));
      // 立即套用亮度去背（即時預覽跳過雜訊清理以加快速度，最終套用時才清理）
      if (bgMode === 'lum') runLumPreview();
    });
  });

  lumThreshSlider?.addEventListener('input', () => {
    if (lumThreshVal) lumThreshVal.textContent = lumThreshSlider.value;
  });
  lumThreshSlider?.addEventListener('change', () => {
    if (bgMode === 'lum') runLumPreview();
  });

  softContrastSlider?.addEventListener('input', () => {
    if (softContrastVal) softContrastVal.textContent = `${softContrastSlider.value}%`;
  });

  // ── 鍵盤逐格調整（字圖管理頁）：←/→ 臨界值、↓/↑ 對比度，按住 Option 每次 ±5 ──
  // 數值立刻更新，連按時等停下來才重新去背，避免卡頓、復原紀錄也只記一筆
  let stepTimer = 0;
  function stepSlider(slider, delta, onValue, rerun) {
    if (!slider) return;
    const min = Number(slider.min), max = Number(slider.max);
    const v = Math.min(max, Math.max(min, Number(slider.value) + delta));
    if (v === Number(slider.value)) return;
    slider.value = String(v);
    onValue(v);
    clearTimeout(stepTimer);
    stepTimer = setTimeout(rerun, 220);
  }
  dialog.addEventListener('keydown', (e) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) return;
    // 打字的欄位、或焦點在滑桿上（滑桿本身會處理方向鍵）時不攔截
    if (e.target.matches?.('input, select, textarea')) return;
    if (bgMode !== 'lum') return;
    const big = e.altKey ? 5 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      stepSlider(lumThreshSlider, e.key === 'ArrowRight' ? big : -big,
        (v) => { if (lumThreshVal) lumThreshVal.textContent = String(v); },
        () => runLumPreview());
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && lumStyle === 'soft') {
      e.preventDefault();
      stepSlider(softContrastSlider, e.key === 'ArrowUp' ? big : -big,
        (v) => { if (softContrastVal) softContrastVal.textContent = `${v}%`; },
        () => runLumPreview());
    }
  });
  softContrastSlider?.addEventListener('change', () => {
    if (bgMode === 'lum' && lumStyle === 'soft') runLumPreview();
  });

  alphaThreshSlider?.addEventListener('input', () => {
    if (alphaThreshVal) alphaThreshVal.textContent = alphaThreshSlider.value;
  });
  alphaThreshSlider?.addEventListener('change', () => {
    if (bgMode === 'ai') runAiPreview();
  });

  noiseAreaSlider?.addEventListener('input', () => {
    if (noiseAreaVal) noiseAreaVal.textContent = noiseAreaSlider.value;
  });
  noiseAreaSlider?.addEventListener('change', () => {
    if (bgMode === 'ai') runAiPreview();
  });

  // 這顆按鈕只在 AI 模式、且尚未執行過 AI 去背時顯示，用來觸發第一次的
  // AI 去背（重的非同步操作，無法像亮度模式一樣單靠滑桿即時觸發）。
  // 執行完之後按鈕會自動隱藏，改由 alpha 閾值／雜訊去除滑桿即時預覽。
  applyBgBtn?.addEventListener('click', async () => {
    if (!state || bgMode !== 'ai' || state.item.bgRemovedCanvas) return;
    applyBgBtn.disabled = true;
    const prevLabel = applyBgBtn.textContent;
    try {
      const { bgRemovedCanvas } = await fullAiProcess(state.item.file, {}, (msg) => {
        applyBgBtn.textContent = msg || '處理中…';
      });
      state.item.bgRemovedCanvas = bgRemovedCanvas;
    } catch (err) {
      console.error(err);
      applyBgBtn.textContent = prevLabel;
      applyBgBtn.disabled = false;
      return;
    }
    state.working = cleanWhiteMask(state.item.bgRemovedCanvas, {
      alphaThreshold: Number(alphaThreshSlider.value),
      minNoiseArea: Number(noiseAreaSlider.value),
      erodePx: 0,
    });
    cropOffsetX = 0;
    cropOffsetY = 0;
    cropRect = null;
    pushHistory();
    fitCanvas();
    updateApplyBgState();
  });

  // --- 底部操作 ---
  undoBtn?.addEventListener('click', undo);
  redoBtn?.addEventListener('click', redo);

  trimBtn?.addEventListener('click', () => {
    // 先清掉貼邊的裝飾框（如作者名條、頁尾品牌列，若沒有偵測到就原封不動），
    // 再一律裁掉透明留白（就算沒有裝飾框，也要做這一步基本的自動裁切）。
    // 記錄實際位移，讓版面上的擺放位置能正確跟著平移，而不是跑位。
    const smart = smartCropFrameRect(state.working, { padding: 8 });
    const final = trimTransparentRect(smart.canvas, 8);
    state.working = final.canvas;
    cropOffsetX += smart.dx + final.dx;
    cropOffsetY += smart.dy + final.dy;
    cropRect = null;
    pushHistory();
    fitCanvas();
  });

  // 還原自動流程套用「智慧裁切」之前的版本（保留邊框，讓使用者自行決定要不要留）
  restoreSmartCropBtn?.addEventListener('click', () => {
    // 字圖管理頁：用目前的去背設定對「整張原圖」重新去背，畫布回到原圖的完整尺寸
    if (state?.item?.restoreFull && state.item.sourceCanvas && bgMode === 'lum') {
      const src = state.item.sourceCanvas;
      state.item.lumChanged = true;
      const threshold = Number(lumThreshSlider.value);
      state.working =
        lumStyle === 'soft'
          ? autoLumExtractSoft(src, {
              threshold,
              keepBright,
              softness: contrastToSoftness(Number(softContrastSlider.value)),
              bgLum: state.item.preCutBg,
            })
          : autoLumExtract(src, { threshold, keepBright, minNoiseArea: 0 });
      // 位移換算成相對於 baseSourceDx/Dy，之後調整去背參數時才會沿用整張原圖的範圍
      cropOffsetX = -baseSourceDx;
      cropOffsetY = -baseSourceDy;
      cropRect = null;
      pushHistory();
      fitCanvas();
      return;
    }
    if (!state?.item?.preSmartCropCanvas) return;
    state.working = cloneCanvas(state.item.preSmartCropCanvas);
    // preSmartCropCanvas 相對於 sourceCanvas 的位移跟 openingCanvas 不同，
    // 换算成相對於 openingCanvas 的位移，讓後續調整去背參數時的裁切範圍仍然正確。
    const preRect = state.item.preSmartCropRect;
    cropOffsetX = preRect ? preRect.x - baseSourceDx : 0;
    cropOffsetY = preRect ? preRect.y - baseSourceDy : 0;
    cropRect = null;
    pushHistory();
    fitCanvas();
  });

  // 確認裁切：把目前框選範圍實際套用到畫布上，可以繼續在彈窗內編輯（例如接著用橡皮擦）
  confirmCropBtn?.addEventListener('click', () => {
    if (!cropRect) return;
    const x = Math.round(cropRect.x);
    const y = Math.round(cropRect.y);
    state.working = cropCanvas(state.working, x, y, Math.round(cropRect.w), Math.round(cropRect.h));
    cropOffsetX += x;
    cropOffsetY += y;
    cropRect = null;
    pushHistory();
    updateCropActionButtons();
    fitCanvas();
  });

  clearCropBtn?.addEventListener('click', () => {
    if (!state?.working) return;
    cropRect = {
      x: 0,
      y: 0,
      w: state.working.width,
      h: state.working.height,
    };
    updateCropActionButtons();
    redraw();
  });

  // 放棄本次在精修視窗做的所有調整（去背重跑、橡皮擦、裁切…），回到開啟精修時的畫面
  resetSessionBtn?.addEventListener('click', () => {
    if (!state?.openingCanvas) return;
    state.working = cloneCanvas(state.openingCanvas);
    cropOffsetX = 0;
    cropOffsetY = 0;
    cropRect = null;
    cropDrag = null;
    history = [];
    offsetHistory = [];
    historyIndex = -1;
    pushHistory();
    updateCropActionButtons();
    if (tool === 'crop') {
      initDefaultCropRect();
      redraw();
    } else {
      fitCanvas();
    }
  });

  dialog.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  });

  // 把目前畫布交給 onConfirm；逐張處理時由 confirmAndGo 接著開下一張
  function confirmCurrent() {
    let result = state.working;
    let dx = cropOffsetX;
    let dy = cropOffsetY;
    if (tool === 'crop' && cropRect) {
      const x = Math.round(cropRect.x);
      const y = Math.round(cropRect.y);
      result = cropCanvas(state.working, x, y, Math.round(cropRect.w), Math.round(cropRect.h));
      dx += x;
      dy += y;
    }
    const sourceCropRect =
      bgMode === 'lum' && state.item.sourceCanvas
        ? {
            x: baseSourceDx + dx,
            y: baseSourceDy + dy,
            w: result.width,
            h: result.height,
          }
        : null;
    return callbacks.onConfirm(state.item, cloneCanvas(result), { dx, dy, sourceCropRect });
  }

  dialog.querySelector('#confirmRefineBtn').addEventListener('click', () => {
    confirmCurrent();
    dialog.close();
  });

  // ── 逐張處理 ──
  const prevBtn = dialog.querySelector('#refinePrevBtn');
  const nextBtn = dialog.querySelector('#refineNextBtn');
  const navPos = dialog.querySelector('#refineNavPos');
  const confirmNextBtn = dialog.querySelector('#confirmNextBtn');
  const go = (dir) => callbacks.onNavigate?.(state.item, dir);
  async function confirmAndGo() {
    const item = state.item;
    await confirmCurrent();
    // onConfirm 可能是非同步（例如送回字牆）；完成後再開下一張，沒有下一張就關閉
    if (!(await callbacks.onNavigate?.(item, 1, { unfinished: true }))) dialog.close();
  }
  // 字牆模式：標記需要換圖，然後跳到下一張還沒處理的作品
  const needsImageBtn = dialog.querySelector('#needsImageBtn');
  async function markNeedsImage() {
    if (!callbacks.onNeedsImage) return;
    const item = state.item;
    await callbacks.onNeedsImage(item);
    if (!(await callbacks.onNavigate?.(item, 1, { unfinished: true }))) dialog.close();
  }
  needsImageBtn?.addEventListener('click', markNeedsImage);
  prevBtn?.addEventListener('click', () => go(-1));
  nextBtn?.addEventListener('click', () => go(1));
  confirmNextBtn?.addEventListener('click', confirmAndGo);
  dialog.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.shiftKey && e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.shiftKey && e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); confirmAndGo(); }
    else if ((e.key === 'n' || e.key === 'N') && callbacks.onNeedsImage) { e.preventDefault(); markNeedsImage(); }
  });

  dialog.querySelector('#closeRefine').addEventListener('click', () => dialog.close());

  // --- open() ---
  return {
    open(item, openMode = 'refine') {
      const openingCanvas = cloneCanvas(item.processedCanvas);
      state = { item, working: cloneCanvas(openingCanvas), openingCanvas };
      cropOffsetX = 0;
      cropOffsetY = 0;
      baseSourceDx = item.cropRect?.x ?? 0;
      baseSourceDy = item.cropRect?.y ?? 0;
      history = [];
      offsetHistory = [];
      historyIndex = -1;
      pushHistory();
      cropRect = null;
      cropDrag = null;

      if (restoreSmartCropBtn) {
        restoreSmartCropBtn.disabled = !item.preSmartCropCanvas && !item.restoreFull;
        restoreSmartCropBtn.title = item.restoreFull
          ? '用目前的去背設定對整張原圖重新去背，回到原圖的完整尺寸'
          : item.preSmartCropCanvas
            ? '找回自動裁切時被去除的邊框內容'
            : '這張作品沒有被自動裁切過';
      }
      titleEl.textContent = `精修 · ${item.author}`;
      // 逐張處理的位置與按鈕狀態（由 main.js 提供 navInfo）
      const nav = callbacks.navInfo?.(item);
      if (navPos) navPos.textContent = nav ? `${item.author.replace(/^@/, '')}　${nav.index + 1} / ${nav.total}${nav.note ? `　${nav.note}` : ''}` : '';
      if (prevBtn) prevBtn.disabled = !nav || nav.index <= 0;
      if (nextBtn) nextBtn.disabled = !nav || nav.index >= nav.total - 1;
      refineTools.classList.remove('hidden');
      dialog.querySelectorAll('.refine-brush-only').forEach(el => el.classList.remove('hidden'));

      // 初始化去背方式
      setBgMode('lum');
      setVisible(aiControls, false);
      // 預設採灰階 alpha 遮罩，避免把原圖的反鋸齒邊緣切成鋸齒；
      // 已經手動選過黑白／灰階的作品則延續其設定。
      lumStyle = item.lastLumStyle || 'soft';
      lumStyleBtns.forEach(b => b.classList.toggle('active', b.dataset.lumStyle === lumStyle));
      softContrastField?.classList.toggle('hidden', lumStyle !== 'soft');
      // 75% 對比度 ≈ softness 40，與預設自動處理一致。
      const defaultContrast =
        item.lastLumSoftness !== undefined
          ? Math.round(
              Math.max(
                10,
                Math.min(
                  100,
                  (((item.preCut ? SOFT_MAX_PRECUT : SOFT_MAX) - item.lastLumSoftness) /
                    ((item.preCut ? SOFT_MAX_PRECUT : SOFT_MAX) - SOFT_MIN)) *
                    100,
                ),
              ),
            )
          : 75;
      if (softContrastSlider) softContrastSlider.value = String(defaultContrast);
      if (softContrastVal) softContrastVal.textContent = `${defaultContrast}%`;
      if (lumThreshLabelLeft) lumThreshLabelLeft.textContent = '保留少';
      if (lumThreshLabelRight) lumThreshLabelRight.textContent = '保留多';

      // 初始化 keepBright：沿用本圖已判定／使用者選過的明暗方向，
      // 切換黑白／灰階模式時也不應被 UI 預設「白字深底」覆寫。
      if (item.lastKeepBright !== undefined) {
        keepBright = !!item.lastKeepBright;
      } else if (item.sourceCanvas) {
        keepBright = !detectNeedsInvert(item.sourceCanvas);
      } else {
        keepBright = true;
      }
      item.lastKeepBright = keepBright;
      brightDarkBtns.forEach(b => b.classList.toggle('active', b.dataset.bright === String(keepBright)));

      // 滑桿顯示「這張圖實際套用過的臨界值」，跟目前預覽一致；
      // 從未套用過亮度去背時才退回自動判斷值。
      if (item.lastLumThreshold !== undefined) {
        lumThreshSlider.value = String(item.lastLumThreshold);
      } else if (item.sourceCanvas) {
        lumThreshSlider.value = String(computeOtsuThreshold(item.sourceCanvas));
      }
      if (lumThreshVal) lumThreshVal.textContent = lumThreshSlider.value;

      // 初始化工具（crop 模式從 editCropBtn 開啟時預選裁切）
      const initTool = openMode === 'crop' ? 'crop' : 'erase';

      updateApplyBgState();
      // 逐張切換時視窗已經開著，再呼叫 showModal 會出錯
      if (!dialog.open) dialog.showModal();
      // 等 modal 版面完成後再初始化畫布 / Cropper，避免容器寬度為 0
      requestAnimationFrame(() => {
        setTool(initTool);
        if (initTool !== 'crop') fitCanvas();
      });
    },
  };
}
