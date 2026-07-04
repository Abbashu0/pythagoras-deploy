import { pageHead } from "../components/PageHeader.js";
import { getBiologyQuestionDetailView, getQuestionBankView, getViewMeta } from "../scripts/data.js";
import { icon } from "../scripts/icons.js";
import { getOfficialTopicInfo } from "../scripts/questionBankFilters.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderEmptyState(title, text, iconName = "search", action = "") {
  return `
    <section class="question-bank-empty stagger" style="animation-delay:170ms" aria-label="\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0623\u0633\u0626\u0644\u0629">
      <div class="icon-wrap question-bank-empty-icon">${icon(iconName)}</div>
      <div class="question-bank-empty-copy">
        <h2 class="question-bank-empty-title">${title}</h2>
        <p class="question-bank-empty-text">${text}</p>
      </div>
      ${action}
    </section>`;
}

function renderFilterResetAction() {
  return `
    <button type="button" class="question-bank-empty-action" data-question-bank-reset-filters>
      <span class="question-bank-empty-action-icon">${icon("refresh")}</span>
      <span>\u0625\u0639\u0627\u062f\u0629 \u0636\u0628\u0637 \u0627\u0644\u0641\u0644\u0627\u062a\u0631</span>
    </button>`;
}

function renderQuestionCard(record, viewMode = "list") {
  const topicInfo = getOfficialTopicInfo(record);
  const primaryTopic = topicInfo?.label || record.primaryTopic?.name || record.chapterName || "";
  const metaBits = [
    record.questionTypeLabel ? `<span class="question-bank-chip is-type">${escapeHtml(record.questionTypeLabel)}</span>` : "",
    record.chapterName ? `<span class="question-bank-chip">${escapeHtml(record.chapterName)}</span>` : "",
    primaryTopic && primaryTopic !== record.chapterName ? `<span class="question-bank-chip is-soft">${escapeHtml(primaryTopic)}</span>` : "",
  ].filter(Boolean).join("");

  return `
    <button
      type="button"
      class="question-bank-item${viewMode === "icons" ? " is-grid" : ""}"
      data-question-detail-view="${getBiologyQuestionDetailView(record.globalOrder)}"
    >
      <span class="question-bank-item-number">#${record.globalOrder}</span>
      <div class="question-bank-item-copy">
        <p class="question-bank-item-text">${escapeHtml(record.displayQuestion || "")}</p>
        <div class="question-bank-item-meta">${metaBits}</div>
      </div>
    </button>`;
}

export function renderQuestionBankResults(subject, state) {
  if (subject.id !== "biology") {
    return renderEmptyState(
      "\u0644\u0645 \u062a\u062a\u0645 \u0625\u0636\u0627\u0641\u0629 \u0628\u0646\u0643 \u0623\u0633\u0626\u0644\u0629 \u0647\u0630\u0647 \u0627\u0644\u0645\u0627\u062f\u0629 \u0628\u0639\u062f",
      "\u0633\u064a\u0638\u0647\u0631 \u0628\u0646\u0643 \u0623\u0633\u0626\u0644\u0629 \u0647\u0630\u0647 \u0627\u0644\u0645\u0627\u062f\u0629 \u0647\u0646\u0627 \u0628\u0639\u062f \u0631\u0628\u0637 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a.",
      subject.icon,
    );
  }

  if (state.status === "loading" || state.status === "idle") {
    return renderEmptyState(
      "\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u0628\u0646\u0643 \u0627\u0644\u0623\u0633\u0626\u0644\u0629...",
      "\u064a\u062a\u0645 \u0627\u0644\u0622\u0646 \u062a\u062c\u0647\u064a\u0632 \u0623\u0633\u0626\u0644\u0629 \u0627\u0644\u0623\u062d\u064a\u0627\u0621 \u0644\u0644\u0639\u0631\u0636 \u0648\u0627\u0644\u0628\u062d\u062b.",
      "tests",
    );
  }

  if (state.status === "error") {
    return renderEmptyState(
      "\u062a\u0639\u0630\u0631 \u062a\u062d\u0645\u064a\u0644 \u0628\u0646\u0643 \u0627\u0644\u0623\u0633\u0626\u0644\u0629",
      "\u062d\u0627\u0648\u0644 \u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0635\u0641\u062d\u0629 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.",
      "tests",
    );
  }

  if (!state.results.length && (state.query.trim() || state.hasActiveFilters)) {
    return renderEmptyState(
      "\u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u0633\u0626\u0644\u0629 \u0645\u0637\u0627\u0628\u0642\u0629",
      "\u062c\u0631\u0651\u0628 \u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0628\u062d\u062b \u0623\u0648 \u0627\u0644\u0641\u0644\u0627\u062a\u0631.",
      "search",
      state.hasActiveFilters ? renderFilterResetAction() : "",
    );
  }

  if (!state.results.length) {
    return renderEmptyState(
      "\u0644\u0645 \u062a\u062a\u0645 \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0628\u0639\u062f",
      "\u0633\u064a\u0638\u0647\u0631 \u0628\u0646\u0643 \u0623\u0633\u0626\u0644\u0629 \u0647\u0630\u0647 \u0627\u0644\u0645\u0627\u062f\u0629 \u0647\u0646\u0627 \u0628\u0639\u062f \u0631\u0628\u0637 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a.",
      subject.icon,
    );
  }

  return `
    <section class="question-bank-list${state.viewMode === "icons" ? " is-grid-mode" : ""}" data-question-bank-list aria-label="\u0642\u0627\u0626\u0645\u0629 \u0623\u0633\u0626\u0644\u0629 \u0627\u0644\u0623\u062d\u064a\u0627\u0621">
      ${state.results.map((record) => renderQuestionCard(record, state.viewMode)).join("")}
    </section>`;
}

export function questionBankScreen(subject, state = {}) {
  const meta = getViewMeta(getQuestionBankView(subject.id));
  const queryValue = escapeHtml(state.query || "");

  return `
    ${pageHead(meta, {
      backView: `tests-${subject.id}`,
      backLabel: `\u0627\u0644\u0631\u062c\u0648\u0639 \u0625\u0644\u0649 \u0627\u062e\u062a\u0628\u0627\u0631\u0627\u062a ${subject.title}`,
      hideCopy: true,
      useFloatingBackButton: true,
      reserveBackSpace: true,
    })}
    <div class="question-bank-stack">
      <div class="question-bank-search-sentinel" data-question-search-sentinel aria-hidden="true"></div>
      <div class="question-bank-search-sticky" data-question-search-sticky>
        <div class="question-bank-search-wrap stagger" style="animation-delay:120ms">
          <div class="question-search-shell" data-question-search-shell>
            <label class="question-search" aria-label="\u0627\u0644\u0628\u062d\u062b \u062f\u0627\u062e\u0644 \u0628\u0646\u0643 \u0627\u0644\u0623\u0633\u0626\u0644\u0629">
              <span class="question-search-icon">${icon("search")}</span>
              <input
                type="search"
                class="question-search-input"
                data-question-search-input
                placeholder="\u0627\u0644\u0628\u062d\u062b \u062f\u0627\u062e\u0644 \u0628\u0646\u0643 \u0627\u0644\u0623\u0633\u0626\u0644\u0629..."
                autocomplete="off"
                spellcheck="false"
                aria-label="\u0627\u0644\u0628\u062d\u062b \u062f\u0627\u062e\u0644 \u0628\u0646\u0643 \u0627\u0644\u0623\u0633\u0626\u0644\u0629"
                value="${queryValue}"
              >
            </label>
          </div>
        </div>
      </div>

      <div data-question-bank-results>
        ${renderQuestionBankResults(subject, state)}
      </div>
    </div>`;
}
