import gsap from "gsap";

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function setRowContent(row, slider, value) {
  const field = row.getAttribute("data-field");
  if (field === "titleYear") {
    slider.innerHTML = value;
  } else {
    slider.textContent = value;
  }
}

class Tooltip {
  constructor(gridEl) {
    this.grid = gridEl;

    if (!this.grid.querySelector("[data-project-title]")) return;

    this.tooltip = document.querySelector(".tooltip");
    this.OFFSET_X = 20;
    this.OFFSET_Y = -60;
    this.animationConfig = {
      texts: {
        duration: 0.7,
        ease: "expo",
      },
      tooltip: {
        duration: 0.6,
        ease: "power4.inOut",
      },
      textsDelay: 0.4,
      hideDelay: "-=0.7",
    };
    this.rowAnimationDirections = {
      titleYear: { in: { yPercent: -100 }, out: { yPercent: -100 } },
      tags: { in: { yPercent: 100 }, out: { yPercent: 100 } },
    };
    this.hoverTarget = null;
    this.isTooltipVisible = false;
    this.scaleDownTimeout;
    this.scaleDownTimeline;
    this.mouseLeaveTimeout;
    this.rowTimelines = {};
    this.windowWidth = window.innerWidth;

    this.xTo = gsap.quickTo(this.tooltip, "x", { duration: 0.6, ease: "expo" });
    this.yTo = gsap.quickTo(this.tooltip, "y", { duration: 0.6, ease: "expo" });

    for (const row of this.tooltip.querySelectorAll(".tooltip__row")) {
      row.dataset.active = "0";
    }

    // 事件委派：只在 grid 上掛 listener
    this.handleMouseMove = this._handleMouseMove.bind(this);
    this.handleMouseOver = this._handleMouseOver.bind(this);
    this.handleMouseOut = this._handleMouseOut.bind(this);
    this.handleResize = this._handleResize.bind(this);

    this.grid.addEventListener("mousemove", this.handleMouseMove);
    this.grid.addEventListener("mouseover", this.handleMouseOver);
    this.grid.addEventListener("mouseout", this.handleMouseOut);
    window.addEventListener("resize", this.handleResize);
  }

  // 取得滑鼠指向的卡片（有 data-project-title）
  _getCard(e) {
    return e.target.closest("[data-project-title]");
  }

  _handleMouseMove(e) {
    if (!this.hoverTarget) return;

    const tooltipWidth = this.tooltip.offsetWidth;
    let tooltipX;
    const tooltipY = e.clientY + this.OFFSET_Y;

    if (e.clientX + this.OFFSET_X + tooltipWidth > this.windowWidth) {
      tooltipX = e.clientX - this.OFFSET_X - tooltipWidth;
    } else {
      tooltipX = e.clientX + this.OFFSET_X;
    }

    if (!this.isTooltipVisible) {
      if (this.scaleDownTimeline) this.scaleDownTimeline.kill();
      clearTimeout(this.scaleDownTimeout);

      gsap.set(this.tooltip, { x: tooltipX, y: tooltipY });
      gsap.fromTo(
        this.tooltip,
        { scale: 0, opacity: 1, transformOrigin: "0% 100%" },
        { ...this.animationConfig.tooltip, scale: 1 }
      );

      this.isTooltipVisible = true;
    } else {
      this.xTo(tooltipX);
      this.yTo(tooltipY);
    }

    clearTimeout(this.scaleDownTimeout);
    this.scaleDownTimeout = setTimeout(() => {
      if (!this.hoverTarget) {
        this.scaleDownTimeline = gsap.timeline();
        this.updateTooltip(
          { titleYear: "", tags: "" },
          this.scaleDownTimeline,
          "out"
        );
        this.scaleDownTimeline.to(
          this.tooltip,
          { ...this.animationConfig.tooltip, scale: 0 },
          this.animationConfig.hideDelay
        );
        this.isTooltipVisible = false;
      }
    }, 50);
  }

  // 模擬 mouseenter：從外部進入卡片時觸發
  _handleMouseOver(e) {
    const card = this._getCard(e);
    if (!card) return;
    if (card.contains(e.relatedTarget)) return; // 仍在卡片內移動，忽略

    clearTimeout(this.mouseLeaveTimeout);
    this.hoverTarget = card;

    if (this.scaleDownTimeline) this.scaleDownTimeline.kill();
    clearTimeout(this.scaleDownTimeout);

    const title = card.dataset.projectTitle ?? "";
    const year = card.dataset.projectYear ?? "";
    const tagsRaw = card.dataset.projectTags ?? "";
    const titleYear = year
      ? `${escapeHtml(title)}／<span class="tooltip__year">${escapeHtml(year)}</span>`
      : escapeHtml(title);
    const tags = tagsRaw
      ? tagsRaw
          .split(/[,\、]/)
          .map((t) => "#" + t.trim())
          .filter(Boolean)
          .join(" ")
      : "";

    const updateTimeline = gsap.timeline();
    this.updateTooltip(
      { titleYear, tags },
      updateTimeline,
      this.isTooltipVisible ? "none" : "in"
    );
  }

  // 模擬 mouseleave：離開至卡片外部時觸發
  _handleMouseOut(e) {
    const card = this._getCard(e);
    if (!card) return;
    if (card.contains(e.relatedTarget)) return; // 仍在卡片內移動，忽略

    this.hoverTarget = null;

    this.mouseLeaveTimeout = setTimeout(() => {
      if (!this.hoverTarget && this.isTooltipVisible) {
        gsap.set(this.tooltip, { scale: 0, opacity: 0 });
        this.isTooltipVisible = false;
      }
    }, 50);
  }

  _handleResize() {
    this.windowWidth = window.innerWidth;
  }

  destroy() {
    if (this.scaleDownTimeline) this.scaleDownTimeline.kill();
    for (const timeline of Object.values(this.rowTimelines)) {
      timeline?.kill();
    }

    clearTimeout(this.scaleDownTimeout);
    clearTimeout(this.mouseLeaveTimeout);

    this.grid.removeEventListener("mousemove", this.handleMouseMove);
    this.grid.removeEventListener("mouseover", this.handleMouseOver);
    this.grid.removeEventListener("mouseout", this.handleMouseOut);
    window.removeEventListener("resize", this.handleResize);
  }

  updateTooltip(values, timeline, direction) {
    for (const [field, newValue] of Object.entries(values)) {
      const rowSelector = `[data-field="${field}"]`;
      this.updateTextSlider(rowSelector, newValue, timeline, direction);
    }
  }

  updateTextSlider(rowSelector, newValue, timeline, direction) {
    const row = this.tooltip.querySelector(rowSelector);
    const textSliders = row.querySelectorAll(".oh__inner");

    if (textSliders.length < 2) return;

    const activeIndex = row.dataset.active === "0" ? 0 : 1;
    const inactiveIndex = activeIndex === 0 ? 1 : 0;

    const currentSlider = textSliders[activeIndex];
    const nextSlider = textSliders[inactiveIndex];

    const rowField = rowSelector.replace('[data-field="', "").replace('"]', "");
    const animationDirection =
      this.rowAnimationDirections[rowField] ||
      this.rowAnimationDirections.tags;

    const clonedOutDirection = { ...animationDirection.out };
    const clonedInDirection = { ...animationDirection.in };

    if (this.rowTimelines[rowSelector] && direction !== "out") {
      this.rowTimelines[rowSelector].kill();
    }
    this.rowTimelines[rowSelector] = gsap.timeline();

    if (direction === "in") {
      gsap.set(currentSlider, clonedOutDirection);
      gsap.set(nextSlider, clonedInDirection);

      this.rowTimelines[rowSelector].to(
        currentSlider,
        {
          ...this.animationConfig.texts,
          ...clonedOutDirection,
        },
        this.animationConfig.textsDelay
      );

      gsap.set(nextSlider, clonedInDirection);
      this.rowTimelines[rowSelector].to(
        nextSlider,
        {
          ...this.animationConfig.texts,
          yPercent: 0,
          onStart: () => {
            setRowContent(row, nextSlider, newValue);
          },
        },
        this.animationConfig.textsDelay
      );
    } else if (direction === "none") {
      const transitionOutDirection = {
        titleYear: { yPercent: 100 },
        tags: { yPercent: -100 },
      }[rowField] || { yPercent: 0 };

      this.rowTimelines[rowSelector].to(
        currentSlider,
        {
          ...this.animationConfig.texts,
          ...transitionOutDirection,
        },
        0
      );

      gsap.set(nextSlider, clonedInDirection);
      this.rowTimelines[rowSelector].to(
        nextSlider,
        {
          ...this.animationConfig.texts,
          yPercent: 0,
          onStart: () => {
            setRowContent(row, nextSlider, newValue);
          },
        },
        0
      );
    } else if (direction === "out") {
      this.rowTimelines[rowSelector].to(
        currentSlider,
        {
          ...clonedOutDirection,
          ...this.animationConfig.texts,
        },
        0
      );
    }

    row.dataset.active = inactiveIndex.toString();

    timeline.add(this.rowTimelines[rowSelector], 0);
  }
}

let tooltip;

const handlePageEvent = (type) => {
  const page = document.documentElement.getAttribute("data-page");
  if (page !== "home") return;

  if (type === "load") {
    tooltip = new Tooltip(document.querySelector("[data-grid]"));
  } else if (type === "before-swap") {
    tooltip.destroy();
  }
};

document.addEventListener("astro:page-load", () => handlePageEvent("load"));
document.addEventListener("astro:before-swap", () =>
  handlePageEvent("before-swap")
);
