import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { createCanonicalContentRepository } from "../src/server/canonical-content";
import { openContentDatabase } from "../src/server/content";
import { normalizeArabicSearchText, buildSafeFtsPrefixQuery, QuestionSearchService } from "../src/server/question-search";
import { SQLiteQuestionRepository, type CanonicalRichDocument, type QuestionItemContent } from "../src/server/questions";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const actor = { actorUserId: "", actorRole: "OWNER" as const };
function paragraph(text: string): CanonicalRichDocument { return { type: "doc", version: 1, blocks: [{ id: uuidv7(), type: "paragraph", spans: [{ text }] }] }; }
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m15-")); const database = openContentDatabase({ dataDirectory: root, migrationsDirectory }); createCanonicalContentRepository(database).bootstrap(); const identities = new SQLiteAdminIdentityRepository(database); const owner = identities.createInitialOwner({ id: uuidv7(), email: "owner@m15.test", displayName: "Owner", passwordHash: "$argon2id$test", createdAt: 1 }); actor.actorUserId = owner.id; return { root, database, questions: new SQLiteQuestionRepository(database, () => 1), close() { database.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } };
}
function createQuestion(f: ReturnType<typeof fixture>) {
  const packageId = uuidv7(), taxonomyId = uuidv7(), questionId = uuidv7(), primary = uuidv7(), alternate = uuidv7();
  f.questions.createPackage({ id: packageId, actor, content: { packageKey: `m15-${packageId}`, title: "حزمة", subjectKey: "math", language: "ar-IQ", contentRevision: 1, bankBrowseMode: "TREE", bankBrowseEntryKey: "entry", bankBrowseEntryLabel: "حزمة", bankBrowseEntryOrder: 1, sourceAssetId: null, assetBindings: [] } });
  f.questions.createTaxonomyNode({ id: taxonomyId, actor, content: { packageId, nodeKey: "topic", label: "النفي", kind: "topic", parentId: null, displayOrder: 1 } });
  const content: QuestionItemContent = { packageId, displayOrder: 37, primaryVariantId: primary, taxonomyAssignments: [{ taxonomyNodeId: taxonomyId, role: "PRIMARY", position: 0 }], variants: [{ id: primary, displayOrder: 1, content: paragraph("قُلْ هُوَ اللَّهُ أَحَدٌ"), occurrences: [{ id: uuidv7(), displayOrder: 1, sourceKind: "ministerial", year: 2024, roundCode: "تمهيدي", session: null, sourceName: null, notes: null, rawLabel: "وزاري 2024 تمهيدي", branches: ["علمي"], qualifiers: ["متميزين"] }] }, { id: alternate, displayOrder: 2, content: paragraph("صياغة بديلة للاختبار"), occurrences: [] }], sharedAnswer: paragraph("جواب مميز") };
  f.questions.createQuestionAggregate({ id: questionId, content, actor }); return { packageId, taxonomyId, questionId };
}
test("M15 normalizes Arabic search projection conservatively and makes only safe FTS expressions", () => {
  assert.equal(normalizeArabicSearchText("إِســتفهام ۱۲٣، ٤٥٦"), "استفهام 123 456");
  assert.equal(normalizeArabicSearchText("ى ي ؤ و ئ"), "ى ي ؤ و ئ");
  const parsed = buildSafeFtsPrefixQuery('" NEAR (استف)'); assert.ok(parsed); assert.match(parsed.match, /^"near"\* AND "استف"\*$/u);
});
test("M15 projects canonical rich text and returns one placement-scoped Question with a stable Bank ordinal", () => {
  const f = fixture(); try { const { packageId, taxonomyId, questionId } = createQuestion(f); const service = new QuestionSearchService(f.database); service.rebuildAll(); assert.equal(service.getHealth().healthy, true);
    const scope = { packageId, targetMode: "TAXONOMY_FILTER" as const, taxonomyNodeIds: [taxonomyId] };
    const quran = service.searchPlacement(scope, "قل هو الله", 0, 25); assert.equal(quran.total, 1); assert.equal(quran.items[0].questionId, questionId); assert.equal(quran.items[0].bankOrdinal, 1); assert.match(quran.items[0].primaryPreview, /اللَّه/u);
    const answer = service.searchPlacement(scope, "مميز", 0, 25); assert.equal(answer.items[0].matchContext, "ANSWER");
    const alternate = service.searchPlacement(scope, "بديلة", 0, 25); assert.equal(alternate.items[0].matchContext, "ALTERNATE_VARIANT");
    const provenance = service.searchPlacement(scope, "2024", 0, 25); assert.equal(provenance.items[0].matchContext, "PROVENANCE");
  } finally { f.close(); }
});
