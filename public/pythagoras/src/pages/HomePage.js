import { badge, icon } from "../scripts/icons.js";
import { pageHead } from "../components/PageHeader.js";
import { screens, getSponsoredBanners } from "../scripts/data.js";
import { sponsoredCarouselCard } from "../components/SponsoredCarouselCard.js";

export function homeScreen() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "صباح الخير" : hour < 18 ? "مساء الخير" : "مساء النور";

  // Read live banners from the admin store (localStorage) on every render so
  // edits made in /admin are reflected immediately after a page refresh.
  // Falls back to the hard-coded seed if the admin store is empty.
  const banners = getSponsoredBanners();

  return `
    ${pageHead(screens.home)}
    <div class="home-stack">
      <div class="home-greeting stagger" style="animation-delay:110ms">
        <div class="greeting-text">${greeting} 👋</div>
        <div class="greeting-sub">جاهز لجلسة دراسة اليوم؟</div>
      </div>

      ${sponsoredCarouselCard(banners)}

      <button type="button" class="featured-card stagger" style="animation-delay:150ms" data-nav-to="tests">
        <div class="featured-head">
          <div class="featured-copy">
            <h2 class="featured-title">الاختبارات جاهزة</h2>
            <p class="featured-text">ابدأ بنك الأسئلة الآن وتدرب على مادتك مباشرة.</p>
          </div>
          <div class="icon-wrap featured">${icon("tests")}</div>
        </div>
        <div class="card-foot">
          ${badge("متاح الآن", "is-live")}
          <div class="hint-link">ابدأ <span>←</span></div>
        </div>
      </button>

      <div class="section-row stagger" style="animation-delay:200ms">
        <h2 class="section-title">أدواتك</h2>
        <button type="button" class="section-link" data-nav-to="tools">عرض الكل ←</button>
      </div>

      <div class="home-shortcuts stagger" style="animation-delay:240ms">
        ${[
          { id: "materials", label: "المواد", icon: "book" },
          { id: "lectures", label: "المحاضرات", icon: "play" },
          { id: "settings", label: "الإعدادات", icon: "settings" },
        ].map((shortcut) => `
          <button type="button" class="shortcut-card" data-nav-to="${shortcut.id}">
            <div class="icon-wrap">${icon(shortcut.icon)}</div>
            <span class="shortcut-label">${shortcut.label}</span>
          </button>`).join("")}
      </div>

      <div class="home-tip stagger" style="animation-delay:280ms">
        <span class="tip-icon">${icon("brain")}</span>
        <p class="tip-text">نصيحة: خصّص 25 دقيقة لكل جلسة دراسية مع استراحة قصيرة بعدها.</p>
      </div>
    </div>`;
}
