// 作品第一張圖的預載。
// 字牆：滑過或按下卡片就抓。作品頁：主圖開始載之後，用較低優先順序抓上一篇、下一篇的第一張。
const preloaded = new Set();

function preloadImage(src, priority) {
	if (!src || preloaded.has(src)) return;
	preloaded.add(src);
	const link = document.createElement("link");
	link.rel = "preload";
	link.as = "image";
	link.href = src;
	if (priority) link.setAttribute("fetchpriority", priority);
	document.head.appendChild(link);
}

function heroSrcFromEvent(event) {
	const target = event.target;
	if (!(target instanceof Element)) return "";
	return target.closest("[data-hero]")?.getAttribute("data-hero") ?? "";
}

function onIntent(event) {
	const src = heroSrcFromEvent(event);
	if (src) preloadImage(src, "high");
}

function preloadNeighbors() {
	const urls = [...document.querySelectorAll(".project-nav [data-hero]")]
		.map((el) => el.getAttribute("data-hero"))
		.filter(Boolean);
	if (!urls.length) return;
	const run = () => urls.forEach((src) => preloadImage(src, "low"));
	const hero = document.querySelector("img[fetchpriority='high']");
	// 這一幀主圖的請求已經由 eager 發出，下一幀再抓前後篇，避免跟主圖搶
	if (!hero || hero.complete) run();
	else requestAnimationFrame(run);
}

document.addEventListener("pointerover", onIntent, { passive: true });
document.addEventListener("pointerdown", onIntent, { passive: true });
document.addEventListener("focusin", onIntent);
document.addEventListener("astro:after-swap", preloadNeighbors);
document.addEventListener("astro:page-load", preloadNeighbors);
preloadNeighbors();
