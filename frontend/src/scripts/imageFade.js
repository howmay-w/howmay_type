const show = (image) => {
	image.classList.add("loaded");
};

const arm = (image) => {
	if (image.classList.contains("loaded")) return;
	if (image.complete) {
		show(image);
		return;
	}
	if (image.dataset.revealBound === "1") return;
	image.dataset.revealBound = "1";
	image.addEventListener("load", () => show(image), { once: true });
	image.addEventListener("error", () => show(image), { once: true });
};

const init = () => {
	document.querySelectorAll("img.fade-in").forEach((image) => arm(image));
};

// after-swap 比 page-load 早：快取裡的圖在畫出來之前就直接顯示，不必再淡入
document.addEventListener("astro:after-swap", init);
document.addEventListener("astro:page-load", init);
init();
