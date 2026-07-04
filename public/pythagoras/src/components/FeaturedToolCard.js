import { badge, icon } from "../scripts/icons.js";

export function featuredCard() {
  return `
    <button type="button" class="featured-card stagger" style="animation-delay:120ms" data-nav-to="tests">
      <div class="featured-head">
        <div class="featured-copy">
          <h2 class="featured-title">الاختبارات جاهزة كبداية إنتاجية</h2>
          <p class="featured-text">ابدأ من المسار الأوضح الآن: بنك الأسئلة والاختبارات المخصصة حسب المادة والفصل والموضوع ونوع السؤال.</p>
        </div>
        <div class="icon-wrap featured">${icon("tests")}</div>
      </div>
      <div class="card-foot">
        ${badge("متاح الآن", "is-live")}
        <div class="hint-link">ابدأ من هنا <span>←</span></div>
      </div>
    </button>`;
}
