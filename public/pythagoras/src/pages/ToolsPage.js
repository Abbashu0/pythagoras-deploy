import { pageHead } from "../components/PageHeader.js";
import { toolCard } from "../components/ToolCard.js";
import { screens, getTools } from "../scripts/data.js";

export function toolsScreen() {
  return `
    ${pageHead(screens.tools)}
    <div class="section-row stagger" style="animation-delay:120ms">
      <h2 class="section-title">مركز الأدوات</h2>
      <span class="section-meta">5 أدوات قريبًا</span>
    </div>
    <section class="tools-grid" aria-label="قائمة الأدوات">
      ${getTools().map((tool, index) => toolCard(tool, 160 + index * 30)).join("")}
    </section>`;
}
