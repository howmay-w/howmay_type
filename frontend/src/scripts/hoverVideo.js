/**
 * Hover Video Preview
 * Desktop  – mouseenter / mouseleave
 * Mobile   – 右下角播放按鈕 tap 切換影片（避免與 iOS Haptic Touch 衝突）
 */

const FADE_MS = 200;
const DEBOUNCE_MS = 100;
/** 區間倍速；Safari 對 >2x 支援不佳會卡頓，上限 2x */
const SAFARI_MAX_RATE = 2;
const isSafari =
  /Safari/.test(navigator.userAgent) &&
  !/Chrome|CriOS|Chromium|FxiOS/.test(navigator.userAgent);

function getPlaybackRate(duration) {
  if (duration < 7) return 1;
  if (duration < 10) return 1.5;
  if (duration < 15) return 2;
  if (duration < 20) return 2.5;
  return 3;
}

class HoverVideo {
  constructor(gridEl) {
    this.grid = gridEl;

    this.cards = Array.from(
      gridEl.querySelectorAll("a[data-hover-video]"),
    ).filter((el) => el.getAttribute("data-hover-video"));

    if (this.cards.length === 0) return;

    this._enterTimers = new Map();
    this._leaveTimers = new Map();
    this._videos = new Map();

    this.handleEnter = this._handleEnter.bind(this);
    this.handleLeave = this._handleLeave.bind(this);

    for (const card of this.cards) {
      card.addEventListener("mouseenter", this.handleEnter);
      card.addEventListener("mouseleave", this.handleLeave);
    }
  }

  // ── Mouse ────────────────────────────────────────────────────────────────

  _handleEnter(e) {
    const card = e.currentTarget;
    const src = card.getAttribute("data-hover-video");
    if (!src) return;

    if (this._leaveTimers.has(card)) {
      clearTimeout(this._leaveTimers.get(card));
      this._leaveTimers.delete(card);
    }

    if (this._videos.has(card)) {
      this._resumeVideo(card);
      return;
    }

    const timer = setTimeout(() => {
      this._enterTimers.delete(card);
      this._createVideo(card, src);
    }, DEBOUNCE_MS);
    this._enterTimers.set(card, timer);
  }

  _handleLeave(e) {
    const card = e.currentTarget;

    if (this._enterTimers.has(card)) {
      clearTimeout(this._enterTimers.get(card));
      this._enterTimers.delete(card);
    }

    this._fadeOutVideo(card);
  }

  // ── Shared helpers ───────────────────────────────────────────────────────

  _applyPlaybackRate(video) {
    const dur = video.duration;
    if (!dur || !isFinite(dur)) return;
    let rate = getPlaybackRate(dur);
    if (isSafari && rate > SAFARI_MAX_RATE) rate = SAFARI_MAX_RATE;
    video.playbackRate = rate;
  }

  _applyStartTime(video) {
    video.currentTime = 0.4 * video.playbackRate;
  }

  _resumeVideo(card) {
    const v = this._videos.get(card);
    // metadata 已載入，可在 play() 前同步設定速率與起始時間
    this._applyPlaybackRate(v);
    this._applyStartTime(v);
    v.style.opacity = "1";
    v.play().catch(() => {});
    const img = card.querySelector("img");
    if (img) img.style.opacity = "0";
  }

  _createVideo(card, src) {
    const wrap = card.querySelector(".project-card__img-wrap");
    if (!wrap) return;

    const img = card.querySelector("img");
    const fit = card.getAttribute("data-hover-video-fit");
    const isContain = fit === "contain";

    const video = document.createElement("video");
    video.setAttribute("src", src);
    video.muted = true;
    video.loop = true;
    video.setAttribute("playsinline", "");
    video.preload = "auto";

    Object.assign(video.style, {
      position: "absolute",
      top: isContain ? "0" : "-1px",
      left: isContain ? "0" : "-1px",
      right: isContain ? "0" : "-1px",
      bottom: isContain ? "0" : "-1px",
      width: isContain ? "100%" : "calc(100% + 2px)",
      height: isContain ? "100%" : "calc(100% + 2px)",
      objectFit: isContain ? "contain" : "cover",
      objectPosition: "center",
      backgroundColor: isContain ? "#ffffff" : "transparent",
      display: "block",
      opacity: "0",
      transition: `opacity ${FADE_MS}ms ease`,
      zIndex: "1",
      willChange: "opacity",
    });

    // loadedmetadata 時只設速率，不做 seek（避免中斷 pending 的 play()）
    video.addEventListener(
      "loadedmetadata",
      () => {
        this._applyPlaybackRate(video);
      },
      { once: true },
    );

    wrap.appendChild(video);
    this._videos.set(card, video);

    video
      .play()
      .then(() => {
        // play() 成功後 seek；延後圖片淡出直到影片首幀就緒，避免白閃
        this._applyStartTime(video);
        const revealVideo = () => {
          // 雙 rAF 確保解碼後的幀已繪製，再淡入影片、淡出圖片
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              // 若使用者已離開，不覆寫 _fadeOutVideo 的結果，避免格子卡在淺灰
              if (this._leaveTimers.has(card)) return;
              if (this._videos.get(card) !== video) return;
              video.style.opacity = "1";
              if (img) {
                img.style.transition = `opacity ${FADE_MS}ms ease`;
                img.style.opacity = "0";
              }
            });
          });
        };
        if (video.seeking) {
          video.addEventListener("seeked", revealVideo, { once: true });
        } else if (video.readyState >= 2) {
          // 已有幀（如 loadeddata 已觸發）
          revealVideo();
        } else {
          video.addEventListener("loadeddata", revealVideo, { once: true });
        }
      })
      .catch(() => {
        // play() 被 reject（常見於手機尚未解碼首幀）→ 若無畫面資料就移除，避免黑色方塊
        if (video.readyState >= 2) {
          requestAnimationFrame(() => {
            if (this._leaveTimers.has(card)) return;
            if (this._videos.get(card) !== video) return;
            video.style.opacity = "1";
            if (img) {
              img.style.transition = `opacity ${FADE_MS}ms ease`;
              img.style.opacity = "0";
            }
          });
        } else {
          video.remove();
          this._videos.delete(card);
        }
      });
  }

  _fadeOutVideo(card) {
    const video = this._videos.get(card);
    if (!video) return;

    const img = card.querySelector("img");

    video.style.opacity = "0";
    if (img) img.style.opacity = "1";

    const timer = setTimeout(() => {
      video.pause();
      video.remove();
      this._videos.delete(card);
      this._leaveTimers.delete(card);
    }, FADE_MS + 50);

    this._leaveTimers.set(card, timer);
  }

  destroy() {
    for (const card of this.cards) {
      card.removeEventListener("mouseenter", this.handleEnter);
      card.removeEventListener("mouseleave", this.handleLeave);

      const et = this._enterTimers.get(card);
      if (et) clearTimeout(et);
      const lt = this._leaveTimers.get(card);
      if (lt) clearTimeout(lt);

      const video = this._videos.get(card);
      if (video) {
        video.pause();
        video.remove();
      }
    }
    this._enterTimers.clear();
    this._leaveTimers.clear();
    this._videos.clear();
    this.cards = [];
  }
}

let hoverVideoInstance = null;

const handlePageEvent = (type) => {
  const page = document.documentElement.getAttribute("data-page");
  if (page !== "home") return;

  if (type === "load") {
    const grid = document.querySelector("[data-grid]");
    if (grid) hoverVideoInstance = new HoverVideo(grid);
  } else if (type === "before-swap") {
    hoverVideoInstance?.destroy();
    hoverVideoInstance = null;
  }
};

document.addEventListener("astro:page-load", () => handlePageEvent("load"));
document.addEventListener("astro:before-swap", () =>
  handlePageEvent("before-swap"),
);
