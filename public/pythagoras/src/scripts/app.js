import { renderAppShell } from "../components/AppShell.js";
import { homeScreen } from "../pages/HomePage.js";
import { lecturesScreen } from "../pages/LecturesPage.js";
import { materialsScreen } from "../pages/MaterialsPage.js";
import { placeholderScreen } from "../pages/PlaceholderPage.js";
import { settingsScreen } from "../pages/SettingsPage.js";
import { subjectTestsScreen } from "../pages/SubjectTestsPage.js";
import { testsSubjectsScreen } from "../pages/TestsSubjectsPage.js";
import { toolsScreen } from "../pages/ToolsPage.js";
import { renderQuestionBankPlaceholder } from "../pages/QuestionBankPlaceholderPage.js";
import "./image-db.js";
import { getSubjectByView } from "./data.js";
import { bindNavigationInteractions } from "./navigation.js";
import { pushRoute, viewFromHash } from "./router.js";
import { applyTheme, getStoredTheme, syncThemeControls } from "./theme.js";
import { applyDensity, getStoredDensity, syncDensityControls } from "./density.js";
import { SponsoredCarouselController } from "../components/SponsoredCarouselCard.js";
import { showToast } from "./toast.js";

let carouselController = null;

function renderView(view = viewFromHash()) {
  const subject = getSubjectByView(view);
  const content = subject ? subjectTestsScreen(subject) : ({
    home: homeScreen,
    materials: materialsScreen,
    lectures: lecturesScreen,
    tests: testsSubjectsScreen,
    questions: renderQuestionBankPlaceholder,
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
  document.querySelectorAll("[data-locked]").forEach((button) => button.addEventListener("click", () => showToast(`${button.dataset.toolName} قيد البناء`)));
  document.querySelectorAll("[data-tests-action-message]").forEach((button) => button.addEventListener("click", () => showToast(button.dataset.testsActionMessage)));
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
renderView();
