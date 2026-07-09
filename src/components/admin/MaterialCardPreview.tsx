"use client";

/**
 * MaterialCardPreview — WYSIWYG preview of a material card.
 *
 * This component renders the EXACT same HTML structure, CSS classes,
 * inline styles, and positioning formulas as the student app's
 * MaterialsPage.js `subjectCard()` function. Both use:
 *
 *   - Same class names: material-image-card, material-image-bg,
 *     material-image-photo, material-image-fade, material-image-content,
 *     material-image-title, material-image-subtitle
 *   - Same CSS from tests.css (border-radius, shadows, transitions)
 *   - Same inline style formulas for height, fade, text position, text scale
 *   - Same transform: translate(X%, Y%) scale(s) for images
 *
 * The ONLY difference: this is a React component (JSX) instead of a
 * template string, and it's not a <button> (no navigation in preview).
 * Everything else is identical.
 *
 * The CSS classes (material-image-card etc.) are defined in the student
 * app's tests.css which is loaded globally via the Next.js layout.
 * If they're NOT loaded in admin context, we also apply inline styles
 * as a fallback so the card looks correct even without the CSS file.
 */

import type { BannerImageTransform } from "@/lib/admin/banner-model";
import { BANNER_TRANSFORM_DEFAULT } from "@/lib/admin/banner-model";

interface Props {
  image?: string;
  gradient?: string;
  transform?: BannerImageTransform;
  title?: string;
  englishTitle?: string;
  fadeIntensity: number;
  textVerticalPosition: number;
  textScale: number;
  cardHeight: number;
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
  maxWidth,
}: Props) {
  // Empty placeholder
  if (!title && !image && !gradient) {
    return (
      <div
        style={{
          width: "100%",
          height: `${cardHeight}px`,
          maxWidth: maxWidth ? `${maxWidth}px` : undefined,
          borderRadius: "24px",
          border: "1px dashed #ccc",
          display: "grid",
          placeItems: "center",
          fontSize: "12px",
          color: "#999",
          background: "rgba(128,128,128,0.05)",
        }}
      >
        اختر مادة لمعاينة شكلها النهائي
      </div>
    );
  }

  const hasImage = !!image && image.startsWith("data:");
  const tf = transform || BANNER_TRANSFORM_DEFAULT;
  const bg = gradient || "linear-gradient(135deg, #1a3a5c, #0d1e30)";

  // === EXACT SAME FORMULAS AS MaterialsPage.js ===
  const fade = fadeIntensity;
  const textY = textVerticalPosition;
  const textBottom = 20 + (textY * 0.8); // px from bottom
  const arabicSize = (1.5 * textScale).toFixed(3);
  const englishSize = (0.75 * textScale).toFixed(3);

  return (
    <div
      // Same class name as student app — picks up CSS from tests.css
      className="material-image-card"
      // Same inline styles as student app's subjectCard()
      style={{
        height: `${cardHeight}px`,
        maxWidth: maxWidth ? `${maxWidth}px` : undefined,
        // Fallback inline styles (in case tests.css isn't loaded in admin)
        position: "relative",
        width: "100%",
        borderRadius: "24px",
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "var(--shadow-md, 0 18px 40px rgba(0,0,0,0.24))",
        background: "var(--surface-soft, #1a1d2a)",
        cursor: "default", // not clickable in preview
      }}
    >
      {/* Background layer — same as student app */}
      <div
        className="material-image-bg"
        style={{
          position: "absolute",
          inset: "0",
          ...(hasImage ? {} : { background: bg }),
        }}
      >
        {hasImage && (
          <img
            className="material-image-photo"
            src={image}
            alt={title || ""}
            loading="lazy"
            draggable={false}
            style={{
              position: "absolute",
              inset: "0",
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `translate(${tf.offsetX}%, ${tf.offsetY}%) scale(${tf.scale})`,
              transformOrigin: "center center",
            }}
          />
        )}
      </div>

      {/* Fade overlay — same as student app */}
      <div
        className="material-image-fade"
        style={{
          position: "absolute",
          inset: "0",
          pointerEvents: "none",
          background: `linear-gradient(to top, rgba(0,0,0,${fade}), rgba(0,0,0,0))`,
        }}
      />

      {/* Text content — same as student app */}
      <div
        className="material-image-content"
        style={{
          position: "absolute",
          bottom: `${textBottom}px`,
          right: "20px",
          left: "20px",
          textAlign: "center",
          zIndex: 2,
        }}
      >
        <h2
          className="material-image-title"
          style={{
            margin: "0",
            fontSize: `${arabicSize}rem`,
            fontWeight: "700",
            lineHeight: "1.3",
            color: "#ffffff",
            textShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}
        >
          {title}
        </h2>
        <span
          className="material-image-subtitle"
          style={{
            display: "block",
            fontSize: `${englishSize}rem`,
            fontWeight: "500",
            color: "rgba(255,255,255,0.7)",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            marginTop: "4px",
          }}
        >
          {englishTitle || ""}
        </span>
      </div>
    </div>
  );
}
