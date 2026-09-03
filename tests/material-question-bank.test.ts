import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";
import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { createCanonicalContentRepository } from "../src/server/canonical-content";
import { createChangeManagementService } from "../src/server/change-management";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import {
  createMaterialQuestionBankService,
  ARABIC_QUESTION_BANK_PRESET,
  MaterialQuestionBankError,
  normalizeMaterialQuestionBankLayout,
  type MaterialQuestionBankLayoutContent,
  type MaterialQuestionBankNodeContent,
} from "../src/server/material-question-bank";
import { SQLiteMaterialQuestionBankRepository } from "../src/server/material-question-bank/sqlite-repository";
import { createQuestionEditorService } from "../src/server/question-editor";
import type { CanonicalRichDocument, QuestionItemContent } from "../src/server/questions";
import { SQLiteQuestionRepository } from "../src/server/questions";

const migrationsDirectory = path.join(process.cwd(), "drizzle");

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m14-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const canonical = createCanonicalContentRepository(database); canonical.bootstrap();
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerRow = identities.createInitialOwner({ id: uuidv7(), email: "owner@m14.test", displayName: "M14 Owner", passwordHash: "$argon2id$test", createdAt: 1 });
  const adminRow = identities.createAdmin({ id: uuidv7(), email: "admin@m14.test", displayName: "M14 Admin", passwordHash: "$argon2id$test", createdAt: 2 });
  const owner = actor(ownerRow.id, "OWNER"), admin = actor(adminRow.id, "ADMIN");
  return { root, database, canonical, owner, admin, questions: new SQLiteQuestionRepository(database, () => 100), banks: createMaterialQuestionBankService(database), changes: createChangeManagementService(database), close() { database.close(); rmSync(root, { recursive: true, force: true }); } };
}
function actor(actorUserId: string, actorRole: "OWNER" | "ADMIN"): AdminActor { return { actorUserId, actorRole }; }
function paragraph(text: string): CanonicalRichDocument { return { type: "doc", version: 1, blocks: [{ id: uuidv7(), type: "paragraph", spans: [{ text }] }] }; }
function createPackage(f: ReturnType<typeof fixture>, subjectKey: string, title: string) {
  const packageId = uuidv7();
  f.questions.createPackage({ id: packageId, actor: f.owner, content: { packageKey: `${subjectKey}-${packageId.slice(0, 8)}`, title, subjectKey, language: "ar-IQ", contentRevision: 1, bankBrowseMode: "TREE", bankBrowseEntryKey: `${subjectKey}-entry-${packageId.slice(0, 8)}`, bankBrowseEntryLabel: title, bankBrowseEntryOrder: 1, sourceAssetId: null, assetBindings: [] } });
  const taxonomyId = uuidv7();
  f.questions.createTaxonomyNode({ id: taxonomyId, actor: f.owner, content: { packageId, nodeKey: `root-${packageId.slice(0, 8)}`, label: "التصنيف الرئيس", kind: "unit", parentId: null, displayOrder: 1 } });
  return { packageId, taxonomyId };
}
function createQuestion(f: ReturnType<typeof fixture>, packageId: string, taxonomyId: string, displayOrder: number) {
  const id = uuidv7(), variantId = uuidv7();
  const content: QuestionItemContent = { packageId, displayOrder, primaryVariantId: variantId, taxonomyAssignments: [{ taxonomyNodeId: taxonomyId, role: "PRIMARY", position: 0 }], variants: [{ id: variantId, displayOrder: 1, content: paragraph(`السؤال التعليمي ${displayOrder}`), occurrences: [{ id: uuidv7(), displayOrder: 1, sourceKind: "ministerial", year: 2024, roundCode: "د1", session: null, sourceName: null, notes: null, rawLabel: `وزاري 2024 د1 رقم ${displayOrder}`, branches: ["علمي"], qualifiers: ["داخل القطر"] }] }], sharedAnswer: paragraph(`الإجابة ${displayOrder}`) };
  f.questions.createQuestionAggregate({ id, content, actor: f.owner }); return id;
}
function bank(id: string, label: string, order: number, parentId: string | null, packageId: string | null, taxonomyNodeId: string | null = null): MaterialQuestionBankNodeContent { return { id, nodeKey: `bank-${id.slice(-8)}`, label, nodeType: "BANK", parentId, displayOrder: order, groupPresentation: null, packageId, targetMode: taxonomyNodeId ? "TAXONOMY_FILTER" : "ALL_PACKAGE_QUESTIONS", taxonomyNodeId, includeDescendants: taxonomyNodeId ? true : null, enabled: true }; }
function group(id: string, label: string, order: number, presentation: "CARDS" | "SWITCHER"): MaterialQuestionBankNodeContent { return { id, nodeKey: `group-${id.slice(-8)}`, label, nodeType: "GROUP", parentId: null, displayOrder: order, groupPresentation: presentation, packageId: null, targetMode: null, taxonomyNodeId: null, includeDescendants: null, enabled: true }; }
function publishLayout(f: ReturnType<typeof fixture>, subjectKey: string, layout: MaterialQuestionBankLayoutContent) { const draft = f.banks.save(subjectKey, layout, f.admin); let change = f.banks.submit(subjectKey, draft.revision, f.admin); change = f.changes.approve(change.id, change.revision, f.owner).changeSet; return f.changes.publish(change.id, change.revision, f.owner); }

test("Arabic Product preset is seeded with stable fixed slots and public empty-state behavior", () => {
  const f = fixture();
  try {
    const workspace = f.banks.getAdminWorkspace("arabic", f.owner);
    assert.equal(workspace.productPreset, "ARABIC_FIXED");
    assert.equal(workspace.layout.rootPresentation, "CARDS");
    assert.deepEqual(workspace.layout.nodes.filter((node) => node.parentId === null).sort(orderNodes).map((node) => node.label), ["الأدب", "القواعد"]);
    const grammar = workspace.layout.nodes.find((node) => node.nodeKey === "arabic-grammar")!;
    assert.equal(grammar.nodeType, "GROUP"); assert.equal(grammar.groupPresentation, "SWITCHER");
    assert.deepEqual(workspace.layout.nodes.filter((node) => node.parentId === grammar.id).sort(orderNodes).map((node) => node.label), ["الاستفهام", "النفي", "التقديم والتأخير", "التوكيد", "النداء", "التعجب", "المدح والذم", "التمني والترجي", "العرض والتحضيض"]);
    assert.deepEqual(workspace.layout.nodes.map((node) => node.id).sort(), ARABIC_QUESTION_BANK_PRESET.nodes.map((node) => node.id).sort());
    assert.ok(workspace.layout.nodes.filter((node) => node.nodeType === "BANK").every((node) => node.packageId === null && node.targetMode === "ALL_PACKAGE_QUESTIONS"));
    const publicLayout = f.banks.getPublicLayout("arabic");
    assert.deepEqual(publicLayout.nodes.filter((node) => node.parentId === null).sort(orderNodes).map((node) => [node.label, node.available]), [["الأدب", false], ["القواعد", false]]);
  } finally { f.close(); }
});

test("Arabic preset rejects structural edits while governed assignment changes publish normally", () => {
  const f = fixture();
  try {
    const initial = f.banks.getAdminWorkspace("arabic", f.admin);
    const english = createPackage(f, "english", "حزمة مشتركة"); createQuestion(f, english.packageId, english.taxonomyId, 1);
    const istifham = initial.layout.nodes.find((node) => node.nodeKey === "arabic-grammar-istifham")!;
    const assigned = { ...initial.layout, nodes: initial.layout.nodes.map((node) => node.id === istifham.id ? { ...node, packageId: english.packageId } : node) };
    const draft = f.banks.save("arabic", assigned, f.admin);
    assert.equal(f.banks.getPublicLayout("arabic").nodes.find((node) => node.id === istifham.id)?.available, false);
    let change = f.banks.submit("arabic", draft.revision, f.admin); change = f.changes.approve(change.id, change.revision, f.owner).changeSet; f.changes.publish(change.id, change.revision, f.owner);
    const published = f.banks.getPublicLayout("arabic");
    assert.equal(published.nodes.find((node) => node.id === istifham.id)?.available, true);
    assert.equal(published.nodes.find((node) => node.nodeKey === "arabic-grammar")?.available, true);
    const unassign = { ...assigned, nodes: assigned.nodes.map((node) => node.id === istifham.id ? { ...node, packageId: null, targetMode: "ALL_PACKAGE_QUESTIONS" as const, taxonomyNodeId: null, includeDescendants: null } : node) };
    assert.ok(f.banks.save("arabic", unassign, f.admin).id);
    assert.throws(() => f.banks.save("arabic", { ...assigned, nodes: assigned.nodes.map((node) => node.id === istifham.id ? { ...node, label: "تعديل محظور" } : node) }, f.admin), /immutable/u);
    assert.throws(() => f.banks.save("arabic", { ...assigned, nodes: assigned.nodes.filter((node) => node.id !== istifham.id) }, f.admin), /immutable/u);
    assert.throws(() => f.banks.save("arabic", { ...assigned, rootPresentation: "DIRECT" }, f.admin), /immutable/u);
  } finally { f.close(); }
});

test("0010 seeds an existing owner database without an Arabic layout and never replaces an existing layout", () => {
  const oldRoot = mkdtempSync(path.join(os.tmpdir(), "pythagoras-arabic-preset-old-"));
  const oldMigrations = mkdtempSync(path.join(os.tmpdir(), "pythagoras-arabic-preset-migrations-"));
  const existingRoot = mkdtempSync(path.join(os.tmpdir(), "pythagoras-arabic-preset-existing-"));
  try {
    mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8"));
    for (const entry of journal.entries.slice(0, 10)) copyFileSync(path.join(migrationsDirectory, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
    journal.entries = journal.entries.slice(0, 10); writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify(journal));
    const old = openContentDatabase({ dataDirectory: oldRoot, migrationsDirectory: oldMigrations });
    createCanonicalContentRepository(old).bootstrap(); new SQLiteAdminIdentityRepository(old).createInitialOwner({ id: uuidv7(), email: "preset-upgrade@test.local", displayName: "Preset Upgrade", passwordHash: "$argon2id$test", createdAt: 1 }); old.close();
    const upgraded = openContentDatabase({ dataDirectory: oldRoot, migrationsDirectory });
    const arabicId = (upgraded.client.prepare("select id from canonical_materials where subject_key='arabic'").get() as { id: string }).id;
    assert.equal(new SQLiteMaterialQuestionBankRepository(upgraded).get(arabicId)?.nodes.length, 11); upgraded.close();

    const existing = openContentDatabase({ dataDirectory: existingRoot, migrationsDirectory: oldMigrations }); createCanonicalContentRepository(existing).bootstrap();
    const owner = new SQLiteAdminIdentityRepository(existing).createInitialOwner({ id: uuidv7(), email: "existing-layout@test.local", displayName: "Existing", passwordHash: "$argon2id$test", createdAt: 1 });
    const arabicIdExisting = (existing.client.prepare("select id from canonical_materials where subject_key='arabic'").get() as { id: string }).id;
    const legacy = { materialId: arabicIdExisting, rootPresentation: "CARDS" as const, nodes: [bank(uuidv7(), "Existing layout", 1, null, null)] };
    new SQLiteMaterialQuestionBankRepository(existing).save({ content: legacy, expectedRevision: 0, actor: actor(owner.id, "OWNER"), operation: "CREATE" });
    existing.close();
    const reopened = openContentDatabase({ dataDirectory: existingRoot, migrationsDirectory });
    assert.deepEqual(new SQLiteMaterialQuestionBankRepository(reopened).get(arabicIdExisting)?.nodes.map((node) => node.label), ["Existing layout"]); reopened.close();
  } finally { [oldRoot, oldMigrations, existingRoot].forEach((target) => rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })); }
});

function migrationSeededFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-arabic-preset-publication-"));
  const oldMigrations = mkdtempSync(path.join(os.tmpdir(), "pythagoras-arabic-preset-publication-migrations-"));
  mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8"));
  for (const entry of journal.entries.slice(0, 10)) copyFileSync(path.join(migrationsDirectory, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
  journal.entries = journal.entries.slice(0, 10);
  writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify(journal));

  const old = openContentDatabase({ dataDirectory: root, migrationsDirectory: oldMigrations });
  createCanonicalContentRepository(old).bootstrap();
  const identities = new SQLiteAdminIdentityRepository(old);
  const ownerRow = identities.createInitialOwner({ id: uuidv7(), email: "seeded-owner@m14.test", displayName: "Seeded Owner", passwordHash: "$argon2id$test", createdAt: 1 });
  const adminRow = identities.createAdmin({ id: uuidv7(), email: "seeded-admin@m14.test", displayName: "Seeded Admin", passwordHash: "$argon2id$test", createdAt: 2 });
  old.close();

  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  return {
    root,
    database,
    canonical: createCanonicalContentRepository(database),
    owner: actor(ownerRow.id, "OWNER"),
    admin: actor(adminRow.id, "ADMIN"),
    questions: new SQLiteQuestionRepository(database, () => 100),
    banks: createMaterialQuestionBankService(database),
    changes: createChangeManagementService(database),
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      rmSync(oldMigrations, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}

test("migration-seeded Arabic preset publishes an Istifham assignment through the UPDATE governance path", () => {
  const f = migrationSeededFixture();
  try {
    const initial = f.banks.getAdminWorkspace("arabic", f.admin);
    assert.equal(initial.canonicalRevision, 1);
    assert.equal(initial.layout.nodes.length, 11);
    const packageGraph = createPackage(f, "arabic", "حزمة الاستفهام الاختبارية");
    createQuestion(f, packageGraph.packageId, packageGraph.taxonomyId, 1);
    const istifham = initial.layout.nodes.find((node) => node.nodeKey === "arabic-grammar-istifham")!;
    const desired = {
      ...initial.layout,
      nodes: initial.layout.nodes.map((node) => node.id === istifham.id ? { ...node, packageId: packageGraph.packageId } : node),
    };
    const draft = f.banks.save("arabic", desired, f.admin);
    let change = f.banks.submit("arabic", draft.revision, f.admin);
    change = f.changes.approve(change.id, change.revision, f.owner).changeSet;
    const result = f.changes.publish(change.id, change.revision, f.owner);

    const published = f.banks.getAdminWorkspace("arabic", f.owner);
    const publishedIstifham = published.layout.nodes.find((node) => node.id === istifham.id)!;
    assert.equal(result.changeSet.changeSet.status, "PUBLISHED");
    assert.equal(published.canonicalRevision, 2);
    assert.equal(publishedIstifham.packageId, packageGraph.packageId);
    assert.equal(f.banks.getPublicLayout("arabic").nodes.find((node) => node.id === istifham.id)?.available, true);
    assert.deepEqual(
      published.layout.nodes.map(structuralPresetNode).sort((a, b) => a.id.localeCompare(b.id)),
      initial.layout.nodes.map(structuralPresetNode).sort((a, b) => a.id.localeCompare(b.id)),
    );
  } finally { f.close(); }
});

test("migration-seeded Arabic assignment publication rolls back atomically on a storage failure", () => {
  const f = migrationSeededFixture();
  try {
    const initial = f.banks.getAdminWorkspace("arabic", f.admin);
    const packageGraph = createPackage(f, "arabic", "حزمة استرجاع الاختبار");
    createQuestion(f, packageGraph.packageId, packageGraph.taxonomyId, 1);
    const istifham = initial.layout.nodes.find((node) => node.nodeKey === "arabic-grammar-istifham")!;
    const desired = { ...initial.layout, nodes: initial.layout.nodes.map((node) => node.id === istifham.id ? { ...node, packageId: packageGraph.packageId } : node) };
    const draft = f.banks.save("arabic", desired, f.admin);
    let change = f.banks.submit("arabic", draft.revision, f.admin);
    change = f.changes.approve(change.id, change.revision, f.owner).changeSet;
    const publicationRevision = Number((f.database.client.prepare("select current_revision from publication_state where id='global'").get() as { current_revision: number }).current_revision);
    f.database.client.exec(`create trigger test_block_arabic_istifham_assignment before update on material_question_bank_nodes
      when new.id = '${istifham.id}' begin select raise(abort, 'test-only Arabic assignment failure'); end;`);

    assert.throws(() => f.changes.publish(change.id, change.revision, f.owner), /Publication failed/u);
    const canonical = f.banks.getAdminWorkspace("arabic", f.owner);
    assert.equal(canonical.canonicalRevision, 1);
    assert.equal(canonical.layout.nodes.find((node) => node.id === istifham.id)?.packageId, null);
    assert.equal(f.changes.getDetails(change.id, f.owner).changeSet.status, "APPROVED");
    assert.equal(Number((f.database.client.prepare("select current_revision from publication_state where id='global'").get() as { current_revision: number }).current_revision), publicationRevision);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from questions where package_id=?").get(packageGraph.packageId) as { count: number }).count), 1);
    assert.deepEqual(f.database.client.prepare("pragma foreign_key_check").all(), []);
    assert.deepEqual(f.database.client.prepare("pragma quick_check").all(), [{ quick_check: "ok" }]);
  } finally { f.close(); }
});

function structuralPresetNode(node: MaterialQuestionBankNodeContent) {
  return {
    id: node.id,
    nodeKey: node.nodeKey,
    label: node.label,
    nodeType: node.nodeType,
    parentId: node.parentId,
    displayOrder: node.displayOrder,
    groupPresentation: node.groupPresentation,
    enabled: node.enabled,
  };
}

function orderNodes(a: { displayOrder: number; id: string }, b: { displayOrder: number; id: string }) { return a.displayOrder - b.displayOrder || a.id.localeCompare(b.id); }

test("M14 generic materials support CARDS topology, SWITCHER children, empty slots, and cross-subject placement", () => {
  const f = fixture();
  try {
    const arabic = f.canonical.getSnapshot().materials.find((item) => item.subjectKey === "biology")!;
    const literature = createPackage(f, "biology", "الأدب العربي");
    const grammar = createPackage(f, "english", "قواعد مشتركة");
    const literatureBank = bank(uuidv7(), "الأدب", 1, null, literature.packageId);
    const grammarGroup = group(uuidv7(), "القواعد", 2, "SWITCHER");
    const labels = ["الاستفهام", "النفي", "التقديم والتأخير", "التوكيد", "النداء", "التعجب", "المدح والذم", "التمني والترجي", "العرض والتحضيض"];
    const topics = labels.map((label, index) => bank(uuidv7(), label, index + 1, grammarGroup.id, grammar.packageId, grammar.taxonomyId));
    const emptySlot = bank(uuidv7(), "موضوع قادم", 3, null, null);
    const layout = normalizeMaterialQuestionBankLayout({ materialId: arabic.id, rootPresentation: "CARDS", nodes: [literatureBank, grammarGroup, ...topics, emptySlot] });
    assert.deepEqual(topics.map((item) => item.label), labels);
    assert.equal(layout.rootPresentation, "CARDS"); assert.equal(layout.nodes.filter((item) => item.parentId === grammarGroup.id).length, 9);
    const workspace = f.banks.getAdminWorkspace("biology", f.owner);
    const warnings = f.banks.save("biology", layout, f.admin);
    assert.equal(warnings.editable, true);
    const repeatedSave = f.banks.save("biology", { ...layout, nodes: layout.nodes.map((node) => node.id === literatureBank.id ? { ...node, label: "الأدب المحدّث" } : node) }, f.admin);
    assert.equal(repeatedSave.id, warnings.id);
    const after = f.banks.getAdminWorkspace("biology", f.admin);
    assert.equal(after.warnings.length, 9); assert.match(after.warnings[0].message, /مسموح|ستظهر|مصنفة/u);
    assert.ok(workspace.packages.some((item) => item.subjectKey === "english"));
  } finally { f.close(); }
});

test("M14 layout is a conservative aggregate and reaches public Student reads only after atomic OWNER publication", () => {
  const f = fixture();
  try {
    const material = f.canonical.getSnapshot().materials.find((item) => item.subjectKey === "biology")!;
    const cross = createPackage(f, "english", "حزمة عابرة للمواد");
    const questionIds = Array.from({ length: 55 }, (_, index) => createQuestion(f, cross.packageId, cross.taxonomyId, index + 100));
    const rootBank = bank(uuidv7(), "كل الأسئلة", 1, null, cross.packageId);
    const repeatedBank = bank(uuidv7(), "عرض ثانٍ", 2, null, cross.packageId, cross.taxonomyId);
    const layout = { materialId: material.id, rootPresentation: "CARDS" as const, nodes: [rootBank, repeatedBank] };
    const draft = f.banks.save("biology", layout, f.admin);
    assert.throws(() => f.banks.getPublicLayout("biology"), (error: unknown) => error instanceof MaterialQuestionBankError && error.code === "MATERIAL_BANK_NOT_FOUND");
    let change = f.banks.submit("biology", draft.revision, f.admin);
    change = f.changes.approve(change.id, change.revision, f.owner).changeSet;
    assert.throws(() => f.banks.getPublicLayout("biology"));
    f.changes.publish(change.id, change.revision, f.owner);
    const publicLayout = f.banks.getPublicLayout("biology");
    assert.deepEqual(publicLayout.nodes.map((item) => item.id), [rootBank.id, repeatedBank.id]);
    const adminWorkspace = f.banks.getAdminWorkspace("biology", f.owner);
    assert.equal(adminWorkspace.published, true);
    assert.deepEqual(adminWorkspace.publishedNodeIds, [rootBank.id, repeatedBank.id]);
    const first = f.banks.listPublicQuestions("biology", rootBank.id, 0, 50);
    assert.equal(first.total, 55); assert.equal(first.items.length, 50); assert.equal(first.items[0].ordinal, 1); assert.equal(first.items[49].ordinal, 50);
    assert.equal("content" in first.items[0], false); assert.equal("variants" in first.items[0], false);
    const second = f.banks.listPublicQuestions("biology", rootBank.id, 50, 100);
    assert.equal(second.limit, 100); assert.equal(second.items[0].ordinal, 51);
    const detail = f.banks.getPublicQuestion("biology", rootBank.id, questionIds[0]);
    assert.equal(detail.variants.length, 1); assert.equal(detail.variants[0].occurrences[0].rawLabel, "وزاري 2024 د1 رقم 100"); assert.equal(detail.sharedAnswer?.type, "doc");
    assert.throws(() => f.banks.getPublicQuestion("biology", repeatedBank.id, uuidv7()), (error: unknown) => error instanceof MaterialQuestionBankError && error.code === "MATERIAL_BANK_NOT_FOUND");
    assert.throws(() => f.banks.save("biology", { ...layout, nodes: [rootBank] }, f.admin), /disabled instead of removed/u);
    const metadataDraft = f.banks.save("biology", { ...layout, nodes: [{ ...rootBank, label: "عنوان مسودة" }, repeatedBank] }, f.admin);
    f.database.client.prepare("update material_question_bank_layouts set root_presentation='DIRECT',revision=revision+1 where material_id=?").run(material.id);
    const conflicted = f.banks.submit("biology", metadataDraft.revision, f.admin);
    assert.throws(() => f.changes.approve(conflicted.id, conflicted.revision, f.owner), /changed after this proposal/u);
    assert.equal(f.changes.getDetails(conflicted.id, f.owner).changeSet.status, "CONFLICTED");
  } finally { f.close(); }
});

test("M14 DIRECT, disabled placement, availability, stable IDs, and unpublished package workflow behavior are explicit", () => {
  const f = fixture();
  try {
    const material = f.canonical.getSnapshot().materials.find((item) => item.subjectKey === "islamic")!;
    const pack = createPackage(f, "islamic", "الإسلامية"); createQuestion(f, pack.packageId, pack.taxonomyId, 1);
    const direct = bank(uuidv7(), "الدخول المباشر", 1, null, pack.packageId);
    publishLayout(f, "islamic", { materialId: material.id, rootPresentation: "DIRECT", nodes: [direct] });
    assert.equal(f.banks.getPublicLayout("islamic").rootPresentation, "DIRECT");
    const draft = f.banks.save("islamic", { materialId: material.id, rootPresentation: "DIRECT", nodes: [{ ...direct, enabled: false }] }, f.admin);
    assert.ok(draft.id); assert.equal("enabled" in f.banks.getPublicLayout("islamic").nodes[0], false);
    assert.throws(() => normalizeMaterialQuestionBankLayout({ materialId: material.id, rootPresentation: "CARDS", nodes: [direct, { ...direct, nodeKey: "duplicate", displayOrder: 2 }] }), /IDs must be unique/u);

    const editor = createQuestionEditorService(f.database);
    const packageId = uuidv7();
    const proposal = { packageKey: `draft-${packageId.slice(0, 8)}`, title: "حزمة غير منشورة", subjectKey: "arabic", language: "ar-IQ", contentRevision: 1, bankBrowseMode: "TREE" as const, bankBrowseEntryKey: `draft-${packageId.slice(0, 8)}`, bankBrowseEntryLabel: "حزمة غير منشورة", bankBrowseEntryOrder: 90, sourceAssetId: null, assetBindings: [] };
    const workflow = editor.save(packageId, { resourceType: "question.package", resourceId: packageId, desired: proposal }, f.admin);
    let submitted = editor.submit(packageId, workflow.revision, f.admin); submitted = f.changes.approve(submitted.id, submitted.revision, f.owner).changeSet;
    const summary = editor.listPackages(f.admin).packages.find((item) => item.id === packageId)!;
    assert.equal(summary.published, false); assert.equal(summary.activeDraft, null); assert.equal(summary.workflow?.status, "APPROVED"); assert.equal(summary.workflow?.editable, false);
  } finally { f.close(); }
});

test("0008 applies to fresh and existing 0007 DBs and M14 source keeps public contracts compact and N+1-free", () => {
  const freshRoot = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m14-fresh-"));
  const oldRoot = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m14-old-"));
  const oldMigrations = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m14-migrations-"));
  try {
    const fresh = openContentDatabase({ dataDirectory: freshRoot, migrationsDirectory });
    assert.equal((fresh.client.prepare("select count(*) count from __drizzle_migrations").get() as { count: number }).count, 36); fresh.close();
    mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8"));
    for (const entry of journal.entries.slice(0, 8)) copyFileSync(path.join(migrationsDirectory, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
    journal.entries = journal.entries.slice(0, 8); writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify(journal));
    const old = openContentDatabase({ dataDirectory: oldRoot, migrationsDirectory: oldMigrations }); old.close();
    const upgraded = openContentDatabase({ dataDirectory: oldRoot, migrationsDirectory });
    assert.ok(upgraded.client.prepare("select name from sqlite_master where name='material_question_bank_nodes'").get()); upgraded.close();
    const editorSource = readFileSync(path.join(process.cwd(), "src/server/question-editor/service.ts"), "utf8");
    const listMethod = editorSource.slice(editorSource.indexOf("listQuestions("), editorSource.indexOf("getQuestion(", editorSource.indexOf("listQuestions(")));
    assert.equal(/rows\.map[\s\S]*this\.database\.client\.prepare/u.test(listMethod), false);
    const publicService = readFileSync(path.join(process.cwd(), "src/server/material-question-bank/service.ts"), "utf8");
    assert.ok(publicService.includes("safeOffset + index + 1")); assert.ok(publicService.includes("MATERIAL_QUESTION_BANK_MAX_PAGE_SIZE"));
    const adminRoute = readFileSync(path.join(process.cwd(), "src/app/api/admin/material-question-bank/[subjectKey]/route.ts"), "utf8");
    const submitRoute = readFileSync(path.join(process.cwd(), "src/app/api/admin/material-question-bank/[subjectKey]/submit/route.ts"), "utf8");
    const publicRoute = readFileSync(path.join(process.cwd(), "src/app/api/content/question-bank/[subjectKey]/route.ts"), "utf8");
    assert.ok(adminRoute.includes("requireMaterialBankAdmin")); assert.ok(adminRoute.includes("assertTrustedMutationRequest"));
    assert.ok(submitRoute.includes("requireMaterialBankAdmin")); assert.ok(submitRoute.includes("assertTrustedMutationRequest"));
    assert.equal(/requireAdmin|session|password|tokenHash/u.test(publicRoute), false);
  } finally { [freshRoot, oldRoot, oldMigrations].forEach((target) => rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })); }
});
