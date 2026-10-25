import gsap from "gsap";
import { floatUp, revealCards } from "./cardReady.js";

// DOM elements and animation-related variables
let lines;
let textSliders;
let searchFrame;
let gridContainer;
let gridItems;
let hasPreloaderComponent;
let animationTimeline; // GSAP timeline instance

// Initialize DOM elements used in the animations.
const initializeVariables = () => {
	lines = document.querySelectorAll("hr");
	textSliders = document.querySelectorAll("header .oh > .oh__inner");
	searchFrame = document.querySelector(".title-header .search-frame");
	gridContainer = document.querySelector("[data-grid]");
	// 只取畫面上顯示的卡片（不含還沒載入、被搜尋或標籤篩掉的），避免對全部 N 個元素建 tween
	gridItems = gridContainer
		? Array.from(gridContainer.children).filter(
				(el) =>
					!el.hasAttribute("data-deferred") &&
					// 其他款字圖：已經跟著所屬作品排上字牆的才算（gridViewMode.js 加上 data-wm-on）
					(!el.hasAttribute("data-wm-extra") || el.hasAttribute("data-wm-on")) &&
					el.style.display !== "none",
			)
		: [];
	hasPreloaderComponent = document.querySelector(".loading");
};

// 入場動畫結束：拿掉工具列的 is-intro，「最新／隨機」的底線才從左畫出（不會比文字早出現）
const endIntro = () => {
	document.querySelector(".title-header--initial")?.classList.remove("is-intro");
};

// 搜尋圓角框和文字同一套浮上；先藏在裁切框下方，避免套用搜尋狀態時先卡在畫面上。
// 多加 4px：yPercent:100 剛好貼齊裁切底，1px 邊線會因四捨五入露出一點頂端
const SEARCH_FRAME_HIDDEN = { yPercent: 100, y: 4 };
const SEARCH_FRAME_SHOWN = { yPercent: 0, y: 0 };
const hideSearchFrame = () => {
	if (searchFrame) gsap.set(searchFrame, { ...SEARCH_FRAME_HIDDEN });
};
const showSearchFrame = () => {
	if (searchFrame) gsap.set(searchFrame, { ...SEARCH_FRAME_SHOWN });
};

// 確保 grid 一定會顯示（動畫出錯時仍可看到內容）
const ensureGridVisible = () => {
	if (gridContainer) gsap.set(gridContainer, { autoAlpha: 1 });
	endIntro();
	showSearchFrame();
};

// 入場動畫的代號：換頁後還在等圖的卡片不再播放
let introRun = 0;

// Animate the homepage elements using a GSAP timeline.
const animateHomepageElements = () => {
	if (!gridContainer) return;

	// 沒有卡片時不播入場動畫，直接顯示
	if (!gridItems.length) {
		ensureGridVisible();
		return;
	}

	// Hide the grid container before starting the animation.
	gsap.set(gridContainer, { autoAlpha: 0 });
	const run = ++introRun;
	const grid = gridContainer;
	const items = gridItems;

	try {
		hideSearchFrame();
		const searchInner = document.querySelector(".title-header [data-search] .oh__inner");
		const searchIdx = [...textSliders].indexOf(searchInner);
		const frameStart = 0.2 + Math.max(searchIdx, 0) * 0.1;
		animationTimeline = gsap
			.timeline({
				defaults: {
					duration: 1.4,
					ease: "power4",
				},
				onInterrupt: ensureGridVisible,
			})
			.fromTo(
				lines,
				{ transformOrigin: "0% 50%", scaleX: 0 },
				{ duration: 1.6, ease: "power2", stagger: 0.9, scaleX: 1 },
			)
			.from(textSliders, { yPercent: 100, stagger: 0.1 }, 0.2)
			// 圓角框和「搜尋」文字同一拍浮上，不要比文字先停在畫面上
			.fromTo(searchFrame || [], { ...SEARCH_FRAME_HIDDEN }, { ...SEARCH_FRAME_SHOWN }, frameStart)
			// 工具列文字浮上來後（約 1.6 秒，頁頭的字先依序浮上）才畫底線；用絕對時間，不影響上面各段的相對位置
			.call(endIntro, undefined, 1.6);
		// 頁頭的字浮上來約 1 秒後，牆面開始出現。每張卡片等自己的字圖（或縮圖）載好才浮上來，
		// 沒載好就先播動畫的話，字會在動畫結束後才突然閃出來；圖從現在就開始載
		gsap.set(items, { yPercent: 100, autoAlpha: 0 });
		gsap.delayedCall(1.2, () => {
			if (run !== introRun) return;
			gsap.set(grid, { autoAlpha: 1 });
			revealCards(items, { animate: floatUp }).then(() => {
				if (run === introRun) document.dispatchEvent(new CustomEvent("gridRendered"));
			});
		});
	} catch (err) {
		console.error("Homepage animation error:", err);
		ensureGridVisible();
		gsap.set(gridItems, { yPercent: 0, autoAlpha: 1 });
	}
};

// Clean up animations and DOM references to prevent memory leaks.
const cleanup = () => {
	introRun++;
	if (animationTimeline) {
		animationTimeline.kill(); // Stop the timeline
		animationTimeline = null;
	}
	lines = null;
	textSliders = null;
	searchFrame = null;
	gridContainer = null;
	gridItems = null;
	hasPreloaderComponent = null;
};

// Initialize the page: set variables, manage scroll behavior, and trigger animations.
const init = () => {
	initializeVariables();

	// Disable scroll restoration on browser back navigation.
	if ("scrollRestoration" in history) {
		history.scrollRestoration = "manual";
	}
	// 從作品頁返回：不播入場動畫、不捲回頂端，直接顯示排好的字牆（捲動位置由 gridViewMode.js 還原）
	if (window.__gridReturning) {
		ensureGridVisible();
		return;
	}
	// Scroll to the top of the page.
	window.scrollTo(0, 0);

	// Wait for assets to load if a preloader is present.
	if (
		hasPreloaderComponent &&
		sessionStorage.getItem("preloadComplete") !== "true"
	) {
		document.addEventListener("assetsLoaded", animateHomepageElements, {
			once: true,
		});
	} else {
		animateHomepageElements();
	}
};

// Run a callback only if the current page is the home page.
const handlePageEvent = (_, callback) => {
	const page = document.documentElement.getAttribute("data-page");
	if (page === "home") callback();
};

// 換頁當下就決定字牆要不要先藏起來。page-load 大約晚一幀，
// 那一幀裡整面作品會以完整透明度一起閃出來
document.addEventListener("astro:after-swap", () => {
	if (document.documentElement.getAttribute("data-page") !== "home") return;
	const grid = document.querySelector("[data-grid]");
	if (!grid) return;
	// 從作品頁按返回：直接顯示，不播入場動畫
	if (window.__gridReturning) gsap.set(grid, { autoAlpha: 1 });
	else {
		gsap.set(grid, { autoAlpha: 0 });
		// 換頁後立刻把圓角框藏到裁切下方；page-load 才會套用搜尋狀態，晚一拍會先看到框
		const frame = document.querySelector(".title-header .search-frame");
		if (frame) gsap.set(frame, { ...SEARCH_FRAME_HIDDEN });
	}
});

// Astro lifecycle hook: initialize animations on page load.
document.addEventListener("astro:page-load", () => {
	handlePageEvent("page-load", init);
});

// Astro lifecycle hook: clean up before swapping pages.
document.addEventListener("astro:before-swap", () => {
	handlePageEvent("before-swap", cleanup);
});
