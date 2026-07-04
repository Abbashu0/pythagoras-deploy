export function pageHead(screen, options = {}) {
  const shouldReserveBackSpace = Boolean(options.backView || options.reserveBackSpace);
  const copy = options.hideCopy ? "" : `<p class="page-copy">${screen.copy}</p>`;

  return `
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
