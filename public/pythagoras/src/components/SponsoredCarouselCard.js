import { icon } from "../scripts/icons.js";

/**
 * SponsoredCarouselCard
 * ---------------------
 * Renders a horizontal carousel of SponsoredBanner entries on the Home page.
 *
 * Architecture:
 *   - UI lives in this file (pure render function returning HTML string).
 *   - Carousel logic (timers, swipe, page tracking) lives in SponsoredCarouselController
 *     (instantiated once per render in app.js and bound to the DOM after mount).
 *   - Banner data comes from `sponsoredBanners` in data.js — tomorrow from an Admin Panel.
 *
 * The card matches the existing featured-card design language: same radius, shadow,
 * surface tokens, and padding rhythm.
 *
 * Tapping a slide logs its banner id to the console (navigation will be wired later
 * via the `destination` field — see SponsoredBanner model).
 */

const AUTO_SLIDE_INTERVAL_MS = 10_000;

/**
 * Recommended banner image size.
 *
 * The banner occupies the left visual panel of each slide. That panel is
 * 42% of the frame width (CSS grid-template-columns: 42% 1fr) and 100% of
 * the frame height (CSS aspect-ratio: 5/2 on the frame).
 *
 * We recommend a 2x retina export so the image stays crisp on high-DPI
 * screens. Designers should export at this exact size; the Admin Panel
 * will reject uploads that don't match the aspect ratio.
 *
 * The numeric values below are measured at runtime from the live DOM so
 * they always reflect the actual rendered dimensions.
 */
const BANNER_RETINA_SCALE = 2;

function reportRecommendedBannerSize() {
  // Defer to next frame so the carousel DOM is laid out before we measure.
  requestAnimationFrame(() => {
    const visual = document.querySelector(".sponsored-slide-visual");
    if (!visual) return;
    const rect = visual.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const cssWidth = Math.round(rect.width);
    const cssHeight = Math.round(rect.height);
    const retinaWidth = cssWidth * BANNER_RETINA_SCALE;
    const retinaHeight = cssHeight * BANNER_RETINA_SCALE;

    // Reduce aspect ratio to simplest integer terms (e.g. 154:146 → 77:73).
    const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
    const g = gcd(cssWidth, cssHeight);
    const ratioW = cssWidth / g;
    const ratioH = cssHeight / g;

    // eslint-disable-next-line no-console
    console.log(
      `%c[SponsoredCarousel] Recommended banner size:%c
  Width:       ${retinaWidth}px (CSS: ${cssWidth}px @1x)
  Height:      ${retinaHeight}px (CSS: ${cssHeight}px @1x)
  Aspect ratio: ${ratioW}:${ratioH}
  Export at ${retinaWidth}×${retinaHeight}px (2x retina) preserving ${ratioW}:${ratioH}.`,
      "color: #4f9cff; font-weight: 600;",
      "color: inherit; font-weight: 400;"
    );
  });
}

export function sponsoredCarouselCard(banners) {
  // Filter + sort once at render time so disabled/out-of-order banners are handled centrally.
  const slides = [...banners]
    .filter((b) => b && b.enabled !== false)
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

  if (slides.length === 0) return "";

  // Report the recommended banner image size so designers and the future Admin Panel
  // know exactly what aspect ratio and resolution to produce. The visual panel is
  // 42% of the frame width and 100% of the frame height; we recommend 2x for retina.
  // These constants are derived from the CSS aspect-ratio (5/2) and grid template.
  reportRecommendedBannerSize();

  return `
    <div class="sponsored-carousel stagger" style="animation-delay:130ms" data-sponsored-carousel data-auto-interval="${AUTO_SLIDE_INTERVAL_MS}">
      <div class="sponsored-carousel-frame">
        <div class="sponsored-carousel-track" data-sponsored-track>
          ${slides
            .map(
              (slide, i) => {
                // Determine if `image` is a real uploaded image (data URL or http URL)
                // vs. a CSS gradient string. The admin store keeps uploaded images
                // as data URLs; the seed data uses gradient strings.
                const isImage = typeof slide.image === "string" &&
                  (slide.image.startsWith("data:") || slide.image.startsWith("http"));
                const transform = slide.transform || { offsetX: 0, offsetY: 0, scale: 1 };
                const visualStyle = isImage
                  ? ""  // image is rendered via <img>, no background needed
                  : `background: ${slide.image || slide.gradient || "linear-gradient(135deg, #4f9cff, #2a6fcc)"};`;
                const visualInner = isImage
                  ? `<img class="sponsored-slide-image" src="${slide.image}" alt="${slide.title}" draggable="false" style="object-position: ${50 + transform.offsetX}% ${50 + transform.offsetY}%; transform: scale(${transform.scale});" />`
                  : `<span class="sponsored-slide-glyph">${icon(slide.iconKey)}</span>`;
                return `
            <article
              class="sponsored-slide"
              data-sponsored-slide
              data-id="${slide.id}"
              data-index="${i}"
              role="button"
              tabindex="0"
              aria-label="${slide.title}: ${slide.subtitle}"
            >
              <div class="sponsored-slide-visual" style="${visualStyle}">
                ${visualInner}
              </div>
              <div class="sponsored-slide-copy">
                <span class="sponsored-eyebrow">محتوى مميّز</span>
                <h3 class="sponsored-title">${slide.title}</h3>
                <p class="sponsored-subtitle">${slide.subtitle}</p>
              </div>
            </article>`;
              }
            )
            .join("")}
        </div>
      </div>
      <div class="sponsored-indicators" data-sponsored-indicators aria-hidden="true">
        ${slides
          .map(
            (_, i) =>
              `<button type="button" class="sponsored-dot${i === 0 ? " is-active" : ""}" data-sponsored-dot data-dot-index="${i}" aria-label="الشريحة ${i + 1}"></button>`
          )
          .join("")}
      </div>
    </div>`;
}

/**
 * SponsoredCarouselController
 * --------------------------
 * Encapsulates all carousel behaviour for a single mounted card:
 *   - active page tracking (0..n-1)
 *   - infinite looping (next after last → 0)
 *   - 10-second auto-slide timer
 *   - touch swipe (RTL aware)
 *   - page indicator sync
 *   - tap → log banner id
 *   - cleanup on unmount
 *
 * Construction is cheap; one instance per card per render.
 * Calling .destroy() removes all listeners and timers.
 */
export class SponsoredCarouselController {
  constructor(root) {
    this.root = root;
    this.track = root.querySelector("[data-sponsored-track]");
    this.indicators = root.querySelector("[data-sponsored-indicators]");
    this.slides = Array.from(root.querySelectorAll("[data-sponsored-slide]"));
    this.dots = Array.from(root.querySelectorAll("[data-sponsored-dot]"));
    this.count = this.slides.length;
    this.active = 0;
    this.autoInterval = Number(root.dataset.autoInterval) || 10_000;
    this.timer = null;
    this.touchStartX = null;
    this.touchStartY = null;
    this.isSwiping = false;

    if (this.count <= 1) return;

    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);
    this._onSlideTap = this._onSlideTap.bind(this);
    this._onDotClick = this._onDotClick.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);

    this._bind();
    this._startAuto();
  }

  _bind() {
    this.track.addEventListener("touchstart", this._onTouchStart, { passive: true });
    this.track.addEventListener("touchmove", this._onTouchMove, { passive: true });
    this.track.addEventListener("touchend", this._onTouchEnd);
    this.slides.forEach((slide) => {
      slide.addEventListener("click", this._onSlideTap);
      slide.addEventListener("keydown", this._onKeyDown);
    });
    this.dots.forEach((dot) => dot.addEventListener("click", this._onDotClick));
  }

  _startAuto() {
    this._stopAuto();
    this.timer = setInterval(() => this.next(), this.autoInterval);
  }

  _stopAuto() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** User interacted → cancel current timer, then start a fresh 10-second countdown. */
  _resetAuto() {
    this._startAuto();
  }

  _goTo(index, { animate = true } = {}) {
    const target = ((index % this.count) + this.count) % this.count;
    this.active = target;
    this.track.style.transition = animate
      ? "transform 360ms cubic-bezier(0.22, 1, 0.36, 1)"
      : "none";
    // RTL: the visual rail flows right-to-left, so we translate by +percentage.
    // LTR would use -percentage. The track container inherits dir from body (rtl).
    const isRtl = getComputedStyle(this.root).direction === "rtl";
    const pct = isRtl ? target * 100 : -target * 100;
    this.track.style.transform = `translateX(${pct}%)`;
    this._syncIndicators();
  }

  _syncIndicators() {
    this.dots.forEach((dot, i) => {
      dot.classList.toggle("is-active", i === this.active);
    });
  }

  next() {
    this._goTo(this.active + 1);
  }

  prev() {
    this._goTo(this.active - 1);
  }

  _onTouchStart(e) {
    if (!e.touches || e.touches.length === 0) return;
    this.touchStartX = e.touches[0].clientX;
    this.touchStartY = e.touches[0].clientY;
    this.isSwiping = false;
    this._stopAuto();
  }

  _onTouchMove(e) {
    if (this.touchStartX == null) return;
    const dx = e.touches[0].clientX - this.touchStartX;
    const dy = e.touches[0].clientY - this.touchStartY;
    // Treat as horizontal swipe only if |dx| > |dy| past a small threshold.
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
      this.isSwiping = true;
    }
  }

  _onTouchEnd(e) {
    if (this.touchStartX == null) return;
    const endX = (e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientX) || this.touchStartX;
    const endY = (e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientY) || this.touchStartY;
    const dx = endX - this.touchStartX;
    const dy = endY - this.touchStartY;
    this.touchStartX = null;
    this.touchStartY = null;

    // Horizontal swipe = |dx| clearly dominates |dy| AND exceeds threshold.
    // We don't rely on a separate isSwiping flag (touchmove can be missed on
    // fast flicks or in some headless browsers), we just check the net delta.
    const isHorizontalSwipe = Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40;

    if (isHorizontalSwipe) {
      // Natural swipe direction (matches user expectation for this RTL app):
      //   swipe RIGHT (dx > 0) → PREVIOUS page
      //   swipe LEFT  (dx < 0) → NEXT page
      if (dx > 0) this.prev();
      else this.next();
    }
    // Always restart the 10-second timer after a user swipe.
    this._resetAuto();
  }

  _onSlideTap(e) {
    const slide = e.currentTarget;
    const id = slide.dataset.id;
    // Per spec: tapping a card simply logs its id. Navigation will be wired later.
    // eslint-disable-next-line no-console
    console.log("[SponsoredCarousel] tapped banner id:", id);
  }

  _onDotClick(e) {
    const idx = Number(e.currentTarget.dataset.dotIndex);
    this._goTo(idx);
    this._resetAuto();
  }

  _onKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this._onSlideTap({ currentTarget: e.currentTarget });
    } else if (e.key === "ArrowLeft") {
      // RTL: ArrowLeft → next (because next slide is to the left visually)
      const isRtl = getComputedStyle(this.root).direction === "rtl";
      if (isRtl) this.next();
      else this.prev();
      this._resetAuto();
    } else if (e.key === "ArrowRight") {
      const isRtl = getComputedStyle(this.root).direction === "rtl";
      if (isRtl) this.prev();
      else this.next();
      this._resetAuto();
    }
  }

  destroy() {
    this._stopAuto();
    this.track.removeEventListener("touchstart", this._onTouchStart);
    this.track.removeEventListener("touchmove", this._onTouchMove);
    this.track.removeEventListener("touchend", this._onTouchEnd);
    this.slides.forEach((slide) => {
      slide.removeEventListener("click", this._onSlideTap);
      slide.removeEventListener("keydown", this._onKeyDown);
    });
    this.dots.forEach((dot) => dot.removeEventListener("click", this._onDotClick));
  }
}
