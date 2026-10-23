import { gsap } from "gsap";
import Lenis from "lenis";

// Initializes smooth scrolling with Lenis.
// Function to set up smooth scrolling.
export const initSmoothScrolling = () => {
	// 換頁不會重載這支模組。再建立一次的話，舊的平滑捲動還在跑，會把新頁面拉回舊位置。
	if (window.__lenis) return;
	// Initialize Lenis for smooth scroll effects. Lerp value controls the smoothness.
	const lenis = new Lenis({ lerp: 0.15 });
	window.__lenis = lenis;

	// Ensure GSAP animations are in sync with Lenis' scroll frame updates.
	gsap.ticker.add((time) => {
		lenis.raf(time * 1000); // Convert GSAP's time to milliseconds for Lenis.
	});

	// Turn off GSAP's default lag smoothing to avoid conflicts with Lenis.
	gsap.ticker.lagSmoothing(0);

	// 作品牆還在滑的時候點進作品，這段動畫會在換頁後繼續，把較矮的作品頁拉到中段。
	// 換頁完成、新畫面拍下來之前就停掉。回首頁作品牆要留著原本的位置，只停動畫。
	document.addEventListener("astro:after-swap", () => {
		const keepWall =
			document.documentElement.dataset.page === "home" && window.__gridReturning;
		if (keepWall) {
			lenis.reset();
			return;
		}
		lenis.scrollTo(0, { immediate: true, force: true });
	});
	document.addEventListener("astro:page-load", () => {
		const root = document.documentElement;
		if (root.dataset.page === "home" && window.__gridReturning) {
			// 作品牆的位置在這之後才還原，對齊那次捲動，避免平滑捲動再把它蓋掉
			setTimeout(() => lenis.scrollTo(window.scrollY, { immediate: true, force: true }), 0);
			return;
		}
		const pinTop = () => {
			if (root.dataset.page === "home" || window.scrollY === 0) return;
			lenis.scrollTo(0, { immediate: true, force: true });
		};
		pinTop();
		// 換頁動畫結束時瀏覽器有時會把舊的捲動位置補回來，動畫一結束再對一次
		if (!root.hasAttribute("data-astro-transition")) return;
		const observer = new MutationObserver(() => {
			if (root.hasAttribute("data-astro-transition")) return;
			observer.disconnect();
			pinTop();
		});
		observer.observe(root, { attributes: true, attributeFilter: ["data-astro-transition"] });
	});
};
