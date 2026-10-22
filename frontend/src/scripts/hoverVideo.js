/**
 * Hover Video Preview
 * Desktop  – mouseenter / mouseleave
 * Mobile   – 右下角播放按鈕 tap 切換影片（避免與 iOS Haptic Touch 衝突）
 */

const FADE_MS = 200;
/** 滑過卡片時先等一下才建立影片，避免滑鼠掃過整排時每張都開始下載 */
const DEBOUNCE_MS = 50;
/** 離開後保留最近幾支影片（暫停、隱藏），再滑回來時不必重新下載、解碼 */
const KEEP_VIDEOS = 8;
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

// 影片真的畫出畫面時才執行：支援 requestVideoFrameCallback 的瀏覽器用它，否則等 playing 後兩個畫面更新
function onFirstFrame(video, callback) {
  if ("requestVideoFrameCallback" in video) {
    video.requestVideoFrameCallback(() => callback());
    return;
  }
  const run = () => requestAnimationFrame(() => requestAnimationFrame(callback));
  if (!video.paused && video.readyState >= 3) run();
  else video.addEventListener("playing", run, { once: true });
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
    // 依最近使用排序（Map 的插入順序），超過 KEEP_VIDEOS 支時移除最久沒用的
    this._videos = new Map();
    this._hovered = null;

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
    // 字牆模式不播 hover 影片
    if (document.documentElement.dataset.view === "type") return;
    this._hovered = card;

    if (this._leaveTimers.has(card)) {
      clearTimeout(this._leaveTimers.get(card));
      this._leaveTimers.delete(card);
    }

    if (this._videos.has(card)) {
      this._playVideo(card, this._videos.get(card));
      return;
    }

    const timer = setTimeout(() => {
      this._enterTimers.delete(card);
      if (this._hovered === card) this._createVideo(card, src);
    }, DEBOUNCE_MS);
    this._enterTimers.set(card, timer);
  }

  _handleLeave(e) {
    const card = e.currentTarget;
    if (this._hovered === card) this._hovered = null;

    if (this._enterTimers.has(card)) {
      clearTimeout(this._enterTimers.get(card));
      this._enterTimers.delete(card);
    }

    this._fadeOutVideo(card);
  }

  // ── Shared helpers ───────────────────────────────────────────────────────

  _applyPlaybackRate(video) {
    const dur = video.duration;
    if (!dur || !Number.isFinite(dur)) return;
    let rate = getPlaybackRate(dur);
    if (isSafari && rate > SAFARI_MAX_RATE) rate = SAFARI_MAX_RATE;
    video.playbackRate = rate;
  }

  _startTime(video) {
    return 0.4 * video.playbackRate;
  }

  // 有 metadata 後：先設好速率、跳到起始時間再播放（先播再跳的話要解碼兩次，啟動較慢），第一個畫面出來才淡入
  _playVideo(card, video) {
    // 移到最近使用
    this._videos.delete(card);
    this._videos.set(card, video);
    const start = () => {
      if (this._hovered !== card || this._videos.get(card) !== video) return;
      this._applyPlaybackRate(video);
      video.currentTime = this._startTime(video);
      video.play().catch(() => {
        // 被瀏覽器擋下或中斷：維持顯示縮圖
      });
      onFirstFrame(video, () => this._reveal(card, video));
    };
    if (video.readyState >= 1) start();
    else video.addEventListener("loadedmetadata", start, { once: true });
  }

  _reveal(card, video) {
    // 若使用者已離開，不覆寫 _fadeOutVideo 的結果，避免格子卡在淺灰
    if (this._hovered !== card || this._videos.get(card) !== video) return;
    video.style.opacity = "1";
    const img = card.querySelector("img");
    if (img) {
      img.style.transition = `opacity ${FADE_MS}ms ease`;
      img.style.opacity = "0";
    }
  }

  _createVideo(card, src) {
    const wrap = card.querySelector(".project-card__img-wrap");
    if (!wrap) return;

    const fit = card.getAttribute("data-hover-video-fit");
    const isContain = fit === "contain";

    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.setAttribute("playsinline", "");
    video.preload = "auto";
    video.setAttribute("src", src);

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

    wrap.appendChild(video);
    this._videos.set(card, video);
    this._trimVideos();
    this._playVideo(card, video);
  }

  // 保留的影片超過上限時，移除最久沒用、目前沒在顯示的
  _trimVideos() {
    for (const [card, video] of this._videos) {
      if (this._videos.size <= KEEP_VIDEOS) break;
      if (card === this._hovered) continue;
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
      this._videos.delete(card);
    }
  }

  _fadeOutVideo(card) {
    const video = this._videos.get(card);
    if (!video) return;

    const img = card.querySelector("img");

    video.style.opacity = "0";
    if (img) img.style.opacity = "1";

    // 淡出後暫停，影片元素保留，再滑回來時直接播放
    const timer = setTimeout(() => {
      this._leaveTimers.delete(card);
      if (this._hovered !== card) video.pause();
    }, FADE_MS + 50);

    this._leaveTimers.set(card, timer);
  }

  destroy() {
    // 沒有可播的卡片時建構子提早結束，沒有東西要清
    if (!this._videos) return;
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
    this._hovered = null;
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
