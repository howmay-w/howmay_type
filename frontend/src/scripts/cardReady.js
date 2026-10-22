import gsap from "gsap";

/*
 * 卡片的圖載好再浮上來。
 * 字牆的字是 CSS mask（--wm），圖沒載完前整個字是透明的；先播動畫的話，動畫跑完字才突然閃出來。
 * 圖片模式看的是縮圖 <img>。
 */
const decoded = new Map();
const wordmarkUrl = (el) => el.style.getPropertyValue("--wm").match(/url\(\s*["']?([^"')]+)/)?.[1];
const loadUrl = (url) => {
  if (!decoded.has(url)) {
    const img = new Image();
    // CSS mask 的圖是用 CORS 模式下載的；這裡也要用 CORS，瀏覽器才會共用同一份，不會下載兩次
    img.crossOrigin = "anonymous";
    img.src = url;
    decoded.set(url, img.decode().catch(() => {}));
  }
  return decoded.get(url);
};

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);

export const cardReady = (el) => {
  if (document.documentElement.dataset.view === "type") {
    const url = wordmarkUrl(el);
    return url ? loadUrl(url) : Promise.resolve();
  }
  const img = el.querySelector(".project-card__img-wrap img");
  if (!img) return Promise.resolve();
  // 縮圖預設 lazy（字牆模式不會用到）；要顯示時才載入
  if (img.loading === "lazy") img.loading = "eager";
  if (img.complete && img.naturalWidth) return Promise.resolve();
  return img.decode().catch(() => {});
};

/*
 * 讓卡片浮上來：每張等自己的圖載好（最多 timeout 毫秒）才開始，和上一張開始的時間至少隔 gap 秒（等同 stagger）。
 * 圖都已在快取時照卡片順序依序浮上；否則誰的圖先好誰先上，一張慢的不會擋住後面已經載好的。
 * 呼叫時先把卡片設成隱藏；同一張卡片又被呼叫時，舊的等待作廢。回傳全部開始播放後 resolve 的 promise。
 */
const generation = new WeakMap();
export const revealCards = (items, { gap = 0.04, timeout = 8000, from = { yPercent: 100 }, animate } = {}) => {
  if (!items.length) return Promise.resolve();
  gsap.killTweensOf(items);
  gsap.set(items, { ...from, autoAlpha: 0 });
  let last = 0;
  return Promise.all(
    items.map((el) => {
      const gen = (generation.get(el) ?? 0) + 1;
      generation.set(el, gen);
      return withTimeout(cardReady(el), timeout).then(
        () =>
          new Promise((resolve) => {
            const wait = Math.max(0, last + gap * 1000 - performance.now());
            last = performance.now() + wait;
            setTimeout(() => {
              if (generation.get(el) === gen) animate(el);
              resolve();
            }, wait);
          }),
      );
    }),
  );
};

// 首頁入場、MORE、排序共用的浮上動畫（位移和淡入用不同的速度曲線）
export const floatUp = (el) => {
  gsap.to(el, { yPercent: 0, duration: 0.8, ease: "power4" });
  gsap.to(el, { autoAlpha: 1, duration: 0.8, ease: "sine" });
};
