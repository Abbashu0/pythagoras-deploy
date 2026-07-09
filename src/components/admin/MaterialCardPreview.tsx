"use client";

/**
 * MaterialCardPreview
 * --------------------
 * Renders ONE material card exactly as students see it on the materials
 * page — full-bleed image (or gradient fallback) at a configurable
 * height, bottom-up black fade overlay, centered Arabic title + English
 * caps subtitle, and a state badge in the top-left corner.
 *
 * This is the React-side mirror of the student app's material card.
 * Both share the same visual language so what the admin sees here
 * matches what students will see after save.
 *
 * Props are intentionally split (instead of taking a `ContentItem`)
 * so the parent can render an unsaved DRAFT directly — including
 * live-previewing the four global appearance settings:
 *
 *   - fadeIntensity        (0..1)    bottom-up black overlay alpha
 *   - textVerticalPosition (-100..+100)  vertical offset of title block
 *                                        0 = centered, +100 = top, -100 = bottom
 *   - textScale            (0.8..1.4)    multiplier on title font sizes
 *   - cardHeight           (160..340 px) fixed card height
 *
 * The card has a fixed pixel height (no aspect-ratio) so the slider's
 * effect is immediately visible without being affected by the parent's
 * width.
 *
 * Used in the admin Materials page bottom strip — shows the currently
 * selected material (or its unsaved draft) so the admin can verify
 * image positioning + all four appearance settings before saving.
 */

import type { BannerImageTransform } from "@/lib/admin/banner-model";
import { BANNER_TRANSFORM_DEFAULT } from "@/lib/admin/banner-model";

interface Props {
  /** Data URL of the uploaded card image. Empty/undefined = gradient fallback. */
  image?: string;
  /** Fallback CSS background (gradient) shown when no image is uploaded. */
  gradient?: string;
  /** Image positioning { offsetX, offsetY, scale }. */
  transform?: BannerImageTransform;
  /** Arabic title shown centered on the card. */
  title?: string;
  /** English caps subtitle (e.g. "BIOLOGY"). */
  englishTitle?: string;
  /** Global fade overlay alpha (0..1). */
  fadeIntensity: number;
  /** Vertical offset of the title block (-100..+100). 0 = centered. */
  textVerticalPosition: number;
  /** Title font scale multiplier (0.8..1.4). */
  textScale: number;
  /** Fixed card height in px (160..340). */
  cardHeight: number;
  /** Whether the material is available to students (controls the badge). */
  available?: boolean;
  /** Optional max width in px (the card itself stays 100% wide). */
  maxWidth?: number;
}

export function MaterialCardPreview({
  image,
  gradient,
  transform,
  title,
  englishTitle,
  fadeIntensity,
  textVerticalPosition,
  textScale,
  cardHeight,
  available = true,
  maxWidth,
}: Props) {
  // Empty placeholder when there's nothing to render.
  if (!title && !image && !gradient) {
    return (
      <div
        className="grid w-full place-items-center rounded-3xl border border-dashed border-border bg-muted/30 text-xs text-muted-foreground"
        style={{
          height: cardHeight,
          maxWidth,
        }}
      >
        اختر مادة لمعاينة شكلها النهائي
      </div>
    );
  }

  const hasImage = !!image && image.startsWith("data:");
  const tf = transform || BANNER_TRANSFORM_DEFAULT;
  const bg = gradient || "linear-gradient(135deg, #1a3a5c, #0d1e30)";

  // Vertical position: -100 = bottom, 0 = centered, +100 = top.
  // The title block's CENTER is placed at:
  //   50% + (textVerticalPosition * 0.5)% from the top
  // (so +100 → 100% → bottom, -100 → 0% → top — wait, that's reversed).
  //
  // Actually: we want +100 = TOP and -100 = BOTTOM (the slider's positive
  // direction is "up" on screen). So:
  //   top% = 50% - (textVerticalPosition * 0.5)%
  //     +100 → 0%  (top of card)     ✓
  //     -100 → 100% (bottom of card)  ✓
  //      0   → 50%  (centered)        ✓
  // Combined with translateY(-50%), the element's CENTER lands at `top%`.
  const topPercent = 50 - textVerticalPosition * 0.5;

  // Base font sizes (in rem) — scaled by textScale.
  const arabicFontSize = `${1.5 * textScale}rem`;
  const englishFontSize = `${0.75 * textScale}rem`;
  const englishMarginTop = `${0.25 * textScale}rem`;

  return (
    <div
      className="relative w-full overflow-hidden rounded-3xl border border-white/10 bg-card shadow-lg"
      style={{
        height: cardHeight,
        maxWidth,
        boxShadow: "0 24px 48px rgba(0,0,0,0.32)",
      }}
    >
      {/* Background layer — image or gradient */}
      <div
        className="absolute inset-0"
        style={hasImage ? { background: "#0a0d14" } : { background: bg }}
      >
        {hasImage && (
          <img
            src={image}
            alt={title || ""}
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{
              objectFit: "cover",
              transform: `translate(${tf.offsetX}%, ${tf.offsetY}%) scale(${tf.scale})`,
              transformOrigin: "center",
            }}
            draggable={false}
          />
        )}
      </div>

      {/* Fade overlay — bottom-up black gradient with the global alpha */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(to top, rgba(0,0,0,${fadeIntensity}), rgba(0,0,0,0))`,
        }}
      />

      {/* State badge — top-left */}
      <div className="absolute left-4 top-4 z-10">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
            available
              ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40"
              : "bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40"
          }`}
        >
          {available ? "متاح الآن" : "قريباً"}
        </span>
      </div>

      {/* Centered title block — vertical position adjustable via slider */}
      <div
        className="pointer-events-none absolute inset-x-5 z-10 text-center"
        style={{
          top: `${topPercent}%`,
          transform: "translateY(-50%)",
        }}
      >
        {title && (
          <h2
            className="m-0 font-bold leading-snug text-white"
            style={{
              fontSize: arabicFontSize,
              textShadow: "0 2px 8px rgba(0,0,0,0.3)",
            }}
          >
            {title}
          </h2>
        )}
        {englishTitle && (
          <span
            className="block font-medium uppercase tracking-[0.2em] text-white/70"
            style={{
              fontSize: englishFontSize,
              marginTop: englishMarginTop,
            }}
          >
            {englishTitle}
          </span>
        )}
      </div>
    </div>
  );
}
