import { pageHead } from "../components/PageHeader.js";
import { badge, icon } from "../scripts/icons.js";
import { getTestsSubjectView, screens, getTestSubjects } from "../scripts/data.js";

function subjectCard(subject, delay) {
  return `
    <button type="button" class="subject-card stagger" style="animation-delay:${delay}ms" data-nav-to="${getTestsSubjectView(subject.id)}">
      <div class="subject-card-head">
        <div class="subject-card-copy">
          <h2 class="subject-card-title">${subject.title}</h2>
          <p class="subject-card-text">${subject.description}</p>
        </div>
        <div class="icon-wrap featured subject-card-icon">${icon(subject.icon)}</div>
      </div>
      <div class="subject-card-foot">
        ${badge(subject.stateLabel, "is-soon")}
        <span class="subject-card-arrow">${icon("chevron")}</span>
      </div>
    </button>`;
}

export function testsSubjectsScreen() {
  return `
    ${pageHead(screens.tests, {
      backView: "tools",
      backLabel: "الرجوع إلى الأدوات",
      useFloatingBackButton: true,
      reserveBackSpace: true,
    })}
    <div class="tests-subjects-stack">
      <section class="subjects-grid" aria-label="مواد الاختبارات">
        ${getTestSubjects().map((subject, index) => subjectCard(subject, 120 + index * 35)).join("")}
      </section>
    </div>`;
}
