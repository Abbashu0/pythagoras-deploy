import { themeLabels } from "./data.js";
import { icon } from "./icons.js";

export const THEME_KEY = "pythagoras-theme";

const VALID_THEMES = ["dark", "light", "aurora"];

function normalizeTheme(theme) {
  return VALID_THEMES.includes(theme) ? theme : "dark";
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

export function getStoredTheme() {
  return normalizeTheme(store.get(THEME_KEY));
}

export function applyTheme(theme) {
  const nextTheme = normalizeTheme(theme);
  document.body.dataset.theme = nextTheme;
  document.body.classList.toggle("dark", nextTheme !== "light");
  document.documentElement.style.colorScheme =
    nextTheme === "light" ? "light" : "dark";
  store.set(THEME_KEY, nextTheme);
  return nextTheme;
}

export function syncThemeControls(theme) {
  const activeTheme = normalizeTheme(theme);

  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const isSelected = button.getAttribute("data-theme-choice") === activeTheme;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");

    const check = button.querySelector(".theme-check");
    if (check) {
      check.innerHTML = isSelected ? icon("check") : "";
    }
  });

  const status = document.querySelector("[data-theme-status]");
  if (status) {
    status.textContent = `الوضع الحالي: ${themeLabels[activeTheme]}`;
  }

  const preview = document.querySelector(".theme-preview-device");
  if (preview) {
    preview.classList.toggle("is-dark", activeTheme === "dark");
    preview.classList.toggle("is-light", activeTheme === "light");
    preview.classList.toggle("is-aurora", activeTheme === "aurora");
  }
}
