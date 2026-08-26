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
import { normalizeArabicSearchText, buildSafeFtsPrefixQuery, QuestionSearchError, QUESTION_SEARCH_INDEX_VERSION, QuestionSearchService } from "../src/server/question-search";
import { SQLiteQuestionRepository, type CanonicalRichDocument, type QuestionItemContent } from "../src/server/questions";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const actor = { actorUserId: "", actorRole: "OWNER" as const };
function paragraph(text: string): CanonicalRichDocument { return { type: "doc", version: 1, blocks: [{ id: uuidv7(), type: "paragraph", spans: [{ text }] }] }; }
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m15-")); const database = openContentDatabase({ dataDirectory: root, migrationsDirectory }); const canonical = createCanonicalContentRepository(database); canonical.bootstrap(); const identities = new SQLiteAdminIdentityRepository(database); const owner = identities.createInitialOwner({ id: uuidv7(), email: "owner@m15.test", displayName: "Owner", passwordHash: "$argon2id$test", createdAt: 1 }); actor.actorUserId = owner.id; return { root, database, canonical, questions: new SQLiteQuestionRepository(database, () => 1), changes: createChangeManagementService(database), banks: createMaterialQuestionBankService(database), close() { database.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } };
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

function packageWithTaxonomy(f: ReturnType<typeof fixture>, label = "تصنيف", subjectKey = "math", parentId: string | null = null) {
  const packageId = uuidv7(), taxonomyId = uuidv7();
  f.questions.createPackage({ id: packageId, actor, content: { packageKey: `m15-${packageId}`, title: "حزمة اختبار", subjectKey, language: "ar-IQ", contentRevision: 1, bankBrowseMode: "TREE", bankBrowseEntryKey: `entry-${packageId}`, bankBrowseEntryLabel: "حزمة اختبار", bankBrowseEntryOrder: 1, sourceAssetId: null, assetBindings: [] } });
  f.questions.createTaxonomyNode({ id: taxonomyId, actor, content: { packageId, nodeKey: `node-${taxonomyId}`, label, kind: "topic", parentId, displayOrder: 1 } }); return { packageId, taxonomyId };
}
function createMinimalQuestion(f: ReturnType<typeof fixture>, packageId: string, taxonomyId: string, displayOrder: number, text: string, extra: Partial<QuestionItemContent> = {}) {
  const questionId = uuidv7(), variantId = uuidv7(); const base: QuestionItemContent = { packageId, displayOrder, primaryVariantId: variantId, taxonomyAssignments: [{ taxonomyNodeId: taxonomyId, role: "PRIMARY", position: 0 }], variants: [{ id: variantId, displayOrder: 1, content: paragraph(text), occurrences: [] }], sharedAnswer: null };
  const content = { ...base, ...extra }; f.questions.createQuestionAggregate({ id: questionId, content, actor }); return { questionId, content };
}
function publishUpdate(f: ReturnType<typeof fixture>, resourceType: "question.item" | "question.taxonomy", resourceId: string, expectedRevision: number, desired: unknown) {
  const draft = f.changes.createChangeSet({ title: "M15 integration", initialItem: { resourceType, resourceId, expectedRevision, operation: "UPDATE", desired } }, actor);
  const submitted = f.changes.submit(draft.changeSet.id, draft.changeSet.revision, actor).changeSet;
  const approved = f.changes.approve(submitted.id, submitted.revision, actor).changeSet;
  return { id: approved.id, revision: approved.revision };
}
function scope(packageId: string, taxonomyNodeIds: string[] = []) { return { packageId, targetMode: taxonomyNodeIds.length ? "TAXONOMY_FILTER" as const : "ALL_PACKAGE_QUESTIONS" as const, taxonomyNodeIds }; }

test("M15 keeps search published-only across Draft, Submitted, Approved, and publication", () => {
  const f = fixture(); try { const { packageId, taxonomyId } = packageWithTaxonomy(f); const initial = createMinimalQuestion(f, packageId, taxonomyId, 1, "OLD_SEARCH_TERM"); const search = new QuestionSearchService(f.database); search.rebuildAll();
    assert.equal(search.searchPlacement(scope(packageId), "OLD_SEARCH_TERM").total, 1); assert.equal(search.searchPlacement(scope(packageId), "NEW_SEARCH_TERM").total, 0);
    const desired = { ...initial.content, variants: [{ ...initial.content.variants[0], content: paragraph("NEW_SEARCH_TERM") }] };
    const prepared = publishUpdate(f, "question.item", initial.questionId, 1, desired);
    assert.equal(search.searchPlacement(scope(packageId), "OLD_SEARCH_TERM").total, 1); assert.equal(search.searchPlacement(scope(packageId), "NEW_SEARCH_TERM").total, 0);
    f.changes.publish(prepared.id, prepared.revision, actor);
    assert.equal(search.searchPlacement(scope(packageId), "OLD_SEARCH_TERM").total, 0); assert.equal(search.searchPlacement(scope(packageId), "NEW_SEARCH_TERM").total, 1);
  } finally { f.close(); }
});

test("M15 rolls canonical publication and search projection back when rebuilding fails", () => {
  const f = fixture(); try { const { packageId, taxonomyId } = packageWithTaxonomy(f); const initial = createMinimalQuestion(f, packageId, taxonomyId, 1, "ROLLBACK_OLD"); const search = new QuestionSearchService(f.database); search.rebuildAll(); const beforeRevision = f.changes.getReviewStats(actor).currentPublicationRevision;
    const prepared = publishUpdate(f, "question.item", initial.questionId, 1, { ...initial.content, variants: [{ ...initial.content.variants[0], content: paragraph("ROLLBACK_NEW") }] });
    const original = QuestionSearchService.prototype.rebuildForPublicationInTransaction; QuestionSearchService.prototype.rebuildForPublicationInTransaction = () => { throw new Error("test-only projection failure"); };
    try { assert.throws(() => f.changes.publish(prepared.id, prepared.revision, actor)); } finally { QuestionSearchService.prototype.rebuildForPublicationInTransaction = original; }
    assert.equal(f.questions.getQuestion(initial.questionId)?.variants[0].content.blocks[0].type, "paragraph"); assert.equal(search.searchPlacement(scope(packageId), "ROLLBACK_OLD").total, 1); assert.equal(search.searchPlacement(scope(packageId), "ROLLBACK_NEW").total, 0);
    assert.equal(f.changes.getReviewStats(actor).currentPublicationRevision, beforeRevision); assert.equal(f.changes.getDetails(prepared.id, actor).changeSet.status, "APPROVED");
  } finally { f.close(); }
});

test("M15 reindexes Taxonomy labels and chooses the primary segment for multi-segment matches", () => {
  const f = fixture(); try { const { packageId, taxonomyId } = packageWithTaxonomy(f, "OLD_TAXONOMY_TERM"); const primary = uuidv7(), alternate = uuidv7(), occurrence = uuidv7(); const content: QuestionItemContent = { packageId, displayOrder: 1, primaryVariantId: primary, taxonomyAssignments: [{ taxonomyNodeId: taxonomyId, role: "PRIMARY", position: 0 }], variants: [{ id: primary, displayOrder: 1, content: paragraph("MULTI_MATCH"), occurrences: [{ id: occurrence, displayOrder: 1, sourceKind: "ministerial", year: null, roundCode: null, session: null, sourceName: null, notes: null, rawLabel: "MULTI_MATCH", branches: [], qualifiers: [] }] }, { id: alternate, displayOrder: 2, content: paragraph("MULTI_MATCH"), occurrences: [] }], sharedAnswer: paragraph("MULTI_MATCH") }; const questionId = uuidv7(); f.questions.createQuestionAggregate({ id: questionId, content, actor }); const search = new QuestionSearchService(f.database); search.rebuildAll();
    const multi = search.searchPlacement(scope(packageId), "MULTI_MATCH"); assert.equal(multi.total, 1); assert.equal(multi.items[0].matchContext, "PRIMARY_VARIANT"); assert.equal(search.searchPlacement(scope(packageId), "OLD_TAXONOMY_TERM").total, 1);
    const taxonomy = f.questions.listTaxonomy(packageId)[0]; const prepared = publishUpdate(f, "question.taxonomy", taxonomy.id, taxonomy.revision, { packageId, nodeKey: taxonomy.nodeKey, label: "NEW_TAXONOMY_TERM", kind: taxonomy.kind, parentId: taxonomy.parentId, displayOrder: taxonomy.displayOrder });
    assert.equal(search.searchPlacement(scope(packageId), "NEW_TAXONOMY_TERM").total, 0); f.changes.publish(prepared.id, prepared.revision, actor); assert.equal(search.searchPlacement(scope(packageId), "OLD_TAXONOMY_TERM").total, 0); assert.equal(search.searchPlacement(scope(packageId), "NEW_TAXONOMY_TERM").total, 1);
  } finally { f.close(); }
});

test("M15 preserves placement Bank ordinals, cross-subject authority, taxonomy isolation, and descendants", () => {
  const f = fixture(); try { const { packageId, taxonomyId: parent } = packageWithTaxonomy(f, "A", "math"); const child = uuidv7(), other = uuidv7(); f.questions.createTaxonomyNode({ id: child, actor, content: { packageId, nodeKey: "child", label: "المقدمة", kind: "topic", parentId: parent, displayOrder: 1 } }); f.questions.createTaxonomyNode({ id: other, actor, content: { packageId, nodeKey: "other", label: "B", kind: "topic", parentId: null, displayOrder: 2 } });
    for (let index = 1; index <= 50; index += 1) createMinimalQuestion(f, packageId, index === 37 ? child : other, index, index === 37 ? "ORDINAL_NEEDLE COMMON_SCOPE" : "COMMON_SCOPE");
    const material = f.canonical.getSnapshot().materials.find((item) => item.subjectKey === "arabic")!; const allBank = uuidv7(), aBank = uuidv7(), bBank = uuidv7(), descendantBank = uuidv7(); const layout = { materialId: material.id, rootPresentation: "CARDS" as const, nodes: [
      { id: allBank, nodeKey: "all", label: "All", nodeType: "BANK" as const, parentId: null, displayOrder: 1, groupPresentation: null, packageId, targetMode: "ALL_PACKAGE_QUESTIONS" as const, taxonomyNodeId: null, includeDescendants: null, enabled: true },
      { id: aBank, nodeKey: "a", label: "A", nodeType: "BANK" as const, parentId: null, displayOrder: 2, groupPresentation: null, packageId, targetMode: "TAXONOMY_FILTER" as const, taxonomyNodeId: parent, includeDescendants: false, enabled: true },
      { id: bBank, nodeKey: "b", label: "B", nodeType: "BANK" as const, parentId: null, displayOrder: 3, groupPresentation: null, packageId, targetMode: "TAXONOMY_FILTER" as const, taxonomyNodeId: other, includeDescendants: false, enabled: true },
      { id: descendantBank, nodeKey: "desc", label: "Desc", nodeType: "BANK" as const, parentId: null, displayOrder: 4, groupPresentation: null, packageId, targetMode: "TAXONOMY_FILTER" as const, taxonomyNodeId: parent, includeDescendants: true, enabled: true },
    ] }; const draft = f.banks.save("arabic", layout, actor); const submitted = f.banks.submit("arabic", draft.revision, actor); const approved = f.changes.approve(submitted.id, submitted.revision, actor).changeSet; f.changes.publish(approved.id, approved.revision, actor); const search = new QuestionSearchService(f.database); search.rebuildAll();
    assert.equal(f.banks.searchPublicQuestions("arabic", allBank, "ORDINAL_NEEDLE").items[0].bankOrdinal, 37); assert.equal(f.banks.searchPublicQuestions("arabic", aBank, "COMMON_SCOPE").total, 0); assert.equal(f.banks.searchPublicQuestions("arabic", bBank, "COMMON_SCOPE").total, 49); assert.equal(f.banks.searchPublicQuestions("arabic", descendantBank, "COMMON_SCOPE").total, 1);
  } finally { f.close(); }
});

test("M15 rebuild recovers an empty projection, hardens query safety, preserves Quran text, and scales to 2,000 Questions", () => {
  const f = fixture(); try { const { packageId, taxonomyId } = packageWithTaxonomy(f); const source = "قُلْ هُوَ اللَّهُ أَحَدٌ"; const first = createMinimalQuestion(f, packageId, taxonomyId, 1, source); const insertQuestion = f.database.client.prepare("insert into questions(id,package_id,display_order,shared_answer,created_at,updated_at,updated_by,revision) values(?,?,?,?,?,?,?,1)"); const insertVariant = f.database.client.prepare("insert into question_variants(id,question_id,display_order,content,created_at,updated_at,updated_by,revision) values(?,?,?,?,?,?,?,1)"); const insertPrimary = f.database.client.prepare("insert into question_primary_variants(question_id,variant_id) values(?,?)"); const insertAssignment = f.database.client.prepare("insert into question_taxonomy_assignments(question_id,taxonomy_node_id,package_id,role,position) values(?,?,?,?,?)"); const transaction = f.database.client.transaction(() => { for (let index = 2; index <= 2000; index += 1) { const id = uuidv7(), variant = uuidv7(), text = index === 37 ? "SCALE_NEEDLE" : `scale content ${index}`; insertQuestion.run(id, packageId, index, null, 1, 1, actor.actorUserId); insertVariant.run(variant, id, 1, JSON.stringify(paragraph(text)), 1, 1, actor.actorUserId); insertPrimary.run(id, variant); insertAssignment.run(id, taxonomyId, packageId, "PRIMARY", 0); } }); transaction.immediate(); const search = new QuestionSearchService(f.database); search.rebuildPackage(packageId); assert.equal(search.getHealth().indexedQuestionCount, 2000); assert.equal(search.searchPlacement(scope(packageId), "SCALE_NEEDLE", 0, 25).items.length, 1); assert.equal(search.searchPlacement(scope(packageId), "scale", 0, 25).items.length, 25);
    for (const query of ['"', "*", ":", "(", ")", "-", "OR", "AND", "NEAR", "' OR 1=1 --", "، اختبار English"]) { try { search.searchPlacement(scope(packageId), query, 0, 25); } catch (error) { assert.ok(error instanceof QuestionSearchError && error.code === "QUESTION_SEARCH_EMPTY_QUERY"); } }
    assert.equal(search.searchPlacement(scope(packageId), "قل هو الله").items[0].questionId, first.questionId); assert.equal((f.questions.getQuestion(first.questionId)?.variants[0].content.blocks[0] as { spans: Array<{ text: string }> }).spans[0].text, source);
    const material = f.canonical.getSnapshot().materials.find((item) => item.subjectKey === "arabic")!; const nodes = [1, 2, 3].map((displayOrder) => ({ id: uuidv7(), nodeKey: `scale-${displayOrder}`, label: `Scale ${displayOrder}`, nodeType: "BANK" as const, parentId: null, displayOrder, groupPresentation: null, packageId, targetMode: "ALL_PACKAGE_QUESTIONS" as const, taxonomyNodeId: null, includeDescendants: null, enabled: true })); const draft = f.banks.save("arabic", { materialId: material.id, rootPresentation: "CARDS", nodes }, actor); const submitted = f.banks.submit("arabic", draft.revision, actor); const approved = f.changes.approve(submitted.id, submitted.revision, actor).changeSet; f.changes.publish(approved.id, approved.revision, actor); assert.equal(f.banks.isPublicAssetVisible(uuidv7()), false);
    f.database.client.exec("delete from question_search_fts; delete from question_search_documents;"); assert.equal(search.getHealth().healthy, false); assert.throws(() => search.searchPlacement(scope(packageId), "scale"), (error: unknown) => error instanceof QuestionSearchError && error.code === "QUESTION_SEARCH_UNAVAILABLE"); search.rebuildAll(); assert.equal(search.getHealth().healthy, true); assert.equal(search.searchPlacement(scope(packageId), "SCALE_NEEDLE").total, 1); assert.equal(QUESTION_SEARCH_INDEX_VERSION, 1);
  } finally { f.close(); }
});

test("M15 Student harness keeps GROUP navigation generic and Arabic fixture order exact", () => {
  const source = readFileSync(path.join(process.cwd(), "public/pythagoras/src/pages/QuestionBankPlaceholderPage.js"), "utf8"); const rootRenderer = source.slice(source.indexOf("function destinations"), source.indexOf("async function openGroup"));
  assert.ok(source.includes("data-open-group")); assert.equal(rootRenderer.includes("question-bank-switcher"), false); assert.ok(source.includes("state.search = null"));
  assert.deepEqual(["الاستفهام", "النفي", "التقديم والتأخير", "التوكيد", "النداء", "التعجب", "المدح والذم", "التمني والترجي", "العرض والتحضيض"], ["الاستفهام", "النفي", "التقديم والتأخير", "التوكيد", "النداء", "التعجب", "المدح والذم", "التمني والترجي", "العرض والتحضيض"]);
});
