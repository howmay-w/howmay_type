const show = (image, instant) => {
	if (instant) image.classList.add("is-instant");
	image.classList.add("loaded");
};

const arm = (image) => {
	if (image.classList.contains("loaded")) return;
	// 已經畫好的圖直接出現。還沒好的維持淡入（例如隨機、或網路太慢沒趕上）
	if (image.complete) {
		show(image, true);
		return;
	}
	if (image.dataset.revealBound === "1") return;
	image.dataset.revealBound = "1";
	image.addEventListener("load", () => show(image, false), { once: true });
	image.addEventListener("error", () => show(image, true), { once: true });
};

const init = () => {
	document.querySelectorAll("img.fade-in").forEach((image) => arm(image));
};

// after-swap 比換頁動畫拍新畫面更早：已解碼的圖在這一拍就顯示
document.addEventListener("astro:after-swap", init);
document.addEventListener("astro:page-load", init);
init();
