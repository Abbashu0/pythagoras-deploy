import { pageHead } from "../components/PageHeader.js";
import { renderRichDocument } from "../components/RichDocumentRenderer.js";
import { getTestsSubjectView, screens } from "../scripts/data.js";
import { icon } from "../scripts/icons.js";

const states = new Map();

export function renderQuestionBankPlaceholder(subject) {
  const meta = {
    ...screens.questions,
    eyebrow: subject.title,
    title: "بنك الأسئلة",
    copy: `المحتوى المنشور فقط من بنك أسئلة ${subject.title}.`,
    stateLabel: "منشور",
  };
  return `${pageHead(meta, { backView: getTestsSubjectView(subject.id), backLabel: `الرجوع إلى ${subject.title}`, reserveBackSpace: true })}<div class="question-bank-root" data-question-bank-root data-subject-key="${escapeAttribute(subject.id)}"><section class="question-bank-loading placeholder-card"><span class="question-bank-spinner" aria-hidden="true"></span><h2 class="placeholder-title">جارٍ تحميل بنك الأسئلة</h2><p class="placeholder-text">نقرأ التوزيع المنشور لهذه المادة.</p></section></div>`;
}

export function mountQuestionBank(subject) {
  const root = document.querySelector("[data-question-bank-root]");
  if (!root) return;
  const state = states.get(subject.id) ?? { layout: null, screen: "layout", bankId: null, page: null, detail: null, offset: 0, activeGroupBanks: new Map() };
  states.set(subject.id, state);
  loadLayout(root, subject, state);
}

async function loadLayout(root, subject, state) {
  try {
    const body = await requestJson(`/api/content/question-bank/${encodeURIComponent(subject.id)}`);
    state.layout = body.layout;
    const enabledRoots = body.layout.nodes.filter((node) => node.parentId === null && node.available).sort(orderNodes);
    if (body.layout.rootPresentation === "DIRECT" && enabledRoots.length === 1 && enabledRoots[0].nodeType === "BANK") { await openBank(root, subject, state, enabledRoots[0].id, 0); return; }
    state.screen = "layout"; render(root, subject, state);
  } catch (error) { root.innerHTML = error.status === 404 ? emptyState(subject) : errorState(); bind(root, subject, state); }
}

function render(root, subject, state) {
  if (state.screen === "detail" && state.detail) root.innerHTML = renderDetail(state.detail, state.detailOrdinal);
  else if (state.screen === "bank" && state.page && state.bankId) root.innerHTML = renderQuestionList(state.layout, state.bankId, state.page);
  else root.innerHTML = renderLayout(state.layout, state);
  bind(root, subject, state);
}

function renderLayout(layout, state) {
  const roots = layout.nodes.filter((node) => node.parentId === null).sort(orderNodes);
  if (!roots.length) return `<section class="placeholder-card"><div class="icon-wrap placeholder featured">${icon("tests")}</div><h2 class="placeholder-title">بنك الأسئلة قيد التجهيز</h2><p class="placeholder-text">لم يُنشر أي مسار متاح داخل هذه المادة حتى الآن.</p></section>`;
  return `<section class="question-bank-layout" data-root-presentation="${layout.rootPresentation}"><div class="question-bank-layout-head"><span>تصفّح المحتوى</span><small>${roots.length} مسار منشور</small></div><div class="question-bank-card-grid">${roots.map((node) => renderNode(node, layout.nodes, state)).join("")}</div></section>`;
}

function renderNode(node, all, state) {
  const children = all.filter((item) => item.parentId === node.id).sort(orderNodes);
  if (node.nodeType === "BANK") return `<button type="button" class="question-bank-entry${node.available ? "" : " is-disabled"}" ${node.available ? `data-open-bank="${escapeAttribute(node.id)}"` : "disabled"}><span class="question-bank-entry-icon">${icon("tests")}</span><span><strong>${escapeHtml(node.label)}</strong><small>${node.available ? "فتح قائمة الأسئلة" : "قيد التجهيز"}</small></span><span class="question-bank-chevron" aria-hidden="true">‹</span></button>`;
  if (node.groupPresentation === "SWITCHER") {
    const active = children.find((child) => child.id === state.activeGroupBanks.get(node.id)) ?? children.find((child) => child.available) ?? children[0];
    return `<article class="question-bank-group question-bank-group--switcher"><header><span class="question-bank-entry-icon">${icon("tests")}</span><div><h2>${escapeHtml(node.label)}</h2><small>اختر القسم المطلوب</small></div></header><div class="question-bank-switcher" role="tablist">${children.map((child) => `<button type="button" role="tab" class="${child.id === active?.id ? "is-active" : ""}" data-group-switch="${escapeAttribute(node.id)}" data-bank-id="${escapeAttribute(child.id)}" ${child.available ? "" : "disabled"}>${escapeHtml(child.label)}</button>`).join("")}</div>${active ? `<button type="button" class="question-bank-switcher-open" data-open-bank="${escapeAttribute(active.id)}" ${active.available ? "" : "disabled"}>${active.available ? "عرض الأسئلة" : "قيد التجهيز"}<span aria-hidden="true">‹</span></button>` : ""}</article>`;
  }
  return `<article class="question-bank-group"><header><span class="question-bank-entry-icon">${icon("tests")}</span><div><h2>${escapeHtml(node.label)}</h2><small>${children.length} مسار</small></div></header><div class="question-bank-group-children">${children.map((child) => renderNode(child, all, state)).join("")}</div></article>`;
}

async function openBank(root, subject, state, bankId, offset) {
  root.innerHTML = loadingCard("جارٍ تحميل الأسئلة");
  try {
    const body = await requestJson(`/api/content/question-bank/${encodeURIComponent(subject.id)}/banks/${encodeURIComponent(bankId)}/questions?offset=${offset}&limit=50`);
    state.screen = "bank"; state.bankId = bankId; state.offset = body.page.offset; state.page = body.page; state.detail = null; render(root, subject, state);
  } catch { root.innerHTML = errorState(); bind(root, subject, state); }
}

function renderQuestionList(layout, bankId, page) {
  const bank = layout.nodes.find((node) => node.id === bankId);
  return `<section class="question-bank-list"><button type="button" class="question-bank-inline-back" data-bank-back>العودة إلى أقسام البنك</button><header class="question-bank-list-head"><div><small>المسار الحالي</small><h2>${escapeHtml(bank?.label ?? "الأسئلة")}</h2></div><span>${page.total} سؤال</span></header>${page.items.length ? `<div class="question-bank-questions">${page.items.map((item) => `<button type="button" class="question-bank-question" data-question-id="${escapeAttribute(item.questionId)}"><span class="question-bank-ordinal">#${item.ordinal}</span><span class="question-bank-question-copy"><strong>${escapeHtml(item.primaryPreview)}</strong><small>${escapeHtml(item.taxonomyBreadcrumb)} · ${item.variantCount} صيغة · ${item.occurrenceCount} ورود</small></span><span class="question-bank-chevron" aria-hidden="true">‹</span></button>`).join("")}</div><nav class="question-bank-pagination" aria-label="صفحات الأسئلة"><button type="button" data-page-offset="${Math.max(0, page.offset - page.limit)}" ${page.offset === 0 ? "disabled" : ""}>السابق</button><span>${page.offset + 1}–${Math.min(page.offset + page.items.length, page.total)} من ${page.total}</span><button type="button" data-page-offset="${page.offset + page.limit}" ${page.offset + page.limit >= page.total ? "disabled" : ""}>التالي</button></nav>` : `<div class="question-bank-empty"><h3>لا توجد أسئلة في هذا المسار</h3><p>المسار منشور لكنه لا يحتوي أسئلة مطابقة حاليًا.</p></div>`}</section>`;
}

async function openDetail(root, subject, state, questionId) {
  state.detailOrdinal = state.page?.items.find((item) => item.questionId === questionId)?.ordinal ?? null;
  root.innerHTML = loadingCard("جارٍ فتح السؤال");
  try { const body = await requestJson(`/api/content/question-bank/${encodeURIComponent(subject.id)}/banks/${encodeURIComponent(state.bankId)}/questions/${encodeURIComponent(questionId)}`); state.screen = "detail"; state.detail = body.question; render(root, subject, state); }
  catch { root.innerHTML = errorState(); bind(root, subject, state); }
}

function renderDetail(question, visibleOrdinal) {
  question = { ...question, canonicalOrder: visibleOrdinal ?? 1 };
  return `<section class="question-bank-detail"><button type="button" class="question-bank-inline-back" data-detail-back>العودة إلى القائمة</button><header class="question-bank-detail-head"><span>سؤال #${question.canonicalOrder}</span><small>${question.variants.length} صيغة</small></header><div class="question-bank-variants">${question.variants.map((variant, index) => `<article class="question-bank-variant"><div class="question-bank-variant-title"><strong>الصيغة ${index + 1}</strong>${variant.id === question.primaryVariantId ? "<span>أساسية</span>" : ""}</div>${renderRichDocument(variant.content)}${variant.occurrences.length ? `<div class="question-bank-occurrences"><small>الورود الوزاري</small>${variant.occurrences.map((item) => `<span title="${escapeAttribute(item.rawLabel)}">${escapeHtml(item.rawLabel)}</span>`).join("")}</div>` : ""}</article>`).join("")}</div>${question.sharedAnswer ? `<article class="question-bank-answer"><h3>الإجابة المشتركة</h3>${renderRichDocument(question.sharedAnswer)}</article>` : ""}${question.taxonomy.length ? `<footer class="question-bank-taxonomy">${question.taxonomy.map((item) => `<span>${escapeHtml(item.breadcrumb)}</span>`).join("")}</footer>` : ""}</section>`;
}

function bind(root, subject, state) {
  root.querySelectorAll("[data-open-bank]").forEach((button) => button.addEventListener("click", () => void openBank(root, subject, state, button.dataset.openBank, 0)));
  root.querySelectorAll("[data-group-switch]").forEach((button) => button.addEventListener("click", () => { state.activeGroupBanks.set(button.dataset.groupSwitch, button.dataset.bankId); render(root, subject, state); }));
  root.querySelectorAll("[data-question-id]").forEach((button) => button.addEventListener("click", () => void openDetail(root, subject, state, button.dataset.questionId)));
  root.querySelectorAll("[data-page-offset]").forEach((button) => button.addEventListener("click", () => void openBank(root, subject, state, state.bankId, Number(button.dataset.pageOffset))));
  root.querySelector("[data-bank-back]")?.addEventListener("click", () => { state.screen = "layout"; render(root, subject, state); });
  root.querySelector("[data-detail-back]")?.addEventListener("click", () => { state.screen = "bank"; state.detail = null; render(root, subject, state); });
  root.querySelector("[data-retry-bank]")?.addEventListener("click", () => void loadLayout(root, subject, state));
}

async function requestJson(url) { const response = await fetch(url, { cache: "no-store" }); const body = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(body.code || "QUESTION_BANK_REQUEST_FAILED"); error.status = response.status; throw error; } return body; }
function emptyState(subject) { return `<section class="placeholder-card"><div class="icon-wrap placeholder featured">${icon("tests")}</div><h2 class="placeholder-title">بنك الأسئلة قيد البناء</h2><p class="placeholder-text">لا يوجد تخطيط منشور لبنك أسئلة ${escapeHtml(subject.title)} حتى الآن.</p></section>`; }
function errorState() { return `<section class="placeholder-card"><h2 class="placeholder-title">تعذّر تحميل بنك الأسئلة</h2><p class="placeholder-text">تحقق من الاتصال ثم حاول مرة أخرى.</p><button type="button" class="question-bank-retry" data-retry-bank>إعادة المحاولة</button></section>`; }
function loadingCard(label) { return `<section class="question-bank-loading placeholder-card"><span class="question-bank-spinner" aria-hidden="true"></span><h2 class="placeholder-title">${label}</h2></section>`; }
function orderNodes(a, b) { return a.displayOrder - b.displayOrder || a.id.localeCompare(b.id); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
function escapeAttribute(value) { return escapeHtml(value).replace(/`/g, "&#096;"); }
