export function pageHead(screen, options = {}) {
  const shouldReserveBackSpace = Boolean(options.backView || options.reserveBackSpace);
  const copy = options.hideCopy ? "" : `<p class="page-copy">${screen.copy}</p>`;
  const backButton = options.backView ? `
    <div class="app-floating-back-layer">
      <div class="app-floating-back-slot">
        <button type="button" class="app-back-button liquidGlass-wrapper back-btn" data-nav-to="${options.backView}" aria-label="${options.backLabel || "الرجوع"}">
          <span class="liquidGlass-effect"></span>
          <span class="liquidGlass-tint"></span>
          <span class="liquidGlass-shine"></span>
          <span class="liquidGlass-text app-back-button__text">
            <svg class="app-back-button__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          </span>
        </button>
      </div>
    </div>` : "";

  return `
    ${backButton}
    <div class="topline${shouldReserveBackSpace ? " has-back" : ""} stagger" style="animation-delay:0ms">
      <span class="brand-chip">Pythagoras Platform</span>
      <span class="status-chip">${screen.stateLabel}</span>
    </div>
    <header class="page-head stagger" style="animation-delay:50ms">
      <div class="eyebrow">${screen.eyebrow}</div>
      <h1 class="page-title">${screen.title}</h1>
      ${copy}
    </header>`;
}
