import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";
import type { AdminActor } from "../src/server/admin-auth/contracts";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { createCanonicalContentRepository } from "../src/server/canonical-content/service";
import { createChangeManagementService } from "../src/server/change-management";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import {
  aiKnowledgeDocuments,
  aiKnowledgePackages,
  aiKnowledgeSourceRevisions,
  aiRetrievalChunks,
  questionOccurrences,
  questionPackages,
  questionPrimaryVariants,
  questionVariants,
  questions,
} from "../src/server/content/schema";
import type { CanonicalRichDocument, QuestionItemContent } from "../src/server/questions/contracts";
import { SQLiteQuestionRepository } from "../src/server/questions/sqlite-question-repository";
import {
  AIKnowledgeDomainService,
  SQLiteAIKnowledgePackageRepository,
  SQLiteAIKnowledgeSourceRepository,
  type AIKnowledgePackageDocument,
  type AIKnowledgePackageV1,
  type AIKnowledgeSourceContent,
} from "../src/server/ai/knowledge";
import {
  AIChunkProjectionBuilder,
  AIRetrievalError,
  AIRetrievalProjectionHealthService,
  AI_RETRIEVAL_MAX_CHUNK_BYTES,
  AI_RETRIEVAL_MAX_QUERY_LIMIT,
  AI_RETRIEVAL_STRATEGY_KEY,
  AI_RETRIEVAL_STRATEGY_REVISION,
  SQLiteAILexicalRetrievalAdapter,
  SQLiteAIRetrievalProjectionRepository,
  StructuredRichDocumentChunkingStrategy,
  type AIRetrievalChunk,
  type AIChunkSourceItem,
} from "../src/server/ai/retrieval";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const ownerId = "01900000-0000-7000-8000-000000000101";
const adminId = "01900000-0000-7000-8000-000000000102";
const owner: AdminActor = { actorUserId: ownerId, actorRole: "OWNER" };
const admin: AdminActor = { actorUserId: adminId, actorRole: "ADMIN" };

interface RetrievalFixture {
  root: string;
  database: ContentDatabase;
  sourceRepository: SQLiteAIKnowledgeSourceRepository;
  packageRepository: SQLiteAIKnowledgePackageRepository;
  changes: ReturnType<typeof createChangeManagementService>;
  knowledge: AIKnowledgeDomainService;
  close(): void;
}

function fixture(): RetrievalFixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m7a-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  createCanonicalContentRepository(database).bootstrap();
  const identities = new SQLiteAdminIdentityRepository(database);
  identities.createInitialOwner({ id: ownerId, email: `owner-${uuidv7()}@m7a.test`, displayName: "M7A Owner", passwordHash: "fixture", createdAt: 1_900_000_000_000 });
  identities.createAdmin({ id: adminId, email: `admin-${uuidv7()}@m7a.test`, displayName: "M7A Admin", passwordHash: "fixture", createdAt: 1_900_000_000_001 });
  return {
    root,
    database,
    sourceRepository: new SQLiteAIKnowledgeSourceRepository(database),
    packageRepository: new SQLiteAIKnowledgePackageRepository(database),
    changes: createChangeManagementService(database),
    knowledge: new AIKnowledgeDomainService(database),
    close() { database.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

function publish(fixtureValue: RetrievalFixture, details: ReturnType<RetrievalFixture["changes"]["createChangeSet"]>) {
  const submitted = details.changeSet.status === "SUBMITTED" ? details : fixtureValue.changes.submit(details.changeSet.id, details.changeSet.revision, admin);
  const approved = fixtureValue.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, owner);
  return fixtureValue.changes.publish(approved.changeSet.id, approved.changeSet.revision, owner);
}

function sourceContent(overrides: Partial<AIKnowledgeSourceContent> = {}): AIKnowledgeSourceContent {
  return {
    key: "m7a.official-source",
    subjectKey: "arabic",
    sourceType: "OFFICIAL_TEXTBOOK",
    displayName: "M7A Source",
    language: "ar",
    edition: "fixture",
    authorityName: "Pythagoras",
    authorityType: "TEST",
    trustTier: "OFFICIAL",
    rightsStatus: "CLEARED",
    rightsBasis: "OWNED",
    licenseName: null,
    attribution: "Synthetic fixture",
    rightsNotes: null,
    sourceUrl: "https://example.test/m7a-source",
    sourceAssetId: null,
    enabled: true,
    preparationMethod: "DETERMINISTIC",
    producerKey: "m7a-fixture",
    producerRevision: "1",
    ...overrides,
  };
}

function canonicalParagraph(text: string): CanonicalRichDocument {
  return { type: "doc", version: 1, blocks: [{ id: uuidv7(), type: "paragraph", spans: [{ text }] }] };
}

function firstInlineText(document: CanonicalRichDocument): string {
  const block = document.blocks.find((candidate): candidate is Extract<CanonicalRichDocument["blocks"][number], { spans: unknown }> => "spans" in candidate);
  return block?.spans.map((span) => span.text).join("") ?? "";
}

function createSource(fixtureValue: RetrievalFixture, overrides: Partial<AIKnowledgeSourceContent> = {}) {
  const id = uuidv7();
  fixtureValue.sourceRepository.create({ id, content: sourceContent(overrides), actor: owner, now: 1_900_000_000_100 });
  return id;
}

function knowledgeDocument(text: string, order: number, title = `Document ${order}`): AIKnowledgePackageDocument {
  return { packageRevisionId: "pending", documentId: uuidv7(), displayOrder: order, title, provenance: { pageStart: order, pageEnd: order + 1, section: `Section ${order}` }, content: canonicalParagraph(text) };
}

function createKnowledgePackage(fixtureValue: RetrievalFixture, texts: string[], subjectKey = "arabic") {
  const sourceId = createSource(fixtureValue, { key: `m7a.${subjectKey}.${uuidv7()}`, subjectKey });
  const packageId = uuidv7();
  const content = {
    key: `m7a.package.${subjectKey}.${uuidv7()}`,
    subjectKey,
    title: `M7A ${subjectKey} package`,
    language: "ar",
    contentRevision: 1,
    sourceId,
    sourceRevision: 1,
    artifactRef: "a".repeat(64),
    artifactSha256: "a".repeat(64),
    artifactByteSize: 1,
  } as const;
  fixtureValue.packageRepository.create({ id: packageId, content, documents: texts.map((text, index) => knowledgeDocument(text, index + 1)), assets: [], actor: owner, now: 1_900_000_000_200 });
  return { packageId, sourceId, content };
}

function questionPackage(fixtureValue: RetrievalFixture, subjectKey = "arabic") {
  const packageId = uuidv7();
  fixtureValue.database.db.insert(questionPackages).values({
    id: packageId,
    packageKey: `m7a-question-${subjectKey}-${uuidv7().slice(0, 8)}`,
    title: "M7A Question Package",
    subjectKey,
    language: "ar-IQ",
    contentRevision: 1,
    bankBrowseMode: "ALL_PACKAGE_QUESTIONS",
    bankBrowseEntryKey: `m7a-question-${uuidv7().slice(0, 8)}`,
    bankBrowseEntryLabel: "M7A Question",
    bankBrowseEntryOrder: 990,
    sourceAssetId: null,
    createdAt: 1_900_000_000_300,
    updatedAt: 1_900_000_000_300,
    updatedBy: ownerId,
    revision: 1,
  }).run();
  return packageId;
}

function insertQuestion(fixtureValue: RetrievalFixture, packageId: string, text: string, withOccurrence = true) {
  const questionId = uuidv7();
  const variantId = uuidv7();
  fixtureValue.database.db.insert(questions).values({ id: questionId, packageId, displayOrder: 1, sharedAnswer: canonicalParagraph("جواب السؤال"), createdAt: 1_900_000_000_400, updatedAt: 1_900_000_000_400, updatedBy: ownerId, revision: 1 }).run();
  fixtureValue.database.db.insert(questionVariants).values({ id: variantId, questionId, displayOrder: 1, content: canonicalParagraph(text), createdAt: 1_900_000_000_400, updatedAt: 1_900_000_000_400, updatedBy: ownerId, revision: 1 }).run();
  fixtureValue.database.db.insert(questionPrimaryVariants).values({ questionId, variantId }).run();
  let occurrenceId: string | null = null;
  if (withOccurrence) {
    occurrenceId = uuidv7();
    fixtureValue.database.db.insert(questionOccurrences).values({ id: occurrenceId, variantId, displayOrder: 1, sourceKind: "ministerial", year: 2025, roundCode: "د1", session: null, sourceName: "Synthetic ministry", notes: null, rawLabel: "وزاري synthetic", createdAt: 1_900_000_000_400, updatedAt: 1_900_000_000_400, updatedBy: ownerId, revision: 1 }).run();
  }
  return { questionId, variantId, occurrenceId };
}

function sourceItem(content: CanonicalRichDocument, overrides: Partial<AIChunkSourceItem> = {}): AIChunkSourceItem {
  return {
    subjectKey: "arabic",
    language: "ar",
    originKind: "KNOWLEDGE_PACKAGE",
    originId: uuidv7(),
    originRevision: 1,
    originContentRevision: 1,
    sourceId: uuidv7(),
    sourceRevision: 1,
    sourceType: "OFFICIAL_TEXTBOOK",
    trustTier: "OFFICIAL",
    artifactSha256: "a".repeat(64),
    sourceItemId: uuidv7(),
    sourceItemOrder: 1,
    content,
    provenance: { pageStart: 1, section: "Fixture" },
    originMetadata: {},
    questionId: null,
    questionRevision: null,
    variantId: null,
    variantRevision: null,
    ...overrides,
  };
}

function uniqueChunkId(): string {
  return uuidv7().replace(/-/gu, "").repeat(2);
}

function insertChunk(database: ContentDatabase, chunk: AIRetrievalChunk, overrides: Partial<AIRetrievalChunk> = {}): void {
  const value = { ...chunk, ...overrides };
  database.client.prepare(`
    insert into ai_retrieval_chunks (
      chunk_id, projection_revision_id, subject_key, origin_kind, origin_id,
      origin_revision, origin_content_revision, source_id, source_revision,
      source_type, trust_tier, artifact_sha256, source_item_id, source_item_order,
      question_id, question_revision, variant_id, variant_revision, chunk_ordinal,
      text, text_hash, language, provenance, origin_metadata, strategy_key,
      strategy_revision, normalizer_key, normalizer_revision, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    value.chunkId,
    value.projectionRevisionId,
    value.subjectKey,
    value.originKind,
    value.originId,
    value.originRevision,
    value.originContentRevision,
    value.sourceId,
    value.sourceRevision,
    value.sourceType,
    value.trustTier,
    value.artifactSha256,
    value.sourceItemId,
    value.sourceItemOrder,
    value.questionId,
    value.questionRevision,
    value.variantId,
    value.variantRevision,
    value.chunkOrdinal,
    value.text,
    value.textHash,
    value.language,
    value.provenance === null ? null : JSON.stringify(value.provenance),
    JSON.stringify(value.originMetadata),
    value.strategyKey,
    value.strategyRevision,
    value.normalizerKey,
    value.normalizerRevision,
    value.createdAt,
  );
}

test("structured-rich-v1 handles every RichDocument block as deterministic semantic text", () => {
  const imageAssetId = uuidv7();
  const content: CanonicalRichDocument = {
    type: "doc",
    version: 1,
    blocks: [
      { id: uuidv7(), type: "heading", level: 2, spans: [{ text: "عنوان" }] },
      { id: uuidv7(), type: "paragraph", spans: [{ text: "فقرة" }] },
      { id: uuidv7(), type: "ordered-list", items: [{ spans: [{ text: "عنصر أول" }] }, { spans: [{ text: "عنصر ثان" }] }] },
      { id: uuidv7(), type: "bullet-list", items: [{ spans: [{ text: "نقطة" }] }] },
      { id: uuidv7(), type: "quran", verses: [{ id: uuidv7(), spans: [{ text: "آية" }], surah: "البقرة", ayah: 1 }] },
      { id: uuidv7(), type: "poetry", verses: [{ id: uuidv7(), sadr: [{ text: "صدر" }], ajuz: [{ text: "عجز" }] }] },
      { id: uuidv7(), type: "table", headerRowCount: 1, rows: [{ cells: [{ spans: [{ text: "خلية" }] }] }] },
      { id: uuidv7(), type: "image", assetId: imageAssetId, alt: "وصف صورة", caption: [{ text: "تعليق" }] },
      { id: uuidv7(), type: "divider" },
    ],
  };
  const drafts = new StructuredRichDocumentChunkingStrategy().build(sourceItem(content));
  const text = drafts.map((draft) => draft.text).join("\n");
  for (const expected of ["عنوان", "فقرة", "عنصر أول", "نقطة", "آية", "صدر", "خلية", "وصف صورة", "تعليق", "—"]) assert.ok(text.includes(expected), expected);
  assert.ok(drafts.every((draft) => Buffer.byteLength(draft.text, "utf8") <= AI_RETRIEVAL_MAX_CHUNK_BYTES));
});

test("large semantic units are split at safe deterministic boundaries without truncation", () => {
  const value = "سؤال طويل ".repeat(3_000);
  const drafts = new StructuredRichDocumentChunkingStrategy().build(sourceItem(canonicalParagraph(value)));
  assert.ok(drafts.length > 1);
  assert.ok(drafts.every((draft) => Buffer.byteLength(draft.text, "utf8") <= AI_RETRIEVAL_MAX_CHUNK_BYTES));
  assert.equal(drafts.map((draft) => draft.text).join("").replace(/\s+/gu, "").length, value.replace(/\s+/gu, "").length);
});

test("Knowledge projection builds in bounded resumable batches, activates atomically, and is idempotent", () => {
  const fixtureValue = fixture();
  try {
    const knowledge = createKnowledgePackage(fixtureValue, ["المحتوى الأول", "المحتوى الثاني", "المحتوى الثالث", "المحتوى الرابع", "المحتوى الخامس"]);
    const canonicalTextBefore = firstInlineText(fixtureValue.packageRepository.getById(knowledge.packageId)!.documents[0].content);
    const builder = new AIChunkProjectionBuilder(fixtureValue.database);
    const session = builder.startBuild({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic", batchSize: 2 });
    assert.equal(session.projectionRevision.status, "BUILDING");
    const lexical = new SQLiteAILexicalRetrievalAdapter(fixtureValue.database);
    assert.deepEqual(lexical.search({ subjectKey: "arabic", query: "المحتوى الأول" }), []);
    let batch = builder.processNextBatch(session.projectionRevision.id, 2);
    assert.equal(batch.done, false);
    assert.equal(fixtureValue.packageRepository.getById(knowledge.packageId)?.documents.length, 5);
    assert.equal(firstInlineText(fixtureValue.packageRepository.getById(knowledge.packageId)!.documents[0].content), canonicalTextBefore);
    let batches = 1;
    while (!batch.done) { batch = builder.processNextBatch(session.projectionRevision.id, 2); batches += 1; }
    assert.equal(batches, 3);
    const ready = builder.finalize(session.projectionRevision.id);
    assert.equal(ready.status, "READY");
    assert.equal(ready.isCurrent, true);
    const repository = new SQLiteAIRetrievalProjectionRepository(fixtureValue.database);
    const chunks = repository.listChunks(ready.id);
    assert.equal(chunks.length, 5);
    assert.deepEqual(chunks.map((chunk) => chunk.chunkOrdinal), [1, 2, 3, 4, 5]);
    assert.equal(new Set(chunks.map((chunk) => chunk.chunkId)).size, chunks.length);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_chunks set text=? where projection_revision_id=? and chunk_id=?").run("tampered", ready.id, chunks[0].chunkId), /immutable/i);
    const second = builder.build({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic", batchSize: 2 });
    assert.equal(second.reused, true);
    assert.equal(second.projectionRevisionId, ready.id);
  } finally { fixtureValue.close(); }
});

test("a BUILDING projection is discovered and resumed after a process-style restart", () => {
  const fixtureValue = fixture();
  let originalClosed = false;
  let reopened: ContentDatabase | null = null;
  try {
    const knowledge = createKnowledgePackage(fixtureValue, ["الإصدار الأول", "الإصدار الثاني", "الإصدار الثالث"]);
    const firstBuilder = new AIChunkProjectionBuilder(fixtureValue.database);
    const first = firstBuilder.startBuild({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic", batchSize: 1 });
    const firstBatch = firstBuilder.processNextBatch(first.projectionRevision.id, 1);
    assert.equal(firstBatch.done, false);
    const repositoryBeforeRestart = new SQLiteAIRetrievalProjectionRepository(fixtureValue.database);
    const persistedBeforeRestart = repositoryBeforeRestart.getRevision(first.projectionRevision.id)!;
    assert.equal(persistedBeforeRestart.status, "BUILDING");
    assert.deepEqual(persistedBeforeRestart.sourceCursor, firstBatch.cursor);
    assert.equal(repositoryBeforeRestart.listChunks(first.projectionRevision.id).length, 1);

    fixtureValue.database.close();
    originalClosed = true;
    reopened = openContentDatabase({ dataDirectory: fixtureValue.root, migrationsDirectory });
    const restartedBuilder = new AIChunkProjectionBuilder(reopened);
    const resumed = restartedBuilder.startBuild({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic", batchSize: 1 });
    assert.equal(resumed.projectionRevision.id, first.projectionRevision.id);
    assert.equal(resumed.reused, false);
    assert.deepEqual(resumed.projectionRevision.sourceCursor, persistedBeforeRestart.sourceCursor);
    assert.equal(new SQLiteAIRetrievalProjectionRepository(reopened).listRevisions(first.projectionSet.id).length, 1);

    let batch = restartedBuilder.processNextBatch(resumed.projectionRevision.id, 1);
    while (!batch.done) batch = restartedBuilder.processNextBatch(resumed.projectionRevision.id, 1);
    const ready = restartedBuilder.finalize(resumed.projectionRevision.id);
    const repositoryAfterRestart = new SQLiteAIRetrievalProjectionRepository(reopened);
    const chunks = repositoryAfterRestart.listChunks(ready.id);
    assert.equal(ready.status, "READY");
    assert.equal(chunks.length, 3);
    assert.equal(new Set(chunks.map((chunk) => chunk.chunkId)).size, 3);
    assert.equal(chunks.map((chunk) => chunk.chunkOrdinal).join(","), "1,2,3");
  } finally {
    if (!originalClosed) fixtureValue.database.close();
    reopened?.close();
    rmSync(fixtureValue.root, { recursive: true, force: true });
  }
});

test("compatible BUILDING projection identity is unique and reused by another builder", () => {
  const fixtureValue = fixture();
  try {
    const knowledge = createKnowledgePackage(fixtureValue, ["قابل للاستئناف"]);
    const firstBuilder = new AIChunkProjectionBuilder(fixtureValue.database);
    const secondBuilder = new AIChunkProjectionBuilder(fixtureValue.database);
    const first = firstBuilder.startBuild({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic" });
    const second = secondBuilder.startBuild({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic" });
    assert.equal(second.projectionRevision.id, first.projectionRevision.id);
    const repository = new SQLiteAIRetrievalProjectionRepository(fixtureValue.database);
    assert.equal(repository.getCompatibleBuildingRevision({
      projectionSetId: first.projectionSet.id,
      inputFingerprint: first.inputFingerprint,
      strategyKey: first.projectionRevision.strategyKey,
      strategyRevision: first.projectionRevision.strategyRevision,
      normalizerKey: first.projectionRevision.normalizerKey,
      normalizerRevision: first.projectionRevision.normalizerRevision,
    })?.id, first.projectionRevision.id);
    assert.throws(() => repository.createRevision({
      projectionSetId: first.projectionSet.id,
      revision: first.projectionRevision.revision + 1,
      inputFingerprint: first.inputFingerprint,
      strategyKey: first.projectionRevision.strategyKey,
      strategyRevision: first.projectionRevision.strategyRevision,
      normalizerKey: first.projectionRevision.normalizerKey,
      normalizerRevision: first.projectionRevision.normalizerRevision,
      now: 1_900_000_001_000,
    }), /could not be created/i);
    assert.equal(repository.listRevisions(first.projectionSet.id).length, 1);
  } finally { fixtureValue.close(); }
});

test("projection Set and Revision lifecycle is protected at the SQLite boundary", () => {
  const fixtureValue = fixture();
  try {
    const knowledge = createKnowledgePackage(fixtureValue, ["الإصدار القديم"]);
    const builder = new AIChunkProjectionBuilder(fixtureValue.database);
    const initial = builder.build({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic" });
    const repository = new SQLiteAIRetrievalProjectionRepository(fixtureValue.database);
    const set = repository.getSet({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic", strategyKey: AI_RETRIEVAL_STRATEGY_KEY, normalizerKey: "retrieval-text-v1" })!;
    const readyBefore = repository.getRevision(initial.projectionRevisionId)!;

    const setMutations: Array<[string, string | number]> = [
      ["subject_key", "physics"],
      ["origin_kind", "QUESTION_PACKAGE"],
      ["origin_id", uuidv7()],
      ["strategy_key", "another-strategy"],
      ["normalizer_key", "another-normalizer"],
      ["created_at", readyBefore.startedAt + 1],
      ["updated_at", readyBefore.startedAt + 1],
    ];
    for (const [column, value] of setMutations) {
      assert.throws(() => fixtureValue.database.client.prepare(`update ai_retrieval_projection_sets set ${column}=? where id=?`).run(value, set.id), /immutable/i);
    }

    const revisionMutations: Array<[string, string | number]> = [
      ["id", uuidv7()],
      ["projection_set_id", uuidv7()],
      ["revision", readyBefore.revision + 1],
      ["input_fingerprint", "b".repeat(64)],
      ["strategy_key", "another-strategy"],
      ["strategy_revision", readyBefore.strategyRevision + 1],
      ["normalizer_key", "another-normalizer"],
      ["normalizer_revision", readyBefore.normalizerRevision + 1],
      ["started_at", readyBefore.startedAt + 1],
    ];
    for (const [column, value] of revisionMutations) {
      assert.throws(() => fixtureValue.database.client.prepare(`update ai_retrieval_projection_revisions set ${column}=? where id=?`).run(value, readyBefore.id), /immutable|lifecycle/i);
    }
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_projection_revisions set status='FAILED', is_current=0, failed_at=?, updated_at=?, safe_error_code='DIRECT_FAILURE' where id=?").run(1_900_000_001_000, 1_900_000_001_000, readyBefore.id), /lifecycle/i);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_projection_revisions set status='BUILDING', is_current=0, ready_at=null, updated_at=? where id=?").run(1_900_000_001_000, readyBefore.id), /lifecycle/i);
    assert.equal(repository.getRevision(readyBefore.id)?.status, "READY");
    assert.equal(repository.getRevision(readyBefore.id)?.isCurrent, true);

    const progressKnowledge = createKnowledgePackage(fixtureValue, ["تقدم البناء"]);
    const progress = builder.startBuild({ originKind: "KNOWLEDGE_PACKAGE", originId: progressKnowledge.packageId, subjectKey: "arabic" });
    const progressBatch = builder.processNextBatch(progress.projectionRevision.id);
    assert.equal(progressBatch.done, true);
    assert.equal(repository.getRevision(progress.projectionRevision.id)?.status, "BUILDING");
    const progressReady = builder.finalize(progress.projectionRevision.id);
    assert.equal(progressReady.status, "READY");

    const failedKnowledge = createKnowledgePackage(fixtureValue, ["فشل البناء"]);
    const failed = builder.startBuild({ originKind: "KNOWLEDGE_PACKAGE", originId: failedKnowledge.packageId, subjectKey: "arabic" });
    repository.markFailed(failed.projectionRevision.id, "AI_RETRIEVAL_PROJECTION_FAILED", 1_900_000_001_100);
    assert.equal(repository.getRevision(failed.projectionRevision.id)?.status, "FAILED");
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_projection_revisions set status='BUILDING', failed_at=null, safe_error_code=null, updated_at=? where id=?").run(1_900_000_001_200, failed.projectionRevision.id), /lifecycle/i);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_projection_revisions set status='READY', is_current=1, failed_at=null, ready_at=?, safe_error_code=null, source_cursor=? where id=?").run(1_900_000_001_200, JSON.stringify({ kind: "DONE" }), failed.projectionRevision.id), /lifecycle/i);

    const oldFields = { ...readyBefore };
    const packageBefore = fixtureValue.packageRepository.getById(knowledge.packageId)!;
    fixtureValue.packageRepository.appendRevision({
      id: knowledge.packageId,
      expectedRevision: packageBefore.package.currentRevision,
      content: { ...knowledge.content, contentRevision: 2, artifactRef: "b".repeat(64), artifactSha256: "b".repeat(64) },
      documents: [knowledgeDocument("الإصدار الجديد", 1)],
      assets: [],
      actor: owner,
      now: 1_900_000_001_300,
    });
    const activated = builder.build({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic" });
    assert.equal(activated.status, "READY");
    const demoted = repository.getRevision(readyBefore.id)!;
    assert.equal(demoted.status, "READY");
    assert.equal(demoted.isCurrent, false);
    assert.deepEqual({ ...demoted, isCurrent: oldFields.isCurrent }, oldFields);

    const activatedChunk = repository.listChunks(activated.projectionRevisionId)[0];
    assert.ok(activatedChunk);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_projection_revisions set status='FAILED', is_current=0, failed_at=?, updated_at=?, safe_error_code='DIRECT_FAILURE' where id=?").run(1_900_000_001_400, 1_900_000_001_400, activated.projectionRevisionId), /lifecycle/i);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_chunks set text=? where projection_revision_id=? and chunk_id=?").run("tampered", activatedChunk.projectionRevisionId, activatedChunk.chunkId), /immutable/i);
    assert.throws(() => fixtureValue.database.client.prepare("delete from ai_retrieval_chunks where projection_revision_id=? and chunk_id=?").run(activatedChunk.projectionRevisionId, activatedChunk.chunkId), /immutable/i);
  } finally { fixtureValue.close(); }
});

test("retrieval chunks enforce parent ownership and are immutable from insertion", () => {
  const fixtureValue = fixture();
  try {
    const knowledge = createKnowledgePackage(fixtureValue, ["ملكية المقطع"]);
    const builder = new AIChunkProjectionBuilder(fixtureValue.database);
    const session = builder.startBuild({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic" });
    const batch = builder.processNextBatch(session.projectionRevision.id);
    assert.equal(batch.done, true);
    const validChunk = new SQLiteAIRetrievalProjectionRepository(fixtureValue.database).listChunks(session.projectionRevision.id)[0];
    assert.ok(validChunk);
    const mismatches: Array<Partial<AIRetrievalChunk>> = [
      { subjectKey: "physics" },
      { originId: uuidv7() },
      { strategyKey: "another-strategy" },
      { strategyRevision: validChunk.strategyRevision + 1 },
      { normalizerKey: "another-normalizer" },
      { normalizerRevision: validChunk.normalizerRevision + 1 },
    ];
    for (const mismatch of mismatches) {
      assert.throws(() => insertChunk(fixtureValue.database, validChunk, { ...mismatch, chunkId: uniqueChunkId(), chunkOrdinal: validChunk.chunkOrdinal + 1 }), /ownership/i);
    }
    assert.throws(() => fixtureValue.database.client.prepare("update ai_retrieval_chunks set chunk_id=? where projection_revision_id=? and chunk_id=?").run(uniqueChunkId(), validChunk.projectionRevisionId, validChunk.chunkId), /immutable/i);
    assert.equal(new SQLiteAIRetrievalProjectionRepository(fixtureValue.database).listChunks(session.projectionRevision.id).length, 1);
  } finally { fixtureValue.close(); }
});

test("Knowledge provenance survives in chunks, while Question chunks use safe explicit trust and exact provenance revisions", () => {
  const fixtureValue = fixture();
  try {
    const knowledge = createKnowledgePackage(fixtureValue, ["مصدر معرفي واضح"]);
    const knowledgeResult = new AIChunkProjectionBuilder(fixtureValue.database).build({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic" });
    const knowledgeChunk = new SQLiteAIRetrievalProjectionRepository(fixtureValue.database).listChunks(knowledgeResult.projectionRevisionId)[0];
    assert.equal(knowledgeChunk.originKind, "KNOWLEDGE_PACKAGE");
    assert.equal(knowledgeChunk.originId, knowledge.packageId);
    assert.equal(knowledgeChunk.originRevision, 1);
    assert.equal(knowledgeChunk.sourceId, knowledge.sourceId);
    assert.equal(knowledgeChunk.sourceRevision, 1);
    assert.equal(knowledgeChunk.sourceType, "OFFICIAL_TEXTBOOK");
    assert.equal(knowledgeChunk.trustTier, "OFFICIAL");
    assert.equal(knowledgeChunk.sourceItemOrder, 1);
    assert.equal(knowledgeChunk.provenance?.pageStart, 1);
    assert.equal(knowledgeChunk.provenance?.section, "Section 1");

    const questionPackageId = questionPackage(fixtureValue);
    const question = insertQuestion(fixtureValue, questionPackageId, "وزاري لا يعني ثقة رسمية");
    const questionResult = new AIChunkProjectionBuilder(fixtureValue.database).build({ originKind: "QUESTION_PACKAGE", originId: questionPackageId, subjectKey: "arabic" });
    const questionChunk = new SQLiteAIRetrievalProjectionRepository(fixtureValue.database).listChunks(questionResult.projectionRevisionId)[0];
    assert.equal(questionChunk.trustTier, "PYTHAGORAS_APPROVED");
    assert.equal(questionChunk.questionId, question.questionId);
    assert.equal(questionChunk.questionRevision, 1);
    assert.equal(questionChunk.variantId, question.variantId);
    assert.equal(questionChunk.variantRevision, 1);
    assert.equal((questionChunk.originMetadata.occurrences as Array<{ id: string; revision: number }>)[0].id, question.occurrenceId);
    assert.equal((questionChunk.originMetadata.occurrences as Array<{ id: string; revision: number }>)[0].revision, 1);
  } finally { fixtureValue.close(); }
});

test("Question-origin projection uses canonical rows only: draft is absent, publication appears, and subject is isolated", () => {
  const fixtureValue = fixture();
  try {
    const packageId = questionPackage(fixtureValue);
    const taxonomyId = uuidv7();
    fixtureValue.database.client.prepare("insert into question_taxonomy_nodes (id, package_id, node_key, label, kind, parent_id, display_order, created_at, updated_at, updated_by, revision) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(taxonomyId, packageId, "topic", "Topic", "topic", null, 1, 1_900_000_000_500, 1_900_000_000_500, ownerId, 1);
    const builder = new AIChunkProjectionBuilder(fixtureValue.database);
    const initial = builder.build({ originKind: "QUESTION_PACKAGE", originId: packageId, subjectKey: "arabic", batchSize: 1 });
    assert.equal(initial.chunkCount, 0);
    const questionId = uuidv7();
    const variantId = uuidv7();
    const desired: QuestionItemContent = { packageId, displayOrder: 1, primaryVariantId: variantId, taxonomyAssignments: [{ taxonomyNodeId: taxonomyId, role: "PRIMARY", position: 0 }], variants: [{ id: variantId, displayOrder: 1, content: canonicalParagraph("draft question only"), occurrences: [] }], sharedAnswer: canonicalParagraph("draft answer") };
    const draft = fixtureValue.changes.createChangeSet({ title: "Draft Question", initialItem: { resourceType: "question.item", resourceId: questionId, expectedRevision: 0, operation: "CREATE", desired } }, admin);
    assert.deepEqual(new SQLiteAILexicalRetrievalAdapter(fixtureValue.database).search({ subjectKey: "arabic", query: "draft" }), []);
    publish(fixtureValue, draft);
    const publicFtsBefore = Number((fixtureValue.database.client.prepare("select count(*) as count from question_search_fts").get() as { count: number }).count);
    const published = builder.build({ originKind: "QUESTION_PACKAGE", originId: packageId, subjectKey: "arabic", batchSize: 1 });
    assert.equal(published.chunkCount, 2);
    assert.equal(Number((fixtureValue.database.client.prepare("select count(*) as count from question_search_fts").get() as { count: number }).count), publicFtsBefore);
    const biologyPackageId = questionPackage(fixtureValue, "biology");
    assert.throws(() => builder.build({ originKind: "QUESTION_PACKAGE", originId: biologyPackageId, subjectKey: "physics" }), (error) => error instanceof AIRetrievalError && error.code === "AI_RETRIEVAL_ORIGIN_NOT_FOUND");
  } finally { fixtureValue.close(); }
});

test("Question edits with an unchanged Package revision make the current M7A projection STALE", () => {
  const fixtureValue = fixture();
  try {
    const packageId = questionPackage(fixtureValue);
    const taxonomyId = uuidv7();
    fixtureValue.database.client.prepare("insert into question_taxonomy_nodes (id, package_id, node_key, label, kind, parent_id, display_order, created_at, updated_at, updated_by, revision) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(taxonomyId, packageId, "topic", "Topic", "topic", null, 1, 1_900_000_000_510, 1_900_000_000_510, ownerId, 1);
    const questionId = uuidv7();
    const variantId = uuidv7();
    const initial: QuestionItemContent = { packageId, displayOrder: 1, primaryVariantId: variantId, taxonomyAssignments: [{ taxonomyNodeId: taxonomyId, role: "PRIMARY", position: 0 }], variants: [{ id: variantId, displayOrder: 1, content: canonicalParagraph("Question before edit"), occurrences: [] }], sharedAnswer: canonicalParagraph("Answer before edit") };
    publish(fixtureValue, fixtureValue.changes.createChangeSet({ title: "Publish Question for stale test", initialItem: { resourceType: "question.item", resourceId: questionId, expectedRevision: 0, operation: "CREATE", desired: initial } }, admin));
    const builder = new AIChunkProjectionBuilder(fixtureValue.database);
    const first = builder.build({ originKind: "QUESTION_PACKAGE", originId: packageId, subjectKey: "arabic" });
    const current = new SQLiteQuestionRepository(fixtureValue.database).getQuestion(questionId)!;
    const updated: QuestionItemContent = { packageId: current.packageId, displayOrder: current.displayOrder, primaryVariantId: current.primaryVariantId, taxonomyAssignments: current.taxonomyAssignments.map(({ taxonomyNodeId: id, role, position }) => ({ taxonomyNodeId: id, role, position })), variants: current.variants.map((variant) => ({ id: variant.id, displayOrder: variant.displayOrder, content: canonicalParagraph("Question after edit"), occurrences: variant.occurrences.map(({ id, displayOrder, sourceKind, year, roundCode, session, sourceName, notes, rawLabel, branches, qualifiers }) => ({ id, displayOrder, sourceKind, year, roundCode, session, sourceName, notes, rawLabel, branches, qualifiers })) })), sharedAnswer: canonicalParagraph("Answer after edit") };
    publish(fixtureValue, fixtureValue.changes.createChangeSet({ title: "Edit Question for stale test", initialItem: { resourceType: "question.item", resourceId: questionId, expectedRevision: current.revision, operation: "UPDATE", desired: updated } }, admin));
    const status = new AIRetrievalProjectionHealthService(fixtureValue.database).getProjectionStatus({ originKind: "QUESTION_PACKAGE", originId: packageId, subjectKey: "arabic" });
    assert.equal(status.status, "STALE");
    const rebuilt = builder.build({ originKind: "QUESTION_PACKAGE", originId: packageId, subjectKey: "arabic" });
    assert.notEqual(rebuilt.projectionRevisionId, first.projectionRevisionId);
    assert.equal(new AIRetrievalProjectionHealthService(fixtureValue.database).getProjectionStatus({ originKind: "QUESTION_PACKAGE", originId: packageId, subjectKey: "arabic" }).status, "READY");
  } finally { fixtureValue.close(); }
});

test("Lexical retrieval is separate, bounded, safe, subject-first, and honors live Knowledge rights", () => {
  const fixtureValue = fixture();
  try {
    const arabic = createKnowledgePackage(fixtureValue, ["عبارة مشتركة عربية"]);
    const physics = createKnowledgePackage(fixtureValue, ["عبارة مشتركة فيزياء"], "physics");
    const builder = new AIChunkProjectionBuilder(fixtureValue.database);
    builder.build({ originKind: "KNOWLEDGE_PACKAGE", originId: arabic.packageId, subjectKey: "arabic" });
    builder.build({ originKind: "KNOWLEDGE_PACKAGE", originId: physics.packageId, subjectKey: "physics" });
    const lexical = new SQLiteAILexicalRetrievalAdapter(fixtureValue.database);
    const results = lexical.search({ subjectKey: "arabic", query: "مشتركة", limit: 50 });
    assert.ok(results.length > 0);
    assert.ok(results.every((result) => result.subjectKey === "arabic"));
    assert.ok(results.every((result, index) => result.rank === index + 1));
    assert.equal(results.some((result) => result.originId === physics.packageId), false);
    assert.throws(() => lexical.search({ subjectKey: "arabic", query: "   !!! " }), (error) => error instanceof AIRetrievalError && error.code === "AI_RETRIEVAL_QUERY_EMPTY");
    assert.throws(() => lexical.search({ subjectKey: "not-a-subject", query: "مشتركة" }), (error) => error instanceof AIRetrievalError && error.code === "AI_RETRIEVAL_SUBJECT_INVALID");
    assert.throws(() => lexical.search({ subjectKey: "arabic", query: "مشتركة", limit: AI_RETRIEVAL_MAX_QUERY_LIMIT + 1 }), (error) => error instanceof AIRetrievalError && error.code === "AI_RETRIEVAL_QUERY_INVALID");
    assert.doesNotThrow(() => lexical.search({ subjectKey: "arabic", query: '" OR * NEAR / 5' }));
    const source = fixtureValue.sourceRepository.getById(arabic.sourceId)!;
    fixtureValue.sourceRepository.appendRevision({ id: arabic.sourceId, expectedRevision: source.currentRevision, content: sourceContent({ key: source.key, subjectKey: "arabic", enabled: false, rightsStatus: "RESTRICTED", rightsBasis: null }), actor: owner, now: 1_900_000_000_600 });
    assert.equal(new AIRetrievalProjectionHealthService(fixtureValue.database).getProjectionStatus({ originKind: "KNOWLEDGE_PACKAGE", originId: arabic.packageId, subjectKey: "arabic" }).status, "INELIGIBLE");
    assert.deepEqual(lexical.search({ subjectKey: "arabic", query: "مشتركة" }), []);
    const restricted = fixtureValue.sourceRepository.getById(arabic.sourceId)!;
    fixtureValue.sourceRepository.appendRevision({ id: arabic.sourceId, expectedRevision: restricted.currentRevision, content: sourceContent({ key: source.key, subjectKey: "arabic", enabled: true, rightsStatus: "CLEARED", rightsBasis: "OWNED" }), actor: owner, now: 1_900_000_000_700 });
    assert.ok(lexical.search({ subjectKey: "arabic", query: "مشتركة" }).length > 0);
  } finally { fixtureValue.close(); }
});

test("failed new projection revision leaves the previous READY revision active, then a rebuild replaces it", () => {
  const fixtureValue = fixture();
  try {
    const knowledge = createKnowledgePackage(fixtureValue, ["الإصدار القديم", "قديم أيضًا"]);
    const builder = new AIChunkProjectionBuilder(fixtureValue.database);
    const first = builder.build({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic", batchSize: 1 });
    const beforePackage = fixtureValue.packageRepository.getById(knowledge.packageId)!;
    fixtureValue.packageRepository.appendRevision({ id: knowledge.packageId, expectedRevision: beforePackage.package.currentRevision, content: { ...knowledge.content, contentRevision: 2, artifactRef: "b".repeat(64), artifactSha256: "b".repeat(64) }, documents: [knowledgeDocument("الإصدار الجديد", 1), knowledgeDocument("جديد أيضًا", 2)], assets: [], actor: owner, now: 1_900_000_000_800 });
    const failing = new AIChunkProjectionBuilder(fixtureValue.database, { failureInjector: (count) => { if (count >= 1) throw new Error("synthetic batch failure"); } });
    assert.throws(() => failing.build({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic", batchSize: 1 }), (error) => error instanceof AIRetrievalError && error.code === "AI_RETRIEVAL_PROJECTION_FAILED");
    const repository = new SQLiteAIRetrievalProjectionRepository(fixtureValue.database);
    const set = repository.getSet({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic", strategyKey: AI_RETRIEVAL_STRATEGY_KEY, normalizerKey: "retrieval-text-v1" })!;
    assert.equal(repository.getCurrentRevision(set.id)?.id, first.projectionRevisionId);
    assert.equal(repository.listRevisions(set.id).some((revision) => revision.status === "FAILED"), true);
    const health = new AIRetrievalProjectionHealthService(fixtureValue.database).getProjectionStatus({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic" });
    assert.equal(health.status, "STALE");
    assert.equal(new AIRetrievalProjectionHealthService(fixtureValue.database).getHealth("arabic").failedRevisions, 1);
    assert.ok(new SQLiteAILexicalRetrievalAdapter(fixtureValue.database).search({ subjectKey: "arabic", query: "القديم" }).length > 0);
    const rebuilt = new AIChunkProjectionBuilder(fixtureValue.database).build({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic", batchSize: 1 });
    assert.equal(rebuilt.status, "READY");
    assert.notEqual(rebuilt.projectionRevisionId, first.projectionRevisionId);
    assert.ok(new SQLiteAILexicalRetrievalAdapter(fixtureValue.database).search({ subjectKey: "arabic", query: "الجديد" }).length > 0);
    assert.deepEqual(new SQLiteAILexicalRetrievalAdapter(fixtureValue.database).search({ subjectKey: "arabic", query: "القديم" }), []);
  } finally { fixtureValue.close(); }
});

test("health reports BUILDING/READY/STALE state and FTS integrity without raw chunk text", () => {
  const fixtureValue = fixture();
  try {
    const knowledge = createKnowledgePackage(fixtureValue, ["صحة الإسقاط"]);
    const builder = new AIChunkProjectionBuilder(fixtureValue.database);
    assert.equal(new AIRetrievalProjectionHealthService(fixtureValue.database).getHealth("arabic").missingOrigins, 1);
    const session = builder.startBuild({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic" });
    assert.equal(new AIRetrievalProjectionHealthService(fixtureValue.database).getProjectionStatus({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic" }).status, "BUILDING");
    let health = new AIRetrievalProjectionHealthService(fixtureValue.database).getHealth("arabic");
    assert.equal(health.buildingRevisions, 1);
    assert.equal(health.currentChunkCount, 0);
    builder.processNextBatch(session.projectionRevision.id);
    builder.finalize(session.projectionRevision.id);
    health = new AIRetrievalProjectionHealthService(fixtureValue.database).getHealth("arabic");
    assert.equal(health.readyCurrentOrigins, 1);
    assert.equal(health.currentChunkCount, health.currentFtsRowCount);
    assert.equal(health.ftsConsistent, true);
    assert.equal(health.orphanChunkCount, 0);
    const status = new AIRetrievalProjectionHealthService(fixtureValue.database).getProjectionStatus({ originKind: "KNOWLEDGE_PACKAGE", originId: knowledge.packageId, subjectKey: "arabic" });
    assert.equal(status.status, "READY");
    const healthJson = JSON.stringify(health);
    assert.equal(healthJson.includes("صحة الإسقاط"), false);
  } finally { fixtureValue.close(); }
});

test("draft Knowledge Package is not a projection origin and M7A schema has no later-stage fields", () => {
  const fixtureValue = fixture();
  try {
    const sourceId = createSource(fixtureValue);
    const packageValue: AIKnowledgePackageV1 = {
      $schema: "https://schemas.pythagoras.local/knowledge-package/1.0.0",
      format: "pythagoras.knowledge-package",
      schemaVersion: "1.0.0",
      contentMode: "knowledge",
      package: { id: uuidv7(), key: "m7a.draft-package", title: "Draft", subjectKey: "arabic", language: "ar", contentRevision: 1 },
      source: { id: sourceId, revision: 1 },
      documents: [{ id: uuidv7(), order: 1, title: "Draft document", provenance: null, content: { type: "doc", version: 1, blocks: [{ id: uuidv7(), type: "paragraph", spans: [{ text: "draft knowledge" }] }] } }],
      assetsManifest: [],
    };
    const draft = fixtureValue.knowledge.stagePackage(packageValue, admin);
    assert.equal(fixtureValue.database.db.select().from(aiKnowledgePackages).all().length, 0);
    assert.equal(new AIRetrievalProjectionHealthService(fixtureValue.database).getHealth("arabic").eligibleKnowledgeOrigins, 0);
    assert.throws(() => new AIChunkProjectionBuilder(fixtureValue.database).build({ originKind: "KNOWLEDGE_PACKAGE", originId: packageValue.package.id, subjectKey: "arabic" }), (error) => error instanceof AIRetrievalError && error.code === "AI_RETRIEVAL_ORIGIN_NOT_FOUND");
    assert.equal(JSON.stringify(draft.items[0].proposedSnapshot).includes("draft knowledge"), false);
    const columns = fixtureValue.database.client.prepare("pragma table_info(ai_retrieval_chunks)").all() as Array<{ name: string }>;
    assert.equal(columns.some((column) => /embedding|vector|rerank|evidence/iu.test(column.name)), false);
    assert.ok(fixtureValue.database.client.prepare("select name from sqlite_master where type='table' and name='ai_retrieval_fts'").get());
  } finally { fixtureValue.close(); }
});

test("0024 upgrades an existing 0023 retrieval database and installs lifecycle protections", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m7a-upgrade-"));
  const oldMigrations = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m7a-migrations-"));
  let upgraded: ContentDatabase | null = null;
  try {
    mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    const priorEntries = journal.entries.slice(0, 23);
    for (const entry of priorEntries) {
      copyFileSync(path.join(migrationsDirectory, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
      const snapshotName = `${entry.idx.toString().padStart(4, "0")}_snapshot.json`;
      if (existsSync(path.join(migrationsDirectory, "meta", snapshotName))) copyFileSync(path.join(migrationsDirectory, "meta", snapshotName), path.join(oldMigrations, "meta", snapshotName));
    }
    writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: priorEntries }));
    const before = openContentDatabase({ dataDirectory: root, migrationsDirectory: oldMigrations });
    assert.equal((before.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count, 23);
    before.close();
    upgraded = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    assert.equal((upgraded.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count, 45);
    assert.ok(upgraded.client.prepare("select name from sqlite_master where type='trigger' and name='ai_retrieval_projection_revisions_lifecycle'").get());
    assert.ok(upgraded.client.prepare("select name from sqlite_master where type='trigger' and name='ai_retrieval_chunks_owner_insert'").get());
    assert.ok(upgraded.client.prepare("select name from sqlite_master where type='index' and name='ai_retrieval_projection_revisions_building_identity_unique'").get());
  } finally {
    upgraded?.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(oldMigrations, { recursive: true, force: true });
  }
});
