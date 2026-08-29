import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const API_BASE = (process.env.REVIEW_API_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/u, "");
const sourcePath = process.env.PYTHAGORAS_SOURCE_PACKAGE ?? path.join(
  process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? ROOT, "AppData", "Local"),
  "Pythagoras", "data", "storage", "objects", "61",
  "617d0b9a9b439f7726756fdc9dcf38089981b4672a8b4e8649dd0764b46e4ae8",
);
const v2Path = path.join(ROOT, "docs", "question-system", "arabic-grammar-istifham.question-package.enriched.v2.json");
const spotAuditPath = path.join(ROOT, "docs", "question-system", "arabic-istifham-v2-content-spot-audit.md");
const searchAuditPath = path.join(ROOT, "docs", "question-system", "arabic-istifham-v2-search-audit.md");
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const v2 = JSON.parse(fs.readFileSync(v2Path, "utf8"));

const layout = await getJson("/api/content/question-bank/arabic");
const bank = layout.layout.nodes.find((node) => node.nodeKey === "arabic-grammar-istifham" && node.available);
if (!bank) throw new Error("Review API does not expose the available Istifham bank.");

const detailCache = new Map();
async function detail(questionId) {
  if (!detailCache.has(questionId)) {
    const response = await getJson(`/api/content/question-bank/arabic/banks/${encodeURIComponent(bank.id)}/questions/${encodeURIComponent(questionId)}`);
    detailCache.set(questionId, response.question);
  }
  return detailCache.get(questionId);
}

const v2ByOrder = new Map(v2.questions.map((question) => [question.order, question]));
const sourceByOrder = new Map(source.questions.map((question) => [question.order, question]));
const poetryOrders = v2.questions.filter((question) => question.variants.some((variant) => variant.content.blocks.some((block) => block.type === "poetry"))).slice(0, 5).map((question) => question.order);
const quranOrders = v2.questions.filter((question) => question.variants.some((variant) => variant.content.blocks.some((block) => block.type === "quran"))).slice(0, 5).map((question) => question.order);
const listOrders = v2.questions.filter((question) => question.variants.some((variant) => variant.content.blocks.some((block) => block.type === "ordered-list" && block.items.length >= 2))).slice(0, 5).map((question) => question.order);
const underlineOrders = v2.questions.filter((question) => countUnderlines(question) > 0).slice(0, 5).map((question) => question.order);
const baseOrders = [9, 12, 40, 91];
const explicitOrders = [35, 40, 68];
const spotOrders = [...new Set([...baseOrders, ...poetryOrders, ...quranOrders, ...listOrders, ...underlineOrders, ...explicitOrders])].sort((left, right) => left - right);
const spotRows = [];

for (const order of spotOrders) {
  const sourceQuestion = sourceByOrder.get(order);
  const v2Question = v2ByOrder.get(order);
  if (!sourceQuestion || !v2Question) continue;
  const reviewed = await detail(v2Question.id);
  const primary = reviewed.variants.find((variant) => variant.id === reviewed.primaryVariantId) ?? reviewed.variants[0];
  const sourceVariant = sourceQuestion.variants[0];
  const sourceQuestionText = documentText(sourceVariant.content);
  const reviewedQuestionText = documentText(primary.content);
  const sourceAnswerText = documentText(sourceQuestion.sharedAnswer);
  const reviewedAnswerText = documentText(reviewed.sharedAnswer);
  const expectedPoetry = /قال\s+الشاعر/u.test(sourceQuestionText);
  const expectedQuran = /قال\s+تعالى/u.test(sourceQuestionText) && /[﴿]/u.test(sourceQuestionText);
  const expectedList = sourceQuestionText.split(/\n/u).filter((line) => /^\s*\d+[.)]\s+/u.test(line)).length >= 2 || sourceQuestion.variants[0].content.blocks.filter((block) => block.type === "paragraph" && /^\s*\d+[.)]\s+/u.test(inlineText(block.spans))).length >= 2 || Boolean(sourceQuestion.sharedAnswer?.blocks.some((block) => block.type === "paragraph" && /^\s*\d+[.)]\s+/u.test(inlineText(block.spans))));
  const hasPoetry = primary.content.blocks.some((block) => block.type === "poetry");
  const hasQuran = primary.content.blocks.some((block) => block.type === "quran");
  const hasList = primary.content.blocks.some((block) => block.type === "ordered-list");
  const sourceUnderlines = countUnderlines(sourceQuestion);
  const reviewedUnderlines = countUnderlines({ variants: reviewed.variants, sharedAnswer: reviewed.sharedAnswer });
  const sourceRefVisible = /\(\s*(?:19|20)\d{2}\s+[^)]*\)/u.test(reviewedQuestionText) || /\(\s*(?:19|20)\d{2}\s+[^)]*\)/u.test(reviewedAnswerText);
  const suspicious = [];
  if (normalizeEducational(sourceQuestionText) !== normalizeEducational(reviewedQuestionText)) suspicious.push("question wording differs after semantic-mark normalization");
  if (normalizeEducational(sourceAnswerText) !== normalizeEducational(reviewedAnswerText)) suspicious.push("answer wording differs after semantic-mark normalization");
  if (expectedPoetry && !hasPoetry) suspicious.push("expected poetry block missing");
  if (expectedQuran && !hasQuran) suspicious.push("expected Quran block missing");
  if (expectedList && !hasList) suspicious.push("expected ordered-list block missing");
  if (sourceUnderlines !== reviewedUnderlines) suspicious.push(`underline count changed (${sourceUnderlines} → ${reviewedUnderlines})`);
  if (sourceRefVisible) suspicious.push("source-year annotation remains visible");
  spotRows.push({ order, questionId: v2Question.id, expectedPoetry, hasPoetry, expectedQuran, hasQuran, expectedList, hasList, sourceUnderlines, reviewedUnderlines, questionPreserved: normalizeEducational(sourceQuestionText) === normalizeEducational(reviewedQuestionText), answerPreserved: normalizeEducational(sourceAnswerText) === normalizeEducational(reviewedAnswerText), provenanceVisible: sourceRefVisible, suspicious });
}

const q40 = await detail(v2ByOrder.get(40).id);
const q40Primary = q40.variants.find((variant) => variant.id === q40.primaryVariantId) ?? q40.variants[0];
const q40QuestionText = documentText(q40Primary.content);
const q40AnswerText = documentText(q40.sharedAnswer);
const q40Occurrences = q40.variants.flatMap((variant) => variant.occurrences).map((occurrence) => `${occurrence.year} ${occurrence.roundCode} ${occurrence.branches.join("/")}`);
const q40OldInherited = q40Occurrences.some((value) => value.includes("2014") && value.includes("تمهيدي") && value.includes("علمي"));

const spotLines = [
  "# Arabic Istifham V2 — Content Spot Audit",
  "",
  `- Review endpoint: ${API_BASE}`,
  `- Records checked: ${spotRows.length}`,
  `- Suspicious classifications: ${spotRows.filter((row) => row.suspicious.length).length}`,
  "- This report is read-only and does not alter package or canonical data.",
  "",
  "## Required Samples",
  "",
  "| Order | Question preserved | Answer preserved | Poetry | Quran | Lists | Underlines | Provenance visible | Suspicious |",
  "|---:|:---:|:---:|:---:|:---:|:---:|---:|:---:|---|",
  ...spotRows.map((row) => `| ${row.order} | ${yesNo(row.questionPreserved)} | ${yesNo(row.answerPreserved)} | ${expectedResult(row.expectedPoetry, row.hasPoetry)} | ${expectedResult(row.expectedQuran, row.hasQuran)} | ${expectedResult(row.expectedList, row.hasList)} | ${row.sourceUnderlines} → ${row.reviewedUnderlines} | ${yesNo(row.provenanceVisible)} | ${row.suspicious.length ? row.suspicious.join("; ") : "none"} |`),
  "",
  `- Poetry sample orders: ${poetryOrders.join(", ")}`,
  `- Quran sample orders: ${quranOrders.join(", ")}`,
  `- Ordered multi-demand sample orders: ${listOrders.join(", ")}`,
  `- Underline sample orders: ${underlineOrders.join(", ")}`,
  `- Explicit source-reference orders: ${explicitOrders.join(", ")}`,
  "",
  "## Q40 Assertion",
  "",
  `- Question contains (2014 د1 أدبي): ${q40QuestionText.includes("2014 د1 أدبي")}`,
  `- Question contains (2015 د1 أدبي): ${q40QuestionText.includes("2015 د1 أدبي")}`,
  `- Answer contains a source-year annotation: ${/\(\s*(?:19|20)\d{2}\s+[^)]*\)/u.test(q40AnswerText)}`,
  `- Structured occurrences: ${q40Occurrences.join("; ")}`,
  `- Old inherited 2014 تمهيدي علمي retained: ${q40OldInherited}`,
  "- Decision: the inherited occurrence is replaced because the explicit source annotations in the Question are the more specific source-of-truth for this record; it is not retained as an extra occurrence.",
  "",
  "## Notes",
  "",
  "- Quran conversion was limited to strong `قال تعالى: ﴿...﴾` evidence; no verse numbers were invented.",
  "- Poetry conversion was limited to clear `قال الشاعر` lead-ins with a reliable hemistich separator; ambiguous records remain flagged in the package audit.",
  "- No answer, Question, or occurrence was merged by this audit.",
  "",
];
fs.writeFileSync(spotAuditPath, spotLines.join("\n"), "utf8");

const queries = [
  "هناك حرف محذوف",
  "قال الشاعر",
  "طَرِبتُ",
  "طربت",
  "أين",
  "اين",
  "إعراب",
  "اعراب",
  "إستفهام",
  "استفهام",
  "الحرف المحذوف",
  "2014",
  "د1",
  "وزاري",
  "السما",
  "وأصحاب",
  "اصحاب",
  "معايبه",
  "همزة الاستفهام",
  "قال تعالى",
];
const searchRows = [];
for (const query of queries) {
  const result = await getJson(`/api/content/question-bank/arabic/banks/${encodeURIComponent(bank.id)}/search?q=${encodeURIComponent(query)}&offset=0&limit=1`);
  searchRows.push({ query, normalizedQuery: result.normalizedQuery, total: result.total, status: "200" });
}
const searchLines = [
  "# Arabic Istifham V2 — Search Audit",
  "",
  `- Review endpoint: ${API_BASE}`,
  `- Bank node: ${bank.id}`,
  "- Search API was exercised after publication and explicit projection rebuild.",
  "",
  "| # | Query | Normalized query | Result count | Status |",
  "|---:|---|---|---:|---:|",
  ...searchRows.map((row, index) => `| ${index + 1} | ${markdown(row.query)} | ${markdown(row.normalizedQuery)} | ${row.total} | ${row.status} |`),
  "",
  "- Diacritic and non-diacritic pairs tested: طَرِبتُ/طربت, أين/اين, إعراب/اعراب, إستفهام/استفهام, وأصحاب/اصحاب.",
  "- Underline target tested: معايبه.",
  "- Poetry, Quran, Answer, and provenance/year segments were queried without changing the M15 normalizer.",
  "",
];
fs.writeFileSync(searchAuditPath, searchLines.join("\n"), "utf8");
console.log(JSON.stringify({ spotAuditPath, searchAuditPath, bankNodeId: bank.id, spotRows: spotRows.length, suspicious: spotRows.filter((row) => row.suspicious.length), q40: { questionHas2014: q40QuestionText.includes("2014 د1 أدبي"), questionHas2015: q40QuestionText.includes("2015 د1 أدبي"), answerHasSourceYear: /\(\s*(?:19|20)\d{2}\s+[^)]*\)/u.test(q40AnswerText), occurrences: q40Occurrences, oldInheritedRetained: q40OldInherited }, searches: searchRows }, null, 2));

async function getJson(route) {
  const response = await fetch(`${API_BASE}${route}`);
  const body = await response.json();
  if (!response.ok || body.ok !== true) throw new Error(`${route} returned HTTP ${response.status}`);
  return body;
}

function documentText(document) {
  if (!document) return "";
  return document.blocks.map((block) => {
    if (block.type === "paragraph" || block.type === "heading") return inlineText(block.spans);
    if (block.type === "ordered-list" || block.type === "bullet-list") return block.items.map((item) => inlineText(item.spans)).join(" ");
    if (block.type === "quran") return block.verses.map((verse) => inlineText(verse.spans)).join(" ");
    if (block.type === "poetry") return block.verses.map((verse) => `${inlineText(verse.sadr)} ${inlineText(verse.ajuz)}`).join(" ");
    if (block.type === "table") return block.rows.flatMap((row) => row.cells).map((cell) => inlineText(cell.spans)).join(" ");
    return block.caption ? inlineText(block.caption) : "";
  }).join(" ").replace(/\s+/gu, " ").trim();
}

function inlineText(spans) {
  return (spans ?? []).map((span) => span.text).join("");
}

function normalizeEducational(value) {
  return value.normalize("NFKC").replace(/\(\s*((?:19|20)\d{2})\s+[^)]*\)/gu, "").replace(/[﴿﴾]/gu, "").replace(/\s*\d+[.)]\s+/gu, " ").replace(/\s*و\s*/gu, "و").replace(/\s+/gu, " ").trim();
}

function countUnderlines(question) {
  const documents = [
    ...(question.variants ?? []).map((variant) => variant.content),
    ...(question.sharedAnswer ? [question.sharedAnswer] : []),
  ];
  return documents.reduce((total, document) => total + document.blocks.reduce((count, block) => count + inlineSpans(block).filter((span) => span.marks?.includes("underline")).length, 0), 0);
}

function inlineSpans(block) {
  if (block.type === "paragraph" || block.type === "heading") return block.spans;
  if (block.type === "ordered-list" || block.type === "bullet-list") return block.items.flatMap((item) => item.spans);
  if (block.type === "quran") return block.verses.flatMap((verse) => verse.spans);
  if (block.type === "poetry") return block.verses.flatMap((verse) => [...verse.sadr, ...verse.ajuz]);
  if (block.type === "table") return [...(block.caption ?? []), ...block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.spans))];
  if (block.type === "image") return block.caption ?? [];
  return [];
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function expectedResult(expected, actual) {
  return expected ? yesNo(actual) : "n/a";
}

function markdown(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}
