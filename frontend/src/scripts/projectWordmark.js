/*
 * 作品頁的字圖（[slug].astro 的 .wm-page）：
 *  - 從字牆點進來時網址帶 ?wm=n，顯示點的那一款；沒帶就顯示第一款
 *  - 寬螢幕從字牆點字進作品頁時，字圖從牆上的位置移到作品頁右側（view transition），
 *    速度曲線和字牆跨分段重排的滑動相同，其他部分照常淡入淡出；返回、手機、圖片模式都不做
 *  - 拉動視窗跨過版型分界（手機 → 中等 → 寬螢幕）時，字圖、圖片欄、內文從原位置滑到新位置，和首頁字牆跨分段重排一樣
 * 換頁時新頁面在 astro:before-swap 就要選好款、設好轉場名稱，瀏覽器才拍得到正確的「之後」畫面。
 */
const MORPH = "wm-morph";
const WIDE = "(min-width: 80em)";
// 和首頁字牆跨分段重排（ProjectGrid.astro 的 wall--glide）相同的時間與速度曲線
const GLIDE = { duration: 600, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
// 作品頁版型分界（見 [slug].astro）：44em、50em 改版型，80em 開右側第三欄
const LAYOUT_MQ = ["(min-width: 44em)", "(min-width: 50em)", "(min-width: 80em)"];

export const pickWordmark = (doc, url) => {
  const items = Array.from(doc.querySelectorAll(".wm-page"));
  if (!items.length) return null;
  const i = parseInt(new URL(url, location.href).searchParams.get("wm") ?? "0", 10);
  const el = items[i] ?? items[0];
  for (const x of items) x.classList.toggle("is-on", x === el);
  return el;
};

let morphFrom = null;

const onBeforePreparation = (e) => {
  morphFrom = null;
  // 離開作品頁時拿掉上一次轉場留下的名稱，返回字牆時字圖就跟著整頁淡出
  for (const el of document.querySelectorAll(".wm-page")) el.style.viewTransitionName = "";
  if (e.navigationType === "traverse" || document.documentElement.dataset.view !== "type") return;
  if (!window.matchMedia(WIDE).matches) return;
  const wm = e.sourceElement?.closest?.("a[data-wordmark]")?.querySelector(".project-card__wordmark");
  if (!wm) return;
  wm.style.viewTransitionName = MORPH;
  morphFrom = wm;
};

const onBeforeSwap = (e) => {
  const el = pickWordmark(e.newDocument, e.to);
  if (morphFrom && el) el.style.viewTransitionName = MORPH;
};

const onAfterSwap = () => {
  morphFrom = null;
};

// ── 拉動視窗時：版型改變就讓字圖、圖片欄、內文從上一個畫面的位置滑到新位置（FLIP） ──
// 同一個版型裡跟著版面自然移動；只有跨過分界、位置跳動時才補動畫。
// 圖片欄與字圖連大小一起過渡；內文只移動位置（縮放文字會變形，寬度直接換成新的）
const GLIDE_TARGETS = [
  { selector: ".media-column", scale: true },
  { selector: ".content-wrap > .content", scale: false },
  { selector: ".wm-page.is-on", scale: true },
];
let lastRects = new Map();
let lastLayout = "";
let lastWidth = 0;
const layoutKey = () => LAYOUT_MQ.map((q) => (window.matchMedia(q).matches ? 1 : 0)).join("");
const glideTargets = () =>
  GLIDE_TARGETS.map((t) => ({ ...t, el: document.querySelector(t.selector) })).filter((t) => t.el);
const remember = () => {
  lastRects = new Map(glideTargets().map((t) => [t.el, t.el.getBoundingClientRect()]));
  lastLayout = layoutKey();
  lastWidth = window.innerWidth;
};
// 頁面尺寸改變後、畫面更新前執行（ResizeObserver），量到的就是新版型的位置
const onResize = () => {
  const key = layoutKey();
  if (key !== lastLayout) {
    for (const { el, scale } of glideTargets()) {
      const from = lastRects.get(el);
      if (!from) continue;
      // 先停掉還在跑的滑動，量到的才是新版型的實際位置（起點是上一個畫面看到的位置）
      el.getAnimations().forEach((a) => a.cancel());
      const now = el.getBoundingClientRect();
      if (!now.width || !now.height) continue;
      const dx = from.left - now.left;
      const dy = from.top - now.top;
      const s = scale ? ` scale(${from.width / now.width}, ${from.height / now.height})` : "";
      el.animate(
        [{ transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px)${s}` }, { transformOrigin: "0 0", transform: "none" }],
        GLIDE,
      );
    }
  }
  remember();
};

// 這支模組可能被首頁和作品頁各載入一次，事件只註冊一次
if (!window.__projectWordmarkInit) {
  window.__projectWordmarkInit = true;
  document.addEventListener("astro:before-preparation", onBeforePreparation);
  document.addEventListener("astro:before-swap", onBeforeSwap);
  document.addEventListener("astro:after-swap", onAfterSwap);
  // 直接開啟作品頁（不是站內換頁）時也要依網址選款
  document.addEventListener("astro:page-load", () => {
    pickWordmark(document, location.href);
    remember();
  });
  new ResizeObserver(onResize).observe(document.documentElement);
  // 捲動時（寬螢幕字圖是 sticky）位置會變，跟著更新起點
  // （拉動視窗時也會觸發捲動，而且比版型判斷更早；寬度變了就先不更新，起點才是上一個畫面的位置）
  window.addEventListener("scroll", () => { if (window.innerWidth === lastWidth) remember(); }, { passive: true });
}
