"use client";

/**
 * MaterialCardPreview
 * --------------------
 * Renders ONE material card exactly as students see it on the materials
 * page — full-bleed 16:9 image (or gradient fallback), bottom-up black
 * fade overlay, centered Arabic title + English caps subtitle, and a
 * state badge in the top-left corner.
 *
 * This is the React-side mirror of the student app's
 * `subjectCard()` HTML string in `MaterialsPage.js`. Both share the
 * same visual language (16:9 aspect, fade alpha from `fadeIntensity`,
 * white centered text) so what the admin sees here matches what
 * students will see after save.
 *
 * Used in the admin Materials page bottom strip — shows the currently
 * selected material (or its unsaved draft) so the admin can verify
 * image positioning + fade intensity before saving.
 */

import type { ContentItem } from "@/lib/admin/content-store";
import { BANNER_TRANSFORM_DEFAULT } from "@/lib/admin/banner-model";

interface Props {
  /** The material to render (null = empty placeholder). */
  item: ContentItem | null;
  /** Global fade overlay alpha (0–1). From the materials store. */
  fadeIntensity: number;
  /** Optional max width in px (the card itself stays 100% wide). */
  maxWidth?: number;
}

export function MaterialCardPreview({
  item,
  fadeIntensity,
  maxWidth,
}: Props) {
  if (!item) {
    return (
      <div
        className="grid aspect-[16/9] w-full place-items-center rounded-3xl border border-dashed border-border bg-muted/30 text-xs text-muted-foreground"
        style={maxWidth ? { maxWidth } : undefined}
      >
        اختر مادة لمعاينة شكلها النهائي
      </div>
    );
  }

  const hasImage = !!item.image && item.image.startsWith("data:");
  const transform = item.transform || BANNER_TRANSFORM_DEFAULT;
  const gradient = item.gradient || "linear-gradient(135deg, #1a3a5c, #0d1e30)";
  const isAvailable = item.available !== false;

  return (
    <div
      className="relative w-full overflow-hidden rounded-3xl border border-white/10 bg-card shadow-lg"
      style={{
        aspectRatio: "16 / 9",
        maxWidth,
        boxShadow: "0 24px 48px rgba(0,0,0,0.32)",
      }}
    >
      {/* Background layer — image or gradient */}
      <div
        className="absolute inset-0"
        style={hasImage ? { background: "#0a0d14" } : { background: gradient }}
      >
        {hasImage && (
          <img
            src={item.image}
            alt={item.label}
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{
              objectFit: "cover",
              transform: `translate(${transform.offsetX}%, ${transform.offsetY}%) scale(${transform.scale})`,
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
            isAvailable
              ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40"
              : "bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40"
          }`}
        >
          {isAvailable ? "متاح الآن" : "قريباً"}
        </span>
      </div>

      {/* Centered title block — bottom of card */}
      <div className="absolute inset-x-5 bottom-5 z-10 text-center">
        <h2
          className="m-0 text-2xl font-bold leading-snug text-white"
          style={{ textShadow: "0 2px 8px rgba(0,0,0,0.3)" }}
        >
          {item.label}
        </h2>
        {item.englishTitle && (
          <span className="mt-1 block text-xs font-medium uppercase tracking-[0.2em] text-white/70">
            {item.englishTitle}
          </span>
        )}
      </div>
    </div>
  );
}
