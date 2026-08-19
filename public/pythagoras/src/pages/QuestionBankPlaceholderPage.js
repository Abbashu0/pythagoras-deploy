import { pageHead } from "../components/PageHeader.js";
import { screens } from "../scripts/data.js";
import { icon } from "../scripts/icons.js";

export function renderQuestionBankPlaceholder() {
  return `
    ${pageHead(screens.questions, { backView: "tests", backLabel: "الرجوع إلى المواد", reserveBackSpace: true })}
    <div class="placeholder-wrap">
      <section class="placeholder-card stagger" style="animation-delay:120ms">
        <div class="icon-wrap placeholder featured">${icon("tests")}</div>
        <h2 class="placeholder-title">بنك الأسئلة قيد البناء</h2>
        <p class="placeholder-text">سيُبنى نظام بنك الأسئلة الجديد لاحقًا بعد توفير البيانات والمواصفات.</p>
      </section>
    </div>`;
}
