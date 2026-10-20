/**
 * 字圖管理頁的精修視窗（在 /__wordmarks/editor，以 iframe 疊在管理頁上方）。
 * 精修介面沿用 wut-collage-tool 的 refineModal；這裡負責：
 *  - 載入貼文原圖、用亮度預設流程自動去背
 *  - 確認後轉成白字透明背景的 webp 存回作品資料夾
 *  - 「需要換圖」寫回管理頁的分類
 *  - 上一張／下一張由管理頁決定（照管理頁目前的清單順序）
 * 與管理頁之間用 postMessage 溝通：
 *  管理頁 → 這裡：{ type: "open", info } / { type: "none" }
 *  這裡 → 管理頁：{ type: "ready" } / { type: "navigate", slug, dir, unfinished } / { type: "changed", slug } / { type: "closed" }
 */
// 樣式表用 <link> 載入（見 editor.html）：若在這裡 import CSS，Vite 會接上即時更新連線，
// 存檔寫入作品資料夾時 Astro 會要求整頁重新載入，精修中的狀態就會不見
import { fullAutoProcess } from "./autoProcess.js";
import { createRefineController } from "./refineModal.js";

const dialog = document.getElementById("refineDialog");
const loadingEl = document.getElementById("editorLoading");
const errorEl = document.getElementById("editorError");
let current = null; // 管理頁傳來的作品資訊 { slug, title, post, index, total, note }
let navResolve = null;

const tell = (msg) => parent.postMessage({ source: "wordmark-editor", ...msg }, location.origin);

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.add("show");
  clearTimeout(showError.t);
  showError.t = setTimeout(() => errorEl.classList.remove("show"), 5000);
}

async function loadCanvas(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);
  return c;
}

async function api(url, opt) {
  const r = await fetch(url, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// 長邊縮到 800px、轉 webp；墨量 = 平均不透明度（字牆用來平衡粗細字的量感）
async function saveWordmark(canvas) {
  const s = Math.min(1, 800 / Math.max(canvas.width, canvas.height));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(canvas.width * s));
  out.height = Math.max(1, Math.round(canvas.height * s));
  out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);
  const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  for (let i = 3; i < d.length; i += 4) sum += d[i];
  const ink = sum / 255 / (canvas.width * canvas.height);
  const blob = await new Promise((res) => out.toBlob(res, "image/webp", 0.9));
  await api(`/__wordmarks/api/replace?slug=${encodeURIComponent(current.slug)}&ink=${ink.toFixed(3)}`, {
    method: "POST",
    body: blob,
  });
}

async function openItem(info) {
  current = info;
  if (!info.post) {
    showError(`「${info.title}」沒有貼文圖可以去背`);
    return false;
  }
  loadingEl.classList.add("show");
  try {
    const source = await loadCanvas(info.post);
    // 自動去背的結果只用來提供臨界值等預設值與「找回邊框」；畫面從目前的字圖開始，
    // 不會把之前處理好的結果蓋掉。要重新去背再按「自動」或調整臨界值。
    const r = fullAutoProcess(source, {});
    const currentCanvas = info.wordmark ? await loadCanvas(info.wordmark).catch(() => null) : null;
    const item = {
      id: info.slug,
      author: `@${info.title}`,
      file: null,
      sourceCanvas: source,
      processedCanvas: currentCanvas || r.canvas,
      lastLumThreshold: r.threshold,
      lastKeepBright: r.keepBright,
      lastLumStyle: r.lumStyle,
      lastLumSoftness: r.softness,
      preSmartCropCanvas: r.preSmartCropCanvas || null,
      preSmartCropRect: r.preSmartCropRect || null,
      // 從目前字圖開始時，它和原圖的對應位置未知，不沿用自動裁切的範圍；
      // 一旦調整臨界值等去背參數，refineModal 會改用 lumViewport（自動去背的範圍）從原圖重新產生
      cropRect: currentCanvas ? null : r.cropRect || null,
      lumViewport: currentCanvas ? r.cropRect || null : null,
      currentSize: currentCanvas ? { w: currentCanvas.width, h: currentCanvas.height } : null,
      // 「找回邊框」改為對整張原圖重新去背（回到原圖尺寸）
      restoreFull: true,
    };
    refine.open(item, "refine");
    return true;
  } catch (err) {
    showError(`無法載入「${info.title}」：${err.message}`);
    return false;
  } finally {
    loadingEl.classList.remove("show");
  }
}

const refine = createRefineController(dialog, {
  navInfo: () => (current ? { index: current.index, total: current.total, note: current.note || "" } : null),
  // 換哪一張由管理頁決定；管理頁回覆 open（打開）或 none（沒有了）
  onNavigate: (_item, dir, opts = {}) =>
    new Promise((resolve) => {
      navResolve = resolve;
      tell({ type: "navigate", slug: current.slug, dir, unfinished: !!opts.unfinished });
    }),
  async onConfirm(_item, canvas) {
    try {
      await saveWordmark(canvas);
      tell({ type: "changed", slug: current.slug });
    } catch (err) {
      showError(`存檔失敗：${err.message}`);
      throw err;
    }
  },
  async onNeedsImage() {
    try {
      await api("/__wordmarks/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: current.slug, fields: { redo: null, reviewed: null, needsImage: true } }),
      });
      tell({ type: "changed", slug: current.slug });
    } catch (err) {
      showError(`標記失敗：${err.message}`);
    }
  },
});

window.addEventListener("message", async (e) => {
  if (e.origin !== location.origin || e.source !== parent) return;
  const msg = e.data || {};
  if (msg.type === "open") {
    const ok = await openItem(msg.info);
    // 第一次就打不開（例如沒有原圖）：收起疊加層，不要卡住管理頁
    if (!ok && !dialog.open) setTimeout(() => tell({ type: "closed" }), 2500);
    navResolve?.(ok);
    navResolve = null;
  } else if (msg.type === "none") {
    navResolve?.(false);
    navResolve = null;
  }
});

dialog.addEventListener("close", () => tell({ type: "closed" }));
tell({ type: "ready" });
