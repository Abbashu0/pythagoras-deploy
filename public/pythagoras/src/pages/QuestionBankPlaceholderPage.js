import { pageHead } from "../components/PageHeader.js";
import { renderRichDocument } from "../components/RichDocumentRenderer.js";
import { getTestsSubjectView, screens } from "../scripts/data.js";
import { icon } from "../scripts/icons.js";

const states = new Map();
let currentRenderState = null;
export function renderQuestionBankPlaceholder(subject) {
  const meta = { ...screens.questions, eyebrow: subject.title, title: "بنك الأسئلة", copy: `المحتوى المنشور فقط من بنك أسئلة ${subject.title}.`, stateLabel: "منشور" };
  return `${pageHead(meta, { backView: getTestsSubjectView(subject.id), backLabel: `الرجوع إلى ${subject.title}`, reserveBackSpace: true })}<div class="question-bank-root" data-question-bank-root><section class="question-bank-loading placeholder-card"><span class="question-bank-spinner"></span><h2 class="placeholder-title">جارٍ تحميل بنك الأسئلة</h2></section></div>`;
}
export function mountQuestionBank(subject) {
  const root = document.querySelector("[data-question-bank-root]"); if (!root) return;
  const state = states.get(subject.id) ?? { layout: null, screen: "layout", groupId: null, bankId: null, page: null, detail: null, detailOrdinal: null, activeGroupBanks: new Map(), search: null, provenance: new Map(), expandedProvenance: new Set(), provenanceLoading: new Set() };
  states.set(subject.id, state); void loadLayout(root, subject, state);
}
async function loadLayout(root, subject, state) {
  try { const body = await requestJson(`/api/content/question-bank/${encodeURIComponent(subject.id)}`); state.layout = body.layout; state.screen = "layout"; render(root, subject, state); }
  catch (error) { root.innerHTML = error.status === 404 ? emptyState(subject) : errorState(); bind(root, subject, state); }
}
function render(root, subject, state) {
  currentRenderState = state;
  root.innerHTML = state.screen === "detail" && state.detail ? detail(state.detail, state.detailOrdinal) : state.screen === "bank" && state.page ? bankView(state) : destinations(state.layout, state.screen === "group" ? state.groupId : null);
  bind(root, subject, state);
}
function destinations(layout, parentId) {
  const nodes = layout.nodes.filter((node) => node.parentId === parentId).sort(order); const group = parentId ? layout.nodes.find((node) => node.id === parentId) : null;
  if (!nodes.length) return `<section class="placeholder-card"><h2 class="placeholder-title">بنك الأسئلة قيد التجهيز</h2></section>`;
  return `<section class="question-bank-layout">${group ? `<button type="button" class="question-bank-inline-back" data-group-back>العودة إلى الأقسام</button><header class="question-bank-list-head"><h2>${html(group.label)}</h2></header>` : ""}<div class="question-bank-layout-head"><span>تصفّح المحتوى</span><small>${nodes.length} مسار منشور</small></div><div class="question-bank-card-grid">${nodes.map(node).join("")}</div></section>`;
}
function node(item) { const action = item.nodeType === "BANK" ? `data-open-bank="${attr(item.id)}"` : `data-open-group="${attr(item.id)}"`; return `<button type="button" class="question-bank-entry${item.available ? "" : " is-disabled"}" ${item.available ? action : "disabled"}><span class="question-bank-entry-icon">${icon("tests")}</span><span><strong>${html(item.label)}</strong><small>${item.nodeType === "BANK" ? "فتح قائمة الأسئلة" : item.groupPresentation === "SWITCHER" ? "اختر الموضوع" : "فتح الأقسام"}</small></span><span class="question-bank-chevron">‹</span></button>`; }
async function openGroup(root, subject, state, groupId) {
  const group = state.layout.nodes.find((item) => item.id === groupId); if (!group) return; state.groupId = groupId; state.search = null;
  if (group.groupPresentation === "SWITCHER") { const banks = state.layout.nodes.filter((item) => item.parentId === groupId && item.nodeType === "BANK").sort(order); const active = banks.find((item) => item.id === state.activeGroupBanks.get(groupId)) ?? banks.find((item) => item.available); if (active) { state.activeGroupBanks.set(groupId, active.id); return openBank(root, subject, state, active.id, 0); } }
  state.screen = "group"; state.page = null; render(root, subject, state);
}
async function openBank(root, subject, state, bankId, offset) {
  root.innerHTML = loading("جارٍ تحميل الأسئلة");
  try { const body = await requestJson(`/api/content/question-bank/${encodeURIComponent(subject.id)}/banks/${encodeURIComponent(bankId)}/questions?offset=${offset}&limit=50`); Object.assign(state, { screen: "bank", bankId, page: body.page, detail: null, search: null }); render(root, subject, state); } catch { root.innerHTML = errorState(); bind(root, subject, state); }
}
function bankView(state) {
  const bank = state.layout.nodes.find((item) => item.id === state.bankId); const group = state.groupId ? state.layout.nodes.find((item) => item.id === state.groupId) : null; const page = state.search?.page ?? state.page; const searching = Boolean(state.search);
  const tabs = group?.groupPresentation === "SWITCHER" ? `<div class="question-bank-switcher" role="tablist">${state.layout.nodes.filter((item) => item.parentId === group.id && item.nodeType === "BANK").sort(order).map((item) => `<button type="button" class="${item.id === state.bankId ? "is-active" : ""}" data-group-switch="${attr(group.id)}" data-bank-id="${attr(item.id)}" ${item.available ? "" : "disabled"}>${html(item.label)}</button>`).join("")}</div>` : "";
  return `<section class="question-bank-list"><button type="button" class="question-bank-inline-back" data-bank-back>العودة إلى الأقسام</button><header class="question-bank-list-head"><div><small>المسار الحالي</small><h2>${html(bank?.label ?? "الأسئلة")}</h2></div><span>${page.total} سؤال</span></header>${tabs}<form class="question-bank-search" data-question-search><input name="q" value="${attr(state.search?.query ?? "")}" placeholder="ابحث في الأسئلة" autocomplete="off"><button>بحث</button>${searching ? `<button type="button" data-clear-search>مسح</button>` : ""}</form>${items(page.items, searching)}${pager(page, searching)}</section>`;
}
function itemsLegacy(list, searching) { return list.length ? `<div class="question-bank-questions">${list.map((item) => `<button type="button" class="question-bank-question" data-question-id="${attr(item.questionId)}"><span class="question-bank-ordinal">#${item.bankOrdinal ?? item.ordinal}</span><span class="question-bank-question-copy"><strong>${html(item.primaryPreview)}</strong><small>${html(item.taxonomyBreadcrumb)}${item.matchContext ? ` · ${html(contextLabel(item.matchContext))}` : ""}</small></span><span class="question-bank-chevron">‹</span></button>`).join("")}</div>` : `<div class="question-bank-empty"><h3>${searching ? "لا توجد نتائج" : "لا توجد أسئلة في هذا المسار"}</h3><p>${searching ? "جرّب كلمة بحث أخرى." : "المسار منشور لكنه لا يحتوي أسئلة مطابقة حالياً."}</p></div>`; }
function pager(page, searching) { return searching || !page.total ? "" : `<nav class="question-bank-pagination"><button type="button" data-page-offset="${Math.max(0, page.offset - page.limit)}" ${page.offset === 0 ? "disabled" : ""}>السابق</button><span>${page.offset + 1}–${Math.min(page.offset + page.items.length, page.total)} من ${page.total}</span><button type="button" data-page-offset="${page.offset + page.limit}" ${page.offset + page.limit >= page.total ? "disabled" : ""}>التالي</button></nav>`; }
async function search(root, subject, state, query) { if (!query.trim()) { state.search = null; return render(root, subject, state); } try { const body = await requestJson(`/api/content/question-bank/${encodeURIComponent(subject.id)}/banks/${encodeURIComponent(state.bankId)}/search?q=${encodeURIComponent(query)}&offset=0&limit=25`); state.search = { query, page: body }; } catch { state.search = { query, page: { total: 0, offset: 0, limit: 25, items: [] } }; } render(root, subject, state); }
async function openDetail(root, subject, state, questionId) { const page = state.search?.page ?? state.page; state.detailOrdinal = page.items.find((item) => item.questionId === questionId)?.bankOrdinal ?? page.items.find((item) => item.questionId === questionId)?.ordinal; root.innerHTML = loading("جارٍ فتح السؤال"); try { const body = await requestJson(`/api/content/question-bank/${encodeURIComponent(subject.id)}/banks/${encodeURIComponent(state.bankId)}/questions/${encodeURIComponent(questionId)}`); state.screen = "detail"; state.detail = body.question; render(root, subject, state); } catch { root.innerHTML = errorState(); bind(root, subject, state); } }
function detailLegacy(question, ordinal) { return `<section class="question-bank-detail"><button type="button" class="question-bank-inline-back" data-detail-back>العودة إلى القائمة</button><header class="question-bank-detail-head"><span>سؤال #${ordinal ?? 1}</span><small>${question.variants.length} صيغة</small></header><div class="question-bank-variants">${question.variants.map((variant, index) => `<article class="question-bank-variant"><div class="question-bank-variant-title"><strong>الصيغة ${index + 1}</strong>${variant.id === question.primaryVariantId ? "<span>أساسية</span>" : ""}</div>${renderRichDocument(variant.content)}</article>`).join("")}</div>${question.sharedAnswer ? `<article class="question-bank-answer"><h3>الإجابة المشتركة</h3>${renderRichDocument(question.sharedAnswer)}</article>` : ""}</section>`; }
function bindLegacy(root, subject, state) {
  root.querySelectorAll("[data-open-bank]").forEach((button) => button.addEventListener("click", () => void openBank(root, subject, state, button.dataset.openBank, 0)));
  root.querySelectorAll("[data-open-group]").forEach((button) => button.addEventListener("click", () => void openGroup(root, subject, state, button.dataset.openGroup)));
  root.querySelectorAll("[data-group-switch]").forEach((button) => button.addEventListener("click", () => { state.activeGroupBanks.set(button.dataset.groupSwitch, button.dataset.bankId); void openBank(root, subject, state, button.dataset.bankId, 0); }));
  root.querySelectorAll("[data-question-id]").forEach((button) => button.addEventListener("click", () => void openDetail(root, subject, state, button.dataset.questionId)));
  root.querySelectorAll("[data-page-offset]").forEach((button) => button.addEventListener("click", () => void openBank(root, subject, state, state.bankId, Number(button.dataset.pageOffset))));
  root.querySelector("[data-question-search]")?.addEventListener("submit", (event) => { event.preventDefault(); void search(root, subject, state, new FormData(event.currentTarget).get("q")?.toString() ?? ""); });
  root.querySelector("[data-clear-search]")?.addEventListener("click", () => { state.search = null; render(root, subject, state); });
  root.querySelector("[data-bank-back]")?.addEventListener("click", () => { state.search = null; state.screen = state.groupId ? "group" : "layout"; state.page = null; render(root, subject, state); });
  root.querySelector("[data-group-back]")?.addEventListener("click", () => { state.groupId = null; state.screen = "layout"; render(root, subject, state); });
  root.querySelector("[data-detail-back]")?.addEventListener("click", () => { state.screen = "bank"; state.detail = null; render(root, subject, state); }); root.querySelector("[data-retry-bank]")?.addEventListener("click", () => void loadLayout(root, subject, state));
}
function contextLabel(value) { return ({ PRIMARY_VARIANT: "مطابقة في السؤال", ALTERNATE_VARIANT: "مطابقة في صيغة أخرى", ANSWER: "مطابقة في الجواب", TAXONOMY: "مطابقة في التصنيف", PROVENANCE: "مطابقة في المصدر" })[value] ?? "مطابقة"; }
async function requestJson(url) { const response = await fetch(url, { cache: "no-store" }); const body = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(body.code || "QUESTION_BANK_REQUEST_FAILED"); error.status = response.status; throw error; } return body; }
function emptyState(subject) { return `<section class="placeholder-card"><h2 class="placeholder-title">بنك الأسئلة قيد البناء</h2><p class="placeholder-text">لا يوجد تخطيط منشور لبنك أسئلة ${html(subject.title)} حتى الآن.</p></section>`; }
function errorState() { return `<section class="placeholder-card"><h2 class="placeholder-title">تعذّر تحميل بنك الأسئلة</h2><button type="button" class="question-bank-retry" data-retry-bank>إعادة المحاولة</button></section>`; }
function loading(label) { return `<section class="question-bank-loading placeholder-card"><span class="question-bank-spinner"></span><h2 class="placeholder-title">${label}</h2></section>`; }
function order(a, b) { return a.displayOrder - b.displayOrder || a.id.localeCompare(b.id); }
function html(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]); }
function attr(value) { return html(value).replace(/`/g, "&#096;"); }

// Student question cards keep provenance compact by default. This later
// declaration intentionally supersedes the legacy card renderer above while
// keeping the existing page API stable.
function items(list, searching, state = currentRenderState) { return list.length ? `<div class="question-bank-questions">${list.map((item) => questionCard(item, state)).join("")}</div>` : `<div class="question-bank-empty"><h3>${searching ? "لا توجد نتائج" : "لا توجد أسئلة في هذا المسار"}</h3><p>${searching ? "جرّب كلمة بحث أخرى." : "المسار منشور لكنه لا يحتوي أسئلة مطابقة حاليًا."}</p></div>`; }
function questionCard(item, state) {
  const questionId = attr(item.questionId); const expanded = state.expandedProvenance.has(item.questionId); const loading = state.provenanceLoading.has(item.questionId);
  return `<article class="question-bank-question"><button type="button" class="question-bank-question-main" data-question-id="${questionId}"><span class="question-bank-ordinal">#${item.bankOrdinal ?? item.ordinal}</span><span class="question-bank-question-copy"><strong>${html(item.primaryPreview)}</strong><small>${html(item.taxonomyBreadcrumb)}${item.matchContext ? ` · ${html(contextLabel(item.matchContext))}` : ""}</small></span><span class="question-bank-chevron">‹</span></button>${sourceBadges(item, expanded)}${expanded ? provenancePanel(item.questionId, state, loading) : ""}</article>`;
}
function sourceBadges(item, expanded) { return item.sourceSummary?.length ? `<div class="question-bank-source-badges" aria-label="مصادر السؤال">${item.sourceSummary.map((summary) => `<button type="button" class="question-bank-source-badge" data-provenance-toggle="${attr(item.questionId)}" aria-expanded="${expanded}" aria-label="عرض تفاصيل ${html(sourceKindLabel(summary.sourceKind))}، ${Number(summary.count)} ورود">${html(sourceKindLabel(summary.sourceKind))} ×${Number(summary.count)}</button>`).join("")}</div>` : ""; }
function provenancePanel(questionId, state, loading) { if (loading) return `<div class="question-bank-provenance question-bank-provenance-loading">جارٍ تحميل الورود…</div>`; const question = state.provenance.get(questionId); if (!question) return ""; return `<div class="question-bank-provenance">${question.variants.filter((variant) => variant.occurrences.length).map((variant, index) => `<section>${question.variants.length > 1 ? `<small>الصيغة ${index + 1}</small>` : ""}${renderOccurrences(variant.occurrences)}</section>`).join("")}</div>`; }
function sourceKindLabel(value) { return ({ ministerial: "وزاري", "discussion-question": "أسئلة المناقشة", "educational-tv": "التلفزيون التربوي", "end-of-chapter": "أسئلة نهاية الفصل", "book-question": "سؤال كتاب", "book-exercise": "تمرين كتاب", enrichment: "إثرائي", other: "أخرى" })[value] ?? "أخرى"; }
function renderOccurrences(occurrences) { if (!occurrences?.length) return ""; return `<div class="question-bank-occurrences"><small>الورود والمصادر</small>${occurrences.slice().sort((left, right) => left.displayOrder - right.displayOrder).map(renderOccurrence).join("")}</div>`; }
function renderOccurrence(occurrence) {
  const facts = [occurrence.year, roundLabel(occurrence.roundCode), ...(occurrence.branches ?? []), ...(occurrence.qualifiers ?? []), occurrence.session, occurrence.sourceName].filter((value) => value !== null && value !== undefined && String(value).trim()).map((value) => html(value));
  return `<article class="question-bank-occurrence"><strong>${html(sourceKindLabel(occurrence.sourceKind))}</strong>${facts.length ? `<span>${facts.join(" · ")}</span>` : ""}${occurrence.rawLabel ? `<small>الوصف الأصلي للمصدر: ${html(occurrence.rawLabel)}</small>` : ""}${occurrence.notes ? `<small>${html(occurrence.notes)}</small>` : ""}</article>`;
}
function roundLabel(value) { return ({ د1: "الدور الأول", د2: "الدور الثاني", د3: "الدور الثالث", تمهيدي: "تمهيدي" })[value] ?? value; }
async function toggleProvenance(root, subject, state, questionId) {
  if (state.expandedProvenance.has(questionId)) { state.expandedProvenance.delete(questionId); render(root, subject, state); return; }
  state.expandedProvenance.add(questionId);
  if (state.provenance.has(questionId)) { render(root, subject, state); return; }
  state.provenanceLoading.add(questionId); render(root, subject, state);
  try {
    const body = await requestJson(`/api/content/question-bank/${encodeURIComponent(subject.id)}/banks/${encodeURIComponent(state.bankId)}/questions/${encodeURIComponent(questionId)}`);
    state.provenance.set(questionId, body.question);
  } catch { state.expandedProvenance.delete(questionId); }
  finally { state.provenanceLoading.delete(questionId); render(root, subject, state); }
}

function detail(question, ordinal) { return `<section class="question-bank-detail"><button type="button" class="question-bank-inline-back" data-detail-back>العودة إلى القائمة</button><header class="question-bank-detail-head"><span>سؤال #${ordinal ?? 1}</span><small>${question.variants.length} صيغة</small></header><div class="question-bank-variants">${question.variants.map((variant, index) => `<article class="question-bank-variant"><div class="question-bank-variant-title"><strong>الصيغة ${index + 1}</strong>${variant.id === question.primaryVariantId ? "<span>أساسية</span>" : ""}</div>${renderRichDocument(variant.content)}${renderOccurrences(variant.occurrences)}</article>`).join("")}</div>${question.sharedAnswer ? `<article class="question-bank-answer"><h3>الإجابة المشتركة</h3>${renderRichDocument(question.sharedAnswer)}</article>` : ""}</section>`; }
function bind(root, subject, state) {
  root.querySelectorAll("[data-open-bank]").forEach((button) => button.addEventListener("click", () => void openBank(root, subject, state, button.dataset.openBank, 0)));
  root.querySelectorAll("[data-open-group]").forEach((button) => button.addEventListener("click", () => void openGroup(root, subject, state, button.dataset.openGroup)));
  root.querySelectorAll("[data-group-switch]").forEach((button) => button.addEventListener("click", () => { state.activeGroupBanks.set(button.dataset.groupSwitch, button.dataset.bankId); void openBank(root, subject, state, button.dataset.bankId, 0); }));
  root.querySelectorAll("[data-question-id]").forEach((button) => button.addEventListener("click", () => void openDetail(root, subject, state, button.dataset.questionId)));
  root.querySelectorAll("[data-provenance-toggle]").forEach((button) => button.addEventListener("click", () => void toggleProvenance(root, subject, state, button.dataset.provenanceToggle)));
  root.querySelectorAll("[data-page-offset]").forEach((button) => button.addEventListener("click", () => void openBank(root, subject, state, state.bankId, Number(button.dataset.pageOffset))));
  root.querySelector("[data-question-search]")?.addEventListener("submit", (event) => { event.preventDefault(); void search(root, subject, state, new FormData(event.currentTarget).get("q")?.toString() ?? ""); });
  root.querySelector("[data-clear-search]")?.addEventListener("click", () => { state.search = null; render(root, subject, state); });
  root.querySelector("[data-bank-back]")?.addEventListener("click", () => { state.search = null; state.screen = state.groupId ? "group" : "layout"; state.page = null; render(root, subject, state); });
  root.querySelector("[data-group-back]")?.addEventListener("click", () => { state.groupId = null; state.screen = "layout"; render(root, subject, state); });
  root.querySelector("[data-detail-back]")?.addEventListener("click", () => { state.screen = "bank"; state.detail = null; render(root, subject, state); });
  root.querySelector("[data-retry-bank]")?.addEventListener("click", () => void loadLayout(root, subject, state));
}
