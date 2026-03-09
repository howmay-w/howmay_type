import imagesLoaded from "imagesloaded";

// Preloader element reference
let loading;

// Initialize the preloader element.
const initializeElements = () => {
  loading = document.querySelector(".loading");
};

// Load only above-the-fold, non-lazy images.
// Lazy images haven't started loading yet so their load events never fire,
// which would cause the preloader to always hit the timeout.
const loadImages = () => {
  return new Promise((resolve) => {
    const vh = window.innerHeight;
    const aboveFoldImgs = [...document.querySelectorAll("img")].filter((img) => {
      if (img.loading === "lazy") return false;
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
    setTimeout(resolve, 4000);
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
