import gsap from "gsap";

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
  searchContent.innerHTML = searchContentOriginal;
  searchInput.value = "";
  searchButton.classList.remove("search--active");
  try {
    sessionStorage.removeItem(GRID_SEARCH_KEY);
    sessionStorage.setItem(GRID_VIEW_MODE_KEY, "random");
  } catch (_) {}
};

// Clear search: reset the filter and clear the input.
const handleSearchClearClick = () => clearSearchState();

// Filter grid: update grid items based on the search input.
const handleSearchInput = (e) => {
  const searchTerm = e.target.value;
  filterGrid(searchTerm);
  searchContent.innerHTML =
    searchTerm === "" ? searchContentOriginal : searchTerm;
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
};

/* Initialize DOM elements and states */
const initializeVariables = () => {
  gridContainer = document.querySelector("[data-grid]");
  gridItems = Array.from(gridContainer?.children || []);
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
const sortGrid = () => {
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
  appearCards(visible);
  updateLoadMoreVisibility();
  document.dispatchEvent(new CustomEvent("grid:reordered"));
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
  filterGrid(tag);
  toggleClearButton(tag);
  searchButton?.classList.add("search--active");
  if (searchContent) searchContent.innerHTML = tag;
  if (searchInput) searchInput.value = tag;
  try {
    sessionStorage.setItem(GRID_SEARCH_KEY, tag);
    sessionStorage.setItem(GRID_VIEW_MODE_KEY, "search");
  } catch (_) {}
  // Clean up URL without triggering navigation
  const url = new URL(window.location.href);
  url.searchParams.delete("tag");
  window.history.replaceState({}, "", url);
};

/* 從專案頁 BACK 回「最新」：套用 ?from=latest */
const applyViewModeFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("from") !== "latest") return;
  sortGrid();
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
  filterGrid(term);
  toggleClearButton(term);
  searchButton?.classList.add("search--active");
  if (searchContent) searchContent.innerHTML = term;
  if (searchInput) searchInput.value = term;
  if (fromUrl) {
    const url = new URL(window.location.href);
    url.searchParams.delete("search");
    window.history.replaceState({}, "", url);
  }
};

/* 點擊專案卡片時，帶上 from_search 或 from=latest，讓專案頁 BACK 可回到篩選結果 */
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
    window.location.href = url.toString();
  } else if (viewMode === "latest") {
    e.preventDefault();
    const url = new URL(link.href);
    url.searchParams.set("from", "latest");
    window.location.href = url.toString();
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
  gridContainer?.addEventListener("click", handleGridCardClick);
  const hadFromLatest =
    new URLSearchParams(window.location.search).get("from") === "latest";
  applyViewModeFromUrl();
  if (!hadFromLatest) applySessionOrder();
  applyTagFromUrl();
  applySearchFromSession();
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
