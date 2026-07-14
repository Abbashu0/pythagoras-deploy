import { renderAppShell } from "../components/AppShell.js";
import { homeScreen } from "../pages/HomePage.js";
import { lecturesScreen } from "../pages/LecturesPage.js";
import { materialsScreen } from "../pages/MaterialsPage.js";
import { placeholderScreen } from "../pages/PlaceholderPage.js";
import { questionBankScreen, renderQuestionBankResults } from "../pages/QuestionBankPage.js?v=20260613c";
import { questionDetailScreen } from "../pages/QuestionDetailPage.js";
import { settingsScreen } from "../pages/SettingsPage.js";
import { subjectTestsScreen } from "../pages/SubjectTestsPage.js";
import { testsSubjectsScreen } from "../pages/TestsSubjectsPage.js";
import { toolsScreen } from "../pages/ToolsPage.js";
import "./image-db.js"; // Registers window.ImageDB (IndexedDB image storage + cache)
import {
  getBiologyQuestionDetailFromView,
  getQuestionBankSubjectByView,
  getQuestionBankView,
  getSubjectByView,
  getViewMeta,
  themeLabels,
  densityLabels,
  viewNavMap,
} from "./data.js";
import {
  getBiologyQuestionBankSnapshot,
  getBiologyQuestionByGlobalOrder,
  getQuestionBankQuery,
  loadBiologyOriginalQuestionBank,
  setQuestionBankQuery,
} from "./biologyQuestionBank.js";
import { icon } from "./icons.js";
import { bindNavigationInteractions, triggerNavActivation } from "./navigation.js";
import {
  QUESTION_BANK_SOURCE_OPTIONS,
  applyQuestionBankFilters,
  buildQuestionBankFilterOptions,
  createDefaultQuestionBankFilters,
  getQuestionTypeLabel,
  hasActiveQuestionBankFilters,
  normalizeQuestionBankFilters,
} from "./questionBankFilters.js";
import { pushRoute, viewFromHash } from "./router.js";
import { applyTheme, getStoredTheme, syncThemeControls } from "./theme.js";
import {
  applyDensity,
  getStoredDensity,
  syncDensityControls,
} from "./density.js";
import { SponsoredCarouselController } from "../components/SponsoredCarouselCard.js";
import { showToast } from "./toast.js";

let currentView = "tools";
let sponsoredCarouselController = null;
const NAV_STATE_KEY = "pythagoras-last-view-by-tab";
const QUESTION_BANK_STICKY_TOP = 58;
const QUESTION_BANK_DEFAULT_VIEW_MODE = "list";

const defaultViewByNavTab = {
  home: "home",
  materials: "materials",
  tools: "tools",
  lectures: "lectures",
  settings: "settings",
};

const lastViewByNavTab = {
  ...defaultViewByNavTab,
  ...readStoredNavState(),
};

const questionBankViewState = {};
let questionBankStickyObserver = null;
let questionBankOutsidePointerCleanup = null;

function readStoredNavState() {
  try {
    const raw = window.localStorage.getItem(NAV_STATE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : null;
  } catch {
    return null;
  }
}

function storeNavState() {
  try {
    window.localStorage.setItem(NAV_STATE_KEY, JSON.stringify(lastViewByNavTab));
  } catch {
    // noop
  }
}

function getQuestionBankStateEntry(subjectId) {
  if (!questionBankViewState[subjectId]) {
    questionBankViewState[subjectId] = {
      scrollTop: 0,
      expandedSearch: false,
      lastOpenedQuestionView: null,
      pendingRestore: false,
      viewMode: QUESTION_BANK_DEFAULT_VIEW_MODE,
      filters: null,
      isFilterPanelOpen: false,
      openAccordion: null,
      useQuestionFallbackOnRestore: false,
    };
  }

  return questionBankViewState[subjectId];
}

function getScreenScrollContainer() {
  const screen = document.getElementById("screen-content");
  return screen?.classList.contains("screen") ? screen : document.querySelector(".screen");
}

function saveQuestionBankViewState(subjectId, extra = {}) {
  const entry = getQuestionBankStateEntry(subjectId);
  const shell = document.querySelector("[data-question-search-shell]");
  const input = document.querySelector("[data-question-search-input]");
  const scrollContainer = getScreenScrollContainer();

  if (input) {
    setQuestionBankQuery(subjectId, input.value);
  }

  entry.scrollTop = scrollContainer?.scrollTop || 0;
  entry.expandedSearch = Boolean(
    shell?.classList.contains("is-expanded")
    || shell?.classList.contains("has-value")
    || document.activeElement === input,
  );

  Object.assign(entry, extra);
  return entry;
}

function markQuestionBankRestore(view) {
  const subject = getQuestionBankSubjectByView(view);
  if (!subject) {
    return;
  }

  const entry = getQuestionBankStateEntry(subject.id);
  entry.pendingRestore = true;
  entry.useQuestionFallbackOnRestore = true;
}

function prepareQuestionBankRestore(fromView, toView) {
  if (!isBiologyDetailView(fromView)) {
    return;
  }

  if (getQuestionBankSubjectByView(toView)) {
    markQuestionBankRestore(toView);
  }
}

function restoreQuestionBankViewState(subjectId, options = {}) {
  const entry = getQuestionBankStateEntry(subjectId);
  if (!entry.pendingRestore) {
    return;
  }

  const scrollContainer = getScreenScrollContainer();
  if (!scrollContainer) {
    return;
  }

  const restore = () => {
    const targetScrollTop = Math.max(0, entry.scrollTop || 0);
    scrollContainer.scrollTop = targetScrollTop;

    if (options.allowQuestionFallback && entry.useQuestionFallbackOnRestore && entry.lastOpenedQuestionView) {
      const questionCard = document.querySelector(`[data-question-detail-view="${entry.lastOpenedQuestionView}"]`);
      const delta = Math.abs((scrollContainer.scrollTop || 0) - targetScrollTop);
      if (questionCard && delta > 120) {
        questionCard.scrollIntoView({ block: "center" });
      }
    }

    entry.pendingRestore = false;
    entry.useQuestionFallbackOnRestore = false;
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(restore);
  });
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isQuestionBankView(view) {
  return Boolean(getQuestionBankSubjectByView(view));
}

function getQuestionBankSnapshotBySubject(subjectId) {
  if (subjectId === "biology") {
    return getBiologyQuestionBankSnapshot();
  }

  return {
    status: "ready",
    records: [],
  };
}

function getQuestionBankEntryWithRecords(subjectId, records = []) {
  const entry = getQuestionBankStateEntry(subjectId);

  if (records.length) {
    if (!entry.filters) {
      entry.filters = createDefaultQuestionBankFilters(records);
    } else {
      entry.filters = normalizeQuestionBankFilters(records, entry.filters);
    }
  }

  entry.viewMode = entry.viewMode === "icons" ? "icons" : QUESTION_BANK_DEFAULT_VIEW_MODE;
  return entry;
}

function summarizeSelectedOptions(selectedIds, options) {
  const available = Array.isArray(options) ? options : [];
  const selected = available.filter((option) => selectedIds.includes(option.id));

  if (!available.length || selected.length === available.length) {
    return "الكل";
  }

  if (selected.length === 1) {
    return selected[0].label;
  }

  if (selected.length === 2) {
    return `${selected[0].label} + ${selected[1].label}`;
  }

  return `${selected.length} محددة`;
}

function renderQuestionBankMenuOption(option, group, selectedIds) {
  const isSelected = selectedIds.includes(option.id);

  return `
    <button
      type="button"
      class="question-bank-option-row${isSelected ? " is-selected" : ""}"
      data-filter-group="${group}"
      data-filter-option="${escapeAttribute(option.id)}"
      aria-pressed="${isSelected ? "true" : "false"}"
    >
      <span class="question-bank-option-copy">${escapeHtml(option.label)}</span>
      <span class="question-bank-option-check" aria-hidden="true">${isSelected ? icon("check") : ""}</span>
    </button>`;
}

function renderQuestionBankAccordion(title, group, options, selectedIds, openAccordion) {
  const isOpen = openAccordion === group;
  const summary = summarizeSelectedOptions(selectedIds, options);

  return `
    <section class="question-bank-panel-section${isOpen ? " is-open" : ""}">
      <button
        type="button"
        class="question-bank-panel-row"
        data-question-bank-accordion="${group}"
        aria-expanded="${isOpen ? "true" : "false"}"
      >
        <span class="question-bank-panel-row-copy">
          <strong>${title}</strong>
          <span>${escapeHtml(summary)}</span>
        </span>
        <span class="question-bank-panel-chevron" aria-hidden="true">${icon("chevron")}</span>
      </button>
      <div class="question-bank-panel-options" ${isOpen ? "" : "hidden"}>
        ${options.map((option) => renderQuestionBankMenuOption(option, group, selectedIds)).join("")}
      </div>
    </section>`;
}

function renderQuestionBankMenuOverlay(subject, state) {
  if (!subject || subject.id !== "biology" || state.status !== "ready") {
    return "";
  }

  const entry = getQuestionBankStateEntry(subject.id);
  const options = state.options;
  const filters = state.filters;
  const isOpen = Boolean(entry.isFilterPanelOpen);

  return `
    <div class="app-question-bank-tools-layer${isOpen ? " is-open" : ""}">
      <button
        type="button"
        class="question-bank-panel-dismiss"
        data-question-bank-panel-dismiss
        aria-label="إغلاق خيارات بنك الأسئلة"
      ></button>
      <div class="question-bank-floating-tools">
        <button
          type="button"
          class="question-bank-menu-button"
          data-question-bank-menu-toggle
          aria-label="خيارات بنك الأسئلة"
          aria-expanded="${isOpen ? "true" : "false"}"
        >
          <span class="question-bank-menu-button-icon">${icon("more-horizontal")}</span>
          ${state.hasActiveFilters ? '<span class="question-bank-menu-button-badge" aria-hidden="true"></span>' : ""}
        </button>
        <section
          class="question-bank-menu-panel${isOpen ? " is-open" : ""}"
          aria-label="لوحة خيارات بنك الأسئلة"
          aria-hidden="${isOpen ? "false" : "true"}"
          ${isOpen ? "" : "inert"}
        >
          <div class="question-bank-menu-panel-scroll">
            <div class="question-bank-panel-section is-static">
              <div class="question-bank-panel-heading">
                <strong>طريقة العرض</strong>
                <button type="button" class="question-bank-panel-reset" data-question-bank-reset-filters>إعادة ضبط</button>
              </div>
              <div class="question-bank-view-switch" role="tablist" aria-label="طريقة عرض الأسئلة">
                <button
                  type="button"
                  class="question-bank-view-option${state.viewMode === "list" ? " is-active" : ""}"
                  data-question-bank-view-mode="list"
                  aria-pressed="${state.viewMode === "list" ? "true" : "false"}"
                >
                  <span>${icon("list")}</span>
                  <span>List</span>
                </button>
                <button
                  type="button"
                  class="question-bank-view-option${state.viewMode === "icons" ? " is-active" : ""}"
                  data-question-bank-view-mode="icons"
                  aria-pressed="${state.viewMode === "icons" ? "true" : "false"}"
                >
                  <span>${icon("grid")}</span>
                  <span>Icons</span>
                </button>
              </div>
            </div>

            ${renderQuestionBankAccordion("حسب المصدر", "sourceIds", options.sources, filters.sourceIds, entry.openAccordion)}
            ${renderQuestionBankAccordion("حسب الفصل", "chapterIds", options.chapters, filters.chapterIds, entry.openAccordion)}
            ${renderQuestionBankAccordion("حسب الموضوع", "topicIds", options.topics, filters.topicIds, entry.openAccordion)}
            ${renderQuestionBankAccordion("حسب نوع السؤال", "questionTypeIds", options.questionTypes, filters.questionTypeIds, entry.openAccordion)}
          </div>
        </section>
      </div>
    </div>`;
}

function cleanupQuestionBankStickyObserver() {
  if (questionBankStickyObserver) {
    questionBankStickyObserver.disconnect();
    questionBankStickyObserver = null;
  }
}

function cleanupQuestionBankOutsidePointerListener() {
  if (typeof questionBankOutsidePointerCleanup === "function") {
    questionBankOutsidePointerCleanup();
    questionBankOutsidePointerCleanup = null;
  }
}

function bindQuestionBankStickyState() {
  cleanupQuestionBankStickyObserver();

  const sticky = document.querySelector("[data-question-search-sticky]");
  const sentinel = document.querySelector("[data-question-search-sentinel]");
  const scrollContainer = getScreenScrollContainer();

  if (!sticky || !sentinel || !scrollContainer || !("IntersectionObserver" in window)) {
    return;
  }

  questionBankStickyObserver = new IntersectionObserver(
    ([entry]) => {
      sticky.classList.toggle("is-stuck", !entry.isIntersecting);
    },
    {
      root: scrollContainer,
      threshold: 0,
      rootMargin: `-${QUESTION_BANK_STICKY_TOP}px 0px 0px 0px`,
    },
  );

  questionBankStickyObserver.observe(sentinel);
}

function escapeAttribute(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function isBiologyDetailView(view) {
  return getBiologyQuestionDetailFromView(view) !== null;
}

function getNavTabForView(view) {
  if (getSubjectByView(view) || getQuestionBankSubjectByView(view) || isBiologyDetailView(view)) {
    return "materials";
  }

  return viewNavMap[view] || (defaultViewByNavTab[view] ? view : null);
}

function getActiveNavId(view) {
  return getNavTabForView(view) || view;
}

function rememberViewForTab(view) {
  const navTab = getNavTabForView(view);
  if (!navTab) {
    return;
  }

  lastViewByNavTab[navTab] = view;
  storeNavState();
}

function resolveNavTarget(tabId) {
  return lastViewByNavTab[tabId] || defaultViewByNavTab[tabId] || tabId;
}

function getBackFallback(view) {
  if (isBiologyDetailView(view)) {
    return getQuestionBankView("biology");
  }

  const questionBankSubject = getQuestionBankSubjectByView(view);
  if (questionBankSubject) {
    return `tests-${questionBankSubject.id}`;
  }

  if (getSubjectByView(view)) {
    return "materials";
  }

  if (view === "tests") {
    return "materials";
  }

  return null;
}

function getBackButtonLabel(view) {
  const target = getBackFallback(view);
  if (!target) {
    return "الرجوع";
  }

  return `الرجوع إلى ${getViewMeta(target).title}`;
}

function renderBackButtonOverlay(view) {
  const target = getBackFallback(view);
  if (!target) {
    return "";
  }

  return `
    <div class="app-floating-back-layer">
      <button
        id="pythagoras-back-button"
        type="button"
        class="app-floating-back-slot liquidGlass-wrapper back-btn app-back-button"
        data-go-back="${escapeAttribute(target)}"
        aria-label="${escapeAttribute(getBackButtonLabel(view))}"
      >
        <span class="liquidGlass-effect" aria-hidden="true"></span>
        <span class="liquidGlass-tint" aria-hidden="true"></span>
        <span class="liquidGlass-shine" aria-hidden="true"></span>
        <span class="liquidGlass-text app-back-button__text">
          <svg class="app-back-button__icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 12H7"></path>
            <path d="m12 7-5 5 5 5"></path>
          </svg>
        </span>
      </button>
    </div>`;
}

function buildQuestionBankState(subject) {
  const snapshot = getQuestionBankSnapshotBySubject(subject.id);
  const query = getQuestionBankQuery(subject.id);
  const entry = getQuestionBankEntryWithRecords(subject.id, snapshot.records || []);

  if (subject.id !== "biology") {
    return {
      status: "ready",
      query,
      viewMode: entry.viewMode,
      results: [],
      filters: entry.filters,
      options: {
        sources: [],
        chapters: [],
        topics: [],
        questionTypes: [],
      },
      hasActiveFilters: false,
    };
  }

  if (snapshot.status !== "ready") {
    return {
      status: snapshot.status,
      query,
      viewMode: entry.viewMode,
      results: [],
      filters: entry.filters,
      options: {
        sources: QUESTION_BANK_SOURCE_OPTIONS,
        chapters: [],
        topics: [],
        questionTypes: [],
      },
      hasActiveFilters: false,
    };
  }

  const filters = normalizeQuestionBankFilters(snapshot.records, entry.filters);
  entry.filters = filters;

  return {
    status: snapshot.status,
    query,
    viewMode: entry.viewMode,
    filters,
    options: buildQuestionBankFilterOptions(snapshot.records, filters.chapterIds),
    hasActiveFilters: hasActiveQuestionBankFilters(snapshot.records, filters),
    results: applyQuestionBankFilters(snapshot.records, { query, filters }),
  };
}

function buildBiologyDetailState(globalOrder) {
  const snapshot = getBiologyQuestionBankSnapshot();

  return {
    status: snapshot.status,
    record: snapshot.status === "ready" ? getBiologyQuestionByGlobalOrder(globalOrder) : null,
  };
}

function renderContent(view) {
  const subject = getSubjectByView(view);
  const questionBankSubject = getQuestionBankSubjectByView(view);
  const biologyQuestionGlobal = getBiologyQuestionDetailFromView(view);

  if (view === "tools") {
    return toolsScreen();
  }

  if (view === "home") {
    return homeScreen();
  }

  if (view === "materials") {
    return materialsScreen();
  }

  if (view === "lectures") {
    return lecturesScreen();
  }

  if (view === "tests") {
    return testsSubjectsScreen();
  }

  // Redirect legacy nav tabs that no longer have their own screen.
  // Old "tasks" / "notes" routes land on the Materials page so any
  // stale bookmarks or saved state still take the user somewhere useful.
  if (view === "tasks" || view === "notes") {
    return materialsScreen();
  }

  if (biologyQuestionGlobal !== null) {
    return questionDetailScreen(biologyQuestionGlobal, buildBiologyDetailState(biologyQuestionGlobal));
  }

  if (questionBankSubject) {
    return questionBankScreen(questionBankSubject, buildQuestionBankState(questionBankSubject));
  }

  if (subject) {
    return subjectTestsScreen(subject);
  }

  if (view === "settings") {
    return settingsScreen();
  }

  return placeholderScreen(view);
}

function renderOverlay(view) {
  const overlays = [renderBackButtonOverlay(view)];
  const questionBankSubject = getQuestionBankSubjectByView(view);

  if (questionBankSubject) {
    overlays.push(renderQuestionBankMenuOverlay(questionBankSubject, buildQuestionBankState(questionBankSubject)));
  }

  return overlays.filter(Boolean).join("");
}

function render(view) {
  const app = document.getElementById("app");
  if (!app) {
    return;
  }

  cleanupQuestionBankStickyObserver();
  cleanupQuestionBankOutsidePointerListener();
  rememberViewForTab(view);
  document.body.dataset.view = view;
  document.title = `Pythagoras | ${getViewMeta(view).title}`;
  app.innerHTML = renderAppShell(view, renderContent(view), renderOverlay(view));
}

function activateCurrentNav(view) {
  requestAnimationFrame(() => {
    const activeNav = document.querySelector(`.nav-item[data-nav-id="${getActiveNavId(view)}"]`);
    triggerNavActivation(activeNav);
  });
}

function refreshView(view = currentView, options = {}) {
  currentView = view;
  render(view);
  bindInteractions(view);

  if (options.activateNav !== false) {
    activateCurrentNav(view);
  }
}

function renderView(nextView, navId) {
  prepareQuestionBankRestore(currentView, nextView);
  refreshView(nextView, { activateNav: false });
  pushRoute(nextView);

  requestAnimationFrame(() => {
    const activeId = navId || getActiveNavId(nextView);
    const activeNav = document.querySelector(`.nav-item[data-nav-id="${activeId}"]`);
    triggerNavActivation(activeNav);
  });
}

function ensureBiologyQuestionBankLoaded() {
  const snapshot = getBiologyQuestionBankSnapshot();
  if (snapshot.status === "loading" || snapshot.status === "ready") {
    return;
  }

  loadBiologyOriginalQuestionBank()
    .catch((error) => {
      console.warn("Failed to load biology question bank", error);
    })
    .finally(() => {
      if (currentView === "question-bank-biology" || isBiologyDetailView(currentView)) {
        refreshView(currentView, { activateNav: false });
      }
    });
}

function bindLockedToolInteractions() {
  document.querySelectorAll("[data-locked='true']").forEach((button) => {
    button.addEventListener("click", () => {
      showToast(`${button.getAttribute("data-tool-name")} ستصل قريبًا ضمن نفس تجربة فيثاغورس.`);
    });
  });
}

function bindThemeInteractions() {
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const nextTheme = applyTheme(button.getAttribute("data-theme-choice"));
      syncThemeControls(nextTheme);
      showToast(`تم تفعيل الوضع ${themeLabels[nextTheme]}.`);
    });
  });

  syncThemeControls(document.body.dataset.theme || getStoredTheme());

  bindDensityInteractions();
}

function bindDensityInteractions() {
  const DENSITY_ORDER = ["compact", "comfortable", "spacious"];

  // Click on density option buttons
  document.querySelectorAll("[data-density-choice]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const next = applyDensity(button.getAttribute("data-density-choice"));
      syncDensityControls(next);
      showToast(`حجم العرض: ${densityLabels[next]}.`);
    });
  });

  // Range input — drag the slider
  const input = document.querySelector("[data-density-input]");
  if (input) {
    input.addEventListener("input", (event) => {
      const idx = Number(event.target.value);
      const next = DENSITY_ORDER[idx] || "comfortable";
      applyDensity(next);
      syncDensityControls(next);
    });
    input.addEventListener("change", (event) => {
      const idx = Number(event.target.value);
      const next = DENSITY_ORDER[idx] || "comfortable";
      showToast(`حجم العرض: ${densityLabels[next]}.`);
    });
  }

  syncDensityControls(getStoredDensity());
}

function bindTestsFeatureInteractions() {
  document.querySelectorAll("[data-tests-action-message]").forEach((button) => {
    button.addEventListener("click", () => {
      showToast(button.getAttribute("data-tests-action-message"));
    });
  });
}

function goBack(fallbackView) {
  const target = fallbackView || getBackFallback(currentView) || "tools";
  renderView(target, getActiveNavId(target));
}

function bindBackInteractions() {
  document.querySelectorAll("[data-go-back]").forEach((button) => {
    button.addEventListener("click", () => {
      goBack(button.getAttribute("data-go-back"));
    });
  });
}

function bindSettingsAppearanceInteractions(view) {
  if (view !== "settings") {
    return;
  }

  const card = document.querySelector("[data-appearance-card]");
  const toggle = document.querySelector("[data-appearance-toggle]");
  if (!card || !toggle) {
    return;
  }

  toggle.addEventListener("click", () => {
    const isExpanded = card.classList.toggle("is-expanded");
    toggle.setAttribute("aria-expanded", isExpanded ? "true" : "false");
  });
}

function bindQuestionSearchShell(subjectId) {
  const shell = document.querySelector("[data-question-search-shell]");
  const input = document.querySelector("[data-question-search-input]");
  if (!shell || !input) {
    return { shell: null, input: null };
  }

  const entry = getQuestionBankStateEntry(subjectId);

  const syncState = () => {
    const hasValue = input.value.trim().length > 0;
    shell.classList.toggle("has-value", hasValue);
    if (!hasValue && document.activeElement !== input) {
      shell.classList.remove("is-expanded");
    }
    entry.expandedSearch = shell.classList.contains("is-expanded") || hasValue;
    return hasValue;
  };

  const expand = () => {
    shell.classList.add("is-expanded");
  };

  if (getQuestionBankQuery(subjectId).trim()) {
    shell.classList.add("is-expanded");
    shell.classList.add("has-value");
  } else if (entry.pendingRestore && entry.expandedSearch) {
    shell.classList.add("is-expanded");
  }

  shell.addEventListener("pointerdown", (event) => {
    if (event.target !== input) {
      event.preventDefault();
    }
    expand();
    setTimeout(() => input.focus(), 10);
  });

  input.addEventListener("focus", expand);
  input.addEventListener("input", syncState);
  input.addEventListener("blur", () => {
    setTimeout(syncState, 90);
  });

  syncState();
  return { shell, input };
}

function updateQuestionBankView(subjectId, mutateEntry) {
  const entry = saveQuestionBankViewState(subjectId, {
    pendingRestore: true,
    useQuestionFallbackOnRestore: false,
  });
  mutateEntry(entry);
  refreshView(currentView, { activateNav: false });
}

function toggleFilterSelection(selectedIds, optionId, allowedIds) {
  const current = Array.isArray(selectedIds) ? [...selectedIds] : [];
  const filteredCurrent = current.filter((id) => allowedIds.includes(id));
  const isSelected = filteredCurrent.includes(optionId);

  if (isSelected) {
    if (filteredCurrent.length === 1) {
      return filteredCurrent;
    }

    return filteredCurrent.filter((id) => id !== optionId);
  }

  return [...filteredCurrent, optionId];
}

function bindQuestionBankInteractions(view) {
  const subject = getQuestionBankSubjectByView(view);
  if (!subject) {
    return;
  }

  bindQuestionBankStickyState();
  const { input } = bindQuestionSearchShell(subject.id);
  const resultsContainer = document.querySelector("[data-question-bank-results]");

  if (!resultsContainer) {
    return;
  }

  const renderResults = () => {
    const state = buildQuestionBankState(subject);
    resultsContainer.innerHTML = renderQuestionBankResults(subject, state);
  };

  if (input) {
    input.addEventListener("input", () => {
      setQuestionBankQuery(subject.id, input.value);
      renderResults();
    });
  }

  resultsContainer.addEventListener("click", (event) => {
    const resetButton = event.target.closest("[data-question-bank-reset-filters]");
    if (resetButton && subject.id === "biology") {
      updateQuestionBankView(subject.id, (entry) => {
        const snapshot = getQuestionBankSnapshotBySubject(subject.id);
        if (snapshot.status === "ready") {
          entry.filters = createDefaultQuestionBankFilters(snapshot.records);
        }
        entry.isFilterPanelOpen = false;
        entry.openAccordion = null;
      });
      return;
    }

    const button = event.target.closest("[data-question-detail-view]");
    if (!button) {
      return;
    }

    const detailView = button.getAttribute("data-question-detail-view");
    if (detailView) {
      saveQuestionBankViewState(subject.id, {
        lastOpenedQuestionView: detailView,
        isFilterPanelOpen: false,
        openAccordion: null,
      });
      renderView(detailView, "materials");
    }
  });

  const menuToggle = document.querySelector("[data-question-bank-menu-toggle]");
  const panelDismiss = document.querySelector("[data-question-bank-panel-dismiss]");
  const menuPanel = document.querySelector(".question-bank-menu-panel");

  if (menuToggle && subject.id === "biology") {
    menuToggle.addEventListener("click", () => {
      updateQuestionBankView(subject.id, (entry) => {
        entry.isFilterPanelOpen = !entry.isFilterPanelOpen;
        if (!entry.isFilterPanelOpen) {
          entry.openAccordion = null;
        }
      });
    });
  }

  if (panelDismiss && subject.id === "biology") {
    panelDismiss.addEventListener("click", () => {
      updateQuestionBankView(subject.id, (entry) => {
        entry.isFilterPanelOpen = false;
        entry.openAccordion = null;
      });
    });
  }

  if (menuPanel && subject.id === "biology") {
    menuPanel.addEventListener("click", (event) => {
      const accordionButton = event.target.closest("[data-question-bank-accordion]");
      if (accordionButton) {
        const group = accordionButton.getAttribute("data-question-bank-accordion");
        updateQuestionBankView(subject.id, (entry) => {
          entry.isFilterPanelOpen = true;
          entry.openAccordion = entry.openAccordion === group ? null : group;
        });
        return;
      }

      const viewModeButton = event.target.closest("[data-question-bank-view-mode]");
      if (viewModeButton) {
        const nextMode = viewModeButton.getAttribute("data-question-bank-view-mode");
        updateQuestionBankView(subject.id, (entry) => {
          entry.isFilterPanelOpen = true;
          entry.viewMode = nextMode === "icons" ? "icons" : "list";
        });
        return;
      }

      const resetButton = event.target.closest("[data-question-bank-reset-filters]");
      if (resetButton) {
        updateQuestionBankView(subject.id, (entry) => {
          const snapshot = getQuestionBankSnapshotBySubject(subject.id);
          if (snapshot.status === "ready") {
            entry.filters = createDefaultQuestionBankFilters(snapshot.records);
          }
          entry.isFilterPanelOpen = true;
          entry.openAccordion = null;
        });
        return;
      }

      const optionButton = event.target.closest("[data-filter-group][data-filter-option]");
      if (!optionButton) {
        return;
      }

      const group = optionButton.getAttribute("data-filter-group");
      const optionId = optionButton.getAttribute("data-filter-option");

      updateQuestionBankView(subject.id, (entry) => {
        const snapshot = getQuestionBankSnapshotBySubject(subject.id);
        if (snapshot.status !== "ready") {
          return;
        }

        const currentFilters = normalizeQuestionBankFilters(snapshot.records, entry.filters || {});
        const currentOptions = buildQuestionBankFilterOptions(snapshot.records, currentFilters.chapterIds);
        const optionMap = {
          sourceIds: currentOptions.sources.map((item) => item.id),
          chapterIds: currentOptions.chapters.map((item) => item.id),
          topicIds: currentOptions.topics.map((item) => item.id),
          questionTypeIds: currentOptions.questionTypes.map((item) => item.id),
        };

        if (!optionMap[group]) {
          return;
        }

        currentFilters[group] = toggleFilterSelection(currentFilters[group], optionId, optionMap[group]);

        if (group === "chapterIds") {
          currentFilters.topicIds = normalizeQuestionBankFilters(snapshot.records, currentFilters).topicIds;
        }

        entry.filters = normalizeQuestionBankFilters(snapshot.records, currentFilters);
        entry.isFilterPanelOpen = true;
        entry.openAccordion = group;
      });
    });
  }

  const entry = getQuestionBankStateEntry(subject.id);
  if (entry.isFilterPanelOpen) {
    const handler = (event) => {
      if (event.target.closest(".question-bank-floating-tools")) {
        return;
      }

      cleanupQuestionBankOutsidePointerListener();
      updateQuestionBankView(subject.id, (nextEntry) => {
        nextEntry.isFilterPanelOpen = false;
        nextEntry.openAccordion = null;
      });
    };

    document.addEventListener("pointerdown", handler, true);
    questionBankOutsidePointerCleanup = () => {
      document.removeEventListener("pointerdown", handler, true);
    };
  }

  if (subject.id === "biology") {
    ensureBiologyQuestionBankLoaded();
  }

  const snapshot = buildQuestionBankState(subject);
  if (snapshot.status === "ready" || subject.id !== "biology") {
    restoreQuestionBankViewState(subject.id, { allowQuestionFallback: true });
  }
}

function bindQuestionDetailInteractions(view) {
  if (!isBiologyDetailView(view)) {
    return;
  }

  ensureBiologyQuestionBankLoaded();
}

function bindInteractions(view) {
  bindNavigationInteractions(view, renderView, resolveNavTarget);
  bindBackInteractions();
  bindLockedToolInteractions();
  bindTestsFeatureInteractions();
  bindThemeInteractions();
  bindSettingsAppearanceInteractions(view);
  bindQuestionBankInteractions(view);
  bindQuestionDetailInteractions(view);
  bindSponsoredCarousel();
}

function bindSponsoredCarousel() {
  // Always tear down the previous controller first — render() replaces the entire
  // #screen-content subtree, so any prior carousel DOM is gone and its listeners
  // would otherwise leak.
  if (sponsoredCarouselController) {
    sponsoredCarouselController.destroy();
    sponsoredCarouselController = null;
  }

  const root = document.querySelector("[data-sponsored-carousel]");
  if (!root) return;

  sponsoredCarouselController = new SponsoredCarouselController(root);
}

applyTheme(getStoredTheme());
applyDensity(getStoredDensity());

const startView = viewFromHash() || "tools";
// Preload images from IndexedDB, THEN render the first view.
if (window.ImageDB) {
  window.ImageDB.preloadAllImages().finally(function () {
    refreshView(startView, { activateNav: false });
  });
} else {
  refreshView(startView, { activateNav: false });
}

window.addEventListener("popstate", () => {
  const view = viewFromHash();
  prepareQuestionBankRestore(currentView, view);
  refreshView(view, { activateNav: false });
});
