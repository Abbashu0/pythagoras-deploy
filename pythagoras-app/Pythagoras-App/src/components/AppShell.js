import { renderBottomNav } from "./BottomNav.js";

export function renderAppShell(view, content, overlay = "") {
  return `
    <div class="app-stage">
      <div class="app-device">
        <div class="app-shell">
          ${overlay}
          <main class="screen is-entering" id="screen-content">${content}</main>
          <div class="toast" id="toast" role="status" aria-live="polite"></div>
          ${renderBottomNav(view)}
        </div>
      </div>
    </div>`;
}
