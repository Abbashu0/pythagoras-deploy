/**
 * SponsoredBanner model.
 *
 * This is the canonical shape used by BOTH:
 *   - the student app's SponsoredCarouselCard (public/pythagoras/src/...)
 *   - the admin dashboard (src/app/admin/...)
 *
 * When a backend is introduced, this is the exact schema the API will return.
 * For now, all fields are stored locally in localStorage.
 */
export interface BannerImageTransform {
  /** X offset in % of image overflow (-50..50). 0 = centered. */
  offsetX: number;
  /** Y offset in % of image overflow (-50..50). 0 = centered. */
  offsetY: number;
  /** Zoom multiplier (1 = original, 2 = 2x zoom-in). */
  scale: number;
}

/**
 * Banner layout mode.
 *
 *   - "full":  One single image fills the entire carousel frame edge-to-edge.
 *              No title, no subtitle, no icon. Everything (text, branding, CTA)
 *              is designed inside the image itself. Used for teacher ads,
 *              sponsored courses, external promotions, marketing campaigns.
 *              This is the DEFAULT for new banners.
 *
 *   - "split": Image on one side (left visual panel) + editable title/subtitle
 *              on the other side. Used for internal platform announcements.
 *              This is the original banner layout.
 *
 * Future banner types can be added by extending this union — the renderer
 * switches on `bannerType` and the editor shows/hides fields accordingly.
 */
export type BannerType = "full" | "split";

export const DEFAULT_BANNER_TYPE: BannerType = "full";

/**
 * Banner status — controls visibility in the carousel.
 *   - "active":   shown in the carousel
 *   - "archived": hidden from carousel but kept in the library
 */
export type BannerStatus = "active" | "archived";

export interface SponsoredBanner {
  id: string;
  /** Layout mode — controls how the carousel renders this banner. */
  bannerType: BannerType;
  /** Data URL or remote URL of the banner image. Empty string = placeholder gradient.
   *  NOTE: in localStorage this field is stripped to "" when `imageKey` is
   *  set (the actual image data lives in IndexedDB). The in-memory copy
   *  is hydrated from IndexedDB via `hydrateImagesFromIDB()`. */
  image: string;
  /** IndexedDB key for the image (e.g. "banner-<uuid>"). When this is
   *  set, the student app looks up the image from IndexedDB instead of
   *  reading `image` directly. Keeps localStorage tiny. */
  imageKey?: string;
  /** If image is empty, this gradient is used as the visual background. */
  gradient: string;
  /** Icon key from the student app's icon set (used as fallback glyph over gradient). */
  iconKey: string;
  title: string;
  subtitle: string;
  /** Whether the banner is enabled (old field — kept for backward compat).
   *  When status is "archived", enabled is false. */
  enabled: boolean;
  /** Banner status — "active" shows in carousel, "archived" hides it. */
  status?: BannerStatus;
  displayOrder: number;
  /** Saved image positioning (drag + zoom) chosen in the admin image positioner. */
  transform: BannerImageTransform;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last edit. */
  updatedAt: string;
}

export type BannerInput = Omit<
  SponsoredBanner,
  "id" | "createdAt" | "updatedAt" | "transform" | "bannerType"
> & {
  transform?: Partial<BannerImageTransform>;
  bannerType?: BannerType;
};

export const BANNER_TRANSFORM_DEFAULT: BannerImageTransform = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
};

/**
 * MAX_ACTIVE_BANNERS — the carousel shows at most this many ACTIVE banners.
 * The banner LIBRARY is unlimited — archived banners don't count.
 */
export const MAX_ACTIVE_BANNERS = 5;

/** @deprecated Use MAX_ACTIVE_BANNERS instead. */
export const MAX_BANNERS = MAX_ACTIVE_BANNERS;

/**
 * Recommended banner export sizes.
 *
 * Each banner type has its own recommended export size because the image
 * fills a different area of the carousel frame:
 *
 *   - Full banner:  image fills the ENTIRE frame (aspect-ratio 5/2)
 *                   → 366×146 CSS px → 732×292 retina (5:2 ratio)
 *
 *   - Split banner: image fills only the 42% left visual panel
 *                   → 154×146 CSS px → 308×292 retina (~1:1 ratio)
 *
 * Designers should export at the retina size for crispness on high-DPI screens.
 * The carousel always uses `object-fit: cover` so the image fills the area
 * without stretching — slight cropping may occur if the exact ratio isn't used.
 */
export const RECOMMENDED_BANNER_FULL = {
  width: 732,
  height: 293,
  aspectRatio: "5:2",
  retinaScale: 2,
} as const;

export const RECOMMENDED_BANNER_SPLIT = {
  width: 308,
  height: 292,
  aspectRatio: "77:73",
  retinaScale: 2,
} as const;

/**
 * @deprecated Use RECOMMENDED_BANNER_FULL or RECOMMENDED_BANNER_SPLIT instead.
 * Kept for backward compatibility with code that still references the old
 * single-size constant.
 */
export const RECOMMENDED_BANNER = RECOMMENDED_BANNER_SPLIT;

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB (IndexedDB can handle large images)

export function makeBanner(input: BannerInput): SponsoredBanner {
  const now = new Date().toISOString();
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `banner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    bannerType: input.bannerType ?? DEFAULT_BANNER_TYPE,
    transform: { ...BANNER_TRANSFORM_DEFAULT, ...(input.transform || {}) },
    createdAt: now,
    updatedAt: now,
    image: input.image ?? "",
    imageKey: input.imageKey,
    gradient: input.gradient ?? "linear-gradient(135deg, oklch(58% 0.13 145), oklch(48% 0.10 165))",
    iconKey: input.iconKey ?? "biology",
    title: input.title ?? "",
    subtitle: input.subtitle ?? "",
    enabled: input.enabled ?? true,
    displayOrder: input.displayOrder ?? 99,
  };
}
