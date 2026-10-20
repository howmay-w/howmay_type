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

/*
 * 字牆上要排的作品：顯示中的卡片照順序，再把其他款字圖（data-wm-extra）穿插進去。
 * 其他款跟著所屬作品顯示或隱藏（搜尋、MORE 都只動卡片），並和本尊隔開一段距離，不會擠在一起。
 */
const visibleItems = () => {
  const children = Array.from(grid.children);
  const cards = children
    .filter((el) => !el.hasAttribute("data-wm-extra") && el.hasAttribute("data-wordmark") && getComputedStyle(el).display !== "none")
    .sort((a, b) => (parseInt(a.style.order) || 0) - (parseInt(b.style.order) || 0));
  const at = new Map(cards.map((el, i) => [el.getAttribute("href"), i]));
  const extras = children.filter((el) => el.hasAttribute("data-wm-extra"));
  const byCard = new Map();
  for (const el of extras) {
    const on = at.has(el.dataset.wmExtra);
    el.toggleAttribute("data-wm-on", on);
    if (!on) continue;
    const list = byCard.get(el.dataset.wmExtra) ?? [];
    list.push(el);
    byCard.set(el.dataset.wmExtra, list);
  }
  // 第 j 款排在本尊後面 j × spread 的位置：把本尊之後的作品平均分給各款，至少隔 4 件
  const keyed = cards.map((el, i) => ({ el, key: i }));
  for (const [href, list] of byCard) {
    const spread = Math.max(4, Math.floor((cards.length - at.get(href)) / (list.length + 1)));
    list.forEach((el, j) => keyed.push({ el, key: at.get(href) + (j + 1) * spread + 0.5 }));
  }
  return keyed.sort((a, b) => a.key - b.key).map((x) => x.el);
};

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
 *  - 補空位：空位原本會留白時，才允許把一件作品縮小到 SHRINK 倍或放大到 GROW 倍、剛好撐滿
 * 目標是讓字與字的空隙平均（都接近固定的間距），不是把牆塞滿。
 * 左右邊界貼齊欄線；超出彈性範圍時，碰到左邊界的靠左、碰到右邊界的靠右、其餘置中。
 * 位置在「分段寬度 D」的座標系裡計算，最後換成百分比寫進 CSS。
 *
 * 排版可以「接著排」：MORE 載入下一批時，已經排好的作品位置不動，新作品從最後一排的空位接下去，
 * 畫面不會因為重排整面牆而跳動（見 layout）。
 */
const LOOKAHEAD = 8;
const FLEX = 0.1;
const GROW = 1.35;
const SHRINK = 0.8;
// 手機版作品小、補空位時縮放的差異比較明顯，範圍收窄
const GROW_MOBILE = 1.2;
const SHRINK_MOBILE = 0.85;
// 同一件作品的其他款：剛放過同一件的，接下來 APART 件內盡量不再放，避免兩款挨在一起
const APART = 8;

const createPacker = (D) => {
  const unit = unitOf(D);
  const gap = unit * 0.45; // 字與字的間距（原 0.34，之後加大到 0.374、0.45）
  // 手機版原本 8 欄：欄寬（約 53px）相對作品太粗，作品很難剛好撐滿欄寬，空洞多；改成和桌機一樣 16 欄
  const N = 16;
  const growMax = D < 480 ? GROW_MOBILE : GROW;
  const shrinkMin = D < 480 ? SHRINK_MOBILE : SHRINK;
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
    for (let rr = r; rr < r + ch; rr++) for (let cc = c; cc < c + k; cc++) if (occ[rr * N + cc] === 1) return false;
    return true;
  };
  const fill = (p, v) => {
    for (let rr = p.r0; rr < p.r0 + p.ch; rr++) for (let cc = p.c0; cc < p.c0 + p.k; cc++) occ[rr * N + cc] = v;
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
  const xOf = (c0, k, w) => {
    const spanX = c0 * pitch;
    const spanW = spanOf(k);
    return c0 === 0 ? spanX : c0 + k === N ? spanX + spanW - w : spanX + (spanW - w) / 2;
  };

  const placed = [];
  const placedEls = new Set();
  const lastAt = new Map();
  let top = 0;

  // 排完後逐件檢查：往左右多佔幾欄、往上或往下多佔幾列都還是空位（或留白），就等比例放大去填，
  // 不超過 growMax 倍，也不讓整面牆變高。最後幾件旁邊的空白是「排完了」而不是空洞，不放大。
  const growIntoGaps = (movable) => {
    const bottom = placed.reduce((mx, p) => Math.max(mx, p.r0 + p.ch), 0);
    const tail = new Set(placed.slice(-LOOKAHEAD));
    const isFree = (r0, c0, k, ch) => r0 + ch <= Math.min(bottom, rows) && free(r0, c0, k, ch);
    const bestGrow = (p) => {
      if (tail.has(p)) return null;
      fill(p, 0);
      // 上方連續空著的列數（取所佔各欄裡最少的）
      let up = Infinity;
      for (let cc = p.c0; cc < p.c0 + p.k; cc++) {
        let n = 0;
        while (p.r0 - n - 1 >= 0 && occ[(p.r0 - n - 1) * N + cc] !== 1) n++;
        up = Math.min(up, n);
      }
      let best = null;
      for (let k = Math.min(N, p.k + 4); k >= p.k; k--) {
        for (let c0 = Math.max(0, p.c0 + p.k - k); c0 <= Math.min(p.c0, N - k); c0++) {
          const w = Math.min(spanOf(k), p.target * growMax);
          if (w <= p.w + 1) continue;
          const h = w / p.aspect;
          const ch = Math.ceil((h + gap) / STEP);
          for (let lift = 0; lift <= Math.min(up, ch - p.ch); lift++) {
            const r0 = p.r0 - lift;
            if (!isFree(r0, c0, k, ch)) continue;
            const gain = w * h - p.w * p.h;
            if (!best || gain > best.gain) best = { r0, c0, k, w, h, ch, gain };
            break;
          }
        }
      }
      fill(p, 1);
      return best;
    };
    // 能多填滿最多面積的先放大（放大前重新確認還有空位）；最多三輪
    for (let round = 0; round < 3; round++) {
      const order = movable
        .map((p) => ({ p, g: bestGrow(p) }))
        .filter((x) => x.g)
        .sort((a, b) => b.g.gain - a.g.gain);
      if (!order.length) break;
      for (const { p } of order) {
        const g = bestGrow(p);
        if (!g) continue;
        fill(p, 0);
        Object.assign(p, { r0: g.r0, y: g.r0 * STEP, c0: g.c0, k: g.k, w: g.w, h: g.h, ch: g.ch });
        p.x = xOf(p.c0, p.k, p.w);
        fill(p, 1);
      }
    }
  };

  // 置中調整：左右「兩側都被其他作品夾住」的作品，移到中間空間的正中央，
  // 讓放不進東西的空白平均分到兩側。某一側空到邊界（例如最後一排、搜尋結果很少）就維持靠左。
  const centerBetween = (movable) => {
    for (const p of movable) {
      p.x = xOf(p.c0, p.k, p.w);
      if (p.c0 === 0 || p.c0 + p.k === N) continue;
      let left = Infinity;
      let right = Infinity;
      let openEdge = false;
      for (let rr = p.r0; rr < p.r0 + p.ch; rr++) {
        let l = 0;
        let c = p.c0 - 1;
        for (; c >= 0 && occ[rr * N + c] !== 1; c--) l++;
        if (c < 0) openEdge = true;
        let r = 0;
        c = p.c0 + p.k;
        for (; c < N && occ[rr * N + c] !== 1; c++) r++;
        if (c >= N) openEdge = true;
        left = Math.min(left, l);
        right = Math.min(right, r);
      }
      if (openEdge) continue;
      p.x += ((right - left) / 2) * pitch;
    }
  };

  // 排入一批作品；已經排好的不動
  const add = (items) => {
    const frozen = placed.length;
    if (frozen) {
      // 接著排：上一批最後幾件附近的留白，是當時可挑的作品太少，重新開放給新作品填
      const tailRow = placed.slice(-LOOKAHEAD).reduce((mn, p) => Math.min(mn, p.r0), Infinity);
      for (let i = tailRow * N; i < occ.length; i++) if (occ[i] === 2) occ[i] = 0;
      top = Math.min(top, tailRow);
    }
    const queue = items.map((el) => {
      const { aspect, mass } = metrics(el);
      return { el, href: el.getAttribute("href"), aspect, target: Math.min(unit * Math.sqrt(mass * aspect), D) };
    });
    const apart = (it) => (placed.length - (lastAt.get(it.href) ?? -Infinity) < APART ? 1 : 0);

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
            apart(it) +
            i * 0.04;
          if (!best || score < best.score) best = { i, k, w, h, ch, score, sliver };
        }
      }
      // 補空位：這個空位原本會留白（放不下任何一件，或只能放進去但留下放不下東西的窄縫），
      // 才允許把一件作品縮放到 SHRINK～GROW 倍、剛好撐滿整個空位；越接近原本大小越優先。
      // 快排完時（剩下的不到一輪前瞻）可挑的作品太少，最後一排本來就會比較空，不硬補
      if ((!best || best.sliver) && queue.length > LOOKAHEAD) {
        const spanW = spanOf(m);
        let fit = null;
        for (let i = 0; i < look; i++) {
          const it = queue[i];
          const ratio = spanW / it.target;
          if (ratio < shrinkMin || ratio > growMax || Math.abs(ratio - 1) <= FLEX) continue;
          const h = spanW / it.aspect;
          const ch = Math.ceil((h + gap) / STEP);
          if (!free(r0, c0, m, ch)) continue;
          const score = Math.abs(Math.log(ratio)) + apart(it) + i * 0.04;
          if (!fit || score < fit.score) fit = { i, k: m, w: spanW, h, ch, score };
        }
        if (fit) best = fit;
      }
      if (!best) {
        // 這個空位放不下接下來任何一件：這一列標成留白，往下一列找
        for (let c = c0; c < c0 + m; c++) occ[r0 * N + c] = 2;
        continue;
      }
      const { i, k, w, h, ch } = best;
      const [it] = queue.splice(i, 1);
      const p = { el: it.el, x: xOf(c0, k, w), y: r0 * STEP, w, h, r0, ch, c0, k, aspect: it.aspect, target: it.target };
      fill(p, 1);
      lastAt.set(it.href, placed.length);
      placed.push(p);
      placedEls.add(it.el);
    }
    const fresh = placed.slice(frozen);
    growIntoGaps(fresh);
    centerBetween(fresh);
    const height = placed.reduce((mx, p) => Math.max(mx, p.y + p.h), 0) || 1;
    return { placed, height };
  };
  return { D, add, has: (el) => placedEls.has(el) };
};

// 一次排完（測試、比較用）
const packColumns = (items, D) => createPacker(D).add(items);

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
  lastSignature = "";
  packer = null;
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
