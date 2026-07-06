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

export interface SponsoredBanner {
  id: string;
  /** Layout mode — controls how the carousel renders this banner. */
  bannerType: BannerType;
  /** Data URL or remote URL of the banner image. Empty string = placeholder gradient. */
  image: string;
  /** If image is empty, this gradient is used as the visual background. */
  gradient: string;
  /** Icon key from the student app's icon set (used as fallback glyph over gradient). */
  iconKey: string;
  title: string;
  subtitle: string;
  destination: string;
  enabled: boolean;
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

export const MAX_BANNERS = 5;

/**
 * Recommended banner export size.
 *
 * Derived from the student app's SponsoredCarouselCard layout:
 *   - frame aspect-ratio: 5/2
 *   - visual panel: 42% of frame width, 100% of frame height
 *
 * At a typical ~366px frame width, the visual panel renders at ~154×146 CSS px.
 * We recommend 2x retina exports → 308×292px.
 */
export const RECOMMENDED_BANNER = {
  width: 308,
  height: 292,
  aspectRatio: "77:73",
  retinaScale: 2,
} as const;

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB

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
    gradient: input.gradient ?? "linear-gradient(135deg, oklch(58% 0.13 145), oklch(48% 0.10 165))",
    iconKey: input.iconKey ?? "biology",
    title: input.title ?? "",
    subtitle: input.subtitle ?? "",
    destination: input.destination ?? "tests",
    enabled: input.enabled ?? true,
    displayOrder: input.displayOrder ?? 99,
  };
}
