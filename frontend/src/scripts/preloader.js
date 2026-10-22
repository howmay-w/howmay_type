import imagesLoaded from "imagesloaded";

// Preloader element reference
let loading;

// Initialize the preloader element.
const initializeElements = () => {
  loading = document.querySelector(".loading");
};

// Load only above-the-fold images that are actually rendered.
// 字牆模式下卡片縮圖是 display: none（量到的位置是 0，會被誤算成在畫面內），不必等；
// 字牆的字圖由首頁入場動畫（index.js）逐張等候
const loadImages = () => {
  return new Promise((resolve) => {
    const vh = window.innerHeight;
    const aboveFoldImgs = [...document.querySelectorAll("img")].filter((img) => {
      if (!img.getClientRects().length) return false;
      const rect = img.getBoundingClientRect();
      return rect.top < vh;
    });

    if (aboveFoldImgs.length === 0) {
      resolve();
      return;
    }

    const imgLoad = imagesLoaded(aboveFoldImgs);
    imgLoad.on("done", resolve);
    imgLoad.on("fail", resolve);
    setTimeout(resolve, 2000);
  });
};

// Load assets and dispatch a custom event when done.
const loadAssets = async () => {
  try {
    await loadImages();
    const event = new CustomEvent("assetsLoaded");
    document.dispatchEvent(event);
  } catch (error) {
    console.error("Failed to load assets:", error);
    throw error;
  }
};

// Show the preloader, load assets if needed, and then hide the preloader.
const toggleLoading = async () => {
  if (sessionStorage.getItem("preloadComplete") === "true") {
    hide();
    return;
  }
  show();
  try {
    await loadAssets();
    sessionStorage.setItem("preloadComplete", "true");
  } catch (error) {
    console.error("Failed to load assets:", error);
  } finally {
    hide(); // 無論成功或失敗都隱藏 preloader，避免卡在白畫面
    document.dispatchEvent(new CustomEvent("assetsLoaded"));
  }
};

// Display the preloader.
const show = () => {
  loading.classList.remove("hidden");
};

// Hide the preloader.
const hide = () => {
  loading.classList.add("hidden");
};

// Cleanup to reset references.
const cleanup = () => {
  loading = null;
};

// Initialize the preloader logic.
const init = () => {
  initializeElements();
  toggleLoading();
};

// Execute a callback only if the current page is the home page.
const handlePageEvent = (_, callback) => {
  const page = document.documentElement.getAttribute("data-page");
  if (page === "home") callback();
};

// Listen for Astro's lifecycle events.
document.addEventListener("astro:page-load", () => {
  handlePageEvent("page-load", init);
});

document.addEventListener("astro:before-swap", () => {
  handlePageEvent("before-swap", cleanup);
});

// Clear the preload flag before page unload to ensure the loader appears on refresh.
window.addEventListener("beforeunload", () => {
  sessionStorage.removeItem("preloadComplete");
});
