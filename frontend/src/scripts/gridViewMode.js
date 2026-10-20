import gsap from "gsap";

// 首頁「圖 / 字」切換：在 <html> 設 data-view，樣式由 CSS 接管（見 ProjectGrid.astro）
// 首次繪製前的套用在 index.astro 的 inline script，避免先閃一次圖片模式
const GRID_VIEW_KEY = "grid-view";
const STEP = 6; // 排版格子的解析度（px）

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
    return localStorage.getItem(GRID_VIEW_KEY) === "type" ? "type" : "image";
  } catch (_) {
    return "image";
  }
};

const applyView = (view) => {
  if (view === "type") document.documentElement.dataset.view = "type";
  else delete document.documentElement.dataset.view;
  for (const btn of options) {
    btn.setAttribute("aria-pressed", String(btn.dataset.viewOption === view));
  }
};

const visibleItems = () =>
  Array.from(grid.children)
    .filter((el) => el.hasAttribute("data-wordmark") && getComputedStyle(el).display !== "none")
    .sort((a, b) => (parseInt(a.style.order) || 0) - (parseInt(b.style.order) || 0));

// 版面寬度分段：同一段內只做等比例縮放（純 CSS 百分比），跨段才重新排版，縮放視窗時不會一直跳動
const BANDS = [320, 400, 480, 580, 700, 840, 1000, 1180, 1400, 1660, 1960];
const bandOf = (W) => BANDS.reduce((d, b) => (W >= b ? b : d), BANDS[0]);

// 每件作品的長寬比與量感（以「一個字的面積」為單位）
const metrics = (el) => {
  const aspect = parseFloat(el.dataset.wmAspect) || 1;
  // 面積和字數不完全成正比（0.8 次方），且至少 1.6 個字的面積：單字作品整體才不會顯得太小
  // 手動倍率最後才乘：寬度 × scale，所以面積 × scale²
  const scale = parseFloat(el.dataset.wmScale) || 1;
  const mass = Math.max(1.6, (parseFloat(el.dataset.wmMass) || 1) ** 0.8) * scale ** 2;
  return { aspect, mass };
};
const unitOf = (D) => (D < 480 ? 62 : Math.min(130, Math.max(68, D * 0.074)));

/*
 * 字牆排版：分欄堆疊。把寬度切成固定欄數，每件作品依量感佔幾欄。
 * 每一步先找「最上方、最左邊」的空位，再從接下來 LOOKAHEAD 件裡挑最能填滿這個空位的作品：
 *  - 前瞻挑選：不必嚴格照順序，後面合適的作品可以先補進空洞（順序最多延後 LOOKAHEAD 件）
 *  - 彈性縮放：作品可在目標大小 ±FLEX 內縮放，剛好撐滿所佔欄寬，欄內不留白
 * 前幾件都放不下的窄縫就留白，往下一列繼續找。
 * 左右邊界貼齊欄線；超出彈性範圍時，碰到左邊界的靠左、碰到右邊界的靠右、其餘置中。
 * 位置在「分段寬度 D」的座標系裡計算，最後換成百分比寫進 CSS。
 */
const LOOKAHEAD = 8;
const FLEX = 0.1;

const packColumns = (items, D) => {
  const unit = unitOf(D);
  const gap = unit * 0.45; // 字與字的間距（原 0.34，之後加大到 0.374、0.45）
  const N = D < 480 ? 8 : 16;
  const colW = (D - gap * (N - 1)) / N;
  const pitch = colW + gap;
  const spanOf = (k) => k * colW + (k - 1) * gap;
  let rows = 512;
  // 0 = 空、1 = 已放作品、2 = 放不下任何作品而留白
  let occ = new Uint8Array(N * rows);
  const grow = () => {
    const o = new Uint8Array(N * rows * 2);
    o.set(occ);
    occ = o;
    rows *= 2;
  };
  const free = (r, c, k, ch) => {
    while (r + ch > rows) grow();
    for (let rr = r; rr < r + ch; rr++) for (let cc = c; cc < c + k; cc++) if (occ[rr * N + cc]) return false;
    return true;
  };
  // 在 k 欄寬的位置上要顯示多寬：±FLEX 內就撐滿欄寬；欄寬太窄回傳 null；太寬則維持原大小、在欄內留白
  const fitWidth = (it, k) => {
    const s = spanOf(k);
    if (s < it.target * (1 - FLEX)) return null;
    return s <= it.target * (1 + FLEX) ? s : it.target;
  };
  const kOptions = (it, maxK) => {
    const ideal = (it.target + gap) / pitch;
    const ks = new Set([Math.floor(ideal), Math.ceil(ideal)].map((k) => Math.min(N, Math.max(1, k))));
    return [...ks].filter((k) => k <= maxK);
  };

  const queue = items.map((el) => {
    const { aspect, mass } = metrics(el);
    return { el, aspect, target: Math.min(unit * Math.sqrt(mass * aspect), D) };
  });
  const placed = [];
  let top = 0;

  while (queue.length) {
    // 最上方、最左邊的空位，以及從那裡往右連續的空欄數 m
    let r0 = top;
    let c0 = -1;
    for (; ; r0++) {
      while (r0 >= rows) grow();
      const base = r0 * N;
      for (let c = 0; c < N; c++) {
        if (!occ[base + c]) {
          c0 = c;
          break;
        }
      }
      if (c0 >= 0) break;
    }
    top = r0;
    let m = 0;
    while (c0 + m < N && !occ[r0 * N + c0 + m]) m++;

    const look = Math.min(LOOKAHEAD, queue.length);
    const minTarget = queue.slice(0, look).reduce((v, it) => Math.min(v, it.target), Infinity);
    let best = null;
    for (let i = 0; i < look; i++) {
      const it = queue[i];
      for (const k of kOptions(it, m)) {
        const w = fitWidth(it, k);
        if (w === null) continue;
        const h = w / it.aspect;
        const ch = Math.ceil((h + gap) / STEP);
        if (!free(r0, c0, k, ch)) continue;
        const spanW = spanOf(k);
        const left = m - k;
        // 分數越低越好：欄內留白、偏離目標大小、留下太窄放不下東西的縫、偏離原本順序都扣分；剛好填滿加分
        const sliver = left > 0 && spanOf(left) < minTarget * (1 - FLEX);
        const score =
          (spanW - w) / spanW +
          Math.abs(w / it.target - 1) * 1.5 +
          (sliver ? 0.25 : 0) +
          (left === 0 ? -0.05 : 0) +
          i * 0.04;
        if (!best || score < best.score) best = { i, k, w, h, ch, score };
      }
    }
    if (!best) {
      // 這個空位放不下接下來任何一件：這一列標成留白，往下一列找
      for (let c = c0; c < c0 + m; c++) occ[r0 * N + c] = 2;
      continue;
    }
    const { i, k, w, h, ch } = best;
    const [it] = queue.splice(i, 1);
    for (let rr = r0; rr < r0 + ch; rr++) for (let cc = c0; cc < c0 + k; cc++) occ[rr * N + cc] = 1;
    const spanW = spanOf(k);
    const spanX = c0 * pitch;
    const x = c0 === 0 ? spanX : c0 + k === N ? spanX + spanW - w : spanX + (spanW - w) / 2;
    placed.push({ el: it.el, x, y: r0 * STEP, w, h, r0, ch, c0, k });
  }
  // 排完後的置中調整：不貼左右邊界的作品，移到它左右兩側實際空著的範圍正中央，
  // 讓放不進東西的空白平均分到兩側，而不是全部堆在右邊
  for (const p of placed) {
    if (p.c0 === 0 || p.c0 + p.k === N) continue;
    let left = Infinity;
    let right = Infinity;
    for (let rr = p.r0; rr < p.r0 + p.ch; rr++) {
      let l = 0;
      for (let c = p.c0 - 1; c >= 0 && occ[rr * N + c] !== 1; c--) l++;
      let r = 0;
      for (let c = p.c0 + p.k; c < N && occ[rr * N + c] !== 1; c++) r++;
      left = Math.min(left, l);
      right = Math.min(right, r);
    }
    p.x += ((right - left) / 2) * pitch;
  }
  const height = placed.reduce((mx, p) => Math.max(mx, p.y + p.h), 0) || 1;
  return { placed, height };
};

let currentBand = 0;

const layout = () => {
  frame = 0;
  if (!grid || !isTypeView()) return;
  const W = grid.clientWidth;
  if (!W) return;
  const D = bandOf(W);
  const items = visibleItems();
  const signature = `${D}|${items.map((el) => el.getAttribute("href")).join(",")}`;
  if (signature === lastSignature) return;
  const bandChanged = currentBand && currentBand !== D;
  lastSignature = signature;
  currentBand = D;

  const { placed, height } = packColumns(items, D);
  observer?.disconnect();
  // 跨段重排時讓字滑到新位置；第一次排版與排序／搜尋直接定位
  grid.classList.toggle("wall--glide", Boolean(bandChanged));
  for (const p of placed) {
    p.el.style.setProperty("--x", `${((p.x / D) * 100).toFixed(3)}%`);
    p.el.style.setProperty("--y", `${((p.y / height) * 100).toFixed(3)}%`);
    p.el.style.setProperty("--w", `${((p.w / D) * 100).toFixed(3)}%`);
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
  layout();
  replayCards();
};

const init = () => {
  grid = document.querySelector("[data-grid]");
  options = Array.from(document.querySelectorAll("[data-view-option]"));
  for (const btn of options) btn.addEventListener("click", handleClick);
  applyView(readView());
  if (!grid) return;
  lastSignature = "";
  observer = new MutationObserver(scheduleLayout);
  resizeObserver = new ResizeObserver(scheduleLayout);
  resizeObserver.observe(grid);
  observe();
  layout();
};

const cleanup = () => {
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

document.addEventListener("astro:page-load", () => {
  if (document.documentElement.getAttribute("data-page") === "home") init();
});
document.addEventListener("astro:before-swap", cleanup);
