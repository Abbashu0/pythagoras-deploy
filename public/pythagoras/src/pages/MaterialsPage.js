import { pageHead } from "../components/PageHeader.js";
import { badge, icon } from "../scripts/icons.js";
import { getTestsSubjectView, screens, getTestSubjects, getMaterialsFadeIntensity } from "../scripts/data.js";

/**
 * subjectCard
 * ------------
 * Renders ONE material as a full-image card (16:9 aspect ratio).
 *
 * Layout (matches the student app's `.material-image-card` CSS in
 * tests.css):
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ [badge]                                       │
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
 * Image vs gradient:
 *   - If the admin uploaded a real image (data: URL), render it as an
 *     <img> with the saved transform (offset + scale) on top of a dark
 *     background. The image uses object-fit: cover so it always fills
 *     the frame regardless of source aspect ratio.
 *   - Otherwise, render the per-subject gradient as the card's
 *     background. The gradient is a per-material color the admin
 *     configures in the DEFAULT_MATERIALS table.
 *
 * Fade overlay:
 *   - A bottom-up black gradient whose alpha is controlled by the
 *     global `fadeIntensity` slider in the admin Materials manager
 *     (0–1, default 0.72). Higher = darker bottom, more legible white
 *     title text over busy images.
 *
 * @param {object}  subject        The material subject (from getTestSubjects()).
 * @param {number}  fadeIntensity  Global fade alpha (0–1).
 * @param {number}  delay          Stagger animation delay in ms.
 */
function subjectCard(subject, fadeIntensity, delay) {
  const hasImage = subject.image && subject.image.startsWith("data:");
  const transform = subject.transform || { offsetX: 0, offsetY: 0, scale: 1 };
  // When an image is present, the <img> paints the visual — leave the
  // wrapper background empty so the image isn't doubled. When there's
  // no image, the per-subject gradient paints the whole card.
  const bg = hasImage
    ? ""
    : subject.gradient || "linear-gradient(135deg, #1a3a5c, #0d1e30)";

  return `
    <button type="button" class="material-image-card stagger" style="animation-delay:${delay}ms" data-nav-to="${getTestsSubjectView(subject.id)}">
      <div class="material-image-bg" style="${hasImage ? '' : `background: ${bg};`}">
        ${hasImage ? `<img class="material-image-photo" src="${subject.image}" alt="${subject.title}" loading="lazy" style="object-fit: cover; transform: translate(${transform.offsetX}%, ${transform.offsetY}%) scale(${transform.scale});" />` : ''}
      </div>
      <div class="material-image-fade" style="background: linear-gradient(to top, rgba(0,0,0,${fadeIntensity}), rgba(0,0,0,0));"></div>
      <div class="material-image-content">
        <h2 class="material-image-title">${subject.title}</h2>
        <span class="material-image-subtitle">${subject.englishTitle || ''}</span>
      </div>
      <div class="material-image-badge">
        ${badge(subject.stateLabel || (subject.available !== false ? "متاح الآن" : "قريباً"), subject.available !== false ? "is-live" : "is-soon")}
      </div>
    </button>`;
}

export function materialsScreen() {
  const fade = getMaterialsFadeIntensity();
  return `
    ${pageHead(screens.materials)}
    <div class="materials-list">
      ${getTestSubjects().map((subject, index) => subjectCard(subject, fade, 120 + index * 50)).join("")}
    </div>`;
}
