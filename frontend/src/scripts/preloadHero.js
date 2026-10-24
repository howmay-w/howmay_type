// 作品第一張圖：滑過或按下就解碼，並留著這張已畫好的圖。
// 從作品牆點進去時，換頁動畫拍新畫面之前把這張圖放上，所以不會先空白再閃出來。
const ready = new Set();
const cache = new Map();
const MAX_CACHE = 6;
window.__heroReady = ready;

function remember(src, img) {
	cache.delete(src);
	cache.set(src, img);
	while (cache.size > MAX_CACHE) {
		const oldest = cache.keys().next().value;
		cache.delete(oldest);
		ready.delete(oldest);
	}
}

function warm(src, priority) {
	if (!src) return Promise.resolve();
	const cached = cache.get(src);
	if (cached?.complete && cached.naturalWidth && !cached.isConnected) {
		ready.add(src);
		remember(src, cached);
		return Promise.resolve();
	}
	if (cached?.__pending) return cached.__pending;
	const img = new Image();
	if (priority) img.fetchPriority = priority;
	img.decoding = "async";
	const pending = new Promise((resolve) => {
		const finish = (ok) => {
			img.__pending = undefined;
			if (ok && img.naturalWidth && !img.isConnected) {
				ready.add(src);
				remember(src, img);
			}
			resolve();
		};
		img.onload = () => {
			const decoded = img.decode ? img.decode() : Promise.resolve();
			decoded.then(() => finish(true), () => finish(true));
		};
		img.onerror = () => finish(false);
		img.src = src;
		if (img.complete && img.naturalWidth) img.onload();
	});
	img.__pending = pending;
	cache.set(src, img);
	return pending;
}

function heroSrcFromEvent(event) {
	const target = event.target;
	if (!(target instanceof Element)) return "";
	return target.closest("[data-hero]")?.getAttribute("data-hero") ?? "";
}

function onIntent(event) {
	const src = heroSrcFromEvent(event);
	if (src) warm(src, "high");
}

// 換頁抓 HTML 的同時等第一張解碼完，作品牆會多停一下，進頁時圖已經在
document.addEventListener("astro:before-preparation", (event) => {
	const el = event.sourceElement;
	const src = el instanceof Element ? (el.closest("[data-hero]")?.getAttribute("data-hero") ?? "") : "";
	if (!src || !event.to?.pathname?.startsWith("/projects")) return;
	const original = event.loader;
	event.loader = async () => {
		const stop = new Promise((resolve) => {
			event.signal.addEventListener("abort", () => resolve(), { once: true });
		});
		await Promise.all([original(), Promise.race([warm(src, "high"), stop])]);
	};
});

function placeDecodedHero() {
	const hero = document.querySelector("img.fade-in[fetchpriority='high']");
	if (!(hero instanceof HTMLImageElement)) return;
	const src = hero.getAttribute("src");
	const cached = src ? cache.get(src) : undefined;
	if (!cached?.complete || !cached.naturalWidth || cached.isConnected) return;
	for (const attr of hero.attributes) {
		if (attr.name === "onload" || attr.name === "onerror") continue;
		cached.setAttribute(attr.name, attr.value);
	}
	cached.classList.add("is-instant", "loaded");
	hero.replaceWith(cached);
	cache.delete(src);
}

function preloadNeighbors() {
	const urls = [...document.querySelectorAll(".project-nav [data-hero]")]
		.map((el) => el.getAttribute("data-hero"))
		.filter(Boolean);
	if (!urls.length) return;
	const run = () => urls.forEach((url) => warm(url, "low"));
	const hero = document.querySelector("img[fetchpriority='high']");
	if (!hero || hero.complete) run();
	else requestAnimationFrame(run);
}

document.addEventListener("pointerover", onIntent, { passive: true });
document.addEventListener("pointerdown", onIntent, { passive: true });
document.addEventListener("focusin", onIntent);
document.addEventListener("astro:after-swap", () => {
	placeDecodedHero();
	preloadNeighbors();
});
document.addEventListener("astro:page-load", preloadNeighbors);
preloadNeighbors();
