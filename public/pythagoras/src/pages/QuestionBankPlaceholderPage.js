import { pageHead } from "../components/PageHeader.js";
import { getTestsSubjectView, screens } from "../scripts/data.js";
import { icon } from "../scripts/icons.js";

export function renderQuestionBankPlaceholder(subject) {
  const meta = {
    ...screens.questions,
    eyebrow: subject.title,
    copy: `سيتم بناء بنك أسئلة ${subject.title} على الأساس الجديد في مرحلة لاحقة.`,
  };
  return `
    ${pageHead(meta, { backView: getTestsSubjectView(subject.id), backLabel: `الرجوع إلى ${subject.title}`, reserveBackSpace: true })}
    <div class="placeholder-wrap">
      <section class="placeholder-card stagger" style="animation-delay:120ms">
        <div class="icon-wrap placeholder featured">${icon("tests")}</div>
        <h2 class="placeholder-title">بنك الأسئلة قيد البناء</h2>
        <p class="placeholder-text">هذه المساحة مخصّصة لبنك أسئلة ${subject.title}. لا توجد بيانات أسئلة منشورة حاليًا.</p>
      </section>
    </div>`;
}
