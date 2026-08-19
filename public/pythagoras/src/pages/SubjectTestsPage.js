import { pageHead } from "../components/PageHeader.js";
import { badge, icon } from "../scripts/icons.js";
import { getViewMeta } from "../scripts/data.js";

function actionCard({ title, description, iconName, message, navTo, className = "" }) {
  const classes = ["subject-action-card", className].filter(Boolean).join(" ");
  const actionAttribute = navTo ? `data-nav-to="${navTo}"` : `data-tests-action-message="${message}"`;

  return `
    <button type="button" class="${classes}" ${actionAttribute}>
      <div class="subject-action-head">
        <div class="subject-action-copy">
          <h3 class="subject-action-title">${title}</h3>
          <p class="subject-action-text">${description}</p>
        </div>
        <div class="icon-wrap ${className.includes("is-secondary") ? "" : "featured"} subject-action-icon">${icon(iconName)}</div>
      </div>
    </button>`;
}

export function subjectTestsScreen(subject) {
  const meta = getViewMeta(`tests-${subject.id}`);

  return `
    ${pageHead(meta, {
      backView: "tests",
      backLabel: "الرجوع إلى صفحة الاختبارات",
      useFloatingBackButton: true,
      reserveBackSpace: true,
    })}
    <div class="subject-tests-stack">
      <button type="button" class="subject-hero-card stagger" style="animation-delay:120ms" data-tests-action-message="سنبدأ ببناء إعداد الاختبار في الخطوة التالية.">
        <div class="subject-hero-head">
          <div class="subject-hero-copy">
            <h2 class="subject-hero-title">اصنع اختبارك</h2>
            <p class="subject-hero-text">اختر لاحقًا الفصل، الموضوع، نوع السؤال، وعدد الأسئلة لبناء اختبار مناسب لك.</p>
          </div>
          <div class="icon-wrap featured subject-hero-icon">${icon(subject.icon)}</div>
        </div>
        <div class="subject-hero-foot">
          ${badge("المسار الأساسي", "is-live")}
          <div class="subject-hero-meta">
            <span class="subject-hero-meta-label">إحصائيات المادة</span>
            <span class="subject-hero-meta-value">ستظهر هنا لاحقًا</span>
          </div>
        </div>
      </button>

      <section class="subject-actions-grid stagger" style="animation-delay:180ms">
        ${actionCard({
          title: "بنك الأسئلة",
          description: "تصفح أسئلة المادة حسب الفصل والموضوع ونوع السؤال لاحقًا.",
          iconName: "tests",
          navTo: "questions",
          className: "is-secondary",
        })}
        ${actionCard({
          title: "سجل الاختبارات",
          description: "ستظهر هنا محاولاتك ونتائجك السابقة لاحقًا.",
          iconName: "repeat",
          message: "سيظهر سجل الاختبارات لاحقًا.",
          className: "is-secondary",
        })}
      </section>

      <div class="subject-actions-single stagger" style="animation-delay:220ms">
        ${actionCard({
          title: "الأسئلة المفضلة",
          description: "الأسئلة التي تحفظها للمراجعة السريعة ستظهر هنا لاحقًا.",
          iconName: "notes",
          message: "ستظهر الأسئلة المفضلة لاحقًا.",
          className: "is-wide",
        })}
      </div>

      ${subject.hasDiagramPractice ? `
        <div class="subject-actions-single stagger" style="animation-delay:260ms">
          ${actionCard({
            title: "الاختبار بالرسومات",
            description: "تدريب خاص على الرسومات والمخططات الخاصة بمادة الأحياء.",
            iconName: "biology",
            message: "سيتم بناء تدريب الرسومات لاحقًا.",
            className: "is-wide is-diagram",
          })}
        </div>` : ""}
    </div>`;
}
