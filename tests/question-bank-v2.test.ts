import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { inspectQuestionPackageJson, type QuestionPackageV1, type RichDocument } from "../src/server/question-packages";

const packagePath = path.join(process.cwd(), "docs/question-system/arabic-grammar-istifham.question-package.enriched.v2.json");
const sourcePath = process.env.PYTHAGORAS_SOURCE_PACKAGE ?? path.join(
  process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? process.cwd(), "AppData", "Local"),
  "Pythagoras", "data", "storage", "objects", "61", "617d0b9a9b439f7726756fdc9dcf38089981b4672a8b4e8649dd0764b46e4ae8",
);

function readPackage(filePath: string): QuestionPackageV1 {
  return JSON.parse(readFileSync(filePath, "utf8")) as QuestionPackageV1;
}

function documentText(document: RichDocument) {
  return document.blocks.flatMap((block) => {
    if (block.type === "paragraph" || block.type === "heading") return block.spans.map((span) => span.text);
    if (block.type === "ordered-list" || block.type === "bullet-list") return block.items.flatMap((item) => item.spans.map((span) => span.text));
    if (block.type === "quran") return block.verses.flatMap((verse) => verse.spans.map((span) => span.text));
    if (block.type === "poetry") return block.verses.flatMap((verse) => [...verse.sadr, ...verse.ajuz].map((span) => span.text));
    return [];
  }).join(" ");
}

test("Arabic Istifham enriched V2 preserves identity and validates", () => {
  const value = readPackage(packagePath);
  const validation = inspectQuestionPackageJson(value, { canonicalSubjectKeys: new Set(["arabic"]) });
  assert.equal(validation.status, "VALID");
  assert.equal(value.package.contentRevision, 2);
  assert.equal(value.questions.length, 482);

  const source = readPackage(sourcePath);
  assert.deepEqual(value.questions.map((question) => question.id), source.questions.map((question) => question.id));
  assert.deepEqual(value.questions.map((question) => question.primaryVariantId), source.questions.map((question) => question.primaryVariantId));

  for (const order of [35, 40, 68]) {
    const question = value.questions.find((item) => item.order === order);
    assert.ok(question);
    assert.doesNotMatch(documentText(question.variants[0].content), /\(\s*(?:19|20)\d{2}\s+[^)]*\)/u);
  }

  const q40 = value.questions.find((question) => question.order === 40);
  assert.deepEqual(q40?.variants[0].occurrences.map((occurrence) => ({ year: occurrence.year, roundCode: occurrence.roundCode, branches: occurrence.branches })), [
    { year: 2014, roundCode: "د1", branches: ["أدبي"] },
    { year: 2015, roundCode: "د1", branches: ["أدبي"] },
  ]);
  assert.equal(q40?.variants[0].content.blocks.some((block: Record<string, any>) => block.type === "poetry"), true);

  const q4 = value.questions.find((question) => question.order === 4);
  assert.equal(q4?.variants[0].content.blocks.some((block: Record<string, any>) => block.type === "quran"), true);
  const q43 = value.questions.find((question) => question.order === 43);
  assert.equal(q43?.variants[0].content.blocks.some((block: Record<string, any>) => block.type === "ordered-list"), true);
  assert.equal(q43?.sharedAnswer?.blocks.some((block) => block.type === "ordered-list"), true);
  assert.equal(value.questions.flatMap((question) => question.variants.flatMap((variant) => variant.content.blocks)).some((block) => block.type === "quran" && block.verses.some((verse) => verse.ayah !== undefined)), false);
});
