import gsap from "gsap";
import { navigate } from "astro:transitions/client";

const SESSION_ORDER_KEY = "grid-session-order";
const GRID_SEARCH_KEY = "grid-search-term";
const GRID_VIEW_MODE_KEY = "grid-view-mode";

// Initialize variables to store DOM elements and states
let gridContainer;
let gridItems;
let shuffleButton;
let sortButton;
let searchButton;
let searchClearButton;
let searchContent;
let searchContentOriginal;
let searchDialog;
let searchOverlay;
let searchInput;
let closeDialog;
let loadMoreBtn;
let loadMoreWrap;
let searchNoResults;

const LOAD_BATCH = 24;

/* Event handler functions */

// Shuffle grid: trigger grid shuffling.
const handleShuffleClick = () => {
  clearSearchState();
  shuffleGrid();
};

// Sort grid: trigger grid sorting.
const handleSortClick = () => {
  clearSearchState();
  sortGrid();
};

// Open search dialog: show the dialog and blur the page.
const handleSearchClick = () => {
  searchDialog.showModal();
  toggleDialogPageBlur(true);
};

// Close search dialog: hide the dialog and remove the blur.
const handleCloseClick = () => {
  searchDialog.close();
  toggleDialogPageBlur(false);
};

// 清除搜尋狀態（供 sort/shuffle 與 clear 按鈕共用）
const clearSearchState = () => {
  filterGrid("");
  // 還原為當次 session 的排序（相當於重新整理頁面後的隨機種子順序）
  applySessionOrder();
  // 重新觸發圖卡上浮動畫
  const visible = gridItems
    .filter((item) => !item.hasAttribute("data-deferred"))
    .sort(
      (a, b) => (parseInt(a.style.order) || 0) - (parseInt(b.style.order) || 0),
    );
  appearCards(visible);
  toggleClearButton();
  setSearchToolbarLabel("");
  searchInput.value = "";
  searchButton.classList.remove("search--active");
  try {
    sessionStorage.removeItem(GRID_SEARCH_KEY);
    sessionStorage.setItem(GRID_VIEW_MODE_KEY, "random");
  } catch (_) {}
  syncSortButtons();
};

// 工具列顯示搜尋字。過長時由 CSS 省略，title 保留完整字串。
const setSearchToolbarLabel = (term) => {
  if (!searchContent) return;
  searchContent.innerHTML = term ? term : searchContentOriginal;
  if (!searchButton) return;
  if (term) searchButton.title = term;
  else searchButton.removeAttribute("title");
};

// Clear search: reset the filter and clear the input.
const handleSearchClearClick = () => clearSearchState();

// Filter grid: update grid items based on the search input.
const handleSearchInput = (e) => {
  const searchTerm = e.target.value;
  filterGrid(searchTerm);
  setSearchToolbarLabel(searchTerm);
  toggleClearButton(searchTerm);
  searchButton.classList.toggle("search--active", searchTerm !== "");
  try {
    if (searchTerm) {
      sessionStorage.setItem(GRID_SEARCH_KEY, searchTerm);
      sessionStorage.setItem(GRID_VIEW_MODE_KEY, "search");
    } else {
      sessionStorage.removeItem(GRID_SEARCH_KEY);
    }
  } catch (_) {}
  syncSortButtons();
};

/* 「最新／隨機」：目前的排序全亮、另一個淡色（和「字／圖」相同）；搜尋或標籤篩選中兩個都淡 */
const syncSortButtons = () => {
  const mode = (() => {
    try {
      return sessionStorage.getItem(GRID_VIEW_MODE_KEY);
    } catch (_) {
      return null;
    }
  })();
  // 網址 ?search= 或標籤進來時不一定寫入 mode，直接看搜尋鈕是否在搜尋狀態
  const searching = mode === "search" || Boolean(searchButton?.classList.contains("search--active"));
  sortButton?.setAttribute("aria-pressed", String(!searching && mode === "latest"));
  shuffleButton?.setAttribute("aria-pressed", String(!searching && mode !== "latest"));
};

/* Initialize DOM elements and states */
const initializeVariables = () => {
  gridContainer = document.querySelector("[data-grid]");
  // 其他款字圖（data-wm-extra）只屬於字牆，由 gridViewMode.js 跟著所屬作品顯示，不算一張卡片
  gridItems = Array.from(gridContainer?.children || []).filter((el) => !el.hasAttribute("data-wm-extra"));
  shuffleButton = document.querySelector("[data-shuffle]");
  sortButton = document.querySelector("[data-sort]");
  searchButton = document.querySelector("[data-search]");
  searchClearButton = document.querySelector("[data-clear]");
  searchContent = searchButton?.querySelector(".oh__inner");
  searchContentOriginal = searchContent?.innerHTML || "";
  searchDialog = document.getElementById("search-dialog");
  searchOverlay = document.getElementById("search-overlay");
  searchInput = document.getElementById("search-input");
  closeDialog = document.getElementById("close-dialog");
  loadMoreBtn = document.getElementById("load-more");
  loadMoreWrap = document.getElementById("load-more-wrap");
  searchNoResults = document.getElementById("search-no-results-wrap");
};

/* 以 GSAP 複製首頁入場動畫：yPercent 100 上浮 + autoAlpha 淡入 */
const appearCards = (items) => {
  if (!items.length) return;
  gsap.killTweensOf(items);
  const tl = gsap.timeline();
  tl.fromTo(
    items,
    { yPercent: 100 },
    { yPercent: 0, duration: 0.8, ease: "power4", stagger: 0.04 },
  ).fromTo(
    items,
    { autoAlpha: 0 },
    { autoAlpha: 1, duration: 0.8, ease: "sine", stagger: 0.04 },
    "<",
  );
};

/* Shuffle：從全部專案中隨機抽選 LOAD_BATCH 張顯示，其餘重新隱藏 */
const shuffleGrid = () => {
  const shuffled = [...gridItems].sort(() => Math.random() - 0.5);

  // 儲存本次排序到 sessionStorage，重整後可還原
  const order = shuffled.map((item) => item.getAttribute("href") ?? "");
  try {
    sessionStorage.setItem(SESSION_ORDER_KEY, JSON.stringify(order));
    sessionStorage.setItem(GRID_VIEW_MODE_KEY, "random");
  } catch (_) {}

  const visible = [];
  shuffled.forEach((item, i) => {
    item.style.order = String(i);
    if (i < LOAD_BATCH) {
      item.removeAttribute("data-deferred");
      item.style.display = "";
      visible.push(item);
    } else {
      item.setAttribute("data-deferred", "");
      item.style.display = ""; // 清除殘留 inline display，讓 CSS 規則接管
    }
  });
  appearCards(visible);
  updateLoadMoreVisibility();
  document.dispatchEvent(new CustomEvent("grid:reordered"));
  syncSortButtons();
};

/* 套用 session 內儲存的排序，或在首次進入時產生新的隨機排序 */
const applySessionOrder = () => {
  let order = null;

  try {
    const saved = sessionStorage.getItem(SESSION_ORDER_KEY);
    if (saved) order = JSON.parse(saved);
  } catch (_) {}

  if (!order) {
    // 首次進入：產生隨機順序並儲存
    const shuffled = [...gridItems].sort(() => Math.random() - 0.5);
    order = shuffled.map((item) => item.getAttribute("href") ?? "");
    try {
      sessionStorage.setItem(SESSION_ORDER_KEY, JSON.stringify(order));
      sessionStorage.setItem(GRID_VIEW_MODE_KEY, "random");
    } catch (_) {}
  }

  const orderMap = new Map(order.map((href, i) => [href, i]));
  const sorted = [...gridItems].sort((a, b) => {
    const ia = orderMap.get(a.getAttribute("href") ?? "") ?? order.length;
    const ib = orderMap.get(b.getAttribute("href") ?? "") ?? order.length;
    return ia - ib;
  });

  sorted.forEach((item, i) => {
    item.style.order = String(i);
    if (i < LOAD_BATCH) {
      item.removeAttribute("data-deferred");
      item.style.display = "";
    } else {
      item.setAttribute("data-deferred", "");
      item.style.display = "";
    }
  });

  updateLoadMoreVisibility();
  document.dispatchEvent(new CustomEvent("grid:reordered"));
};

/* 最新：重設回「全部專案依日期排序後的最新 LOAD_BATCH 張」，其餘重新隱藏 */
// skipAnimation：頁面載入時套用（BACK 回「最新」）不播卡片浮上動畫，交給首頁入場動畫；
// 兩個動畫同時跑時，入場動畫會從「透明」動到「透明」，卡片就一直不出現
const sortGrid = ({ skipAnimation = false } = {}) => {
  // 使用者主動切回日期排序 → 清除 session，下次重整會重新隨機
  try {
    sessionStorage.removeItem(SESSION_ORDER_KEY);
    sessionStorage.setItem(GRID_VIEW_MODE_KEY, "latest");
  } catch (_) {}
  const sorted = [...gridItems].sort((a, b) => {
    const dateA = a.getAttribute("data-project-date") ?? "";
    const dateB = b.getAttribute("data-project-date") ?? "";
    if (dateA && dateB) return dateB.localeCompare(dateA);
    if (dateA) return -1;
    if (dateB) return 1;
    return 0;
  });
  const visible = [];
  sorted.forEach((item, i) => {
    item.style.order = String(i);
    if (i < LOAD_BATCH) {
      item.removeAttribute("data-deferred");
      item.style.display = "";
      visible.push(item);
    } else {
      item.setAttribute("data-deferred", "");
      item.style.display = ""; // 清除殘留 inline display，讓 CSS 規則接管
    }
  });
  if (skipAnimation) {
    gsap.killTweensOf(visible);
    gsap.set(visible, { yPercent: 0, autoAlpha: 1 });
  } else appearCards(visible);
  updateLoadMoreVisibility();
  document.dispatchEvent(new CustomEvent("grid:reordered"));
  syncSortButtons();
};

/* Filter grid items based on the search input */
const filterGrid = (searchValue, options = {}) => {
  const { skipAnimation = false } = options;
  const lowerCaseSearch = searchValue.toLowerCase();
  const isSearching = searchValue !== "";

  // 搜尋中：先 kill 舊動畫，避免快速輸入時疊加（關閉 dialog 僅同步時不 kill，避免觸發重播）
  if (isSearching && !skipAnimation) gsap.killTweensOf(gridItems);

  const toAnimate = [];
  const alreadyVisible = []; // 已顯示、不需重播動畫的卡片
  const matchingItems = [];

  for (const item of gridItems) {
    const title = (
      item.getAttribute("data-project-title") ??
      item.getAttribute("data-product-title") ??
      ""
    ).toLowerCase();
    const creatorName = (
      item.getAttribute("data-creator-name") ?? ""
    ).toLowerCase();
    const tags = (item.getAttribute("data-project-tags") ?? "").toLowerCase();
    const matches =
      title.includes(lowerCaseSearch) ||
      creatorName.includes(lowerCaseSearch) ||
      tags.includes(lowerCaseSearch);

    if (matches) {
      if (isSearching) {
        matchingItems.push(item);
        // 只對「原本隱藏、現在才顯示」的卡片播動畫；已顯示的不重播
        const wasHidden =
          item.style.display === "none" || item.hasAttribute("data-deferred");
        item.style.display = "block";
        // deferred 項目被搜尋顯示時，強制立即載入圖片（lazy 在 display:none 時不會載入）
        if (item.hasAttribute("data-deferred")) {
          item.querySelectorAll('img[loading="lazy"]').forEach((img) => {
            img.loading = "eager";
          });
        }
        if (wasHidden) {
          toAnimate.push(item);
        } else {
          alreadyVisible.push(item);
        }
      } else {
        // 清空搜尋：靜默還原，讓 CSS 的 a[data-deferred]{display:none} 自然接管
        item.style.display = "";
      }
    } else {
      item.style.display = "none";
    }
  }

  // 搜尋中：依日期排序，越新越前面
  if (isSearching && matchingItems.length) {
    const sorted = [...matchingItems].sort((a, b) => {
      const dateA = a.getAttribute("data-project-date") ?? "";
      const dateB = b.getAttribute("data-project-date") ?? "";
      if (dateA && dateB) return dateB.localeCompare(dateA);
      if (dateA) return -1;
      if (dateB) return 1;
      return 0;
    });
    sorted.forEach((item, i) => {
      item.style.order = String(i);
    });
    let order = matchingItems.length;
    for (const item of gridItems) {
      if (item.style.display === "none") {
        item.style.order = String(order++);
      }
    }
  }

  // kill 後已顯示的卡片可能停在動畫中途，強制設為完成態避免卡在半透明
  if (alreadyVisible.length) {
    gsap.set(alreadyVisible, { yPercent: 0, autoAlpha: 1 });
  }
  if (toAnimate.length) {
    if (skipAnimation) {
      gsap.set(toAnimate, { yPercent: 0, autoAlpha: 1 });
    } else if (isSearching) {
      // 搜尋模式：全部同時淡入，不用 stagger
      // fromTo + stagger 會把所有 items 先設成 autoAlpha:0，後段 items 長時間透明 → 看起來消失
      gsap.fromTo(
        toAnimate,
        { yPercent: 15, autoAlpha: 0 },
        { yPercent: 0, autoAlpha: 1, duration: 0.45, ease: "power2.out" },
      );
    } else {
      appearCards(toAnimate);
    }
  }
  updateLoadMoreVisibility(isSearching);
  const matchCount = gridItems.filter(
    (item) => item.style.display !== "none",
  ).length;
  const noResults = isSearching && matchCount === 0;
  if (searchNoResults) {
    searchNoResults.classList.toggle("hidden", !noResults);
  }
  if (loadMoreWrap) {
    loadMoreWrap.classList.toggle("hidden", noResults);
  }
  if (gridContainer) {
    gridContainer.classList.toggle("grid--no-results", noResults);
  }
};

/* 顯示下一批尚未載入的卡片（依目前 CSS order 視覺順序揭示） */
const loadMore = () => {
  const deferred = gridItems
    .filter((item) => item.hasAttribute("data-deferred"))
    .sort(
      (a, b) => (parseInt(a.style.order) || 0) - (parseInt(b.style.order) || 0),
    );
  const batch = deferred.slice(0, LOAD_BATCH);
  batch.forEach((item) => {
    item.removeAttribute("data-deferred");
    item.style.display = "";
  });
  appearCards(batch);
  updateLoadMoreVisibility();
};

/* 自動載入：「更多」按鈕進到畫面下方一個螢幕高的範圍內，就自動載入下一批，牆面看起來是連續的。
   按鈕保留在牆底，網路慢或沒觸發時還能手動按；全部載完按鈕消失，頁尾才出現。
   載完一批後牆面重排需要一點時間，之後按鈕若還在範圍內（螢幕很高時）就再載一批，直到填滿 */
let autoLoadObserver = null;
let autoLoadTimer = 0;
const AUTO_LOAD_SETTLE = 450;
const gridShown = () => {
  const grid = document.querySelector("[data-grid]");
  return Boolean(grid) && getComputedStyle(grid).visibility !== "hidden";
};
// 直接量按鈕位置（不沿用觀察器的狀態：自己改寫的話，觀察器會以為沒變化而不再通知）
const loadMoreNear = () =>
  Boolean(loadMoreBtn) &&
  !loadMoreBtn.classList.contains("hidden") &&
  loadMoreBtn.getBoundingClientRect().top < window.innerHeight * 2;
const tryAutoLoad = () => {
  if (autoLoadTimer || !loadMoreNear()) return;
  // 首頁入場動畫還在跑（牆面還沒顯示）時先不載，等一下再檢查
  if (gridShown()) loadMore();
  autoLoadTimer = window.setTimeout(() => {
    autoLoadTimer = 0;
    tryAutoLoad();
  }, AUTO_LOAD_SETTLE);
};
const setupAutoLoad = () => {
  if (!loadMoreBtn || !("IntersectionObserver" in window)) return;
  autoLoadObserver = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) tryAutoLoad();
    },
    { rootMargin: "0px 0px 100% 0px" },
  );
  autoLoadObserver.observe(loadMoreBtn);
};
const teardownAutoLoad = () => {
  autoLoadObserver?.disconnect();
  autoLoadObserver = null;
  clearTimeout(autoLoadTimer);
  autoLoadTimer = 0;
};

/* 更新「載入更多」按鈕的顯示狀態。搜尋／篩選中時隱藏（已顯示全部符合結果） */
const updateLoadMoreVisibility = (isFilterActive = false) => {
  if (!loadMoreBtn) return;
  if (isFilterActive) {
    loadMoreBtn.classList.add("hidden");
    return;
  }
  const hasDeferred = gridItems.some((item) =>
    item.hasAttribute("data-deferred"),
  );
  loadMoreBtn.classList.toggle("hidden", !hasDeferred);
};

/* Toggle backdrop-filter overlay when the search dialog is open or closed.
   Uses overlay instead of body filter:blur to avoid Safari line artifacts
   when project cards animate (transform) under a blurred parent. */
const toggleDialogPageBlur = (toggle) => {
  if (searchOverlay) {
    searchOverlay.toggleAttribute("data-visible", toggle);
  }
};

/* Show or hide the clear button based on search input */
const toggleClearButton = (searchTerm = "") => {
  const isHidden = searchClearButton?.classList.contains("hidden");
  if (searchTerm === "" && !isHidden) {
    searchClearButton.classList.add("hidden");
  } else if (searchTerm !== "" && isHidden) {
    searchClearButton.classList.remove("hidden");
  }
};

/* Apply tag filter from URL ?tag= parameter */
const applyTagFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const tag = params.get("tag");
  if (!tag) return;
  // 頁面載入時套用：不播篩選的淡入動畫，交給首頁入場動畫（index.js），兩個動畫疊在一起字會停在透明
  filterGrid(tag, { skipAnimation: true });
  toggleClearButton(tag);
  searchButton?.classList.add("search--active");
  setSearchToolbarLabel(tag);
  if (searchInput) searchInput.value = tag;
  try {
    sessionStorage.setItem(GRID_SEARCH_KEY, tag);
    sessionStorage.setItem(GRID_VIEW_MODE_KEY, "search");
  } catch (_) {}
  // Clean up URL without triggering navigation
  const url = new URL(window.location.href);
  url.searchParams.delete("tag");
  window.history.replaceState({}, "", url);
  syncSortButtons();
};

/* 從專案頁 BACK 回「最新」：套用 ?from=latest */
const applyViewModeFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("from") !== "latest") return;
  sortGrid({ skipAnimation: true });
  const url = new URL(window.location.href);
  url.searchParams.delete("from");
  window.history.replaceState({}, "", url);
};

/* Apply search from URL ?search= or sessionStorage（從專案頁 BACK 回篩選結果） */
const applySearchFromSession = () => {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("search");
  const fromSession = (() => {
    try {
      return sessionStorage.getItem(GRID_SEARCH_KEY);
    } catch (_) {
      return null;
    }
  })();
  const term = fromUrl ?? fromSession ?? "";
  if (!term) return;
  // 頁面載入時套用：不播篩選的淡入動畫。一般載入交給首頁入場動畫（index.js），從作品頁返回時由 gridViewMode.js 直接顯示；
  // 兩個動畫疊在一起，字會停在透明的狀態
  filterGrid(term, { skipAnimation: true });
  toggleClearButton(term);
  searchButton?.classList.add("search--active");
  setSearchToolbarLabel(term);
  if (searchInput) searchInput.value = term;
  if (fromUrl) {
    const url = new URL(window.location.href);
    url.searchParams.delete("search");
    window.history.replaceState({}, "", url);
  }
};

/* 點擊專案卡片時，帶上 from_search 或 from=latest，讓專案頁 BACK 可回到篩選結果。
   用站內換頁（navigate）而不是整頁跳轉，字牆點字進作品頁的轉場才會保留（見 projectWordmark.js） */
const handleGridCardClick = (e) => {
  const link = e.target.closest("a[href^='/projects/']");
  if (!link) return;
  const term =
    searchContent?.textContent?.trim() !== searchContentOriginal?.trim()
      ? (searchContent?.textContent?.trim() ?? "")
      : "";
  const viewMode = (() => {
    try {
      return sessionStorage.getItem(GRID_VIEW_MODE_KEY);
    } catch (_) {
      return null;
    }
  })();
  if (term) {
    e.preventDefault();
    const url = new URL(link.href);
    url.searchParams.set("from_search", term);
    navigate(url.toString(), { sourceElement: link });
  } else if (viewMode === "latest") {
    e.preventDefault();
    const url = new URL(link.href);
    url.searchParams.set("from", "latest");
    navigate(url.toString(), { sourceElement: link });
  }
};

/* Initialize event listeners and states */
const init = () => {
  initializeVariables();
  shuffleButton?.addEventListener("click", handleShuffleClick);
  sortButton?.addEventListener("click", handleSortClick);
  searchButton?.addEventListener("click", handleSearchClick);
  closeDialog?.addEventListener("click", handleCloseClick);
  searchOverlay?.addEventListener("click", handleCloseClick);
  searchClearButton?.addEventListener("click", handleSearchClearClick);
  searchInput?.addEventListener("input", handleSearchInput);
  searchDialog?.addEventListener("close", () => {
    toggleDialogPageBlur(false);
    // 關閉對話框後重新套用篩選，避免 form 或瀏覽器行為導致狀態不同步
    // 以工具列顯示的搜尋文字為準（searchContent），因關閉 dialog 時 input 可能被 form reset 清空
    // skipAnimation: 僅同步狀態，不觸發圖卡上飄動畫
    const toolbarTerm =
      searchContent?.textContent?.trim() !== searchContentOriginal?.trim()
        ? (searchContent?.textContent?.trim() ?? "")
        : (searchInput?.value ?? "");
    // 同步 input 與工具列，避免兩者不一致
    if (searchInput && toolbarTerm !== searchInput.value)
      searchInput.value = toolbarTerm;
    filterGrid(toolbarTerm, { skipAnimation: true });
  });
  loadMoreBtn?.addEventListener("click", loadMore);
  setupAutoLoad();
  gridContainer?.addEventListener("click", handleGridCardClick);
  const hadFromLatest =
    new URLSearchParams(window.location.search).get("from") === "latest";
  applyViewModeFromUrl();
  // 從作品頁返回（站內換頁的上一頁）時維持原本的「最新」排序；重新整理則照舊回到隨機
  const returningToLatest =
    window.__gridReturning &&
    (() => {
      try {
        return sessionStorage.getItem(GRID_VIEW_MODE_KEY) === "latest";
      } catch (_) {
        return false;
      }
    })();
  if (returningToLatest) sortGrid({ skipAnimation: true });
  else if (!hadFromLatest) applySessionOrder();
  applyTagFromUrl();
  applySearchFromSession();
  syncSortButtons();
};

/* Cleanup event listeners and reset variables */
const cleanup = () => {
  shuffleButton?.removeEventListener("click", handleShuffleClick);
  sortButton?.removeEventListener("click", handleSortClick);
  searchButton?.removeEventListener("click", handleSearchClick);
  closeDialog?.removeEventListener("click", handleCloseClick);
  searchOverlay?.removeEventListener("click", handleCloseClick);
  searchClearButton?.removeEventListener("click", handleSearchClearClick);
  searchInput?.removeEventListener("input", handleSearchInput);
  loadMoreBtn?.removeEventListener("click", loadMore);
  teardownAutoLoad();
  gridContainer?.removeEventListener("click", handleGridCardClick);
  gridContainer = null;
  gridItems = [];
  shuffleButton = null;
  sortButton = null;
  searchButton = null;
  searchClearButton = null;
  searchContent = null;
  searchContentOriginal = "";
  searchDialog = null;
  searchOverlay = null;
  searchInput = null;
  closeDialog = null;
  loadMoreBtn = null;
  loadMoreWrap = null;
  searchNoResults = null;
};

/* Handle Astro page events on the home page */
const handlePageEvent = (type) => {
  const page = document.documentElement.getAttribute("data-page");
  if (page !== "home") return;
  if (type === "load") {
    init();
  } else if (type === "before-swap") {
    cleanup();
  }
};

// Listen for Astro's lifecycle events
document.addEventListener("astro:page-load", () => handlePageEvent("load"));
document.addEventListener("astro:before-swap", () =>
  handlePageEvent("before-swap"),
);
