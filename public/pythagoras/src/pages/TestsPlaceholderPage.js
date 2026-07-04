import { pageHead } from "../components/PageHeader.js";
import { screens } from "../scripts/data.js";
import { badge, icon } from "../scripts/icons.js";

export function testsScreen() {
  return `
    ${pageHead(screens.tests)}
    <div class="tests-stack">
      <section class="tests-card stagger" style="animation-delay:120ms">
        <div class="featured-head">
          <div class="featured-copy">
            <h2 class="tests-title">سنبني تجربة الاختبارات في الخطوة التالية</h2>
            <p class="tests-text">هنا سيختار الطالب المادة ثم يدخل إلى بنك الأسئلة أو يصنع اختبارًا مخصصًا.</p>
          </div>
          <div class="icon-wrap featured">${icon("tests")}</div>
        </div>
        <div class="card-foot">
          ${badge("الخطوة التالية", "is-live")}
          <span class="tool-hint">جاهز للتوسع لاحقًا</span>
        </div>
      </section>
      <section class="tests-card stagger" style="animation-delay:170ms">
        <h3 class="section-title">ما سيأتي لاحقًا</h3>
        <div class="tests-list">
          <div class="tests-list-item">اختيار المادة والوصول إلى بنك الأسئلة أو إنشاء اختبار مخصص.</div>
          <div class="tests-list-item">فصل المسارات بين التصفح، الاختبار النشط، والتدريب على الرسومات.</div>
          <div class="tests-list-item">الحفاظ على نفس اللغة البصرية الهادئة في كل الصفحات.</div>
        </div>
      </section>
    </div>`;
}
