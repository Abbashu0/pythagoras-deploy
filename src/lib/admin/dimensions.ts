/**
 * dimensions.ts
 * =============
 * Single source of truth for ALL dimension calculations used by the
 * admin previews and recommended-image-size hints.
 *
 * ─────────────────────────────────────────────────────────────────
 *  WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────
 *  Previously the admin preview widths (e.g. 366px for the carousel,
 *  378px for material cards) and the recommended image sizes
 *  (e.g. 732×293 retina) were hardcoded in different files, and they
 *  didn't always match the actual student-app dimensions.
 *
 *  The student app's device frame is `min(100%, 430px)` wide, with
 *  `18px` horizontal padding inside `.screen`. So the actual content
 *  width on a desktop preview is `430 − 36 = 394px`. On a real mobile
 *  device it's `100vw − 36px`.
 *
 *  This file centralises every width / aspect-ratio / retina-factor
 *  so the previews match the student app pixel-perfectly AND the
 *  recommended-image-size hints stay accurate as the admin changes
 *  card height / banner type.
 *
 * ─────────────────────────────────────────────────────────────────
 *  USAGE
 * ─────────────────────────────────────────────────────────────────
 *    import { getMaterialCardDimensions, getBannerDimensions } from "@/lib/admin/dimensions";
 *
 *    const dim = getMaterialCardDimensions({ cardHeight: 240 });
 *    // → { cssWidth: 394, cssHeight: 240, retinaWidth: 788, retinaHeight: 480, aspectRatio: "197:120" }
 *
 *    const dim = getBannerDimensions("full");
 *    // → { cssWidth: 394, cssHeight: 158, retinaWidth: 788, retinaHeight: 316, aspectRatio: "5:2" }
 */

export type BannerKind = "full" | "split";

export interface Dimensions {
  /** Rendered CSS width in px (the actual on-screen size). */
  cssWidth: number;
  /** Rendered CSS height in px. */
  cssHeight: number;
  /** 2× retina width — the pixel size designers should export at. */
  retinaWidth: number;
  /** 2× retina height. */
  retinaHeight: number;
  /** Simplified integer aspect ratio, e.g. "5:2" or "197:120". */
  aspectRatio: string;
  /** Retina scale factor (always 2 — kept as a field for clarity). */
  retinaScale: number;
}

// ============================================================
// Constants — measured from the student app's CSS
// ============================================================

/**
 * The student app's device frame is `min(100%, 430px)` wide.
 * On a desktop preview we render at the full 430px.
 */
export const APP_DEVICE_WIDTH = 430;

/**
 * Horizontal padding inside `.screen` (18px each side).
 * Content width = APP_DEVICE_WIDTH − 2 × SCREEN_PADDING_X.
 */
export const SCREEN_PADDING_X = 18;

/**
 * The actual width of every "full-bleed" content card inside the
 * student app (carousels, material cards, etc.) on a desktop preview.
 *
 * On real mobile devices this becomes `100vw − 36px`, but the admin
 * preview always renders at the desktop width (394px) because that's
 * the upper bound — a designer who exports at this size will get
 * crisp results on every device.
 */
export const CONTENT_WIDTH = APP_DEVICE_WIDTH - 2 * SCREEN_PADDING_X; // 394

/**
 * Carousel frame aspect ratio (5:2) — from `.sponsored-carousel-frame`.
 */
export const CAROUSEL_ASPECT_W = 5;
export const CAROUSEL_ASPECT_H = 2;

/**
 * Split banner visual panel width (42% of the frame) — from the
 * `grid-template-columns: 42% 1fr` rule in SponsoredCarouselCard.js.
 */
export const SPLIT_PANEL_PERCENT = 0.42;

/**
 * Retina scale factor used for recommended export sizes.
 */
export const RETINA_SCALE = 2;

// ============================================================
// Helpers
// ============================================================

/** Compute the greatest common divisor of two integers. */
function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

/** Format a width/height pair as a simplified "W:H" aspect ratio string. */
function formatAspectRatio(w: number, h: number): string {
  const g = gcd(w, h);
  return `${Math.round(w / g)}:${Math.round(h / g)}`;
}

// ============================================================
// Material card dimensions (dynamic — depends on cardHeight)
// ============================================================

export interface MaterialCardDimensionsInput {
  /** The current `cardHeight` setting (160..340). Default 213. */
  cardHeight: number;
}

/**
 * Compute the recommended image size for a material card.
 *
 * The card is full-bleed inside the screen, so its width = CONTENT_WIDTH
 * (394px) and its height = `cardHeight` (set by the admin). The
 * recommended export size is 2× retina = 788 × (cardHeight × 2) px.
 *
 * As the admin drags the card-height slider, the recommended size
 * updates in real-time so the hint always says "export at exactly
 * this size and your image will fit perfectly".
 */
export function getMaterialCardDimensions(
  input: MaterialCardDimensionsInput
): Dimensions {
  const { cardHeight } = input;
  const cssWidth = CONTENT_WIDTH;
  const cssHeight = cardHeight;
  return {
    cssWidth,
    cssHeight,
    retinaWidth: cssWidth * RETINA_SCALE,
    retinaHeight: cssHeight * RETINA_SCALE,
    aspectRatio: formatAspectRatio(cssWidth, cssHeight),
    retinaScale: RETINA_SCALE,
  };
}

// ============================================================
// Banner dimensions (depends on banner type)
// ============================================================

/**
 * Compute the recommended image size for a banner.
 *
 *  - "full":  Image fills the ENTIRE carousel frame. Frame width =
 *             CONTENT_WIDTH (394px), frame height = 394 × 2/5 ≈ 158px.
 *             Retina = 788 × 316.
 *
 *  - "split": Image fills only the 42% left visual panel. Panel width =
 *             CONTENT_WIDTH × 0.42 ≈ 165px, panel height = full frame
 *             height ≈ 158px. Retina = 330 × 316.
 */
export function getBannerDimensions(kind: BannerKind): Dimensions {
  const frameWidth = CONTENT_WIDTH;
  const frameHeight = (frameWidth * CAROUSEL_ASPECT_H) / CAROUSEL_ASPECT_W; // 394 * 2/5 ≈ 157.6

  if (kind === "full") {
    const cssWidth = frameWidth;
    const cssHeight = Math.round(frameHeight);
    return {
      cssWidth,
      cssHeight,
      retinaWidth: cssWidth * RETINA_SCALE,
      retinaHeight: cssHeight * RETINA_SCALE,
      aspectRatio: `${CAROUSEL_ASPECT_W}:${CAROUSEL_ASPECT_H}`,
      retinaScale: RETINA_SCALE,
    };
  }

  // split
  const panelWidth = Math.round(frameWidth * SPLIT_PANEL_PERCENT); // ≈165
  const panelHeight = Math.round(frameHeight); // ≈158
  return {
    cssWidth: panelWidth,
    cssHeight: panelHeight,
    retinaWidth: panelWidth * RETINA_SCALE,
    retinaHeight: panelHeight * RETINA_SCALE,
    aspectRatio: formatAspectRatio(panelWidth, panelHeight),
    retinaScale: RETINA_SCALE,
  };
}

// ============================================================
// Convenience — preview widths for the admin components
// ============================================================

/**
 * Width to render the live carousel preview at — matches the student
 * app's actual content width.
 */
export const CAROUSEL_PREVIEW_WIDTH = CONTENT_WIDTH;

/**
 * Width to render the live material-card preview at — matches the
 * student app's actual content width.
 */
export const MATERIAL_PREVIEW_WIDTH = CONTENT_WIDTH;

/**
 * Width to render the ImagePositioner frame at, for banner editing.
 * Same as the carousel preview so the editor = the student view.
 */
export const BANNER_POSITIONER_WIDTH = CONTENT_WIDTH;

/**
 * Width to render the ImagePositioner frame at, for material-card
 * editing. Same as the material preview width.
 */
export const MATERIAL_POSITIONER_WIDTH = CONTENT_WIDTH;
