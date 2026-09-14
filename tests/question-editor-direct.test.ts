import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth";
import { createCanonicalContentRepository } from "../src/server/canonical-content";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import { createDirectQuestionEditorService } from "../src/server/question-editor";
import { QuestionSearchService } from "../src/server/question-search";
import { SQLiteQuestionRepository, type CanonicalRichDocument, type QuestionItemContent } from "../src/server/questions";

const migrationsDirectory = path.join(process.cwd(), "drizzle");

function paragraph(text: string, id = uuidv7()): CanonicalRichDocument {
  return { type: "doc", version: 1, blocks: [{ id, type: "paragraph", spans: [{ text }] }] };
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-direct-question-editor-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  createCanonicalContentRepository(database).bootstrap();
  const owner = new SQLiteAdminIdentityRepository(database).createInitialOwner({
    id: uuidv7(),
    email: "direct-editor@example.test",
    displayName: "Direct Editor",
    passwordHash: "$argon2id$direct-editor-test-only",
    createdAt: 1,
  });
  const actor: AdminActor = { actorUserId: owner.id, actorRole: "OWNER" };
  return {
    root,
    database,
    actor,
    repository: new SQLiteQuestionRepository(database, () => 10),
    service: createDirectQuestionEditorService(database),
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
    },
  };
}

function seedPackage(database: ContentDatabase, actor: AdminActor) {
  const repository = new SQLiteQuestionRepository(database, () => 10);
  const packageId = uuidv7();
  const taxonomyId = uuidv7();
  repository.createPackage({
    id: packageId,
    actor,
    content: {
      packageKey: `direct-${packageId}`,
      title: "حزمة المحرر المباشر",
      subjectKey: "arabic",
      language: "ar-IQ",
      contentRevision: 1,
      bankBrowseMode: "ALL_PACKAGE_QUESTIONS",
      bankBrowseEntryKey: `entry-${packageId}`,
      bankBrowseEntryLabel: "أسئلة الحزمة",
      bankBrowseEntryOrder: 1,
      sourceAssetId: null,
      assetBindings: [],
    },
  });
  repository.createTaxonomyNode({
    id: taxonomyId,
    actor,
    content: { packageId, nodeKey: "topic", label: "موضوع", kind: "topic", parentId: null, displayOrder: 1 },
  });
  return { packageId, taxonomyId };
}

function questionContent(
  packageId: string,
  variantId: string,
  blockId: string,
  taxonomyId: string,
  text: string,
  occurrenceId?: string,
): QuestionItemContent {
  return {
    packageId,
    displayOrder: 1,
    primaryVariantId: variantId,
    taxonomyAssignments: [{ taxonomyNodeId: taxonomyId, role: "PRIMARY", position: 0 }],
    variants: [{
      id: variantId,
      displayOrder: 1,
      content: paragraph(text, blockId),
      occurrences: occurrenceId ? [{ id: occurrenceId, displayOrder: 1, sourceKind: "ministerial", year: 2024, roundCode: null, session: null, sourceName: null, notes: null, rawLabel: "وزاري 2024", branches: [], qualifiers: [] }] : [],
    }],
    sharedAnswer: null,
  };
}

test("direct package workspace, search, save, deletion intents, and package revisions are canonical", async () => {
  const f = fixture();
  try {
    const { packageId, taxonomyId } = seedPackage(f.database, f.actor);
    const prepared = f.service.prepareNewQuestion(packageId, f.actor);
    const occurrenceId = uuidv7();
    const created = f.service.createQuestion(
      packageId,
      prepared.questionId,
      questionContent(packageId, prepared.variantId, prepared.blockId, taxonomyId, "سؤال عربي أصلي", occurrenceId),
      f.actor,
    );
    assert.equal(created.id, prepared.questionId);
    assert.equal(created.revision, 1);

    const workspace = await f.service.getPackageWorkspace(packageId, f.actor);
    assert.equal(workspace.counts.questionCount, 1);
    assert.equal(workspace.counts.variantCount, 1);
    assert.equal(workspace.counts.occurrenceCount, 1);
    assert.equal(workspace.taxonomy[0]?.questionCount, 1);
    assert.equal(workspace.package.placements.length, 0);

    const search = new QuestionSearchService(f.database);
    const searchResult = search.searchPlacement({ packageId, targetMode: "ALL_PACKAGE_QUESTIONS", taxonomyNodeIds: [] }, "سؤال");
    assert.equal(searchResult.total, 1);
    assert.equal(searchResult.items[0]?.questionId, prepared.questionId);
    assert.equal(search.searchPlacement({ packageId, targetMode: "ALL_PACKAGE_QUESTIONS", taxonomyNodeIds: [] }, "سؤال", 0, 25, { sourceKinds: ["ministerial"], year: 2024 }).total, 1);

    const listed = f.service.listQuestions(packageId, f.actor, { limit: 50, taxonomyNodeId: taxonomyId });
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0]?.primaryPreview, "سؤال عربي أصلي");
    assert.equal(f.service.listQuestions(packageId, f.actor, { sourceKind: "ministerial", year: 2024, hasAnswer: false, variantCount: "ONE", occurrenceState: "HAS" }).total, 1);
    assert.equal(f.service.listQuestions(packageId, f.actor, { occurrenceState: "NONE" }).total, 0);

    const next = structuredClone(created.content);
    const blockId = next.variants[0]!.content.blocks[0]!.id;
    next.variants[0]!.content = paragraph("سؤال عربي محدث", blockId);
    const updated = f.service.updateQuestion(packageId, prepared.questionId, next, created.revision, {}, f.actor);
    assert.equal(updated.revision, 2);
    assert.equal(updated.content.variants[0]?.content.blocks[0]?.id, blockId);
    assert.equal(f.repository.getPackage(packageId)?.contentRevision, 3);
    assert.equal(search.searchPlacement({ packageId, targetMode: "ALL_PACKAGE_QUESTIONS", taxonomyNodeIds: [] }, "أصلي").total, 0);
    assert.equal(search.searchPlacement({ packageId, targetMode: "ALL_PACKAGE_QUESTIONS", taxonomyNodeIds: [] }, "محدث").total, 1);

    assert.throws(
      () => f.service.updateQuestion(packageId, prepared.questionId, next, created.revision, {}, f.actor),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "QUESTION_EDITOR_CONFLICT",
    );

    const withoutOccurrence = structuredClone(updated.content);
    withoutOccurrence.variants[0]!.occurrences = [];
    const occurrenceDeleted = f.service.updateQuestion(packageId, prepared.questionId, withoutOccurrence, updated.revision, { occurrenceIds: [occurrenceId] }, f.actor);
    assert.equal(occurrenceDeleted.content.variants[0]?.occurrences.length, 0);

    const secondVariantId = uuidv7();
    const secondBlockId = uuidv7();
    const withVariant = structuredClone(occurrenceDeleted.content);
    withVariant.variants.push({ id: secondVariantId, displayOrder: 2, content: paragraph("صيغة بديلة", secondBlockId), occurrences: [] });
    const variantAdded = f.service.updateQuestion(packageId, prepared.questionId, withVariant, occurrenceDeleted.revision, {}, f.actor);
    assert.equal(variantAdded.content.variants.length, 2);
    const withoutSecondVariant = structuredClone(variantAdded.content);
    withoutSecondVariant.variants = withoutSecondVariant.variants.filter((variant) => variant.id !== secondVariantId);
    const variantDeleted = f.service.updateQuestion(packageId, prepared.questionId, withoutSecondVariant, variantAdded.revision, { variantIds: [secondVariantId] }, f.actor);
    assert.equal(variantDeleted.content.variants.length, 1);

    const packageBeforeTitle = f.repository.getPackage(packageId)!;
    const titled = await f.service.updatePackageTitle(packageId, "عنوان محدث", packageBeforeTitle.revision, f.actor);
    assert.equal(titled.package.title, "عنوان محدث");
    assert.equal(titled.package.contentRevision, 6);
    const changeSets = Number((f.database.client.prepare("select count(*) count from change_sets").get() as { count: number }).count);
    assert.equal(changeSets, 0);
  } finally {
    f.close();
  }
});

test("direct new-question preparation starts with one stable editable paragraph and no fake taxonomy", () => {
  const f = fixture();
  try {
    const { packageId } = seedPackage(f.database, f.actor);
    const prepared = f.service.prepareNewQuestion(packageId, f.actor);
    assert.match(prepared.questionId, /^[0-9a-f-]{36}$/u);
    assert.match(prepared.variantId, /^[0-9a-f-]{36}$/u);
    assert.equal(prepared.content.variants.length, 1);
    assert.equal(prepared.content.variants[0]?.content.blocks[0]?.type, "paragraph");
    assert.deepEqual(prepared.content.taxonomyAssignments, []);
    assert.equal(prepared.content.sharedAnswer, null);
  } finally {
    f.close();
  }
});

test("direct question preparation supplies bounded server-owned IDs and new image blocks require ALT text", () => {
  const f = fixture();
  try {
    const { packageId } = seedPackage(f.database, f.actor);
    const preparedIds = f.service.prepareIds({ blocks: 2, verses: 2, occurrences: 2, variants: 2 });
    assert.equal(preparedIds.blockIds.length, 2);
    assert.equal(preparedIds.verseIds.length, 2);
    assert.equal(preparedIds.occurrenceIds.length, 2);
    assert.equal(preparedIds.variantIds.length, 2);
    assert.notEqual(preparedIds.variantIds[0], preparedIds.variantIds[1]);

    const prepared = f.service.prepareNewQuestion(packageId, f.actor);
    const invalidImageContent = questionContent(packageId, prepared.variantId, prepared.blockId, uuidv7(), "سؤال بصري");
    invalidImageContent.variants[0]!.content = {
      type: "doc",
      version: 1,
      blocks: [{ id: prepared.blockId, type: "image", assetId: uuidv7(), alt: "" }],
    };
    assert.throws(
      () => f.service.createQuestion(packageId, prepared.questionId, invalidImageContent, f.actor),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "QUESTION_EDITOR_INVALID",
    );
  } finally {
    f.close();
  }
});
