import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";
import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { createCanonicalContentRepository } from "../src/server/canonical-content";
import { createChangeManagementService } from "../src/server/change-management";
import { openContentDatabase } from "../src/server/content";
import { createQuestionEditorService, canonicalToEditorState, editorStateToCanonical } from "../src/server/question-editor";
import { createQuestionPackageImportService } from "../src/server/question-import";
import type { CanonicalRichDocument, QuestionItemContent } from "../src/server/questions";
import { SQLiteQuestionRepository } from "../src/server/questions";

const migrationsDirectory = path.join(process.cwd(), "drizzle");

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m13-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  createCanonicalContentRepository(database).bootstrap();
  const identities = new SQLiteAdminIdentityRepository(database);
  const owner = identities.createInitialOwner({ id: uuidv7(), email: "owner@m13.test", displayName: "M13 Owner", passwordHash: "$argon2id$test", createdAt: 1 });
  const admin = identities.createAdmin({ id: uuidv7(), email: "admin@m13.test", displayName: "M13 Admin", passwordHash: "$argon2id$test", createdAt: 2 });
  const second = identities.createAdmin({ id: uuidv7(), email: "second@m13.test", displayName: "Second Admin", passwordHash: "$argon2id$test", createdAt: 3 });
  return { root, database, owner: actor(owner.id, "OWNER"), admin: actor(admin.id, "ADMIN"), second: actor(second.id, "ADMIN"), editor: createQuestionEditorService(database), imports: createQuestionPackageImportService(database), changes: createChangeManagementService(database), questions: new SQLiteQuestionRepository(database), close() { database.close(); rmSync(root, { recursive: true, force: true }); } };
}
function actor(actorUserId: string, actorRole: "OWNER" | "ADMIN"): AdminActor { return { actorUserId, actorRole }; }
function paragraph(text: string): CanonicalRichDocument { return { type: "doc", version: 1, blocks: [{ id: uuidv7(), type: "paragraph", spans: [{ text }] }] }; }
function question(packageId: string, taxonomyNodeId: string, displayOrder = 1): QuestionItemContent { const variantId = uuidv7(); return { packageId, displayOrder, primaryVariantId: variantId, taxonomyAssignments: [{ taxonomyNodeId, role: "PRIMARY", position: 0 }], variants: [{ id: variantId, displayOrder: 1, content: paragraph("ما علامة رفع الفاعل؟"), occurrences: [{ id: uuidv7(), displayOrder: 1, sourceKind: "ministerial", year: 2024, roundCode: "د1", session: null, sourceName: null, notes: null, rawLabel: "وزاري 2024 د1", branches: ["علمي"], qualifiers: ["داخل القطر"] }] }], sharedAnswer: paragraph("الضمة") }; }

test("unpublished empty Package continues in one Draft and publishes a complete graph only after OWNER", () => {
  const f = fixture();
  try {
    const staged = f.imports.createEmptyPackage({ title: "حزمة M13", packageKey: "arabic-m13", subjectKey: "arabic", language: "ar-IQ", bankBrowseMode: "TREE", bankBrowseEntryKey: "arabic-m13", bankBrowseEntryLabel: "حزمة M13", bankBrowseEntryOrder: 51 }, f.admin);
    const taxonomyId = uuidv7(); const browseId = uuidv7(); const questionId = uuidv7();
    const firstDraft = f.editor.getPackage(staged.packageId, f.admin).activeDraft!;
    f.editor.save(staged.packageId, { resourceType: "question.taxonomy", resourceId: taxonomyId, desired: { packageId: staged.packageId, nodeKey: "grammar", label: "القواعد", kind: "unit", parentId: null, displayOrder: 1 } }, f.admin);
    f.editor.save(staged.packageId, { resourceType: "question.browse", resourceId: browseId, desired: { packageId: staged.packageId, nodeKey: "grammar-list", label: "القواعد", nodeType: "QUESTION_LIST", parentId: null, displayOrder: 1, taxonomyNodeId: taxonomyId, includeDescendants: true } }, f.admin);
    f.editor.save(staged.packageId, { resourceType: "question.item", resourceId: questionId, desired: question(staged.packageId, taxonomyId) }, f.admin);
    const workspace = f.editor.getPackage(staged.packageId, f.admin);
    assert.equal(workspace.activeDraft?.id, firstDraft.id);
    assert.deepEqual(workspace.counts, { questionCount: 1, variantCount: 1, occurrenceCount: 1, taxonomyCount: 1, browseCount: 1 });
    assert.equal(f.questions.getPackage(staged.packageId), null);
    assert.equal(f.editor.listQuestions(staged.packageId, f.admin).items[0].primaryPreview, "ما علامة رفع الفاعل؟");
    const detail = f.editor.getQuestion(staged.packageId, questionId, f.admin);
    assert.equal(detail.draftOnly, true); assert.equal(detail.content.sharedAnswer?.blocks.length, 1);
    let change = f.editor.submit(staged.packageId, workspace.activeDraft!.revision, f.admin);
    change = f.changes.approve(change.id, change.revision, f.owner).changeSet;
    assert.equal(f.questions.getPackage(staged.packageId), null);
    f.changes.publish(change.id, change.revision, f.owner);
    assert.equal(f.questions.getPackageAggregate(staged.packageId)?.questions.length, 1);
  } finally { f.close(); }
});

test("published question overlay is bounded, reuses the author's Draft, and leaves canonical unchanged", () => {
  const f = fixture();
  try {
    const staged = f.imports.createEmptyPackage({ title: "منشورة M13", packageKey: "published-m13", subjectKey: "arabic", language: "ar-IQ", bankBrowseMode: "ALL_PACKAGE_QUESTIONS", bankBrowseEntryKey: "published-m13", bankBrowseEntryLabel: "منشورة M13", bankBrowseEntryOrder: 52 }, f.owner);
    const taxonomyId = uuidv7(); const questionId = uuidv7();
    f.editor.save(staged.packageId, { resourceType: "question.taxonomy", resourceId: taxonomyId, desired: { packageId: staged.packageId, nodeKey: "root", label: "الجذر", kind: "unit", parentId: null, displayOrder: 1 } }, f.owner);
    f.editor.save(staged.packageId, { resourceType: "question.item", resourceId: questionId, desired: question(staged.packageId, taxonomyId) }, f.owner);
    let state = f.editor.getPackage(staged.packageId, f.owner).activeDraft!;
    let change = f.editor.submit(staged.packageId, state.revision, f.owner); change = f.changes.approve(change.id, change.revision, f.owner).changeSet; f.changes.publish(change.id, change.revision, f.owner);
    const canonicalBefore = f.questions.getQuestion(questionId)!;
    const desired = questionContent(canonicalBefore); desired.variants[0].content = paragraph("صياغة غير منشورة <script>alert(1)</script>");
    const draft = f.editor.save(staged.packageId, { resourceType: "question.item", resourceId: questionId, desired }, f.admin);
    const repeated = f.editor.save(staged.packageId, { resourceType: "question.package", resourceId: staged.packageId, desired: { ...packageContent(f.questions.getPackage(staged.packageId)!), title: "عنوان مسودة" } }, f.admin);
    assert.equal(repeated.id, draft.id);
    assert.equal(f.questions.getQuestion(questionId)!.variants[0].content.blocks[0].type, "paragraph");
    assert.equal((f.questions.getQuestion(questionId)!.variants[0].content.blocks[0] as { spans: Array<{ text: string }> }).spans[0].text, "ما علامة رفع الفاعل؟");
    const list = f.editor.listQuestions(staged.packageId, f.admin, 0, 50);
    assert.equal(list.limit, 50); assert.equal(list.items.length, 1); assert.equal("content" in list.items[0], false); assert.match(list.items[0].primaryPreview, /script/u);
    const secondDraft = f.editor.save(staged.packageId, { resourceType: "question.package", resourceId: staged.packageId, desired: { ...packageContent(f.questions.getPackage(staged.packageId)!), title: "مسودة مشرف آخر" } }, f.second);
    assert.notEqual(secondDraft.id, draft.id);
    assert.equal(f.editor.getPackage(staged.packageId, f.admin).activeDraft?.id, draft.id);
  } finally { f.close(); }
});

test("RichDocument adapter is lossless and keeps Arabic, marks, identities, and inert HTML text", () => {
  const document = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/question-packages/e-rich-content-valid.json"), "utf8")) as { questions: Array<{ variants: Array<{ content: CanonicalRichDocument }> }> };
  const canonical = document.questions[0].variants[0].content;
  canonical.blocks.unshift({ id: uuidv7(), type: "paragraph", spans: [{ text: "نَصّ عربي English 2026 <iframe onload=alert(1)>", marks: ["bold", "italic", "underline"] }] });
  const roundTrip = editorStateToCanonical(canonicalToEditorState(canonical));
  assert.deepEqual(roundTrip, canonical);
  assert.match(JSON.stringify(roundTrip), /iframe/u);
  assert.equal(JSON.stringify(roundTrip).includes("dangerouslySetInnerHTML"), false);
});

function questionContent(value: NonNullable<ReturnType<SQLiteQuestionRepository["getQuestion"]>>): QuestionItemContent { return { packageId: value.packageId, displayOrder: value.displayOrder, primaryVariantId: value.primaryVariantId, taxonomyAssignments: value.taxonomyAssignments.map(({ taxonomyNodeId, role, position }) => ({ taxonomyNodeId, role, position })), variants: value.variants.map((variant) => ({ id: variant.id, displayOrder: variant.displayOrder, content: variant.content, occurrences: variant.occurrences.map(({ id, displayOrder, sourceKind, year, roundCode, session, sourceName, notes, rawLabel, branches, qualifiers }) => ({ id, displayOrder, sourceKind, year, roundCode, session, sourceName, notes, rawLabel, branches, qualifiers })) })), sharedAnswer: value.sharedAnswer }; }
function packageContent(value: NonNullable<ReturnType<SQLiteQuestionRepository["getPackage"]>>) { return { packageKey: value.packageKey, title: value.title, subjectKey: value.subjectKey, language: value.language, contentRevision: value.contentRevision, bankBrowseMode: value.bankBrowseMode, bankBrowseEntryKey: value.bankBrowseEntryKey, bankBrowseEntryLabel: value.bankBrowseEntryLabel, bankBrowseEntryOrder: value.bankBrowseEntryOrder, sourceAssetId: value.sourceAssetId, assetBindings: [] }; }
