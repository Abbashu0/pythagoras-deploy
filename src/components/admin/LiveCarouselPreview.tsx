"use client";

/**
 * LiveCarouselPreview
 * -------------------
 * A pixel-faithful desktop preview of the canonical banner presentation used by
 * the Admin workspace.
 *
 * Renders a SINGLE banner (the one passed via the `banner` prop) according
 * to its `bannerType`:
 *
 *   - "full":  One single image fills the entire frame edge-to-edge (object-fit: cover).
 *              No title, no subtitle, no icon. The image IS the banner.
 *              The image's `transform` (translate + scale) is applied so the
 *              admin sees EXACTLY what students will see.
 *
 *   - "split": Image on the left visual panel (42%) + title/subtitle on the right (58%).
 *              The original layout.
 *
 * The optional `allBanners` array is used ONLY for the pagination dots count
 * (so the dots reflect how many banners exist in the carousel). The actual
 * rendered banner is always the one passed via `banner`.
 *
 * The pagination indicator is a floating glassmorphism capsule at the bottom
 * of the frame, matching the student app's iOS-style pill.
 */

import { SponsoredBanner } from "@/lib/admin/banner-model";
import { CAROUSEL_PREVIEW_WIDTH } from "@/lib/admin/dimensions";

interface Props {
  /** The banner to render. If null, shows an empty-state placeholder. */
  banner: SponsoredBanner | null;
  /** Optional — used only to render the correct number of pagination dots. */
  allBanners?: SponsoredBanner[];
  /**
   * Constrain width to match the student app's actual content width.
   * Defaults to CAROUSEL_PREVIEW_WIDTH (394px) — the exact width of
   * the carousel frame on a 430px student-app device.
   */
  width?: number;
}

export function LiveCarouselPreview({
  banner,
  allBanners,
  width = CAROUSEL_PREVIEW_WIDTH,
}: Props) {
  if (!banner) {
    return (
      <div
        className="flex items-center justify-center rounded-[30px] border border-dashed text-xs text-muted-foreground"
        style={{
          width,
          aspectRatio: "5 / 2",
          background: "#0f131c",
          borderColor: "color-mix(in oklab, #4f9cff 18%, #2a3142)",
        }}
      >
        لا توجد بانرات لعرضها
      </div>
    );
  }

  const isFull = banner.bannerType === "full";
  const hasImage = banner.image && banner.image.length > 0;
  const isImageDataUrl = hasImage;

  // Pagination dots — count comes from allBanners (or 1 if not provided).
  // The active dot is always index 0 (we always render the same banner).
  const dotsCount = allBanners?.length || 1;

  return (
    <div
      className="relative overflow-hidden rounded-[30px] border"
      style={{
        width,
        background: "#0f131c",
        borderColor: "color-mix(in oklab, #4f9cff 18%, #2a3142)",
        boxShadow: "0 18px 38px rgba(0,0,0,0.10)",
      }}
    >
      {/* Frame — 5:2 aspect, no padding */}
      <div
        className="relative overflow-hidden"
        style={{
          aspectRatio: "5 / 2",
          background: "rgba(255,255,255,0.04)",
        }}
      >
        {isFull ? (
          // ---------- Full Banner: image fills entire frame ----------
          hasImage && isImageDataUrl ? (
            <img
              src={banner.image}
              alt={banner.title || "banner"}
              draggable={false}
              className="absolute inset-0 h-full w-full select-none"
              style={{
                objectFit: "contain",
                // Use translate + scale (NOT object-position) — consistent
                // with the editor's ImagePositioner transform values.
                transform: `translate(${banner.transform.offsetX}%, ${banner.transform.offsetY}%) scale(${banner.transform.scale})`,
                transformOrigin: "center",
              }}
            />
          ) : // Full banner with gradient (no uploaded image) — show gradient + icon as fallback
          hasImage ? (
            <div
              className="absolute inset-0"
              style={{
                background:
                  banner.gradient ||
                  "linear-gradient(135deg, #4f9cff, #2a6fcc)",
              }}
            >
              <div className="grid h-full place-items-center">
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="rgba(255,255,255,0.95)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.25))" }}
                >
                  <rect x="5" y="4.5" width="14" height="17" rx="3" />
                  <path d="M9 9.5h6" />
                  <path d="M9 13.5h3" />
                  <path d="m9.5 17 1.8 1.8L15.5 14.5" />
                </svg>
              </div>
            </div>
          ) : (
            // Full banner with no image at all — show placeholder
            <div className="grid h-full place-items-center text-xs text-white/40">
              ارفع صورة لملء الإطار بالكامل
            </div>
          )
        ) : (
          // ---------- Split Banner: image left + copy right ----------
          <div className="grid h-full" style={{ gridTemplateColumns: "42% 1fr" }}>
            <div
              className="relative overflow-hidden"
              style={{
                background:
                  hasImage && isImageDataUrl
                    ? undefined
                    : banner.gradient ||
                      "linear-gradient(135deg, #4f9cff, #2a6fcc)",
              }}
            >
              {hasImage && isImageDataUrl ? (
                <img
                  src={banner.image}
                  alt={banner.title}
                  draggable={false}
                  className="absolute inset-0 h-full w-full select-none"
                  style={{
                    objectFit: "contain",
                    transform: `translate(${banner.transform.offsetX}%, ${banner.transform.offsetY}%) scale(${banner.transform.scale})`,
                    transformOrigin: "center",
                  }}
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center">
                  <svg
                    width="36"
                    height="36"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="rgba(255,255,255,0.95)"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.25))" }}
                  >
                    <rect x="5" y="4.5" width="14" height="17" rx="3" />
                    <path d="M9 9.5h6" />
                    <path d="M9 13.5h3" />
                    <path d="m9.5 17 1.8 1.8L15.5 14.5" />
                  </svg>
                </div>
              )}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.22), transparent 60%)",
                }}
              />
            </div>

            <div
              className="grid content-center gap-1 text-right"
              style={{ padding: "10px 14px" }}
              dir="rtl"
            >
              <span
                className="font-mono uppercase tracking-wider text-[#4f9cff]"
                style={{ fontSize: "9px", letterSpacing: "0.16em", opacity: 0.85 }}
              >
                محتوى مميّز
              </span>
              <h3
                className="font-semibold leading-tight text-white"
                style={{ fontSize: "15px" }}
              >
                {banner.title || "بدون عنوان"}
              </h3>
              <p
                className="leading-snug"
                style={{
                  fontSize: "12px",
                  lineHeight: 1.5,
                  color: "rgba(255,255,255,0.65)",
                }}
              >
                {banner.subtitle || "بدون وصف"}
              </p>
            </div>
          </div>
        )}

        {/* Floating glassmorphism pagination capsule */}
        <div
          className="absolute flex items-center gap-1.5"
          dir="ltr"
          style={{
            bottom: 10,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.35)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            borderRadius: 999,
            padding: "5px 9px",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {Array.from({ length: dotsCount }).map((_, i) => (
            <span
              key={i}
              className="rounded-full"
              style={{
                width: i === 0 ? 18 : 6,
                height: 6,
                background:
                  i === 0
                    ? "#ffffff"
                    : "rgba(255,255,255,0.45)",
                transition:
                  "width 280ms cubic-bezier(0.22,1,0.36,1), background 280ms",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
