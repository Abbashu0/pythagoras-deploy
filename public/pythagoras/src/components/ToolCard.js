import { badge, icon } from "../scripts/icons.js";

export function toolCard(tool, delay) {
  const inner = `
    <div class="tool-head">
      <div class="tool-copy">
        <h3 class="tool-title">${tool.title}</h3>
        <p class="tool-text">${tool.description}</p>
      </div>
      <div class="icon-wrap ${tool.available ? "featured" : ""}">${icon(tool.icon)}</div>
    </div>
    <div class="tool-meta">
      ${badge(tool.status, tool.statusClass)}
      <span class="tool-hint">${tool.hint}</span>
    </div>`;

  if (tool.available) {
    return `<button type="button" class="tool-card available stagger" style="animation-delay:${delay}ms" data-nav-to="tests">${inner}</button>`;
  }

  return `<button type="button" class="tool-card locked stagger" style="animation-delay:${delay}ms" data-locked="true" data-tool-name="${tool.title}">${inner}</button>`;
}
