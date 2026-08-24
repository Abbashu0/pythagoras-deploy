import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionReviewItem } from "../src/components/admin/review/QuestionReviewItem";
import type { ChangeDetails } from "../src/components/admin/review/types";
import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { createCanonicalContentRepository } from "../src/server/canonical-content";
import {
  ChangeManagementError,
  ChangeResourceAdapterRegistry,
  createChangeManagementService,
  createDefaultChangeResourceRegistry,
  SQLitePublicationRepository,
  type ChangeResourceAdapter,
} from "../src/server/change-management";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import {
  createQuestionChangeAdapters,
  QuestionChangeSetCoordinator,
  SQLiteQuestionRepository,
  type CanonicalRichDocument,
  type QuestionItemContent,
  type QuestionPackageContent,
  type QuestionTaxonomyContent,
} from "../src/server/questions";

const migrationsDirectory = path.join(process.cwd(), "drizzle");

interface Fixture {
  root: string;
  database: ContentDatabase;
  service: ReturnType<typeof createChangeManagementService>;
  questions: SQLiteQuestionRepository;
  publications: SQLitePublicationRepository;
  owner: AdminActor;
  admin: AdminActor;
  close(): void;
}

function createFixture(registry?: ChangeResourceAdapterRegistry): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-question-change-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  createCanonicalContentRepository(database).bootstrap();
  const identities = new SQLiteAdminIdentityRepository(database);
  const createdAt = 1_710_000_000_000;
  const ownerUser = identities.createInitialOwner({ id: uuidv7(), email: "owner@question-change.test", displayName: "Owner", passwordHash: "$argon2id$test", createdAt });
  const adminUser = identities.createAdmin({ id: uuidv7(), email: "admin@question-change.test", displayName: "Admin", passwordHash: "$argon2id$test", createdAt: createdAt + 1 });
  return {
    root,
    database,
    service: createChangeManagementService(database, registry),
    questions: new SQLiteQuestionRepository(database),
    publications: new SQLitePublicationRepository(database),
    owner: { actorUserId: ownerUser.id, actorRole: "OWNER" },
    admin: { actorUserId: adminUser.id, actorRole: "ADMIN" },
    close() { database.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

function paragraph(text: string): CanonicalRichDocument {
  return {
    type: "doc",
    version: 1,
    blocks: [{ id: uuidv7(), type: "paragraph", spans: [{ text }] }],
  };
}

function packageContent(overrides: Partial<QuestionPackageContent> = {}): QuestionPackageContent {
  return {
    packageKey: "m11-arabic",
    title: "حزمة عربية تجريبية",
    subjectKey: "arabic",
    language: "ar-IQ",
    contentRevision: 1,
    bankBrowseMode: "TREE",
    bankBrowseEntryKey: "m11-bank",
    bankBrowseEntryLabel: "بنك M11",
    bankBrowseEntryOrder: 91,
    sourceAssetId: null,
    assetBindings: [],
    ...overrides,
  };
}

function taxonomyContent(packageId: string, overrides: Partial<QuestionTaxonomyContent> = {}): QuestionTaxonomyContent {
  return {
    packageId,
    nodeKey: "grammar",
    label: "القواعد",
    kind: "unit",
    parentId: null,
    displayOrder: 1,
    ...overrides,
  };
}

function questionContent(packageId: string, taxonomyNodeId: string, overrides: Partial<QuestionItemContent> = {}): QuestionItemContent {
  const variantId = uuidv7();
  return {
    packageId,
    displayOrder: 1,
    primaryVariantId: variantId,
    taxonomyAssignments: [{ taxonomyNodeId, role: "PRIMARY", position: 0 }],
    variants: [{
      id: variantId,
      displayOrder: 1,
      content: paragraph("ما علامة رفع الفاعل؟"),
      occurrences: [{
        id: uuidv7(),
        displayOrder: 1,
        sourceKind: "ministerial",
        year: 2024,
        roundCode: "د1",
        session: null,
        sourceName: "وزارة التربية",
        notes: null,
        rawLabel: "وزاري 2024 الدور الأول",
        branches: ["علمي"],
        qualifiers: ["داخل القطر"],
      }],
    }],
    sharedAnswer: paragraph("الضمة."),
    ...overrides,
  };
}

function publishCreateAggregate(fixture: Fixture) {
  const packageId = uuidv7();
  const taxonomyRootId = uuidv7();
  const taxonomyChildId = uuidv7();
  const browseRootId = uuidv7();
  const browseListId = uuidv7();
  const questionId = uuidv7();
  const question = questionContent(packageId, taxonomyChildId);
  let change = fixture.service.createChangeSet({
    title: "إنشاء أساس بنك الأسئلة",
    initialItems: [
      { resourceType: "question.item", resourceId: questionId, expectedRevision: 0, operation: "CREATE", desired: question },
      { resourceType: "question.browse", resourceId: browseListId, expectedRevision: 0, operation: "CREATE", desired: { packageId, nodeKey: "grammar-list", label: "أسئلة القواعد", nodeType: "QUESTION_LIST", parentId: browseRootId, displayOrder: 1, taxonomyNodeId: taxonomyChildId, includeDescendants: true } },
      { resourceType: "question.browse", resourceId: browseRootId, expectedRevision: 0, operation: "CREATE", desired: { packageId, nodeKey: "browse-root", label: "التصفح", nodeType: "GROUP", parentId: null, displayOrder: 1, taxonomyNodeId: null, includeDescendants: null } },
      { resourceType: "question.taxonomy", resourceId: taxonomyChildId, expectedRevision: 0, operation: "CREATE", desired: taxonomyContent(packageId, { nodeKey: "subject", label: "الموضوع", kind: "topic", parentId: taxonomyRootId }) },
      { resourceType: "question.taxonomy", resourceId: taxonomyRootId, expectedRevision: 0, operation: "CREATE", desired: taxonomyContent(packageId) },
      { resourceType: "question.package", resourceId: packageId, expectedRevision: 0, operation: "CREATE", desired: packageContent() },
    ],
  }, fixture.admin);
  assert.equal(fixture.questions.getPackage(packageId), null, "DRAFT mutated canonical Question data");
  change = fixture.service.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
  assert.equal(fixture.questions.getPackage(packageId), null, "SUBMITTED mutated canonical Question data");
  change = fixture.service.requestChanges(change.changeSet.id, change.changeSet.revision, "راجع الصياغة قبل النشر", fixture.owner);
  assert.equal(fixture.questions.getPackage(packageId), null, "NEEDS_CHANGES mutated canonical Question data");
  change = fixture.service.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
  change = fixture.service.approve(change.changeSet.id, change.changeSet.revision, fixture.owner);
  assert.equal(fixture.questions.getPackage(packageId), null, "APPROVED mutated canonical Question data");
  const publication = fixture.service.publish(change.changeSet.id, change.changeSet.revision, fixture.owner);
  return { packageId, taxonomyRootId, taxonomyChildId, browseRootId, browseListId, questionId, question, publication };
}

test("Question adapters are registered and reverse-ordered dependencies publish atomically only after OWNER approval", () => {
  const fixture = createFixture();
  try {
    const types = createDefaultChangeResourceRegistry().listResourceTypes();
    for (const type of ["question.package", "question.taxonomy", "question.browse", "question.item", "asset.metadata", "banner"]) assert.ok(types.includes(type));
    const result = publishCreateAggregate(fixture);
    assert.equal(result.publication.publicationRevision, 1);
    assert.equal(result.publication.changeSet.changeSet.status, "PUBLISHED");
    assert.ok(result.publication.changeSet.areaLabels.includes("بنك الأسئلة"));
    assert.match(result.publication.changeSet.items.find((item) => item.resourceType === "question.item")!.presentation.resourceLabel, /سؤال/u);
    const aggregate = fixture.questions.getPackageAggregate(result.packageId)!;
    assert.equal(aggregate.package.updatedBy, fixture.owner.actorUserId);
    assert.deepEqual(aggregate.taxonomy.map((node) => node.id), [result.taxonomyRootId, result.taxonomyChildId]);
    assert.deepEqual(aggregate.browseNodes.map((node) => node.id), [result.browseRootId, result.browseListId]);
    assert.equal(aggregate.questions[0].id, result.questionId);
    assert.equal(aggregate.questions[0].variants[0].occurrences[0].rawLabel, "وزاري 2024 الدور الأول");
    const publication = fixture.publications.list().items[0];
    assert.equal(fixture.publications.listItems(publication.id).filter((item) => item.resourceType.startsWith("question.")).length, 6);
    assert.throws(() => {
      let change = fixture.service.createChangeSet({ title: "OWNER-only check", initialItem: { resourceType: "question.package", resourceId: uuidv7(), expectedRevision: 0, operation: "CREATE", desired: packageContent({ packageKey: "owner-only", bankBrowseEntryKey: "owner-only", bankBrowseEntryOrder: 92 }) } }, fixture.admin);
      change = fixture.service.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
      fixture.service.approve(change.changeSet.id, change.changeSet.revision, fixture.admin);
    }, (error) => error instanceof ChangeManagementError && error.code === "CHANGE_AUTHORIZATION_FAILED");
  } finally { fixture.close(); }
});

test("missing parents, cycles and cross-package taxonomy assignments are blocked before canonical mutation", () => {
  const fixture = createFixture();
  try {
    const packageId = uuidv7();
    const missing = uuidv7();
    let change = fixture.service.createChangeSet({ title: "Missing parent", initialItems: [
      { resourceType: "question.package", resourceId: packageId, expectedRevision: 0, operation: "CREATE", desired: packageContent() },
      { resourceType: "question.taxonomy", resourceId: uuidv7(), expectedRevision: 0, operation: "CREATE", desired: taxonomyContent(packageId, { parentId: missing }) },
    ] }, fixture.admin);
    assert.throws(() => fixture.service.submit(change.changeSet.id, change.changeSet.revision, fixture.admin), (error) => error instanceof ChangeManagementError && error.code === "CHANGE_VALIDATION_FAILED");
    assert.equal(fixture.questions.getPackage(packageId), null);

    const cyclePackage = uuidv7();
    const a = uuidv7();
    const b = uuidv7();
    change = fixture.service.createChangeSet({ title: "Cycle", initialItems: [
      { resourceType: "question.package", resourceId: cyclePackage, expectedRevision: 0, operation: "CREATE", desired: packageContent({ packageKey: "cycle-package", bankBrowseEntryKey: "cycle", bankBrowseEntryOrder: 93 }) },
      { resourceType: "question.taxonomy", resourceId: a, expectedRevision: 0, operation: "CREATE", desired: taxonomyContent(cyclePackage, { nodeKey: "a", parentId: b }) },
      { resourceType: "question.taxonomy", resourceId: b, expectedRevision: 0, operation: "CREATE", desired: taxonomyContent(cyclePackage, { nodeKey: "b", parentId: a, displayOrder: 2 }) },
    ] }, fixture.admin);
    assert.throws(() => fixture.service.submit(change.changeSet.id, change.changeSet.revision, fixture.admin));
    assert.equal(fixture.questions.getPackage(cyclePackage), null);

    const firstPackage = uuidv7();
    const secondPackage = uuidv7();
    const foreignTaxonomy = uuidv7();
    const questionId = uuidv7();
    change = fixture.service.createChangeSet({ title: "Cross-package assignment", initialItems: [
      { resourceType: "question.package", resourceId: firstPackage, expectedRevision: 0, operation: "CREATE", desired: packageContent({ packageKey: "first-package", bankBrowseEntryKey: "first", bankBrowseEntryOrder: 94 }) },
      { resourceType: "question.package", resourceId: secondPackage, expectedRevision: 0, operation: "CREATE", desired: packageContent({ packageKey: "second-package", bankBrowseEntryKey: "second", bankBrowseEntryOrder: 95 }) },
      { resourceType: "question.taxonomy", resourceId: foreignTaxonomy, expectedRevision: 0, operation: "CREATE", desired: taxonomyContent(secondPackage) },
      { resourceType: "question.item", resourceId: questionId, expectedRevision: 0, operation: "CREATE", desired: questionContent(firstPackage, foreignTaxonomy) },
    ] }, fixture.admin);
    assert.throws(() => fixture.service.submit(change.changeSet.id, change.changeSet.revision, fixture.admin));
    assert.equal(fixture.questions.getQuestion(questionId), null);

    assert.throws(() => fixture.service.createChangeSet({ title: "Invalid primary Variant", initialItem: { resourceType: "question.item", resourceId: uuidv7(), expectedRevision: 0, operation: "CREATE", desired: questionContent(firstPackage, foreignTaxonomy, { primaryVariantId: uuidv7() }) } }, fixture.admin));
  } finally { fixture.close(); }
});

test("Package, Taxonomy and Browse UPDATEs use reviewed domain mutations and preserve immutable ownership", () => {
  const fixture = createFixture();
  try {
    const created = publishCreateAggregate(fixture);
    const packageBefore = fixture.questions.getPackage(created.packageId)!;
    const taxonomyBefore = fixture.questions.listTaxonomy(created.packageId).find((node) => node.id === created.taxonomyRootId)!;
    const browseBefore = fixture.questions.listBrowseNodes(created.packageId).find((node) => node.id === created.browseRootId)!;
    let change = fixture.service.createChangeSet({ title: "تحديث بنية الحزمة", initialItems: [
      { resourceType: "question.package", resourceId: created.packageId, expectedRevision: packageBefore.revision, operation: "UPDATE", desired: packageContent({ title: "الحزمة العربية المنقحة", bankBrowseEntryLabel: "البنك المنقح" }) },
      { resourceType: "question.taxonomy", resourceId: created.taxonomyRootId, expectedRevision: taxonomyBefore.revision, operation: "UPDATE", desired: taxonomyContent(created.packageId, { label: "القواعد المنقحة" }) },
      { resourceType: "question.browse", resourceId: created.browseRootId, expectedRevision: browseBefore.revision, operation: "UPDATE", desired: { packageId: created.packageId, nodeKey: "browse-root", label: "التصفح المنقح", nodeType: "GROUP", parentId: null, displayOrder: 1, taxonomyNodeId: null, includeDescendants: null } },
    ] }, fixture.admin);
    change = fixture.service.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
    change = fixture.service.approve(change.changeSet.id, change.changeSet.revision, fixture.owner);
    assert.equal(fixture.questions.getPackage(created.packageId)!.title, "حزمة عربية تجريبية");
    fixture.service.publish(change.changeSet.id, change.changeSet.revision, fixture.owner);
    assert.equal(fixture.questions.getPackage(created.packageId)!.title, "الحزمة العربية المنقحة");
    assert.equal(fixture.questions.listTaxonomy(created.packageId).find((node) => node.id === created.taxonomyRootId)!.label, "القواعد المنقحة");
    assert.equal(fixture.questions.listBrowseNodes(created.packageId).find((node) => node.id === created.browseRootId)!.label, "التصفح المنقح");
    assert.throws(() => fixture.service.createChangeSet({ title: "Immutable package identity", initialItem: { resourceType: "question.package", resourceId: created.packageId, expectedRevision: 2, operation: "UPDATE", desired: packageContent({ packageKey: "changed-key", title: "الحزمة العربية المنقحة", bankBrowseEntryLabel: "البنك المنقح" }) } }, fixture.admin));
  } finally { fixture.close(); }
});

test("question aggregate UPDATE preserves identity, provenance and revision until publication", () => {
  const fixture = createFixture();
  try {
    const created = publishCreateAggregate(fixture);
    const before = fixture.questions.getQuestion(created.questionId)!;
    const existingVariant = before.variants[0];
    const existingOccurrence = existingVariant.occurrences[0];
    const secondVariantId = uuidv7();
    const desired = questionContent(created.packageId, created.taxonomyChildId, {
      displayOrder: 1,
      primaryVariantId: existingVariant.id,
      variants: [
        {
          id: existingVariant.id,
          displayOrder: 1,
          content: paragraph("ما علامة رفع الفاعل في الجملة؟"),
          occurrences: [{
            id: existingOccurrence.id,
            displayOrder: existingOccurrence.displayOrder,
            sourceKind: existingOccurrence.sourceKind,
            year: existingOccurrence.year,
            roundCode: existingOccurrence.roundCode,
            session: existingOccurrence.session,
            sourceName: existingOccurrence.sourceName,
            notes: existingOccurrence.notes,
            rawLabel: "وزاري 2024 الدور الأول — محدّث",
            branches: ["علمي", "أدبي"],
            qualifiers: ["داخل القطر", "نازحين"],
          }],
        },
        { id: secondVariantId, displayOrder: 2, content: paragraph("عيّن علامة رفع الفاعل."), occurrences: [] },
      ],
      sharedAnswer: paragraph("يرفع الفاعل بالضمة أو ما ينوب عنها."),
    });
    let change = fixture.service.createChangeSet({ title: "تحديث السؤال", initialItem: { resourceType: "question.item", resourceId: created.questionId, expectedRevision: before.revision, operation: "UPDATE", desired } }, fixture.admin);
    change = fixture.service.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
    change = fixture.service.approve(change.changeSet.id, change.changeSet.revision, fixture.owner);
    assert.equal(fixture.questions.getQuestion(created.questionId)!.revision, 1, "approval mutated the aggregate");
    fixture.service.publish(change.changeSet.id, change.changeSet.revision, fixture.owner);
    const after = fixture.questions.getQuestion(created.questionId)!;
    assert.equal(after.id, created.questionId);
    assert.equal(after.revision, 2);
    assert.equal(after.updatedBy, fixture.owner.actorUserId);
    assert.equal(after.variants.length, 2);
    assert.equal(after.variants[0].id, existingVariant.id);
    assert.equal(after.variants[0].revision, 2);
    assert.deepEqual(after.variants[0].occurrences[0].branches, ["علمي", "أدبي"]);
    assert.equal(after.variants[0].occurrences[0].revision, 2);
    assert.equal(after.sharedAnswer?.blocks[0]?.type, "paragraph");
  } finally { fixture.close(); }
});

test("question UPDATE rejects implicit Variant or Occurrence deletion", () => {
  const fixture = createFixture();
  try {
    const created = publishCreateAggregate(fixture);
    const before = fixture.questions.getQuestion(created.questionId)!;
    const withoutOccurrence: QuestionItemContent = {
      packageId: before.packageId,
      displayOrder: before.displayOrder,
      primaryVariantId: before.primaryVariantId,
      taxonomyAssignments: before.taxonomyAssignments.map(({ taxonomyNodeId, role, position }) => ({ taxonomyNodeId, role, position })),
      variants: before.variants.map((variant) => ({ id: variant.id, displayOrder: variant.displayOrder, content: variant.content, occurrences: [] })),
      sharedAnswer: before.sharedAnswer,
    };
    assert.throws(() => fixture.service.createChangeSet({ title: "Unsafe omission", initialItem: { resourceType: "question.item", resourceId: created.questionId, expectedRevision: before.revision, operation: "UPDATE", desired: withoutOccurrence } }, fixture.admin), (error) => error instanceof ChangeManagementError && error.code === "CHANGE_VALIDATION_FAILED");
    assert.equal(fixture.questions.getQuestion(created.questionId)!.variants[0].occurrences.length, 1);
  } finally { fixture.close(); }
});

test("concurrent question aggregate proposals use conservative conflict detection", () => {
  const fixture = createFixture();
  try {
    const created = publishCreateAggregate(fixture);
    const base = fixture.questions.getQuestion(created.questionId)!;
    const toContent = (text: string): QuestionItemContent => ({
      packageId: base.packageId,
      displayOrder: base.displayOrder,
      primaryVariantId: base.primaryVariantId,
      taxonomyAssignments: base.taxonomyAssignments.map(({ taxonomyNodeId, role, position }) => ({ taxonomyNodeId, role, position })),
      variants: base.variants.map((variant) => ({ id: variant.id, displayOrder: variant.displayOrder, content: paragraph(text), occurrences: variant.occurrences.map(({ id, displayOrder, sourceKind, year, roundCode, session, sourceName, notes, rawLabel, branches, qualifiers }) => ({ id, displayOrder, sourceKind, year, roundCode, session, sourceName, notes, rawLabel, branches, qualifiers })) })),
      sharedAnswer: base.sharedAnswer,
    });
    let first = fixture.service.createChangeSet({ title: "First question edit", initialItem: { resourceType: "question.item", resourceId: created.questionId, expectedRevision: 1, desired: toContent("التعديل الأول") } }, fixture.admin);
    let second = fixture.service.createChangeSet({ title: "Second question edit", initialItem: { resourceType: "question.item", resourceId: created.questionId, expectedRevision: 1, desired: toContent("التعديل الثاني") } }, fixture.admin);
    first = fixture.service.submit(first.changeSet.id, first.changeSet.revision, fixture.admin);
    second = fixture.service.submit(second.changeSet.id, second.changeSet.revision, fixture.admin);
    first = fixture.service.approve(first.changeSet.id, first.changeSet.revision, fixture.owner);
    second = fixture.service.approve(second.changeSet.id, second.changeSet.revision, fixture.owner);
    fixture.service.publish(first.changeSet.id, first.changeSet.revision, fixture.owner);
    assert.throws(() => fixture.service.publish(second.changeSet.id, second.changeSet.revision, fixture.owner), (error) => error instanceof ChangeManagementError && error.code === "CHANGE_CONFLICT");
    const conflicted = fixture.service.getDetails(second.changeSet.id, fixture.owner);
    assert.equal(conflicted.changeSet.status, "CONFLICTED");
    assert.equal(conflicted.items[0].conflictState, "BLOCKING");
  } finally { fixture.close(); }
});

test("a later adapter failure rolls back Question publication and global revision", () => {
  const failingAdapter: ChangeResourceAdapter = {
    resourceType: "test.fail-after-question",
    areaLabel: "Test",
    loadCurrent() { throw new ChangeManagementError("CHANGE_NOT_FOUND", "Synthetic resource is not published."); },
    captureProposal(_database, resourceId) { return { current: { resourceId, revision: 0, snapshot: {} }, proposedSnapshot: { value: "fail" }, changedPaths: ["value"] }; },
    validateSnapshot() {},
    describe() { return { resourceLabel: "Failure", resourceSubtitle: "Test", changeSummary: "Test", areaLabel: "Test", fieldDiffs: [] }; },
    apply() { throw new Error("simulated failure after Question write"); },
  };
  const registry = new ChangeResourceAdapterRegistry([...createQuestionChangeAdapters(), failingAdapter], [new QuestionChangeSetCoordinator()]);
  const fixture = createFixture(registry);
  try {
    const packageId = uuidv7();
    let change = fixture.service.createChangeSet({ title: "Atomic question publication", initialItems: [
      { resourceType: "question.package", resourceId: packageId, expectedRevision: 0, operation: "CREATE", desired: packageContent() },
      { resourceType: failingAdapter.resourceType, resourceId: uuidv7(), expectedRevision: 0, operation: "CREATE", desired: { value: "fail" } },
    ] }, fixture.admin);
    change = fixture.service.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
    change = fixture.service.approve(change.changeSet.id, change.changeSet.revision, fixture.owner);
    assert.throws(() => fixture.service.publish(change.changeSet.id, change.changeSet.revision, fixture.owner), (error) => error instanceof ChangeManagementError && error.code === "CHANGE_PUBLICATION_FAILED");
    assert.equal(fixture.questions.getPackage(packageId), null);
    assert.equal(fixture.publications.getCurrentRevision(), 0);
    assert.equal(fixture.service.getDetails(change.changeSet.id, fixture.owner).changeSet.status, "APPROVED");
  } finally { fixture.close(); }
});

test("representative question snapshots fit the existing bounded snapshot contract", () => {
  const packageId = uuidv7();
  const snapshot = questionContent(packageId, uuidv7());
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot), "utf8") < 64 * 1024);
  assert.equal(JSON.stringify(snapshot).includes("passwordHash"), false);
  assert.equal(JSON.stringify(snapshot).includes("tokenHash"), false);
});

test("Question review renders readable RichDocument before/after without unsafe HTML", () => {
  const packageId = uuidv7();
  const taxonomyId = uuidv7();
  const before = questionContent(packageId, taxonomyId);
  const after: QuestionItemContent = {
    ...before,
    variants: before.variants.map((variant) => ({ ...variant, content: paragraph("الصياغة العربية المقترحة") })),
    sharedAnswer: paragraph("الجواب العربي المقترح"),
  };
  const item: ChangeDetails["items"][number] = {
    id: uuidv7(),
    revision: 1,
    resourceId: uuidv7(),
    resourceType: "question.item",
    conflictState: "NONE",
    conflictDetails: null,
    beforeSnapshot: before as unknown as Record<string, unknown>,
    proposedSnapshot: after as unknown as Record<string, unknown>,
    currentSnapshot: before as unknown as Record<string, unknown>,
    currentResourceRevision: 1,
    presentation: { resourceLabel: "سؤال #1", resourceSubtitle: "صيغة واحدة · ورود واحد", changeSummary: "تعديل تعليمي", areaLabel: "بنك الأسئلة", fieldDiffs: [] },
  };
  const markup = renderToStaticMarkup(createElement(QuestionReviewItem, { item }));
  assert.match(markup, /سؤال #1/u);
  assert.match(markup, /الصياغة العربية المقترحة/u);
  assert.match(markup, /الجواب العربي المقترح/u);
  assert.match(markup, /data-rich-document="public-v1"/u);
  assert.equal(markup.includes("{&quot;type&quot;:&quot;doc&quot;"), false, "raw JSON dominated the Question review");
  const source = readFileSync(path.join(process.cwd(), "src/components/admin/review/QuestionReviewItem.tsx"), "utf8");
  assert.equal(source.includes("dangerouslySetInnerHTML"), false);
});
