import fs from "node:fs";
import path from "node:path";
import { v5 as uuidv5 } from "uuid";

const ROOT = process.cwd();
const PACKAGE_ID = "9ccff57a-3b8e-5e06-a6bd-ef3a04358f84";
const SOURCE_PATH = process.env.PYTHAGORAS_SOURCE_PACKAGE ?? path.join(
  process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? ROOT, "AppData", "Local"),
  "Pythagoras", "data", "storage", "objects", "61",
  "617d0b9a9b439f7726756fdc9dcf38089981b4672a8b4e8649dd0764b46e4ae8",
);
const OUTPUT_DIR = path.join(ROOT, "docs", "question-system");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "arabic-grammar-istifham.question-package.enriched.v2.json");
const AUDIT_PATH = path.join(OUTPUT_DIR, "arabic-grammar-istifham.enriched.v2.audit.md");

const source = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8"));
const stats = {
  sourceQuestions: source.questions.length,
  sourceVariants: countVariants(source.questions),
  sourceOccurrences: countOccurrences(source.questions),
  finalQuestions: 0,
  finalVariants: 0,
  finalOccurrences: 0,
  sourceRefsExtracted: 0,
  visibleSourceRefsRemaining: 0,
  quranBlocks: 0,
  poetryBlocks: 0,
  orderedListBlocks: 0,
  orderedListQuestionBlocks: 0,
  orderedListAnswerBlocks: 0,
  underlineSpans: 0,
  questionsWithMissingAnswer: 0,
  questionsWithMissingContent: 0,
  ambiguities: [],
  sourceRefsByQuestion: new Map(),
};

const originalIds = collectIds(source);

const enriched = structuredClone(source);
enriched.package.contentRevision = 2;
enriched.questions = enriched.questions.map((question) => {
  const sourceRefs = [];
  const variants = question.variants.map((variant) => {
    const sanitized = sanitizeDocument(variant.content, question, variant, sourceRefs);
    const content = transformDocument(sanitized, question, "question");
    return { ...variant, content };
  });
  const uniqueRefs = uniqueSourceRefs(sourceRefs);
  if (uniqueRefs.length) {
    stats.sourceRefsExtracted += uniqueRefs.length;
    stats.sourceRefsByQuestion.set(question.order, uniqueRefs);
    question.variants = variants.map((variant) => ({
      ...variant,
      occurrences: buildOccurrences(variant.occurrences, uniqueRefs, question, variant),
    }));
  } else {
    question.variants = variants;
  }
  if (question.sharedAnswer) question.sharedAnswer = transformDocument(question.sharedAnswer, question, "answer");
  if (!question.sharedAnswer) stats.questionsWithMissingAnswer += 1;
  if (!question.variants.some((variant) => hasVisibleText(variant.content))) stats.questionsWithMissingContent += 1;
  return question;
});

stats.finalQuestions = enriched.questions.length;
stats.finalVariants = countVariants(enriched.questions);
stats.finalOccurrences = countOccurrences(enriched.questions);
stats.visibleSourceRefsRemaining = countVisibleSourceRefs(enriched.questions);
stats.quranBlocks = countBlocks(enriched.questions, "quran");
stats.poetryBlocks = countBlocks(enriched.questions, "poetry");
stats.orderedListBlocks = countBlocks(enriched.questions, "ordered-list", true) + countBlocks(enriched.questions, "ordered-list", false);
stats.orderedListQuestionBlocks = countBlocksInDocuments(enriched.questions.flatMap((question) => question.variants.map((variant) => variant.content)), "ordered-list");
stats.orderedListAnswerBlocks = countBlocksInDocuments(enriched.questions.map((question) => question.sharedAnswer).filter(Boolean), "ordered-list");
stats.underlineSpans = countUnderlineSpans(enriched.questions);

const finalIds = collectIds(enriched);
const newIds = [...finalIds].filter((id) => !originalIds.has(id));
const retiredIds = [...originalIds].filter((id) => !finalIds.has(id));
const duplicateSignatures = duplicateOccurrenceSignatures(enriched.questions);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
fs.writeFileSync(AUDIT_PATH, buildAudit({ newIds, retiredIds, duplicateSignatures }), "utf8");
console.log(JSON.stringify({ output: OUTPUT_PATH, audit: AUDIT_PATH, stats: serializeStats(stats), newIds: newIds.length, retiredIds: retiredIds.length }, null, 2));

function sanitizeDocument(document, question, variant, sourceRefs) {
  return {
    ...document,
    blocks: document.blocks.map((block) => {
      if (block.type !== "paragraph") return block;
      const text = inlineText(block.spans);
      const matches = [...text.matchAll(/\(\s*((?:19|20)\d{2})\s+([^\s()]+)([^()]*)\)/gu)];
      const parsed = matches.map((match, index) => parseSourceRef(match, question, variant, index)).filter(Boolean);
      sourceRefs.push(...parsed);
      if (!matches.length) return block;
      const ranges = matches.map((match) => {
        const start = codePointLength(text.slice(0, match.index));
        return [start, start + codePointLength(match[0])];
      });
      return { ...block, spans: trimInline(removeInlineRanges(block.spans, ranges)) };
    }),
  };
}

function parseSourceRef(match, question, variant, index) {
  const year = Number(match[1]);
  const tokens = match[2].split(/\s+/u).filter(Boolean);
  const tail = match[3].replace(/[\u060c,.;:]+$/u, "").trim();
  const tailTokens = tail.split(/\s+/u).filter(Boolean);
  const roundCode = tokens.shift() ?? null;
  const allTokens = [...tokens, ...tailTokens];
  const branches = [];
  if (allTokens.some((token) => /أدبي/u.test(token))) branches.push("أدبي");
  if (allTokens.some((token) => /علمي/u.test(token))) branches.push("علمي");
  const qualifiers = [];
  if (allTokens.some((token) => /داخل/u.test(token))) qualifiers.push("داخل القطر");
  if (allTokens.some((token) => /خارج/u.test(token))) qualifiers.push("خارج القطر");
  if (allTokens.some((token) => /خاص/u.test(token))) qualifiers.push("خاص");
  if (allTokens.some((token) => /نازحين/u.test(token))) qualifiers.push("نازحين");
  const labelParts = ["وزاري", year, roundCode, ...branches, ...qualifiers];
  return {
    key: `${year}|${roundCode ?? ""}|${branches.join(",")}|${qualifiers.join(",")}`,
    year,
    roundCode,
    branches,
    qualifiers,
    rawLabel: labelParts.filter(Boolean).join(" "),
    questionOrder: question.order,
    variantId: variant.id,
    sourceIndex: index,
  };
}

function buildOccurrences(existing, refs, question, variant) {
  const used = new Set();
  return refs.map((ref, index) => {
    const reusable = existing.find((occurrence) => !used.has(occurrence.id) && occurrence.year === ref.year) ?? existing.find((occurrence) => !used.has(occurrence.id));
    const id = reusable?.id ?? uuidv5(`occurrence:${question.id}:${variant.id}:${ref.key}:${index}`, PACKAGE_ID);
    if (reusable) used.add(reusable.id);
    return {
      ...(reusable ?? {}),
      id,
      sourceKind: "ministerial",
      year: ref.year,
      roundCode: ref.roundCode,
      branches: [...ref.branches],
      qualifiers: [...ref.qualifiers],
      rawLabel: ref.rawLabel,
    };
  });
}

function transformDocument(document, question, role) {
  const units = [];
  for (const block of document.blocks) {
    if (block.type !== "paragraph") {
      units.push(block);
      continue;
    }
    const text = inlineText(block.spans);
    const lines = [...text.matchAll(/[^\n]+/gu)];
    if (!lines.length) continue;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex][0];
      const start = codePointLength(text.slice(0, lines[lineIndex].index));
      const spans = trimInline(sliceInline(block.spans, start, start + codePointLength(line)));
      const transformed = transformParagraphLine({ ...block, spans }, line, question, role, lineIndex);
      units.push(...transformed);
    }
  }

  const result = [];
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (isNumberedParagraph(unit)) {
      const items = [{ spans: stripNumberPrefix(unit.spans) }];
      let cursor = index + 1;
      while (cursor < units.length && isNumberedParagraph(units[cursor])) {
        items.push({ spans: stripNumberPrefix(units[cursor].spans) });
        cursor += 1;
      }
      result.push({ id: unit.id, type: "ordered-list", items });
      index = cursor - 1;
    } else {
      result.push(unit);
    }
  }
  return { ...document, blocks: result };
}

function transformParagraphLine(block, line, question, role, lineIndex) {
  const clean = inlineText(block.spans).trim();
  if (!clean) return [];

  const poetryMatch = clean.match(/^(.*?\u0627\u0644\u0634\u0627\u0639\u0631[^:\n]{0,100}\s*:)\s*(.+)$/u);
  if (poetryMatch && /\s{2,}/u.test(poetryMatch[2])) {
    const leadLength = codePointLength(poetryMatch[1]);
    const poemSpans = trimInline(sliceInline(block.spans, leadLength, codePointLength(clean)));
    const poemText = inlineText(poemSpans).trim();
    const halves = poemText.split(/\s{2,}/u).map((part) => part.trim()).filter(Boolean);
    if (halves.length >= 2) {
      const firstHalfEnd = codePointLength(halves[0]);
      const separatorLength = codePointLength(poemText.slice(firstHalfEnd).match(/^\s+/u)?.[0] ?? "");
      const sadr = trimInline(sliceInline(poemSpans, 0, firstHalfEnd));
      const ajuz = trimInline(sliceInline(poemSpans, firstHalfEnd + separatorLength, codePointLength(poemText)));
      return [
        { id: block.id, type: "paragraph", spans: trimInline(sliceInline(block.spans, 0, leadLength)) },
        {
          id: uuidv5(`poetry-block:${question.id}:${block.id}:${role}:${lineIndex}`, PACKAGE_ID),
          type: "poetry",
          verses: [{ id: uuidv5(`poetry-verse:${question.id}:${block.id}:${role}:${lineIndex}`, PACKAGE_ID), sadr, ajuz }],
        },
      ];
    }
  } else if (poetryMatch) {
    stats.ambiguities.push(`Q${question.order}: poetry lead-in found but hemistich separator was not unambiguous.`);
  }

  const quranMatches = [...clean.matchAll(/\uFD3F([^\uFD3E]+)\uFD3E/gu)];
  if (quranMatches.length && /\u0642\u0627\u0644\s+\u062a\u0639\u0627\u0644\u0649/u.test(clean)) {
    const firstStart = codePointLength(clean.slice(0, quranMatches[0].index));
    const lastEnd = codePointLength(clean.slice(0, quranMatches.at(-1).index)) + codePointLength(quranMatches.at(-1)[0]);
    const output = [];
    const lead = trimInline(sliceInline(block.spans, 0, firstStart));
    if (inlineText(lead).trim()) output.push({ id: block.id, type: "paragraph", spans: lead });
    for (let index = 0; index < quranMatches.length; index += 1) {
      const match = quranMatches[index];
      const matchStart = codePointLength(clean.slice(0, match.index));
      if (index > 0) {
        const previous = quranMatches[index - 1];
        const previousEnd = codePointLength(clean.slice(0, previous.index)) + codePointLength(previous[0]);
        const between = trimInline(sliceInline(block.spans, previousEnd, matchStart));
        if (inlineText(between).trim()) output.push({ id: uuidv5(`quran-between:${question.id}:${block.id}:${role}:${lineIndex}:${index}`, PACKAGE_ID), type: "paragraph", spans: between });
      }
      output.push({
        id: lead.length && index === 0 ? uuidv5(`quran-block:${question.id}:${block.id}:${role}:${lineIndex}`, PACKAGE_ID) : index === 0 && !lead.length ? block.id : uuidv5(`quran-block:${question.id}:${block.id}:${role}:${lineIndex}:${index}`, PACKAGE_ID),
        type: "quran",
        verses: [{
          id: uuidv5(`quran-verse:${question.id}:${block.id}:${role}:${lineIndex}:${index}`, PACKAGE_ID),
          spans: trimInline(sliceInline(block.spans, matchStart + 1, matchStart + codePointLength(match[0]) - 1)),
        }],
      });
    }
    const trailing = trimInline(sliceInline(block.spans, lastEnd, codePointLength(clean)));
    if (inlineText(trailing).trim()) output.push({ id: uuidv5(`quran-tail:${question.id}:${block.id}:${role}:${lineIndex}`, PACKAGE_ID), type: "paragraph", spans: trailing });
    return output;
  }

  return [{ ...block, spans: trimInline(block.spans) }];
}

function isNumberedParagraph(block) {
  return block?.type === "paragraph" && /^\s*\d+[.)]\s+/u.test(inlineText(block.spans));
}

function stripNumberPrefix(spans) {
  const text = inlineText(spans);
  const match = text.match(/^\s*\d+[.)]\s+/u);
  return trimInline(sliceInline(spans, codePointLength(match?.[0] ?? ""), codePointLength(text)));
}

function inlineText(spans) {
  return spans.map((span) => span.text).join("");
}

function sliceInline(spans, start, end) {
  let cursor = 0;
  const result = [];
  for (const span of spans) {
    const chars = Array.from(span.text);
    const spanStart = cursor;
    const spanEnd = cursor + chars.length;
    const from = Math.max(start, spanStart) - spanStart;
    const to = Math.min(end, spanEnd) - spanStart;
    if (to > from) result.push({ ...span, text: chars.slice(from, to).join("") });
    cursor = spanEnd;
  }
  return result;
}

function removeInlineRanges(spans, ranges) {
  const result = [];
  let cursor = 0;
  const length = codePointLength(inlineText(spans));
  for (const [start, end] of ranges.sort((left, right) => left[0] - right[0])) {
    result.push(...sliceInline(spans, cursor, start));
    cursor = end;
  }
  result.push(...sliceInline(spans, cursor, length));
  return result.filter((span) => span.text.length);
}

function trimInline(spans) {
  const result = spans.map((span) => ({ ...span })).filter((span) => span.text.length);
  if (!result.length) return [];
  result[0].text = result[0].text.replace(/^\s+/u, "");
  result.at(-1).text = result.at(-1).text.replace(/\s+$/u, "");
  return result.filter((span) => span.text.length);
}

function codePointLength(value) {
  return Array.from(value ?? "").length;
}

function uniqueSourceRefs(refs) {
  const seen = new Set();
  return refs.filter((ref) => {
    if (seen.has(ref.key)) return false;
    seen.add(ref.key);
    return true;
  });
}

function countVisibleSourceRefs(questions) {
  return questions.reduce((total, question) => total + question.variants.reduce((sum, variant) => sum + variant.content.blocks.reduce((count, block) => count + (block.type === "paragraph" && /\(\s*(?:19|20)\d{2}\s+[^)]*\)/u.test(inlineText(block.spans)) ? 1 : 0), 0), 0), 0);
}

function hasVisibleText(document) {
  return document.blocks.some((block) => block.type === "paragraph" || block.type === "heading" || block.type === "quran" || block.type === "poetry");
}

function countVariants(questions) {
  return questions.reduce((total, question) => total + question.variants.length, 0);
}

function countOccurrences(questions) {
  return questions.reduce((total, question) => total + question.variants.reduce((sum, variant) => sum + variant.occurrences.length, 0), 0);
}

function countBlocks(questions, type, includeAnswers = true) {
  return countBlocksInDocuments(questions.flatMap((question) => [
    ...question.variants.map((variant) => variant.content),
    ...(includeAnswers && question.sharedAnswer ? [question.sharedAnswer] : []),
  ]), type);
}

function countBlocksInDocuments(documents, type) {
  return documents.reduce((total, document) => total + document.blocks.filter((block) => block.type === type).length, 0);
}

function countUnderlineSpans(questions) {
  return questions.reduce((total, question) => total + [
    ...question.variants.map((variant) => variant.content),
    ...(question.sharedAnswer ? [question.sharedAnswer] : []),
  ].reduce((sum, document) => sum + document.blocks.reduce((blockTotal, block) => blockTotal + inlineSpansInBlock(block).filter((span) => Boolean(span?.marks?.includes("underline"))).length, 0), 0), 0);
}

function inlineSpansInBlock(block) {
  if (block.type === "paragraph" || block.type === "heading") return block.spans;
  if (block.type === "ordered-list" || block.type === "bullet-list") return block.items.flatMap((item) => item.spans);
  if (block.type === "quran") return block.verses.flatMap((verse) => verse.spans);
  if (block.type === "poetry") return block.verses.flatMap((verse) => [...verse.sadr, ...verse.ajuz]);
  if (block.type === "table") return [...(block.caption ?? []), ...block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.spans))];
  if (block.type === "image") return block.caption ?? [];
  return [];
}

function collectIds(packageJson) {
  const ids = new Set([packageJson.package.id, ...packageJson.taxonomy.map((node) => node.id), ...packageJson.bankBrowse.nodes.map((node) => node.id)]);
  for (const question of packageJson.questions) {
    ids.add(question.id);
    ids.add(question.primaryVariantId);
    for (const variant of question.variants) {
      ids.add(variant.id);
      for (const occurrence of variant.occurrences) ids.add(occurrence.id);
      for (const block of variant.content.blocks) collectBlockIds(block, ids);
    }
    if (question.sharedAnswer) for (const block of question.sharedAnswer.blocks) collectBlockIds(block, ids);
  }
  return ids;
}

function collectBlockIds(block, ids) {
  ids.add(block.id);
  if (block.type === "quran") for (const verse of block.verses) ids.add(verse.id);
  if (block.type === "poetry") for (const verse of block.verses) ids.add(verse.id);
}

function duplicateOccurrenceSignatures(questions) {
  const duplicates = [];
  for (const question of questions) {
    const map = new Map();
    for (const variant of question.variants) for (const occurrence of variant.occurrences) {
      const signature = JSON.stringify({ sourceKind: occurrence.sourceKind, year: occurrence.year, roundCode: occurrence.roundCode, branches: occurrence.branches, qualifiers: occurrence.qualifiers });
      const rows = map.get(signature) ?? [];
      rows.push(`${question.order}:${variant.id}:${occurrence.id}`);
      map.set(signature, rows);
    }
    for (const rows of map.values()) if (rows.length > 1) duplicates.push(rows);
  }
  return duplicates;
}

function serializeStats(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "sourceRefsByQuestion"));
}

function buildAudit({ newIds, retiredIds, duplicateSignatures }) {
  const q40 = enriched.questions.find((question) => question.order === 40);
  const q40Refs = q40?.variants.flatMap((variant) => variant.occurrences.map((occurrence) => `${occurrence.rawLabel} [${occurrence.id}]`)).join("; ") ?? "غير موجود";
  return [
    "# Arabic Grammar Istifham — Enriched V2 Audit",
    "",
    "- Source file: current published Asset JSON (local path intentionally omitted)",
    `- Output package: ${path.relative(ROOT, OUTPUT_PATH)}`,
    `- Package identity: ${enriched.package.id} / ${enriched.package.key}`,
    `- Content revision: 1 → ${enriched.package.contentRevision}`,
    "",
    "## Counts",
    "",
    "| Metric | Before | After |",
    "|---|---:|---:|",
    `| Questions | ${stats.sourceQuestions} | ${stats.finalQuestions} |`,
    `| Variants | ${stats.sourceVariants} | ${stats.finalVariants} |`,
    `| Occurrences | ${stats.sourceOccurrences} | ${stats.finalOccurrences} |`,
    `| Source annotations extracted | — | ${stats.sourceRefsExtracted} |`,
    `| Visible source annotations remaining | — | ${stats.visibleSourceRefsRemaining} |`,
    `| Underline spans | — | ${stats.underlineSpans} |`,
    "",
    "## Rich Content",
    "",
    `- Quran blocks: ${stats.quranBlocks}`,
    `- Poetry blocks: ${stats.poetryBlocks}`,
    `- Ordered-list blocks in Questions: ${stats.orderedListQuestionBlocks}`,
    `- Ordered-list blocks in Answers: ${stats.orderedListAnswerBlocks}`,
    `- Missing answers: ${stats.questionsWithMissingAnswer}`,
    `- Questions with missing visible content: ${stats.questionsWithMissingContent}`,
    "",
    "## Stable Identity",
    "",
    `- Existing IDs preserved: ${originalIds.size - retiredIds.length}`,
    `- New deterministic IDs: ${newIds.length}`,
    `- Retired IDs: ${retiredIds.length}`,
    "- Fuzzy merges: 0",
    `- Duplicate occurrence signatures requiring review: ${duplicateSignatures.length}`,
    "",
    "## Required Source Corrections",
    "",
    "- Q35/Q40/Q68 inline year references were extracted from visible Question text.",
    `- Q40 occurrences after enrichment: ${q40Refs}`,
    "- Q40 inherited source label is replaced; it is not retained as an extra visible occurrence.",
    "",
    "## Ambiguities / Review Flags",
    "",
    stats.ambiguities.length ? stats.ambiguities.map((item) => `- ${item}`).join("\n") : "- None recorded by the conservative converter.",
    "",
    "## Safety",
    "",
    "- The original V1 Asset was not overwritten.",
    "- No canonical Question rows were changed.",
    "- No Change Set was published by this generator.",
    "- This file is an import candidate only; Owner review and publication are still required.",
    "",
  ].join("\n");
}
