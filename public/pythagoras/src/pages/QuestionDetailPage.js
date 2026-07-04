import { pageHead } from "../components/PageHeader.js";
import { getBiologyQuestionDetailView, getQuestionBankView, getViewMeta } from "../scripts/data.js";
import { icon } from "../scripts/icons.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderParagraphs(text) {
  return String(text || "")
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("");
}

function renderListItems(items = [], ordered = false) {
  if (!Array.isArray(items) || !items.length) {
    return "";
  }

  const tag = ordered ? "ol" : "ul";
  const className = ordered ? "question-answer-list is-ordered" : "question-answer-list";

  return `
    <${tag} class="${className}">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </${tag}>`;
}

function renderEmptyDetail(title, text, iconName = "tests") {
  return `
    <section class="question-bank-empty question-detail-empty" aria-label="${escapeHtml(title)}">
      <div class="icon-wrap question-bank-empty-icon">${icon(iconName)}</div>
      <div class="question-bank-empty-copy">
        <h2 class="question-bank-empty-title">${escapeHtml(title)}</h2>
        <p class="question-bank-empty-text">${escapeHtml(text)}</p>
      </div>
    </section>`;
}

function renderMetaChips(record) {
  const chips = [
    record.chapterName ? `<span class="question-detail-chip">${escapeHtml(record.chapterName)}</span>` : "",
    record.questionTypeLabel ? `<span class="question-detail-chip is-accent">${escapeHtml(record.questionTypeLabel)}</span>` : "",
    record.primaryTopic?.name && record.primaryTopic.name !== record.chapterName
      ? `<span class="question-detail-chip is-soft">${escapeHtml(record.primaryTopic.name)}</span>`
      : "",
    record.sourceSummary?.primaryLabel
      ? `<span class="question-detail-chip is-source">${escapeHtml(record.sourceSummary.primaryLabel)}</span>`
      : "",
  ].filter(Boolean);

  return chips.length
    ? `<div class="question-detail-meta stagger" style="animation-delay:110ms">${chips.join("")}</div>`
    : "";
}

function renderSourceBadges(sourceSummary = {}) {
  const badges = [];

  if (sourceSummary.officialExamCount > 0) {
    badges.push(`<span class="question-detail-chip is-source">وزاري ${escapeHtml(sourceSummary.officialExamCount)} مرات</span>`);
  }
  if (sourceSummary.hasEducationalTv) {
    badges.push('<span class="question-detail-chip is-soft">التلفزيون التربوي</span>');
  }
  if (sourceSummary.hasEndChapter) {
    badges.push('<span class="question-detail-chip is-soft">نهاية الفصل</span>');
  }
  if (Array.isArray(sourceSummary.allRefs)) {
    sourceSummary.allRefs.forEach((ref) => {
      if (ref && ref !== sourceSummary.primaryLabel) {
        badges.push(`<span class="question-detail-chip">${escapeHtml(ref)}</span>`);
      }
    });
  }

  return badges.length
    ? `
      <section class="question-detail-card stagger" style="animation-delay:230ms">
        <h2 class="question-detail-card-title">المصادر</h2>
        <div class="question-detail-meta">${badges.join("")}</div>
      </section>`
    : "";
}

function renderFillBlank(view) {
  return `
    ${view.template ? `<div class="question-detail-rich-text">${renderParagraphs(view.template)}</div>` : ""}
    <div class="question-answer-rows">
      ${(view.blanks || []).map((blank, index) => `
        <div class="question-answer-row">
          <span class="question-answer-label">الفراغ ${index + 1}</span>
          <span class="question-answer-value">${escapeHtml(blank.answer || "")}</span>
        </div>`).join("")}
    </div>`;
}

function renderMcq(view) {
  return `
    ${view.question ? `<div class="question-detail-rich-text">${renderParagraphs(view.question)}</div>` : ""}
    <div class="question-mcq-options">
      ${(view.options || []).map((option) => `
        <div class="question-mcq-option${option === view.correctAnswer ? " is-correct" : ""}">
          <span class="question-mcq-marker">${option === view.correctAnswer ? icon("check") : ""}</span>
          <span>${escapeHtml(option)}</span>
        </div>`).join("")}
    </div>`;
}

function renderReason(view) {
  return `
    ${view.claim ? `
      <div class="question-answer-row is-block">
        <span class="question-answer-label">العبارة</span>
        <div class="question-answer-value">${renderParagraphs(view.claim)}</div>
      </div>` : ""}
    ${view.reason ? `
      <div class="question-answer-row is-block">
        <span class="question-answer-label">التعليل</span>
        <div class="question-answer-value">${renderParagraphs(view.reason)}</div>
      </div>` : ""}`;
}

function renderDefinition(view) {
  return `
    ${view.term ? `
      <div class="question-answer-row is-block">
        <span class="question-answer-label">المصطلح</span>
        <div class="question-answer-value">${renderParagraphs(view.term)}</div>
      </div>` : ""}
    ${view.definition ? `
      <div class="question-answer-row is-block">
        <span class="question-answer-label">التعريف</span>
        <div class="question-answer-value">${renderParagraphs(view.definition)}</div>
      </div>` : ""}`;
}

function renderList(view) {
  return `
    ${view.title ? `<div class="question-detail-rich-text">${renderParagraphs(view.title)}</div>` : ""}
    ${renderListItems(view.items)}
    ${Array.isArray(view.groups) && view.groups.length ? `
      <div class="question-detail-meta">
        ${view.groups.map((group) => `<span class="question-detail-chip is-soft">${escapeHtml(group.label || "")}</span>`).join("")}
      </div>` : ""}`;
}

function renderComparisonColumns(view) {
  return `
    <div class="question-comparison-columns">
      ${(view.columns || []).map((column) => `
        <section class="question-comparison-column">
          <h3 class="question-comparison-column-title">${escapeHtml(column.label || "")}</h3>
          ${renderListItems(column.items)}
        </section>`).join("")}
    </div>`;
}

function renderComparisonTable(view) {
  const columns = Array.isArray(view.columns) && view.columns.length
    ? view.columns.map((column) => column.label || "")
    : (view.comparedItems || []);
  const axes = Array.isArray(view.axes) ? view.axes : [];
  const cellMap = new Map((view.cells || []).map((cell) => [`${cell.axis}::${cell.column}`, cell.text || ""]));

  return `
    <div class="question-comparison-table-wrap">
      <table class="question-comparison-table">
        <thead>
          <tr>
            <th>المحور</th>
            ${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${axes.map((axis) => `
            <tr>
              <th>${escapeHtml(axis)}</th>
              ${columns.map((column) => `<td>${escapeHtml(cellMap.get(`${axis}::${column}`) || "")}</td>`).join("")}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function renderAttributeSlots(view) {
  return `
    ${view.targetQuestion ? `<div class="question-detail-rich-text">${renderParagraphs(view.targetQuestion)}</div>` : ""}
    <div class="question-answer-rows">
      ${(view.slots || []).map((slot) => `
        <div class="question-answer-row">
          <span class="question-answer-label">${escapeHtml(slot.label || "")}</span>
          <span class="question-answer-value">${escapeHtml(slot.value || "")}</span>
        </div>`).join("")}
    </div>`;
}

function renderSequence(view) {
  return `
    ${view.prompt ? `<div class="question-detail-rich-text">${renderParagraphs(view.prompt)}</div>` : ""}
    ${renderListItems(view.correctOrder, true)}`;
}

function renderDirectAnswer(view) {
  return `
    ${view.question ? `
      <div class="question-answer-row is-block">
        <span class="question-answer-label">السؤال</span>
        <div class="question-answer-value">${renderParagraphs(view.question)}</div>
      </div>` : ""}
    ${view.answer ? `
      <div class="question-answer-row is-block">
        <span class="question-answer-label">الإجابة</span>
        <div class="question-answer-value">${renderParagraphs(view.answer)}</div>
      </div>` : ""}`;
}

function renderExplanation(view) {
  return `
    ${view.title ? `<div class="question-detail-rich-text">${renderParagraphs(view.title)}</div>` : ""}
    <div class="question-detail-rich-text">${renderParagraphs((view.paragraphs || []).join("\n\n"))}</div>`;
}

function renderSimpleTargetAnswer(label, target, answer) {
  return `
    ${target ? `
      <div class="question-answer-row is-block">
        <span class="question-answer-label">${label}</span>
        <div class="question-answer-value">${renderParagraphs(target)}</div>
      </div>` : ""}
    ${answer ? `
      <div class="question-answer-row is-block">
        <span class="question-answer-label">الإجابة الصحيحة</span>
        <div class="question-answer-value">${renderParagraphs(answer)}</div>
      </div>` : ""}`;
}

function renderDiagramPractice(view) {
  const checklist = Array.isArray(view.selfCheckChecklist) ? view.selfCheckChecklist : [];
  const asset = view.diagramAsset || {};

  return `
    ${asset.alt ? `
      <div class="question-answer-row is-block">
        <span class="question-answer-label">وصف الرسم</span>
        <div class="question-answer-value">${renderParagraphs(asset.alt)}</div>
      </div>` : ""}
    ${asset.assetStatus ? `
      <div class="question-answer-row">
        <span class="question-answer-label">حالة الأصل</span>
        <span class="question-answer-value">${escapeHtml(asset.assetStatus)}</span>
      </div>` : ""}
    ${checklist.length ? `
      <div class="question-answer-row is-block">
        <span class="question-answer-label">خطوات المراجعة الذاتية</span>
        <div class="question-answer-value">${renderListItems(checklist)}</div>
      </div>` : ""}`;
}

function renderAnswerBody(record) {
  const view = record.answerView || {};

  switch (view.type) {
    case "fill-blank":
      return renderFillBlank(view);
    case "mcq-original":
      return renderMcq(view);
    case "reason":
      return renderReason(view);
    case "definition":
      return renderDefinition(view);
    case "list":
      return renderList(view);
    case "comparison":
      return view.displayMode === "cell-exact" ? renderComparisonTable(view) : renderComparisonColumns(view);
    case "attribute-slots":
      return renderAttributeSlots(view);
    case "sequence":
      return renderSequence(view);
    case "direct-answer":
      return renderDirectAnswer(view);
    case "explanation":
      return renderExplanation(view);
    case "phase-stage":
      return renderSimpleTargetAnswer("الحدث", view.event, view.correctAnswer);
    case "tissue-type":
      return renderSimpleTargetAnswer("المطلوب", view.target, view.correctAnswer);
    case "chromosome-group":
      return renderSimpleTargetAnswer("المطلوب", view.target, view.correctAnswer);
    case "diagram-practice":
      return renderDiagramPractice(view);
    default:
      return record.answerText
        ? `<div class="question-detail-rich-text">${renderParagraphs(record.answerText)}</div>`
        : '<p class="question-bank-empty-text">لا توجد طريقة عرض متاحة لهذا الجواب حاليًا.</p>';
  }
}

function renderAppearances(appearances = []) {
  const uniqueAppearances = appearances
    .filter((appearance) => appearance?.questionText)
    .filter((appearance, index, items) => items.findIndex((entry) => entry.questionText === appearance.questionText) === index);

  if (!uniqueAppearances.length) {
    return "";
  }

  return `
    <section class="question-detail-card stagger" style="animation-delay:210ms">
      <h2 class="question-detail-card-title">صيغ أخرى للسؤال</h2>
      <div class="question-appearance-list">
        ${uniqueAppearances.map((appearance) => `
          <article class="question-appearance-item">
            <div class="question-detail-rich-text">${renderParagraphs(appearance.questionText)}</div>
            ${Array.isArray(appearance.refs) && appearance.refs.length ? `
              <div class="question-detail-meta">
                ${appearance.refs.map((ref) => `<span class="question-detail-chip is-soft">${escapeHtml(ref)}</span>`).join("")}
              </div>` : ""}
          </article>`).join("")}
      </div>
    </section>`;
}

export function questionDetailScreen(globalOrder, recordState = {}) {
  const detailView = getBiologyQuestionDetailView(globalOrder);
  const meta = getViewMeta(detailView);
  const baseHeader = pageHead(meta, {
    backView: getQuestionBankView("biology"),
    backLabel: "الرجوع إلى بنك أسئلة الأحياء",
    hideCopy: true,
    useFloatingBackButton: true,
    reserveBackSpace: true,
  });

  if (recordState.status === "loading" || recordState.status === "idle") {
    return `
      ${baseHeader}
      <div class="question-detail-stack">
        ${renderEmptyDetail("جاري تحميل السؤال...", "يتم الآن تجهيز تفاصيل السؤال من بنك أسئلة الأحياء.", "tests")}
      </div>`;
  }

  if (recordState.status === "error") {
    return `
      ${baseHeader}
      <div class="question-detail-stack">
        ${renderEmptyDetail("تعذر تحميل السؤال", "حاول تحديث الصفحة مرة أخرى.", "tests")}
      </div>`;
  }

  const record = recordState.record;
  if (!record) {
    return `
      ${baseHeader}
      <div class="question-detail-stack">
        ${renderEmptyDetail("لم يتم العثور على السؤال", "قد يكون رقم السؤال غير موجود أو لم يكتمل التحميل بعد.", "tests")}
      </div>`;
  }

  return `
    ${baseHeader}
    <div class="question-detail-stack">
      ${renderMetaChips(record)}

      <section class="question-detail-card stagger" style="animation-delay:140ms">
        <h2 class="question-detail-card-title">السؤال</h2>
        <div class="question-detail-rich-text">${renderParagraphs(record.displayQuestion || "")}</div>
      </section>

      <section class="question-detail-card stagger" style="animation-delay:170ms">
        <h2 class="question-detail-card-title">الجواب</h2>
        ${renderAnswerBody(record)}
      </section>

      ${renderAppearances(record.appearances)}
      ${renderSourceBadges(record.sourceSummary)}
    </div>`;
}
