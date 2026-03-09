import gsap from "gsap";

// DOM elements and animation-related variables
let lines;
let textSliders;
let gridContainer;
let gridItems;
let hasPreloaderComponent;
let animationTimeline; // GSAP timeline instance

// Initialize DOM elements used in the animations.
const initializeVariables = () => {
	lines = document.querySelectorAll("hr");
	textSliders = document.querySelectorAll("header .oh > .oh__inner");
	gridContainer = document.querySelector("[data-grid]");
	// 只取尚未延遲載入（非 data-deferred）的可見卡片，避免對全部 N 個元素建 tween
	gridItems = gridContainer
		? Array.from(gridContainer.children).filter(
				(el) => !el.hasAttribute("data-deferred"),
			)
		: [];
	hasPreloaderComponent = document.querySelector(".loading");
};

// 確保 grid 一定會顯示（動畫出錯時仍可看到內容）
const ensureGridVisible = () => {
	if (gridContainer) gsap.set(gridContainer, { autoAlpha: 1 });
};

// Animate the homepage elements using a GSAP timeline.
const animateHomepageElements = () => {
	if (!gridContainer) return;

	// 沒有卡片時不播入場動畫，直接顯示
	if (!gridItems.length) {
		ensureGridVisible();
		return;
	}

	// Hide the grid container before starting the animation.
	animationTimeline = gsap.set(gridContainer, { autoAlpha: 0 });

	try {
		gsap
			.timeline({
				defaults: {
					duration: 1.4,
					ease: "power4",
				},
				onComplete: () => {
					const event = new CustomEvent("gridRendered");
					document.dispatchEvent(event);
				},
				onInterrupt: ensureGridVisible,
				onKill: ensureGridVisible,
			})
			.fromTo(
				lines,
				{ transformOrigin: "0% 50%", scaleX: 0 },
				{ duration: 1.6, ease: "power2", stagger: 0.9, scaleX: 1 },
			)
			.from(textSliders, { yPercent: 100, stagger: 0.1 }, 0.2)
			.set(gridContainer, { autoAlpha: 1 }, "<+=1")
			.from(gridItems, { yPercent: 100, stagger: 0.04, duration: 0.8 }, "<")
			.from(gridItems, { ease: "sine", autoAlpha: 0, stagger: 0.04, duration: 0.8 }, "<");
	} catch (err) {
		console.error("Homepage animation error:", err);
		ensureGridVisible();
	}
};

// Clean up animations and DOM references to prevent memory leaks.
const cleanup = () => {
	if (animationTimeline) {
		animationTimeline.kill(); // Stop the timeline
		animationTimeline = null;
	}
	lines = null;
	textSliders = null;
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

// Astro lifecycle hook: initialize animations on page load.
document.addEventListener("astro:page-load", () => {
	handlePageEvent("page-load", init);
});

// Astro lifecycle hook: clean up before swapping pages.
document.addEventListener("astro:before-swap", () => {
	handlePageEvent("before-swap", cleanup);
});
