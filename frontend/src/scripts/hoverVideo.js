/**
 * Hover Video Preview
 * Desktop  – mouseenter / mouseleave
 * Mobile   – 長按 400ms 顯示影片，放開隱藏（不觸發導航）
 */

const FADE_MS = 200;
const DEBOUNCE_MS = 100;
const LONG_PRESS_MS = 400;
const MOVE_THRESHOLD = 10;
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
    this._pressTimers = new Map();
    this._pressActive = new Set();
    this._touchStart = new Map();

    this.handleEnter = this._handleEnter.bind(this);
    this.handleLeave = this._handleLeave.bind(this);
    this.handleTouchStart = this._handleTouchStart.bind(this);
    this.handleTouchMove = this._handleTouchMove.bind(this);
    this.handleTouchEnd = this._handleTouchEnd.bind(this);
    this.handleContextMenu = this._handleContextMenu.bind(this);

    for (const card of this.cards) {
      card.addEventListener("mouseenter", this.handleEnter);
      card.addEventListener("mouseleave", this.handleLeave);
      card.addEventListener("touchstart", this.handleTouchStart, {
        passive: true,
      });
      card.addEventListener("touchmove", this.handleTouchMove, {
        passive: true,
      });
      card.addEventListener("touchend", this.handleTouchEnd);
      card.addEventListener("touchcancel", this.handleTouchEnd);
      card.addEventListener("contextmenu", this.handleContextMenu);
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

  // ── Touch ────────────────────────────────────────────────────────────────

  _handleTouchStart(e) {
    const card = e.currentTarget;
    const src = card.getAttribute("data-hover-video");
    if (!src) return;

    const touch = e.touches[0];
    this._touchStart.set(card, { x: touch.clientX, y: touch.clientY });

    const timer = setTimeout(() => {
      this._pressTimers.delete(card);
      this._pressActive.add(card);

      if (this._videos.has(card)) {
        this._resumeVideo(card);
      } else {
        this._createVideo(card, src);
      }
    }, LONG_PRESS_MS);

    this._pressTimers.set(card, timer);
  }

  _handleTouchMove(e) {
    const card = e.currentTarget;
    const start = this._touchStart.get(card);
    if (!start) return;

    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - start.x);
    const dy = Math.abs(touch.clientY - start.y);

    if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
      const timer = this._pressTimers.get(card);
      if (timer) {
        clearTimeout(timer);
        this._pressTimers.delete(card);
      }
      this._touchStart.delete(card);
    }
  }

  _handleTouchEnd(e) {
    const card = e.currentTarget;

    const timer = this._pressTimers.get(card);
    if (timer) {
      clearTimeout(timer);
      this._pressTimers.delete(card);
    }
    this._touchStart.delete(card);

    if (this._pressActive.has(card)) {
      this._pressActive.delete(card);
      this._fadeOutVideo(card);
      // 長按結束 → 阻止 click 觸發連結導航
      e.preventDefault();
    }
  }

  _handleContextMenu(e) {
    // 長按期間或影片顯示時，阻止 iOS/Android 的預設右鍵選單
    const card = e.currentTarget;
    if (this._pressActive.has(card) || this._pressTimers.has(card)) {
      e.preventDefault();
    }
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
        requestAnimationFrame(() => {
          video.style.opacity = "1";
        });
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
      card.removeEventListener("touchstart", this.handleTouchStart);
      card.removeEventListener("touchmove", this.handleTouchMove);
      card.removeEventListener("touchend", this.handleTouchEnd);
      card.removeEventListener("touchcancel", this.handleTouchEnd);
      card.removeEventListener("contextmenu", this.handleContextMenu);

      const et = this._enterTimers.get(card);
      if (et) clearTimeout(et);
      const lt = this._leaveTimers.get(card);
      if (lt) clearTimeout(lt);
      const pt = this._pressTimers.get(card);
      if (pt) clearTimeout(pt);

      const video = this._videos.get(card);
      if (video) {
        video.pause();
        video.remove();
      }
    }
    this._enterTimers.clear();
    this._leaveTimers.clear();
    this._videos.clear();
    this._pressTimers.clear();
    this._pressActive.clear();
    this._touchStart.clear();
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
