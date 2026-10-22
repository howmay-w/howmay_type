import gsap from "gsap";
import { bandOf, createPacker, scatterIndex, testParam } from "./wallPacker.js";
import "./projectWordmark.js";

// 首頁「圖 / 字」切換：在 <html> 設 data-view，樣式由 CSS 接管（見 ProjectGrid.astro）
// 首次繪製前的套用在 index.astro 的 inline script，避免先閃一次圖片模式
const GRID_VIEW_KEY = "grid-view";
let options = [];
let grid = null;
let observer = null;
let resizeObserver = null;
let frame = 0;
let frameTimer = 0;
let lastSignature = "";

const isTypeView = () => document.documentElement.dataset.view === "type";

const readView = () => {
  // 網址 ?view=type 可直接指定（分享連結、比較頁的 iframe 用）
  const fromUrl = new URLSearchParams(window.location.search).get("view");
  if (fromUrl === "type" || fromUrl === "image") return fromUrl;
  try {
    // 預設「字」；選過「圖」才記住
    return localStorage.getItem(GRID_VIEW_KEY) === "image" ? "image" : "type";
  } catch (_) {
    return "type";
  }
};

const applyView = (view) => {
  if (view === "type") document.documentElement.dataset.view = "type";
  else delete document.documentElement.dataset.view;
  for (const btn of options) {
    btn.setAttribute("aria-pressed", String(btn.dataset.viewOption === view));
  }
};

/*
 * 字牆上要排的作品：顯示中的卡片照順序，再把其他款字圖（data-wm-extra）穿插進去。
 * 其他款要散在整面牆、不和本尊擠在一起：每一款在「全部卡片的順序」裡分到一個隨機位置
 * （把整個清單切成和款數一樣多段，每段裡隨機挑一個，且離本尊至少 EXTRA_APART 件），
 * 等那個位置的卡片顯示出來（例如按 MORE 載入到那裡）就出現在它旁邊；本尊還沒載入也沒關係，點進去都是同一篇。
 * 搜尋時：本尊被篩掉，其他款也不出現；本尊符合但那個位置的卡片被篩掉，就改排在本尊後面幾件。
 */
const byOrder = (a, b) => (parseInt(a.style.order) || 0) - (parseInt(b.style.order) || 0);
const visibleItems = () => {
  const children = Array.from(grid.children);
  const all = children.filter((el) => !el.hasAttribute("data-wm-extra")).sort(byOrder);
  const shown = (el) => el.hasAttribute("data-wordmark") && getComputedStyle(el).display !== "none";
  const cards = all.filter(shown);
  const at = new Map(cards.map((el, i) => [el, i]));
  // 只在有字圖的卡片之間挑位置（沒有字圖的卡片不會出現在字牆）
  const pool = all.filter((el) => el.hasAttribute("data-wordmark"));
  const poolAt = new Map(pool.map((el, i) => [el.getAttribute("href"), i]));
  const byHref = new Map(all.map((el) => [el.getAttribute("href"), el]));
  const extras = children.filter((el) => el.hasAttribute("data-wm-extra"));
  const count = new Map();
  for (const el of extras) count.set(el.dataset.wmExtra, (count.get(el.dataset.wmExtra) ?? 0) + 1);
  const keyed = cards.map((el, i) => ({ el, key: i }));
  for (const el of extras) {
    const href = el.dataset.wmExtra;
    const parent = byHref.get(href);
    let key = null;
    // 本尊被搜尋篩掉時，其他款也不出現。搜尋會把不符合的卡片設成 display: none（還沒載入的卡片也一樣），
    // 所以看 inline 的 display；只是還沒載入（MORE）的本尊則不算篩掉
    const parentFiltered =
      !parent || (!at.has(parent) && (parent.style.display === "none" || !parent.hasAttribute("data-deferred")));
    if (!parentFiltered) {
      const n = count.get(href);
      const j = (parseInt(el.dataset.wmIndex) || 1) - 1;
      const home = poolAt.get(href);
      // 第 j 段裡的隨機位置；太靠近本尊就往後挪
      const v = scatterIndex(href, j, n, home, pool.length);
      const target = pool[v];
      if (target && at.has(target)) key = at.get(target) + 0.5;
      else if (target && (target.style.display === "none" || !target.hasAttribute("data-deferred")) && at.has(parent)) {
        // 被搜尋篩掉：排在本尊後面，各款之間隔開
        // （搜尋把不符合的卡片設成 inline display: none，還沒載入的卡片也一樣，所以不能只看 data-deferred）
        key = at.get(parent) + (j + 1) * Math.max(3, Math.floor((cards.length - at.get(parent)) / (n + 1))) + 0.5;
      }
      // 其餘（那個位置的卡片還沒載入）：先不顯示，載入到那裡時才出現
    }
    el.toggleAttribute("data-wm-on", key !== null);
    if (key !== null) keyed.push({ el, key });
  }
  return keyed.sort((a, b) => a.key - b.key).map((x) => x.el);
};

let currentBand = 0;
// 目前字牆的排版器與已排的卡片順序；MORE 只是在後面多出卡片時，接著排而不重排
let packer = null;
let packedCards = [];

const layout = () => {
  frame = 0;
  if (!grid || !isTypeView()) return;
  const W = grid.clientWidth;
  if (!W) return;
  const D = bandOf(W);
  const items = visibleItems();
  const signature = `${D}|${items.map((el) => `${el.getAttribute("href")}#${el.dataset.wmIndex ?? 0}`).join(",")}`;
  if (signature === lastSignature) return;
  const bandChanged = currentBand && currentBand !== D;
  lastSignature = signature;
  currentBand = D;

  const cards = items.filter((el) => !el.hasAttribute("data-wm-extra"));
  // MORE：同一個分段、原本的卡片順序不變、只在後面多出新卡片 → 已排好的位置不動，新的接著排
  const isMore =
    packer &&
    packer.D === D &&
    cards.length > packedCards.length &&
    packedCards.every((el, i) => cards[i] === el);
  let result;
  if (isMore) {
    result = packer.add(items.filter((el) => !packer.has(el)));
  } else {
    packer = createPacker(D);
    result = packer.add(items);
  }
  packedCards = cards;
  const { placed, height } = result;
  observer?.disconnect();
  // 跨段重排時讓字滑到新位置；第一次排版與排序／搜尋直接定位
  grid.classList.toggle("wall--glide", Boolean(bandChanged));
  // 測試用：網址加 ?wmscale=0.9，排版完成後每張字圖以自己的中心縮放（位置不變、空隙變大），比較視覺感受用
  const s = testParam("wmscale");
  for (const p of placed) {
    const w = p.w * s;
    const x = p.x + (p.w - w) / 2;
    const y = p.y + (p.h - p.h * s) / 2;
    p.el.style.setProperty("--x", `${((x / D) * 100).toFixed(3)}%`);
    p.el.style.setProperty("--y", `${((y / height) * 100).toFixed(3)}%`);
    p.el.style.setProperty("--w", `${((w / D) * 100).toFixed(3)}%`);
  }
  grid.style.setProperty("--wall-ratio", `${D} / ${Math.ceil(height)}`);
  observe();
};

// 下一個畫面更新時重排；背景分頁不會觸發畫面更新，所以加計時器備援，誰先到誰執行
const scheduleLayout = () => {
  if (frame) return;
  const run = () => {
    if (!frame) return;
    cancelAnimationFrame(frame);
    clearTimeout(frameTimer);
    layout();
  };
  frame = requestAnimationFrame(run);
  frameTimer = setTimeout(run, 80);
};

// 排序、搜尋、MORE 都會改動卡片的 style / data-deferred，統一在這裡重排
const observe = () => {
  observer?.observe(grid, {
    subtree: false,
    childList: true,
    attributes: true,
    attributeFilter: ["style", "data-deferred"],
    attributeOldValue: false,
  });
  for (const el of grid.children) {
    observer?.observe(el, { attributes: true, attributeFilter: ["style", "data-deferred"] });
  }
};

const replayCards = () => {
  const visible = Array.from(grid.children)
    .filter((el) => !el.hasAttribute("data-deferred") && getComputedStyle(el).display !== "none")
    .sort((a, b) => (parseInt(a.style.order) || 0) - (parseInt(b.style.order) || 0));
  gsap.killTweensOf(visible);
  // 只有畫面內的卡片播入場動畫，其餘直接顯示，避免全部載入後要等很久
  const inView = visible.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  });
  gsap.set(
    visible.filter((el) => !inView.includes(el)),
    { yPercent: 0, autoAlpha: 1 },
  );
  gsap.fromTo(
    inView,
    { yPercent: 30, autoAlpha: 0 },
    { yPercent: 0, autoAlpha: 1, duration: 0.6, ease: "power3", stagger: 0.02 },
  );
};

const handleClick = (e) => {
  const view = e.currentTarget.dataset.viewOption;
  const current = isTypeView() ? "type" : "image";
  if (view === current) return;
  try {
    localStorage.setItem(GRID_VIEW_KEY, view);
  } catch (_) {}
  applyView(view);
  lastSignature = "";
  packer = null;
  layout();
  replayCards();
};

const init = () => {
  grid = document.querySelector("[data-grid]");
  options = Array.from(document.querySelectorAll("[data-view-option]"));
  for (const btn of options) btn.addEventListener("click", handleClick);
  applyView(readView());
  if (!grid) return;
  grid.addEventListener("pointerdown", onPointerDown);
  grid.addEventListener("pointercancel", release);
  grid.addEventListener("pointerup", onPointerUp);
  lastSignature = "";
  packer = null;
  observer = new MutationObserver(scheduleLayout);
  resizeObserver = new ResizeObserver(scheduleLayout);
  resizeObserver.observe(grid);
  observe();
  layout();
};

// 手機點字：手指一按下就讓字變色（和電腦版 hover 一樣），等換頁時不會以為卡住。
// 手指開始捲動時瀏覽器會送 pointercancel，就把顏色收回
let pressed = null;
const release = () => {
  pressed?.classList.remove("is-pressed");
  pressed = null;
};
const onPointerDown = (e) => {
  if (e.pointerType === "mouse" || !isTypeView()) return;
  const card = e.target.closest?.("a[data-wordmark], a[data-wm-extra]");
  if (!card || !grid?.contains(card)) return;
  release();
  pressed = card;
  card.classList.add("is-pressed");
};
// 長按、或按了沒換頁（例如拖出卡片外才放開）：放開一下後收回
const onPointerUp = () => {
  const card = pressed;
  setTimeout(() => {
    if (pressed === card) release();
  }, 1200);
};

const cleanup = () => {
  grid?.removeEventListener("pointerdown", onPointerDown);
  grid?.removeEventListener("pointercancel", release);
  grid?.removeEventListener("pointerup", onPointerUp);
  release();
  for (const btn of options) btn.removeEventListener("click", handleClick);
  observer?.disconnect();
  resizeObserver?.disconnect();
  if (frame) cancelAnimationFrame(frame);
  clearTimeout(frameTimer);
  options = [];
  grid = null;
  observer = null;
  resizeObserver = null;
  frame = 0;
};

/*
 * 從作品頁返回首頁時回到原本的段落：
 * 離開首頁時記下捲動位置與已載入幾批（MORE 按了幾次）；按「返回」回到首頁時，
 * 照同樣的順序一批一批載入（排版是接著排的，每件作品會回到一模一樣的位置），再捲回原處。
 * 首頁初始化（index.js）會先捲到頂端，所以等所有初始化跑完才還原。
 */
const RETURN_KEY = "grid-return";
// 整頁載入時（例如從帶 from_search 的作品頁按瀏覽器的上一頁）也算返回
let returning = performance.getEntriesByType?.("navigation")[0]?.type === "back_forward";
// 讓首頁入場動畫（index.js）知道這次是返回，跳過動畫
window.__gridReturning = returning;
document.addEventListener("astro:before-preparation", (e) => {
  if (grid && document.documentElement.getAttribute("data-page") === "home") {
    const loaded = Array.from(grid.children).filter(
      (el) => !el.hasAttribute("data-wm-extra") && !el.hasAttribute("data-deferred"),
    ).length;
    try {
      sessionStorage.setItem(RETURN_KEY, JSON.stringify({ y: window.scrollY, loaded }));
    } catch (_) {}
  }
  returning = e.navigationType === "traverse" && new URL(e.to).pathname === "/";
  window.__gridReturning = returning;
});

const restoreReturn = () => {
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? "null");
  } catch (_) {}
  if (!saved || !grid) return;
  const more = document.getElementById("load-more");
  // 搜尋中：所有符合的作品都已顯示，不用一批一批補載入（補載入會把被篩掉的卡片重新顯示）
  const searching = (() => {
    try {
      return Boolean(sessionStorage.getItem("grid-search-term"));
    } catch (_) {
      return false;
    }
  })();
  const loadedNow = () =>
    Array.from(grid.children).filter((el) => !el.hasAttribute("data-wm-extra") && !el.hasAttribute("data-deferred"))
      .length;
  // 首頁其他初始化（還原這次的隨機順序等）已經跑完：先用現在的順序重排第一批，
  // 再一批一批顯示、每批立刻排版，和當初一批一批按 MORE 的結果相同。
  // 不經過 MORE 按鈕：MORE 會播浮上來的動畫，返回時要直接是排好的樣子
  if (frame) cancelAnimationFrame(frame);
  clearTimeout(frameTimer);
  packer = null;
  lastSignature = "";
  layout();
  const BATCH = 24;
  const deferred = () =>
    Array.from(grid.children)
      .filter((el) => el.hasAttribute("data-deferred"))
      .sort(byOrder);
  while (!searching && loadedNow() < saved.loaded) {
    const batch = deferred().slice(0, BATCH);
    if (!batch.length) break;
    for (const el of batch) {
      el.removeAttribute("data-deferred");
      el.style.display = "";
    }
    if (frame) cancelAnimationFrame(frame);
    clearTimeout(frameTimer);
    layout();
  }
  if (more && !searching && !deferred().length) more.classList.add("hidden");
  // 只處理畫面上顯示的字（隱藏的卡片維持原狀，之後 MORE 或清除搜尋時會正常播放）
  const cards = Array.from(grid.children).filter((el) => getComputedStyle(el).display !== "none");
  gsap.killTweensOf(cards);
  gsap.set(cards, { yPercent: 0, autoAlpha: 1 });
  gsap.set(grid, { autoAlpha: 1 });
  window.scrollTo(0, saved.y);
};

document.addEventListener("astro:page-load", () => {
  if (document.documentElement.getAttribute("data-page") !== "home") return;
  init();
  if (returning) {
    returning = false;
    // 旗標等還原跑完才清掉：index.js 的初始化可能在這之後才執行，還要讀到它
    setTimeout(() => {
      restoreReturn();
      window.__gridReturning = false;
    }, 0);
  }
});
document.addEventListener("astro:before-swap", cleanup);
