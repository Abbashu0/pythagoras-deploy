import { pageHead } from "../components/PageHeader.js";
import { icon } from "../scripts/icons.js";
import {
  getTestsSubjectView,
  screens,
  getTestSubjects,
  getMaterialsFadeIntensity,
  getMaterialsSettings,
  isDisplayableImageSource,
} from "../scripts/data.js";

/**
 * subjectCard
 * ------------
 * Renders ONE material as a full-image card.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │                                               │
 *   │              <full-bleed image>               │
 *   │                  OR                           │
 *   │              <gradient fallback>              │
 *   │                                               │
 *   │                  ─── fade ───                 │
 *   │               ARABIC TITLE                    │
 *   │                ENGLISH CAPS                   │
 *   └──────────────────────────────────────────────┘
 *
 * No status badges are shown — the badge data stays in the admin only.
 *
 * Global settings (from admin, read via getMaterialsSettings()):
 *   - fadeIntensity: 0–1, default 0.72
 *   - textVerticalPosition: -100 to +100, default 0
 *   - textScale: 0.8 to 1.4, default 1
 *   - cardHeight: 160–340px, default 213 (16:9 at ~378px width)
 */
function subjectCard(subject, settings, delay) {
  const hasImage = isDisplayableImageSource(subject.image);
  const transform = subject.transform || { offsetX: 0, offsetY: 0, scale: 1 };
  const bg = hasImage
    ? ""
    : subject.gradient || "linear-gradient(135deg, #1a3a5c, #0d1e30)";

  // Apply global settings
  const fade = settings.fadeIntensity;
  const textY = settings.textVerticalPosition;
  const textScale = settings.textScale;
  const cardHeight = settings.cardHeight;

  // Text positioning: vertical offset in px from default bottom position
  // textY range: -100 (top) to +100 (bottom). 0 = default (bottom: 20px)
  const textBottom = 20 + (textY * 0.8); // scale to reasonable px range

  // Text sizes: Arabic base 1.5rem, English base 0.75rem
  const arabicSize = (1.5 * textScale).toFixed(3);
  const englishSize = (0.75 * textScale).toFixed(3);

  return `
    <button type="button" class="material-image-card stagger" style="animation-delay:${delay}ms; height: ${cardHeight}px;" data-nav-to="${getTestsSubjectView(subject.id)}">
      <div class="material-image-bg" style="${hasImage ? '' : `background: ${bg};`}">
        ${hasImage ? `<img class="material-image-photo" src="${subject.image}" alt="${subject.title}" loading="lazy" style="object-fit: contain; transform: translate(${transform.offsetX}%, ${transform.offsetY}%) scale(${transform.scale});" />` : ''}
      </div>
      <div class="material-image-fade" style="background: linear-gradient(to top, rgba(0,0,0,${fade}), rgba(0,0,0,0));"></div>
      <div class="material-image-content" style="bottom: ${textBottom}px;">
        <h2 class="material-image-title" style="font-size: ${arabicSize}rem;">${subject.title}</h2>
        <span class="material-image-subtitle" style="font-size: ${englishSize}rem;">${subject.englishTitle || ''}</span>
      </div>
    </button>`;
}

export function materialsScreen() {
  const settings = getMaterialsSettings();
  return `
    ${pageHead(screens.materials)}
    <div class="materials-list">
      ${getTestSubjects().map((subject, index) => subjectCard(subject, settings, 120 + index * 50)).join("")}
    </div>`;
}
