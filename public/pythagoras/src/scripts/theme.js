import { themeLabels } from "./data.js";
import { icon } from "./icons.js";

export const THEME_KEY = "pythagoras-theme";

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
  const theme = store.get(THEME_KEY);
  return theme === "light" ? "light" : "dark";
}

export function applyTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.body.dataset.theme = nextTheme;
  document.body.classList.toggle("dark", nextTheme === "dark");
  document.documentElement.style.colorScheme = nextTheme;
  store.set(THEME_KEY, nextTheme);
  return nextTheme;
}

export function syncThemeControls(theme) {
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const isSelected = button.getAttribute("data-theme-choice") === theme;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");

    const check = button.querySelector(".theme-check");
    if (check) {
      check.innerHTML = isSelected ? icon("check") : "";
    }
  });

  const status = document.querySelector("[data-theme-status]");
  if (status) {
    status.textContent = `الوضع الحالي: ${themeLabels[theme]}`;
  }

  const preview = document.querySelector(".theme-preview-device");
  if (preview) {
    preview.classList.toggle("is-dark", theme === "dark");
    preview.classList.toggle("is-light", theme === "light");
  }
}
