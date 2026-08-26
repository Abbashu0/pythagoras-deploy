import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { createCanonicalContentRepository } from "../src/server/canonical-content";
import { createChangeManagementService } from "../src/server/change-management";
import { openContentDatabase } from "../src/server/content";
import { createMaterialQuestionBankService } from "../src/server/material-question-bank";
import { QuestionSearchService } from "../src/server/question-search";
import { SQLiteQuestionRepository, type CanonicalRichDocument, type QuestionItemContent } from "../src/server/questions";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const actor = { actorUserId: "", actorRole: "OWNER" as const };
function paragraph(text: string): CanonicalRichDocument { return { type: "doc", version: 1, blocks: [{ id: uuidv7(), type: "paragraph", spans: [{ text }] }] }; }
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-public-provenance-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  createCanonicalContentRepository(database).bootstrap();
  const owner = new SQLiteAdminIdentityRepository(database).createInitialOwner({ id: uuidv7(), email: "provenance-owner@test.local", displayName: "Provenance Owner", passwordHash: "$argon2id$test", createdAt: 1 });
  actor.actorUserId = owner.id;
  return { root, database, questions: new SQLiteQuestionRepository(database, () => 1), banks: createMaterialQuestionBankService(database), changes: createChangeManagementService(database), close() { database.close(); rmSync(root, { recursive: true, force: true }); } };
}
function createPublishedQuestion(f: ReturnType<typeof fixture>) {
  const packageId = uuidv7(), taxonomyId = uuidv7(), questionId = uuidv7(), variantId = uuidv7(), occurrenceId = uuidv7();
  f.questions.createPackage({ id: packageId, actor, content: { packageKey: `provenance-${packageId}`, title: "Provenance package", subjectKey: "biology", language: "ar-IQ", contentRevision: 1, bankBrowseMode: "TREE", bankBrowseEntryKey: "entry", bankBrowseEntryLabel: "Entry", bankBrowseEntryOrder: 1, sourceAssetId: null, assetBindings: [] } });
  f.questions.createTaxonomyNode({ id: taxonomyId, actor, content: { packageId, nodeKey: "topic", label: "Topic", kind: "topic", parentId: null, displayOrder: 1 } });
  const content: QuestionItemContent = { packageId, displayOrder: 1, primaryVariantId: variantId, taxonomyAssignments: [{ taxonomyNodeId: taxonomyId, role: "PRIMARY", position: 0 }], variants: [{ id: variantId, displayOrder: 1, content: paragraph("Question text"), occurrences: [{ id: occurrenceId, displayOrder: 1, sourceKind: "ministerial", year: 2024, roundCode: "د1", session: null, sourceName: null, notes: null, rawLabel: "وزاري 2024", branches: ["علمي"], qualifiers: [] }] }], sharedAnswer: null };
  f.questions.createQuestionAggregate({ id: questionId, content, actor });
  const material = createCanonicalContentRepository(f.database).getSnapshot().materials.find((item) => item.subjectKey === "biology")!;
  const bankId = uuidv7();
  const draft = f.banks.save("biology", { materialId: material.id, rootPresentation: "DIRECT", nodes: [{ id: bankId, nodeKey: "bank", label: "Bank", nodeType: "BANK", parentId: null, displayOrder: 1, groupPresentation: null, packageId, targetMode: "ALL_PACKAGE_QUESTIONS", taxonomyNodeId: null, includeDescendants: null, enabled: true }] }, actor);
  const submitted = f.banks.submit("biology", draft.revision, actor);
  const approved = f.changes.approve(submitted.id, submitted.revision, actor).changeSet;
  f.changes.publish(approved.id, approved.revision, actor);
  return { packageId, taxonomyId, questionId, bankId };
}

test("public list and search expose compact source-kind summaries without loading detail occurrences", () => {
  const f = fixture();
  try {
    const created = createPublishedQuestion(f);
    const page = f.banks.listPublicQuestions("biology", created.bankId);
    assert.deepEqual(page.items[0].sourceSummary, [{ sourceKind: "ministerial", count: 1 }]);
    assert.equal("occurrences" in page.items[0], false);
    const search = new QuestionSearchService(f.database); search.rebuildAll();
    const result = f.banks.searchPublicQuestions("biology", created.bankId, "Question");
    assert.deepEqual(result.items[0].sourceSummary, [{ sourceKind: "ministerial", count: 1 }]);
    const detail = f.banks.getPublicQuestion("biology", created.bankId, created.questionId);
    assert.equal(detail.variants[0].occurrences[0].rawLabel, "وزاري 2024");
    assert.equal(detail.variants[0].occurrences[0].year, 2024);
    assert.deepEqual(detail.variants[0].occurrences[0].branches, ["علمي"]);
  } finally { f.close(); }
});

test("Student question-bank source controls and shared occurrence renderer are present", () => {
  const source = readFileSync(path.join(process.cwd(), "public/pythagoras/src/pages/QuestionBankPlaceholderPage.js"), "utf8");
  assert.match(source, /data-provenance-toggle/u);
  assert.match(source, /aria-expanded/u);
  assert.match(source, /renderOccurrences/u);
  assert.match(source, /sourceKindLabel/u);
  assert.match(source, /occurrences/u);
});
