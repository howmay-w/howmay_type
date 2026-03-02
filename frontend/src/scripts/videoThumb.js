/**
 * 對 [data-thumb-video] 的 <video>，
 * 透過 IntersectionObserver 延遲載入；
 * 進入視窗後 seek 到最後一影格，用 canvas 擷取成 <img> 取代，確保縮圖穩定顯示。
 */

/** @param {HTMLVideoElement} video */
const captureAndReplace = (video) => {
  try {
    const w = video.videoWidth || 600;
    const h = video.videoHeight || 600;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

    const img = document.createElement("img");
    img.src = dataUrl;
    img.className = video.className;
    img.alt = "";
    video.parentNode?.replaceChild(img, video);
  } catch {
    // canvas 擷取失敗（如 CORS），保留 video 元素不動
  }
};

/** @param {HTMLVideoElement} video */
const processVideo = (video) => {
  if (video.dataset.thumbProcessed) return;
  video.dataset.thumbProcessed = "1";

  const seekAndCapture = () => {
    const t =
      isFinite(video.duration) && video.duration > 0
        ? video.duration - 0.001
        : 0;
    video.addEventListener("seeked", () => captureAndReplace(video), {
      once: true,
    });
    video.currentTime = t;
  };

  // 升級 preload 以實際載入影格資料
  video.preload = "auto";

  if (video.readyState >= 1) {
    seekAndCapture();
  } else {
    video.addEventListener("loadedmetadata", seekAndCapture, { once: true });
  }
};

/** @type {IntersectionObserver | null} */
let observer = null;

const getObserver = () => {
  if (observer) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          observer?.unobserve(entry.target);
          processVideo(/** @type {HTMLVideoElement} */ (entry.target));
        }
      }
    },
    { rootMargin: "300px" },
  );
  return observer;
};

const initVideoThumbs = () => {
  const obs = getObserver();
  const videos = /** @type {NodeListOf<HTMLVideoElement>} */ (
    document.querySelectorAll("video[data-thumb-video]")
  );
  for (const video of videos) {
    if (!video.dataset.thumbProcessed) {
      obs.observe(video);
    }
  }
};

document.addEventListener("astro:page-load", initVideoThumbs);
// 排序／隨機後 DOM 節點被重新掛回，需重新觀察尚未處理的 video
document.addEventListener("grid:reordered", initVideoThumbs);
