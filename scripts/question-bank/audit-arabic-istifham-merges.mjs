import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_PATH = process.env.PYTHAGORAS_SOURCE_PACKAGE ?? path.join(
  process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? ROOT, "AppData", "Local"),
  "Pythagoras", "data", "storage", "objects", "61",
  "617d0b9a9b439f7726756fdc9dcf38089981b4672a8b4e8649dd0764b46e4ae8",
);
const OUTPUT_PATH = path.join(ROOT, "docs", "question-system", "arabic-istifham-v2-merge-review.md");
const source = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8"));

const rows = source.questions.map((question) => {
  const variant = question.variants[0];
  const questionText = documentText(variant.content);
  const answerText = documentText(question.sharedAnswer);
  return {
    order: question.order,
    id: question.id,
    questionText,
    answerText,
    questionNormalized: normalize(questionText),
    answerNormalized: normalize(answerText),
    occurrences: variant.occurrences.map((occurrence) => occurrence.rawLabel),
  };
});

const exactQuestionGroups = grouped(rows, (row) => row.questionNormalized).filter((group) => group.length > 1);
const exactAnswerGroups = grouped(rows, (row) => row.answerNormalized).filter((group) => group.length > 1);
const candidates = [];

for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
    const left = rows[leftIndex];
    const right = rows[rightIndex];
    if (!left.questionNormalized || !right.questionNormalized) continue;
    const questionSimilarity = jaccard(left.questionNormalized, right.questionNormalized);
    const answerSimilarity = jaccard(left.answerNormalized, right.answerNormalized);
    const questionContainment = containment(left.questionNormalized, right.questionNormalized);
    const exactQuestion = left.questionNormalized === right.questionNormalized;
    const strongCandidate = exactQuestion || questionContainment >= 0.86 || questionSimilarity >= 0.82 || (questionSimilarity >= 0.7 && answerSimilarity >= 0.82);
    if (!strongCandidate) continue;
    const reasons = [];
    if (exactQuestion) reasons.push("exact question wording after conservative normalization");
    else if (questionContainment >= 0.86) reasons.push(`one question is mostly contained in the other (${questionContainment.toFixed(3)})`);
    else reasons.push(`high question token similarity (${questionSimilarity.toFixed(3)})`);
    if (answerSimilarity >= 0.82) reasons.push(`answer similarity (${answerSimilarity.toFixed(3)})`);
    candidates.push({
      left,
      right,
      questionSimilarity,
      answerSimilarity,
      questionContainment,
      reason: reasons.join("; "),
      recommendation: exactQuestion ? "MANUAL_REVIEW" : "MANUAL_REVIEW",
    });
  }
}

const lines = [
  "# Arabic Istifham V2 — Variant and Merge Review",
  "",
  "This is a read-only content audit of the 482 source records. It does not merge, delete, or rewrite any Question.",
  "",
  "## Evidence",
  "",
  `- Source records audited: ${rows.length}`,
  `- Source records with more than one Variant: ${source.questions.filter((question) => question.variants.length > 1).length}`,
  `- Exact normalized Question duplicate groups: ${exactQuestionGroups.length}`,
  `- Exact normalized Answer duplicate groups: ${exactAnswerGroups.length}`,
  `- Defensible similarity candidates requiring content review: ${candidates.length}`,
  "- Automatic merges performed: 0",
  "",
  "## Decision",
  "",
  candidates.length
    ? "The candidates below are not safe to merge automatically. They are marked MANUAL_REVIEW until the Product Owner confirms educational equivalence, answer equivalence, and source precedence."
    : "No defensible merge candidates were found by exact, containment, or high question/answer similarity evidence. All 482 records remain separate.",
  "",
  "## Candidate Records",
  "",
];

if (!candidates.length) {
  lines.push("No candidate records.", "");
} else {
  candidates.sort((left, right) => left.left.order - right.left.order || left.right.order - right.right.order);
  candidates.forEach((candidate, index) => {
    lines.push(
      `### Candidate ${index + 1} — ${candidate.recommendation}`,
      "",
      `- Source orders: ${candidate.left.order}, ${candidate.right.order}`,
      `- Question IDs: ${candidate.left.id}; ${candidate.right.id}`,
      `- Similarity reason: ${candidate.reason}`,
      `- Question Jaccard: ${candidate.questionSimilarity.toFixed(3)}`,
      `- Question containment: ${candidate.questionContainment.toFixed(3)}`,
      `- Answer Jaccard: ${candidate.answerSimilarity.toFixed(3)}`,
      "",
      "#### First source record",
      "",
      `- Wording: ${markdownText(candidate.left.questionText)}`,
      `- Answer: ${markdownText(candidate.left.answerText)}`,
      `- Occurrences: ${candidate.left.occurrences.length ? candidate.left.occurrences.map(markdownText).join("; ") : "none"}`,
      "",
      "#### Second source record",
      "",
      `- Wording: ${markdownText(candidate.right.questionText)}`,
      `- Answer: ${markdownText(candidate.right.answerText)}`,
      `- Occurrences: ${candidate.right.occurrences.length ? candidate.right.occurrences.map(markdownText).join("; ") : "none"}`,
      "",
      `- Recommended action: ${candidate.recommendation}`,
      "",
    );
  });
}

lines.push(
  "## Action Summary",
  "",
  `- MERGE recommendations: ${candidates.filter((candidate) => candidate.recommendation === "MERGE").length}`,
  `- KEEP_SEPARATE recommendations: ${candidates.filter((candidate) => candidate.recommendation === "KEEP_SEPARATE").length}`,
  `- MANUAL_REVIEW recommendations: ${candidates.filter((candidate) => candidate.recommendation === "MANUAL_REVIEW").length}`,
  "- Current V2 package keeps all 482 Questions and all 482 source Variants separate.",
  "- A future merge, if approved, must be a reviewed package revision with explicit stable-ID and provenance decisions.",
  "",
);

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, lines.join("\n"), "utf8");
console.log(JSON.stringify({ output: OUTPUT_PATH, sourceRecords: rows.length, exactQuestionGroups: exactQuestionGroups.length, exactAnswerGroups: exactAnswerGroups.length, candidates: candidates.length }, null, 2));

function documentText(document) {
  if (!document) return "";
  return document.blocks.map((block) => {
    if (block.type === "paragraph" || block.type === "heading") return block.spans.map((span) => span.text).join("");
    if (block.type === "ordered-list" || block.type === "bullet-list") return block.items.map((item) => item.spans.map((span) => span.text).join("")).join(" ");
    if (block.type === "quran") return block.verses.map((verse) => verse.spans.map((span) => span.text).join("")).join(" ");
    if (block.type === "poetry") return block.verses.map((verse) => [...verse.sadr, ...verse.ajuz].map((span) => span.text).join(" ")).join(" ");
    if (block.type === "table") return block.rows.flatMap((row) => row.cells).map((cell) => cell.spans.map((span) => span.text).join("")).join(" ");
    return block.caption?.map((span) => span.text).join("") ?? "";
  }).join(" ").trim();
}

function normalize(value) {
  return value.normalize("NFKD").replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/gu, "").replace(/[إأآٱ]/gu, "ا").replace(/ى/gu, "ي").replace(/ؤ/gu, "و").replace(/ئ/gu, "ي").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function tokens(value) {
  return new Set(normalize(value).split(/\s+/u).filter(Boolean));
}

function jaccard(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection || 1);
}

function containment(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.min(a.size || 1, b.size || 1);
}

function grouped(values, key) {
  const groups = new Map();
  for (const value of values) {
    const groupKey = key(value);
    if (!groupKey) continue;
    const group = groups.get(groupKey) ?? [];
    group.push(value);
    groups.set(groupKey, group);
  }
  return [...groups.values()];
}

function markdownText(value) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ").trim() || "(empty)";
}
