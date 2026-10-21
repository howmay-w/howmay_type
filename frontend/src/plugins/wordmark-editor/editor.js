/**
 * 字圖管理頁的精修視窗（在 /__wordmarks/editor，以 iframe 疊在管理頁上方）。
 * 精修介面沿用 wut-collage-tool 的 refineModal；這裡負責：
 *  - 載入貼文原圖、用亮度預設流程自動去背
 *  - 確認後轉成白字透明背景的 webp 存回作品資料夾
 *  - 「需要換圖」寫回管理頁的分類
 *  - 上一張／下一張由管理頁決定（照管理頁目前的清單順序）
 * 與管理頁之間用 postMessage 溝通：
 *  管理頁 → 這裡：{ type: "open", info } / { type: "none" }
 *  這裡 → 管理頁：{ type: "ready" } / { type: "navigate", key, dir, unfinished } / { type: "changed", key } / { type: "closed" }
 * 一件作品可以有好幾款字圖：key = slug#v，v 是第幾款（0 = 主字圖）
 */
// 樣式表用 <link> 載入（見 editor.html）：若在這裡 import CSS，Vite 會接上即時更新連線，
// 存檔寫入作品資料夾時 Astro 會要求整頁重新載入，精修中的狀態就會不見
import { fullAutoProcess } from "./autoProcess.js";
import { createRefineController } from "./refineModal.js";

const dialog = document.getElementById("refineDialog");
const loadingEl = document.getElementById("editorLoading");
const errorEl = document.getElementById("editorError");
let current = null; // 管理頁傳來的作品資訊 { key, slug, v, title, post, wordmark, index, total, note }
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

// 已經去背過的原圖（例如換圖時上傳的透明 PNG）：字的深淺只存在透明度裡，RGB 幾乎全是同一個顏色，
// 只看亮度的去背流程會變成「全留或全刪」、漸層也會消失。
// 先把它鋪到和字相反的底色上（白字鋪黑底、黑字鋪白底），透明度就變成亮度，臨界值與對比度才能細調。
// 一開始依字的整體亮度挑底色；之後切換「白字深底／黑字淺底」時會換成對應的底色（見 flattenOn），
// 不然像「字戀」這種黑框黃字的透明圖，鋪了黑底再選黑字，黑框會和底色混在一起被切掉。
function flattenOn(canvas, bright) {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = bright ? "#000" : "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return out;
}
function flattenIfCutout(canvas) {
  const { width: W, height: H } = canvas;
  const d = canvas.getContext("2d").getImageData(0, 0, W, H).data;
  let clear = 0, sumA = 0, sumLum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 250) clear++;
    sumA += a;
    sumLum += a * (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  }
  if (clear < W * H * 0.01 || !sumA) return { canvas, preCut: false, bg: undefined };
  const bright = sumLum / sumA >= 128;
  return { canvas: flattenOn(canvas, bright), preCut: true, bg: bright ? 0 : 255, original: canvas };
}

async function api(url, opt) {
  const r = await fetch(url, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// 長邊縮到 800px、轉 webp；墨量 = 平均不透明度（字牆用來平衡粗細字的量感）。
// 原圖直接用的字圖若這次只裁切、擦除（沒有重新去背），保留到 1200px 並維持「原圖直接用」標記，畫質與對比不變
async function saveWordmark(canvas, item) {
  const keepDirect = Boolean(current.direct && !item?.lumChanged);
  const s = Math.min(1, (keepDirect ? 1200 : 800) / Math.max(canvas.width, canvas.height));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(canvas.width * s));
  out.height = Math.max(1, Math.round(canvas.height * s));
  out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);
  const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  for (let i = 3; i < d.length; i += 4) sum += d[i];
  const ink = sum / 255 / (canvas.width * canvas.height);
  const blob = await new Promise((res) => out.toBlob(res, "image/webp", 0.9));
  await api(`/__wordmarks/api/replace?slug=${encodeURIComponent(current.slug)}&v=${current.v ?? 0}&ink=${ink.toFixed(3)}${keepDirect ? "&mode=direct" : ""}`, {
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
    const { canvas: source, preCut, bg, original } = flattenIfCutout(await loadCanvas(info.post));
    // 自動去背的結果只用來提供臨界值等預設值與「找回邊框」；畫面從目前的字圖開始，
    // 不會把之前處理好的結果蓋掉。要重新去背再按「自動」或調整臨界值。
    // 已去背的原圖：臨界值放在中間、柔和範圍拉到最寬，結果接近原本的透明漸層（對比度 10%）
    const r = fullAutoProcess(source, preCut ? { threshold: 128, softness: 271, bgLum: bg } : {});
    const currentCanvas = info.wordmark ? await loadCanvas(info.wordmark).catch(() => null) : null;
    const item = {
      id: info.key,
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
      // 原圖本來就去過背：對比度可以調得更低，接近完整保留原本的透明漸層
      preCut,
      preCutBg: bg,
      // 切換「白字深底／黑字淺底」時，透明原圖改鋪對應的底色（白字 → 黑底、黑字 → 白底）
      reflatten: preCut
        ? function (keepBright) {
            this.sourceCanvas = flattenOn(original, keepBright);
            this.preCutBg = keepBright ? 0 : 255;
          }
        : null,
    };
    // 一開始判斷的明暗方向和底色不一致時（例如判斷成黑字），先換成對應的底色
    item.reflatten?.(item.lastKeepBright);
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
      tell({ type: "navigate", key: current.key, dir, unfinished: !!opts.unfinished });
    }),
  async onConfirm(item, canvas) {
    try {
      await saveWordmark(canvas, item);
      tell({ type: "changed", key: current.key });
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
        body: JSON.stringify({ slug: current.slug, v: current.v ?? 0, fields: { redo: null, reviewed: null, needsImage: true } }),
      });
      tell({ type: "changed", key: current.key });
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
