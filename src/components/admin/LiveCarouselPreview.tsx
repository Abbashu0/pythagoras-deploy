"use client";

/**
 * LiveCarouselPreview
 * -------------------
 * A pixel-faithful desktop re-creation of the student app's SponsoredCarouselCard
 * (see public/pythagoras/src/components/SponsoredCarouselCard.js).
 *
 * Renders each banner according to its `bannerType`:
 *
 *   - "full":  One single image fills the entire frame edge-to-edge (object-fit: cover).
 *              No title, no subtitle, no icon. The image IS the banner.
 *
 *   - "split": Image on the left visual panel (42%) + title/subtitle on the right (58%).
 *              The original layout.
 *
 * The preview always shows the FIRST enabled banner (static, no auto-rotation)
 * so the admin can see exactly what students will see for that specific banner.
 */

import { SponsoredBanner } from "@/lib/admin/banner-model";

interface Props {
  banners: SponsoredBanner[];
  /** Constrain width to match the student app's mobile card (~366px). */
  width?: number;
}

export function LiveCarouselPreview({ banners, width = 366 }: Props) {
  const active = banners[0]; // just show the first banner statically for preview
  if (!active) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl border border-dashed text-xs text-muted-foreground"
        style={{ width, aspectRatio: "5 / 2" }}
      >
        لا توجد بانرات لعرضها
      </div>
    );
  }

  const isFull = active.bannerType === "full";
  const hasImage = active.image && active.image.length > 0;
  const isImageDataUrl = hasImage && (active.image.startsWith("data:") || active.image.startsWith("http"));

  return (
    <div
      className="relative rounded-[30px] border p-3"
      style={{
        width,
        background:
          "linear-gradient(180deg, color-mix(in oklab, #4f9cff 6%, transparent), transparent 60%), #0f131c",
        borderColor: "color-mix(in oklab, #4f9cff 18%, #2a3142)",
        boxShadow: "0 18px 38px rgba(0,0,0,0.10)",
      }}
    >
      <div
        className="relative overflow-hidden rounded-[24px]"
        style={{
          aspectRatio: "5 / 2",
          background: "rgba(255,255,255,0.04)",
        }}
      >
        {isFull ? (
          // ---------- Full Banner: image fills entire frame ----------
          hasImage ? (
            isImageDataUrl ? (
              <img
                src={active.image}
                alt={active.title || "banner"}
                draggable={false}
                className="absolute inset-0 h-full w-full select-none"
                style={{
                  objectFit: "cover",
                  objectPosition: `${50 + active.transform.offsetX}% ${
                    50 + active.transform.offsetY
                  }%`,
                  transform: `scale(${active.transform.scale})`,
                  transformOrigin: "center",
                }}
              />
            ) : (
              // Full banner with gradient (no uploaded image) — show gradient + icon as fallback
              <div
                className="absolute inset-0"
                style={{
                  background:
                    active.gradient ||
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
            )
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
                background: hasImage
                  ? undefined
                  : active.gradient ||
                    "linear-gradient(135deg, #4f9cff, #2a6fcc)",
              }}
            >
              {hasImage && isImageDataUrl ? (
                <img
                  src={active.image}
                  alt={active.title}
                  draggable={false}
                  className="absolute inset-0 h-full w-full select-none"
                  style={{
                    objectFit: "cover",
                    objectPosition: `${50 + active.transform.offsetX}% ${
                      50 + active.transform.offsetY
                    }%`,
                    transform: `scale(${active.transform.scale})`,
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
                {active.title || "بدون عنوان"}
              </h3>
              <p
                className="leading-snug"
                style={{
                  fontSize: "12px",
                  lineHeight: 1.5,
                  color: "rgba(255,255,255,0.65)",
                }}
              >
                {active.subtitle || "بدون وصف"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Indicators */}
      <div
        className="flex items-center justify-center gap-1.5 pt-2.5"
        dir="ltr"
      >
        {banners.map((b, i) => (
          <span
            key={b.id}
            className="rounded-full"
            style={{
              width: i === 0 ? 18 : 6,
              height: 6,
              background:
                i === 0
                  ? "#4f9cff"
                  : "color-mix(in oklab, white 22%, #2a3142)",
              opacity: i === 0 ? 1 : 0.7,
              transition: "width 280ms cubic-bezier(0.22,1,0.36,1), background 280ms",
            }}
          />
        ))}
      </div>
    </div>
  );
}
