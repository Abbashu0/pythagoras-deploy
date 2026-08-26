import { renderAppShell } from "../components/AppShell.js";
import { homeScreen } from "../pages/HomePage.js";
import { lecturesScreen } from "../pages/LecturesPage.js";
import { materialsScreen } from "../pages/MaterialsPage.js";
import { placeholderScreen } from "../pages/PlaceholderPage.js";
import { settingsScreen } from "../pages/SettingsPage.js";
import { subjectTestsScreen } from "../pages/SubjectTestsPage.js";
import { testsSubjectsScreen } from "../pages/TestsSubjectsPage.js";
import { toolsScreen } from "../pages/ToolsPage.js";
import { mountQuestionBank, renderQuestionBankPlaceholder } from "../pages/QuestionBankPlaceholderPage.js?v=20260826b";
import "./image-db.js";
import {
  ADMIN_BANNERS_KEY,
  ADMIN_MATERIALS_KEY,
  ADMIN_MATERIALS_SETTINGS_KEY,
  ADMIN_NAV_ITEMS_KEY,
  ADMIN_TOOLS_KEY,
  getSponsoredBanners,
  getQuestionBankSubjectByView,
  getSubjectByView,
  getTestSubjects,
  isLegacyRuntimeContent,
  loadRuntimeContent,
} from "./data.js";
import { bindNavigationInteractions } from "./navigation.js";
import { pushRoute, viewFromHash } from "./router.js";
import { applyTheme, getStoredTheme, syncThemeControls } from "./theme.js";
import { applyDensity, getStoredDensity, syncDensityControls } from "./density.js";
import { SponsoredCarouselController } from "../components/SponsoredCarouselCard.js";
import { showToast } from "./toast.js";

let carouselController = null;

async function hydrateStudentImages() {
  if (!isLegacyRuntimeContent()) return;
  const imageDB = window.ImageDB;
  if (!imageDB) return;

  await imageDB.preloadAllImages();
  await Promise.all(
    [...getTestSubjects(), ...getSponsoredBanners()]
      .map((subject) => subject.imageKey)
      .filter(Boolean)
      .map((key) => imageDB.getImage(key))
  );
  renderView();
}

function renderView(view = viewFromHash()) {
  const subject = getSubjectByView(view);
  const questionBankSubject = getQuestionBankSubjectByView(view);
  const content = subject ? subjectTestsScreen(subject) : questionBankSubject ? renderQuestionBankPlaceholder(questionBankSubject) : ({
    home: homeScreen,
    materials: materialsScreen,
    lectures: lecturesScreen,
    tests: testsSubjectsScreen,
    tools: toolsScreen,
    settings: settingsScreen,
  }[view] || (() => placeholderScreen("tools")))();

  if (carouselController) carouselController.destroy();
  document.getElementById("app").innerHTML = renderAppShell(view, content);
  const carousel = document.querySelector("[data-sponsored-carousel]");
  carouselController = carousel ? new SponsoredCarouselController(carousel) : null;

  bindNavigationInteractions(view, (target) => {
    pushRoute(target);
    renderView(target);
  });
  if (questionBankSubject) mountQuestionBank(questionBankSubject);
  document.querySelectorAll("[data-locked]").forEach((button) => button.addEventListener("click", () => showToast(`${button.dataset.toolName} قيد البناء`)));
  document.querySelectorAll("[data-tests-action-message]").forEach((button) => button.addEventListener("click", () => showToast(button.dataset.testsActionMessage)));
  document.querySelectorAll("[data-appearance-toggle]").forEach((button) => button.addEventListener("click", () => {
    const card = button.closest("[data-appearance-card]");
    if (!card) return;

    const isExpanded = card.classList.toggle("is-expanded");
    button.setAttribute("aria-expanded", String(isExpanded));
  }));
  document.querySelectorAll("[data-theme-choice]").forEach((button) => button.addEventListener("click", () => syncThemeControls(applyTheme(button.dataset.themeChoice))));
  document.querySelectorAll("[data-density-choice]").forEach((button) => button.addEventListener("click", () => syncDensityControls(applyDensity(button.dataset.densityChoice))));
  const densityInput = document.querySelector("[data-density-input]");
  if (densityInput) densityInput.addEventListener("input", () => syncDensityControls(applyDensity(["compact", "comfortable", "spacious"][Number(densityInput.value)])));
  syncThemeControls(getStoredTheme());
  syncDensityControls(getStoredDensity());
}

applyTheme(getStoredTheme());
applyDensity(getStoredDensity());
window.addEventListener("hashchange", () => renderView());
window.addEventListener("storage", (event) => {
  if (!isLegacyRuntimeContent()) return;
  if (
    event.key === ADMIN_NAV_ITEMS_KEY ||
    event.key === ADMIN_MATERIALS_SETTINGS_KEY ||
    event.key === ADMIN_TOOLS_KEY
  ) {
    renderView();
  }
  if (event.key === ADMIN_MATERIALS_KEY || event.key === ADMIN_BANNERS_KEY) {
    hydrateStudentImages();
  }
});
async function start() {
  try {
    await loadRuntimeContent();
    renderView();
    if (isLegacyRuntimeContent()) await hydrateStudentImages();
  } catch {
    document.getElementById("app").innerHTML = `<main class="app-shell"><section class="placeholder-card" dir="rtl"><h1>تعذّر تحميل المحتوى</h1><p>أعد تحميل الصفحة بعد التأكد من تشغيل خادم Pythagoras.</p></section></main>`;
  }
}

void start();
