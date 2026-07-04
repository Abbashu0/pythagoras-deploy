import { pageHead } from "../components/PageHeader.js";
import { screens } from "../scripts/data.js";
import { icon } from "../scripts/icons.js";

export function placeholderScreen(view) {
  const screen = screens[view];

  return `
    ${pageHead(screen)}
    <div class="placeholder-wrap">
      <section class="placeholder-card stagger" style="animation-delay:120ms">
        <div class="icon-wrap placeholder featured">${icon(screen.icon)}</div>
        <h2 class="placeholder-title">هذه الصفحة قيد البناء</h2>
        <p class="placeholder-text">سنبني تجربة ${screen.title} لاحقًا ضمن نفس هوية التطبيق.</p>
      </section>
    </div>`;
}
