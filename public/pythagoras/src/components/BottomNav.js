import { viewNavMap, getNavItems } from "../scripts/data.js";
import { icon } from "../scripts/icons.js";

export function renderBottomNav(view) {
  const activeId = viewNavMap[view] || "tools";
  // Read live nav items from admin store (localStorage) with fallback
  const items = getNavItems();

  return `
    <div class="bottom-nav-wrap">
      <nav class="bottom-nav" aria-label="التنقل الرئيسي">
        ${items.map((item) => {
          const isActive = activeId === item.id;
          return `
            <button type="button" class="nav-item${isActive ? " is-active" : ""}"
              data-nav-id="${item.id}" data-nav-to="${item.id}"
              ${isActive ? 'aria-current="page"' : ""}>
              <span class="nav-orb">${icon(item.icon)}</span>
              <span class="nav-label">${item.label}</span>
            </button>`;
        }).join("")}
      </nav>
    </div>`;
}
