import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";
import type { AdminActor } from "../src/server/admin-auth/contracts";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { createChangeManagementService } from "../src/server/change-management";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import { createCanonicalContentRepository } from "../src/server/canonical-content/service";
import { aiKnowledgeDocuments, aiKnowledgePackages, aiKnowledgeSourceRevisions, aiKnowledgeSources } from "../src/server/content/schema";
import {
  AI_KNOWLEDGE_PACKAGE_RESOURCE_TYPE,
  AI_KNOWLEDGE_SOURCE_RESOURCE_TYPE,
  AIKnowledgeDomainService,
  AIKnowledgeError,
  SQLiteAIKnowledgePackageRepository,
  SQLiteAIKnowledgeSourceRepository,
  SQLiteQuestionKnowledgeProjector,
  inspectAIKnowledgePackageJson,
} from "../src/server/ai/knowledge";
import type { AIKnowledgePackageV1, AIKnowledgeSourceContent } from "../src/server/ai/knowledge";
import type { QuestionAggregate } from "../src/server/questions/contracts";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const ownerId = "01900000-0000-7000-8000-000000000001";
const adminId = "01900000-0000-7000-8000-000000000002";
const owner: AdminActor = { actorUserId: ownerId, actorRole: "OWNER" };
const admin: AdminActor = { actorUserId: adminId, actorRole: "ADMIN" };

interface KnowledgeFixture {
  root: string;
  database: ContentDatabase;
  changes: ReturnType<typeof createChangeManagementService>;
  knowledge: AIKnowledgeDomainService;
  close(): void;
}

function fixture(): KnowledgeFixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m6-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  createCanonicalContentRepository(database).bootstrap();
  const identities = new SQLiteAdminIdentityRepository(database);
  identities.createInitialOwner({ id: ownerId, email: `owner-${uuidv7()}@m6.test`, displayName: "M6 Owner", passwordHash: "fixture", createdAt: 1_900_000_000_000 });
  identities.createAdmin({ id: adminId, email: `admin-${uuidv7()}@m6.test`, displayName: "M6 Admin", passwordHash: "fixture", createdAt: 1_900_000_000_001 });
  const changes = createChangeManagementService(database);
  return { root, database, changes, knowledge: new AIKnowledgeDomainService(database), close: () => { database.close(); rmSync(root, { recursive: true, force: true }); } };
}

function publish(fixture: KnowledgeFixture, details: ReturnType<KnowledgeFixture["changes"]["createChangeSet"]>) {
  const submitted = details.changeSet.status === "SUBMITTED" ? details : fixture.changes.submit(details.changeSet.id, details.changeSet.revision, admin);
  const approved = fixture.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, owner);
  return fixture.changes.publish(approved.changeSet.id, approved.changeSet.revision, owner);
}

function sourceContent(overrides: Partial<AIKnowledgeSourceContent> = {}): AIKnowledgeSourceContent {
  return {
    key: "arabic.official-textbook",
    subjectKey: "arabic",
    sourceType: "OFFICIAL_TEXTBOOK",
    displayName: "Arabic Official Textbook",
    language: "ar",
    edition: "2026",
    authorityName: "Ministry",
    authorityType: "MINISTRY",
    trustTier: "OFFICIAL",
    rightsStatus: "CLEARED",
    rightsBasis: "OWNED",
    licenseName: null,
    attribution: "Pythagoras fixture",
    rightsNotes: null,
    sourceUrl: "https://example.test/textbook",
    sourceAssetId: null,
    enabled: true,
    preparationMethod: "MANUAL",
    producerKey: "m6-fixture",
    producerRevision: "1",
    ...overrides,
  };
}

function document(id = uuidv7(), text = "Knowledge body"): AIKnowledgePackageV1["documents"][number] {
  return {
    id,
    order: 1,
    title: "Chapter one",
    provenance: { pageStart: 1, pageEnd: 2, section: "Grammar" },
    content: { type: "doc", version: 1, blocks: [{ id: uuidv7(), type: "paragraph", spans: [{ text }] }] },
  };
}

function packageValue(sourceId: string, sourceRevision: number, overrides: Partial<AIKnowledgePackageV1["package"]> = {}): AIKnowledgePackageV1 {
  return {
    $schema: "https://schemas.pythagoras.local/knowledge-package/1.0.0",
    format: "pythagoras.knowledge-package",
    schemaVersion: "1.0.0",
    contentMode: "knowledge",
    package: { id: uuidv7(), key: "arabic.knowledge.v1", title: "Arabic Knowledge", subjectKey: "arabic", language: "ar", contentRevision: 1, ...overrides },
    source: { id: sourceId, revision: sourceRevision },
    documents: [document()],
    assetsManifest: [],
  };
}

function createSource(fixture: KnowledgeFixture, content = sourceContent()) {
  const id = uuidv7();
  const draft = fixture.changes.createChangeSet({ title: "Create Knowledge Source", initialItem: { resourceType: AI_KNOWLEDGE_SOURCE_RESOURCE_TYPE, resourceId: id, expectedRevision: 0, operation: "CREATE", desired: content } }, admin);
  publish(fixture, draft);
  return { id, content };
}

test("Knowledge Package inspector is strict, bounded, and source-pinned", () => {
  const sourceId = uuidv7();
  const value = packageValue(sourceId, 1);
  const valid = inspectAIKnowledgePackageJson(value, { canonicalSubjectKeys: new Set(["arabic"]) });
  assert.equal(valid.status, "VALID");
  assert.ok(valid.package);
  const unknown = inspectAIKnowledgePackageJson({ ...value, chunks: [] }, { canonicalSubjectKeys: new Set(["arabic"]) });
  assert.equal(unknown.status, "INVALID");
  assert.ok(unknown.diagnostics.some((item) => item.code === "KNOWLEDGE_UNKNOWN_FIELD"));
  const unsupported = inspectAIKnowledgePackageJson({ ...value, schemaVersion: "2.0.0" }, { canonicalSubjectKeys: new Set(["arabic"]) });
  assert.equal(unsupported.status, "UNSUPPORTED_VERSION");
});

test("Knowledge Source and Package publish through OWNER Change Sets with bounded package snapshots", () => {
  const fixtureValue = fixture();
  try {
    const source = createSource(fixtureValue);
    const value = packageValue(source.id, 1);
    const privateMarker = "KNOWLEDGE_CONTENT_STAYS_OUTSIDE_CHANGE_SNAPSHOT";
    value.documents[0] = document(uuidv7(), privateMarker);
    const draft = fixtureValue.knowledge.stagePackage(value, admin);
    const snapshot = JSON.stringify(draft.items[0].proposedSnapshot);
    assert.equal(snapshot.includes(privateMarker), false);
    assert.ok(snapshot.includes("artifactSha256"));
    const published = publish(fixtureValue, draft);
    assert.ok(published.publicationRevision > 0);
    const packages = new SQLiteAIKnowledgePackageRepository(fixtureValue.database);
    const aggregate = packages.getById(value.package.id);
    assert.ok(aggregate);
    assert.equal(aggregate.package.subjectKey, "arabic");
    assert.equal(aggregate.documents[0].content.blocks[0].type, "paragraph");
    assert.equal(aggregate.documents[0].content.blocks[0].spans[0].text, privateMarker);
    assert.equal(fixtureValue.database.db.select().from(aiKnowledgeSources).all().length, 1);
    assert.equal(fixtureValue.database.db.select().from(aiKnowledgePackages).all().length, 1);
  } finally { fixtureValue.close(); }
});

test("Knowledge history is immutable, exact source pins remain queryable, and disabled Sources leave history but lose eligibility", () => {
  const fixtureValue = fixture();
  try {
    const source = createSource(fixtureValue);
    const first = packageValue(source.id, 1);
    publish(fixtureValue, fixtureValue.knowledge.stagePackage(first, admin));
    const second = { ...first, package: { ...first.package, contentRevision: 2, title: "Arabic Knowledge 2" }, documents: [document(uuidv7(), "second revision")] };
    publish(fixtureValue, fixtureValue.knowledge.stagePackage(second, admin));
    const packages = new SQLiteAIKnowledgePackageRepository(fixtureValue.database);
    assert.equal(packages.getRevision(first.package.id, 1)?.revision.revision, 1);
    assert.equal(packages.getRevision(first.package.id, 1)?.package.currentRevision, 2);
    assert.equal(packages.getById(first.package.id)?.package.currentRevision, 2);
    const revisionId = packages.getRevision(first.package.id, 1)!.revision.revisionId;
    assert.throws(() => fixtureValue.database.client.prepare("delete from ai_knowledge_documents where package_revision_id=?").run(revisionId), /immutable/i);
    assert.throws(() => fixtureValue.database.client.prepare("delete from ai_knowledge_package_revisions where id=?").run(revisionId), /immutable/i);

    const sourceRepository = new SQLiteAIKnowledgeSourceRepository(fixtureValue.database);
    const current = sourceRepository.getById(source.id)!;
    const restricted = { ...source.content, rightsStatus: "RESTRICTED" as const, rightsBasis: null, enabled: false };
    publish(fixtureValue, fixtureValue.changes.createChangeSet({ title: "Restrict source", initialItem: { resourceType: AI_KNOWLEDGE_SOURCE_RESOURCE_TYPE, resourceId: source.id, expectedRevision: current.currentRevision, operation: "UPDATE", desired: restricted } }, admin));
    assert.equal(packages.listProjectionEligibleKnowledge("arabic").length, 0);
    assert.equal(packages.getById(first.package.id)?.revision.sourceRevision, 1);
    assert.equal(fixtureValue.database.db.select().from(aiKnowledgeSourceRevisions).all().length, 2);
  } finally { fixtureValue.close(); }
});

test("QuestionKnowledgeProjector is deterministic, published-question scoped, and read-only", () => {
  const fixtureValue = fixture();
  try {
    const rich = { type: "doc", version: 1 as const, blocks: [{ id: uuidv7(), type: "paragraph" as const, spans: [{ text: "Question" }] }] };
    const question = {
      id: uuidv7(), packageId: uuidv7(), displayOrder: 1, sharedAnswer: rich, createdAt: 1, updatedAt: 1, updatedBy: ownerId, revision: 1,
      primaryVariantId: "variant-two", taxonomyAssignments: [],
      variants: [
        { id: "variant-one", questionId: "question", displayOrder: 1, content: rich, createdAt: 1, updatedAt: 1, updatedBy: ownerId, revision: 1, occurrences: [] },
        { id: "variant-two", questionId: "question", displayOrder: 2, content: rich, createdAt: 1, updatedAt: 1, updatedBy: ownerId, revision: 1, occurrences: [] },
      ],
    } as unknown as QuestionAggregate;
    const projector = new SQLiteQuestionKnowledgeProjector(fixtureValue.database);
    const projections = projector.projectQuestion(question, "arabic");
    assert.equal(projections.length, 2);
    assert.equal(projections[0].isPrimaryVariant, false);
    assert.equal(projections[1].isPrimaryVariant, true);
    assert.equal(projections[0].sharedAnswer, rich);
    assert.equal(fixtureValue.database.db.select().from(aiKnowledgeDocuments).all().length, 0);
  } finally { fixtureValue.close(); }
});

test("Knowledge package source pin must match the canonical subject", () => {
  const fixtureValue = fixture();
  try {
    const source = createSource(fixtureValue);
    const invalid = packageValue(source.id, 1, { subjectKey: "math" });
    assert.throws(() => fixtureValue.knowledge.stagePackage(invalid, admin), (error) => error instanceof AIKnowledgeError && error.code === "AI_KNOWLEDGE_INVALID");
  } finally { fixtureValue.close(); }
});

test("Knowledge publication is atomic when an artifact asset cannot be resolved", () => {
  const fixtureValue = fixture();
  try {
    const source = createSource(fixtureValue);
    const missingHash = "b".repeat(64);
    const invalidAtPublication = packageValue(source.id, 1);
    invalidAtPublication.documents[0] = {
      ...invalidAtPublication.documents[0],
      content: { type: "doc", version: 1, blocks: [{ id: uuidv7(), type: "image", assetRef: "missing-cover", alt: "cover" }] },
    };
    invalidAtPublication.assetsManifest = [{ ref: "missing-cover", sha256: missingHash, filename: "cover.png", mimeType: "image/png", byteSize: 10 }];
    const draft = fixtureValue.knowledge.stagePackage(invalidAtPublication, admin);
    const submitted = fixtureValue.changes.submit(draft.changeSet.id, draft.changeSet.revision, admin);
    const approved = fixtureValue.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, owner);
    assert.throws(() => fixtureValue.changes.publish(approved.changeSet.id, approved.changeSet.revision, owner));
    assert.equal(fixtureValue.database.db.select().from(aiKnowledgePackages).all().length, 0);
    assert.equal(fixtureValue.database.db.select().from(aiKnowledgeDocuments).all().length, 0);
  } finally { fixtureValue.close(); }
});

test("Knowledge source and package historical revisions are protected from direct mutation", () => {
  const fixtureValue = fixture();
  try {
    const source = createSource(fixtureValue);
    const sourceRevision = new SQLiteAIKnowledgeSourceRepository(fixtureValue.database).getRevision(source.id, 1)!;
    assert.throws(() => fixtureValue.database.client.prepare("update ai_knowledge_source_revisions set display_name=? where id=?").run("mutated", sourceRevision.revisionId), /immutable/i);
    assert.throws(() => fixtureValue.database.client.prepare("delete from ai_knowledge_source_revisions where id=?").run(sourceRevision.revisionId), /immutable/i);
    const packageData = packageValue(source.id, 1);
    publish(fixtureValue, fixtureValue.knowledge.stagePackage(packageData, admin));
    const packageRow = new SQLiteAIKnowledgePackageRepository(fixtureValue.database).getById(packageData.package.id)!;
    assert.throws(() => fixtureValue.database.client.prepare("update ai_knowledge_packages set key=? where id=?").run("mutated.key", packageData.package.id), /immutable/i);
    assert.throws(() => fixtureValue.database.client.prepare("update ai_knowledge_package_revisions set title=? where id=?").run("mutated", packageRow.revision.revisionId), /immutable/i);
  } finally { fixtureValue.close(); }
});
