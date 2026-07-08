import { pageHead } from "../components/PageHeader.js";
import { badge, icon } from "../scripts/icons.js";
import { getTestsSubjectView, screens, getTestSubjects } from "../scripts/data.js";

function subjectCard(subject, delay) {
  const isAvailable = subject.available !== false;
  return `
    <button type="button" class="material-card stagger" style="animation-delay:${delay}ms" data-nav-to="${getTestsSubjectView(subject.id)}">
      <div class="material-card-icon">${icon(subject.icon)}</div>
      <div class="material-card-body">
        <h2 class="material-card-title">${subject.title}</h2>
        <p class="material-card-desc">${subject.description || subject.pageDescription || ""}</p>
      </div>
      <div class="material-card-meta">
        ${badge(subject.stateLabel || (isAvailable ? "متاح الآن" : "قريباً"), isAvailable ? "is-live" : "is-soon")}
        <span class="material-card-arrow">${icon("chevron")}</span>
      </div>
    </button>`;
}

export function materialsScreen() {
  return `
    ${pageHead(screens.materials)}
    <div class="materials-list">
      ${getTestSubjects().map((subject, index) => subjectCard(subject, 120 + index * 40)).join("")}
    </div>`;
}
