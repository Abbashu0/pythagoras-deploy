import { densityLabels } from "./data.js";
import { icon } from "./icons.js";

export const DENSITY_KEY = "pythagoras-density";

const VALID_DENSITIES = ["compact", "comfortable", "spacious"];

// Multiplier applied to body font-size; cards & headings scale via em units
const DENSITY_MULTIPLIERS = {
  compact: 0.92,
  comfortable: 1,
  spacious: 1.12,
};

function normalizeDensity(density) {
  return VALID_DENSITIES.includes(density) ? density : "comfortable";
}

const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // noop
    }
  },
};

export function getStoredDensity() {
  return normalizeDensity(store.get(DENSITY_KEY));
}

export function getDensityMultiplier(density) {
  const d = normalizeDensity(density);
  return DENSITY_MULTIPLIERS[d];
}

export function applyDensity(density) {
  const next = normalizeDensity(density);
  document.documentElement.style.setProperty(
    "--density-multiplier",
    String(DENSITY_MULTIPLIERS[next])
  );
  store.set(DENSITY_KEY, next);
  return next;
}

export function syncDensityControls(density) {
  const active = normalizeDensity(density);

  document.querySelectorAll("[data-density-choice]").forEach((button) => {
    const isSelected = button.getAttribute("data-density-choice") === active;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
  });

  // Move the slider thumb to the matching tick
  const slider = document.querySelector("[data-density-slider]");
  if (slider) {
    const index = VALID_DENSITIES.indexOf(active);
    const totalTicks = VALID_DENSITIES.length;
    // Position as percentage: 0% (left), 50%, 100% (right)
    const pct = totalTicks > 1 ? (index / (totalTicks - 1)) * 100 : 50;
    slider.style.setProperty("--density-thumb-pct", `${pct}%`);
  }

  const status = document.querySelector("[data-density-status]");
  if (status) {
    status.textContent = `الحجم الحالي: ${densityLabels[active]}`;
  }
}
