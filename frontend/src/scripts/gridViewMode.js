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
 * 其他款要散在整面牆、不和本尊擠在一起：每一款在「全部卡片的順序」裡分到一個隨機位置
 * （把整個清單切成和款數一樣多段，每段裡隨機挑一個，且離本尊至少 EXTRA_APART 件），
 * 等那個位置的卡片顯示出來（例如按 MORE 載入到那裡）就出現在它旁邊；本尊還沒載入也沒關係，點進去都是同一篇。
 * 搜尋時：本尊被篩掉，其他款也不出現；本尊符合但那個位置的卡片被篩掉，就改排在本尊後面幾件。
 */
const EXTRA_APART = 6;
// 由字串算出 0–1 的固定亂數：同一款每次都落在同一個位置（卡片順序本身已經是隨機或依日期）
const hash01 = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
};
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
    // 本尊被搜尋篩掉（隱藏但不是「還沒載入」）時，其他款也不出現
    const parentFiltered = !parent || (!at.has(parent) && !parent.hasAttribute("data-deferred"));
    if (!parentFiltered) {
      const n = count.get(href);
      const j = (parseInt(el.dataset.wmIndex) || 1) - 1;
      const home = poolAt.get(href);
      // 第 j 段裡的隨機位置；太靠近本尊就往後挪
      let v = Math.floor(((j + hash01(`${href}#${j}`)) / n) * pool.length);
      if (Math.abs(v - home) < EXTRA_APART) v = (home + EXTRA_APART + j) % pool.length;
      const target = pool[v];
      if (target && at.has(target)) key = at.get(target) + 0.5;
      else if (target && !target.hasAttribute("data-deferred") && at.has(parent)) {
        // 被搜尋篩掉：排在本尊後面，各款之間隔開
        key = at.get(parent) + (j + 1) * Math.max(3, Math.floor((cards.length - at.get(parent)) / (n + 1))) + 0.5;
      }
      // 其餘（那個位置的卡片還沒載入）：先不顯示，載入到那裡時才出現
    }
    el.toggleAttribute("data-wm-on", key !== null);
    if (key !== null) keyed.push({ el, key });
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
  // 0 = 空、1 = 已放作品、2 = 放不下任何作品而留白、3 = 整排置中後讓出的空位（之後的作品不能放）
  let occ = new Uint8Array(N * rows);
  const grow = () => {
    const o = new Uint8Array(N * rows * 2);
    o.set(occ);
    occ = o;
    rows *= 2;
  };
  const free = (r, c, k, ch) => {
    while (r + ch > rows) grow();
    for (let rr = r; rr < r + ch; rr++) for (let cc = c; cc < c + k; cc++) if (occ[rr * N + cc] & 1) return false;
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
        while (p.r0 - n - 1 >= 0 && !(occ[(p.r0 - n - 1) * N + cc] & 1)) n++;
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
        for (; c >= 0 && !(occ[rr * N + c] & 1); c--) l++;
        if (c < 0) openEdge = true;
        let r = 0;
        c = p.c0 + p.k;
        for (; c < N && !(occ[rr * N + c] & 1); c++) r++;
        if (c >= N) openEdge = true;
        left = Math.min(left, l);
        right = Math.min(right, r);
      }
      if (openEdge) continue;
      p.x += ((right - left) / 2) * pitch;
    }
  };

  // 手機版：一排填不滿時置中。手機常是兩欄交錯排列，沒有整齊的「一排」可以整組平移，
  // 所以讓每件作品依左右實際的空間各自往中間調整，重複幾輪到穩定：
  // 左右的障礙是同一高度的其他作品（保持標準間距）或邊界；靠邊界那側分到兩倍的空白，
  // 結果是左右留白相等、作品之間的間距只略為加大。已排好（凍結）的作品不動，只當障礙。
  const centerRows = (movable) => {
    const rowsOverlap = (a, b) => a.r0 < b.r0 + b.ch && b.r0 < a.r0 + a.ch;
    const neighbors = new Map(movable.map((p) => [p, placed.filter((q) => q !== p && rowsOverlap(p, q))]));
    for (let iter = 0; iter < 24; iter++) {
      let moved = 0;
      for (const p of movable) {
        let lb = 0;
        let rb = D;
        let lw = 2;
        let rw = 2;
        for (const q of neighbors.get(p)) {
          if (q.x + q.w <= p.x + 0.5 && q.x + q.w + gap > lb) {
            lb = q.x + q.w + gap;
            lw = 1;
          } else if (q.x >= p.x + p.w - 0.5 && q.x - gap < rb) {
            rb = q.x - gap;
            rw = 1;
          }
        }
        const slack = rb - lb - p.w;
        if (slack <= 0) continue;
        const x = lb + (slack * lw) / (lw + rw);
        moved = Math.max(moved, Math.abs(x - p.x));
        p.x = x;
      }
      if (moved < 0.5) break;
    }
    // 作品畫面上移離了原本的欄位：把現在佔到的欄（含標準間距）保留起來，之後（例如 MORE）的作品不能放進去
    for (const p of movable) {
      const c0 = Math.max(0, Math.floor(p.x / pitch));
      const c1 = Math.min(N - 1, Math.ceil((p.x + p.w + gap) / pitch) - 1);
      for (let rr = p.r0; rr < p.r0 + p.ch; rr++) for (let cc = c0; cc <= c1; cc++) if (!(occ[rr * N + cc] & 1)) occ[rr * N + cc] = 3;
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
    if (D < 480) centerRows(fresh);
    else centerBetween(fresh);
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
  while (loadedNow() < saved.loaded) {
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
  if (more && !deferred().length) more.classList.add("hidden");
  const cards = Array.from(grid.children);
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
