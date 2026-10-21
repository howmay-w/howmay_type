/*
 * 字牆排版規則（首頁字牆 gridViewMode.js 與本機字圖管理頁的「字牆」檢視共用）。
 * 純計算、不碰 DOM：作品只需要有 dataset.wmAspect / wmMass / wmScale 與 getAttribute("href")。
 */
export const STEP = 6; // 排版格子的解析度（px）

export const EXTRA_APART = 6;
// 由字串算出 0–1 的固定亂數：同一款每次都落在同一個位置（卡片順序本身已經是隨機或依日期）
export const hash01 = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
};
// 同一篇作品的其他款散在整面牆：第 j 款（共 n 款）在 poolLength 件卡片裡分到的位置，
// 把清單切成 n 段、每段裡依作品與款號隨機挑一個，且離本尊（home）至少 EXTRA_APART 件
export const scatterIndex = (href, j, n, home, poolLength) => {
  let v = Math.floor(((j + hash01(`${href}#${j}`)) / n) * poolLength);
  if (Math.abs(v - home) < EXTRA_APART) v = (home + EXTRA_APART + j) % poolLength;
  return v;
};

// 版面寬度分段：同一段內只做等比例縮放（純 CSS 百分比），跨段才重新排版，縮放視窗時不會一直跳動
export const BANDS = [320, 400, 480, 580, 700, 840, 1000, 1180, 1400, 1660, 1960];
export const bandOf = (W) => BANDS.reduce((d, b) => (W >= b ? b : d), BANDS[0]);

// 每件作品的長寬比與量感（以「一個字的面積」為單位）
export const metrics = (el) => {
  const aspect = parseFloat(el.dataset.wmAspect) || 1;
  // 面積和字數不完全成正比（0.8 次方），且至少 1.6 個字的面積：單字作品整體才不會顯得太小
  // 手動倍率最後才乘：寬度 × scale，所以面積 × scale²
  const scale = parseFloat(el.dataset.wmScale) || 1;
  const mass = Math.max(1.6, (parseFloat(el.dataset.wmMass) || 1) ** 0.8) * scale ** 2;
  return { aspect, mass };
};
export const unitOf = (D) => (D < 480 ? 62 : Math.min(130, Math.max(68, D * 0.074)));

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
 * 畫面不會因為重排整面牆而跳動（見 gridViewMode.js 的 layout）。
 */
export const LOOKAHEAD = 8;
export const FLEX = 0.1;
export const GROW = 1.35;
export const SHRINK = 0.8;
// 手機版作品小、補空位時縮放的差異比較明顯，範圍收窄
export const GROW_MOBILE = 1.2;
export const SHRINK_MOBILE = 0.85;
// 同一件作品的其他款：剛放過同一件的，接下來 APART 件內盡量不再放，避免兩款挨在一起
export const APART = 8;

// 字的整體大小與間距：字先縮到 WORD_SCALE 再排版，間距是基準單位的 GAP_RATIO 倍
// （原本字 ×1、間距 0.45；比較後間距加大為 ×1.5；字曾試過 ×0.9，手動倍率重設後回到 ×1）
export const WORD_SCALE = 1;
export const GAP_RATIO = 0.45 * 1.5;
// 測試用網址參數（比較頁用）：wmpre = 排版前再把字縮放、wmgap = 間距再乘的倍數，都疊加在上面的設定上
export const testParam = (key) => parseFloat(new URLSearchParams(window.location.search).get(key)) || 1;

export const createPacker = (D) => {
  const unit = unitOf(D);
  const gap = unit * GAP_RATIO * testParam("wmgap"); // 字與字的間距（歷次：0.34 → 0.374 → 0.45 → 0.675）
  const pre = testParam("wmpre");
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

  // 作品畫面上移離了原本的欄位（置中）：把現在佔到的欄（含標準間距）保留起來，之後（例如 MORE）的作品不能放進去
  const reserve = (p) => {
    const c0 = Math.max(0, Math.floor(p.x / pitch));
    const c1 = Math.min(N - 1, Math.ceil((p.x + p.w + gap) / pitch) - 1);
    for (let rr = p.r0; rr < p.r0 + p.ch; rr++) for (let cc = c0; cc <= c1; cc++) if (!(occ[rr * N + cc] & 1)) occ[rr * N + cc] = 3;
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
      reserve(p);
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
    for (const p of movable) reserve(p);
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
      // 其他款的連結帶 ?wm=n，同一件作品用 data-wm-extra（本尊的網址）辨認
      return { el, href: el.dataset?.wmExtra ?? el.getAttribute("href"), aspect, target: Math.min(unit * Math.sqrt(mass * aspect) * WORD_SCALE * pre, D) };
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
export const packColumns = (items, D) => createPacker(D).add(items);
