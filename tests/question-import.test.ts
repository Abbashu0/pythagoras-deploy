import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";
import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { createAssetService } from "../src/server/assets";
import { createCanonicalContentRepository } from "../src/server/canonical-content";
import { createChangeManagementService } from "../src/server/change-management";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import { assets, questionPackageAssetBindings } from "../src/server/content/schema";
import { createQuestionPackageImportService } from "../src/server/question-import";
import type { QuestionPackageV1 } from "../src/server/question-packages";
import { SQLiteQuestionRepository } from "../src/server/questions";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const fixtureDirectory = path.join(process.cwd(), "tests/fixtures/question-packages");

function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m12-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  createCanonicalContentRepository(database).bootstrap();
  const identities = new SQLiteAdminIdentityRepository(database);
  const user = identities.createInitialOwner({ id: uuidv7(), email: "owner@m12.test", displayName: "M12 Owner", passwordHash: "$argon2id$test", createdAt: Date.now() });
  const actor: AdminActor = { actorUserId: user.id, actorRole: "OWNER" };
  return { root, database, actor, service: createQuestionPackageImportService(database), changes: createChangeManagementService(database), close() { database.close(); rmSync(root, { recursive: true, force: true }); } };
}

async function ingestPackage(database: ContentDatabase, actor: AdminActor, value: unknown, name = "package.json") {
  const directory = path.join(database.paths.tempDirectory, uuidv7()); mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, name); writeFileSync(filePath, JSON.stringify(value));
  return (await createAssetService(database).ingest({ filePath, originalFilename: name }, actor)).asset;
}

function fixture(name: string): QuestionPackageV1 { return JSON.parse(readFileSync(path.join(fixtureDirectory, name), "utf8")) as QuestionPackageV1; }
function tableCount(database: ContentDatabase, table: string) { return Number((database.client.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count); }

test("server-authoritative preflight is bounded, non-mutating, and blocks generic/invalid packages", async () => {
  const value = fixture("b-literature-valid.json"); value.package.contentRevision = 7;
  const f = createFixture();
  try {
    const asset = await ingestPackage(f.database, f.actor, value);
    const preflight = await f.service.preflight(asset.id, f.actor);
    assert.equal(preflight.eligible, true); assert.equal(preflight.package?.contentRevision, 7);
    assert.deepEqual(preflight.counts, { taxonomy: value.taxonomy.length, browseNodes: value.bankBrowse.nodes.length, questions: value.questions.length, variants: 1, occurrences: 1, manifestAssets: 0, usedAssets: 0, resolvedAssets: 0, unresolvedAssets: 0, estimatedChangeItems: 3 });
    assert.equal(tableCount(f.database, "question_packages"), 0); assert.equal(tableCount(f.database, "change_sets"), 0);
    const generic = await ingestPackage(f.database, f.actor, { hello: "world" }, "generic.json");
    assert.equal((await f.service.preflight(generic.id, f.actor)).eligible, false);
    const invalid = await ingestPackage(f.database, f.actor, fixture("g-invalid-primary-variant.json"), "invalid.json");
    assert.equal((await f.service.preflight(invalid.id, f.actor)).blockers.length > 0, true);
  } finally { f.close(); }
});

test("warning acknowledgement, active-draft idempotency, reviewed publication, and contentRevision preservation", async () => {
  const f = createFixture();
  try {
    const warningValue = fixture("k-warning-missing-answer.json"); warningValue.package.contentRevision = 9;
    const asset = await ingestPackage(f.database, f.actor, warningValue);
    const preflight = await f.service.preflight(asset.id, f.actor);
    assert.equal(preflight.acknowledgementRequired, true);
    await assert.rejects(() => f.service.stage(asset.id, false, f.actor), /acknowledged/i);
    const staged = await f.service.stage(asset.id, true, f.actor);
    assert.equal(staged.outcome, "STAGED"); assert.equal(tableCount(f.database, "question_packages"), 0);
    const repeated = await f.service.stage(asset.id, true, f.actor);
    assert.equal(repeated.outcome, "EXISTING_DRAFT"); assert.equal(repeated.changeSetId, staged.changeSetId);
    let details = f.changes.getDetails(staged.changeSetId!, f.actor);
    details = f.changes.submit(details.changeSet.id, details.changeSet.revision, f.actor);
    details = f.changes.approve(details.changeSet.id, details.changeSet.revision, f.actor);
    f.changes.publish(details.changeSet.id, details.changeSet.revision, f.actor);
    assert.equal(new SQLiteQuestionRepository(f.database).getPackage(staged.packageId)?.contentRevision, 9);
    assert.equal((await f.service.preflight(asset.id, f.actor)).alreadyImported, true);
  } finally { f.close(); }
});

test("initial import blocks canonical package, bank-entry, and nested entity collisions", async () => {
  const f = createFixture();
  try {
    const original = fixture("b-literature-valid.json");
    const source = await ingestPackage(f.database, f.actor, original, "canonical-source.json");
    const staged = await f.service.stage(source.id, false, f.actor);
    let state = f.changes.getDetails(staged.changeSetId!, f.actor);
    state = f.changes.submit(state.changeSet.id, state.changeSet.revision, f.actor);
    state = f.changes.approve(state.changeSet.id, state.changeSet.revision, f.actor);
    f.changes.publish(state.changeSet.id, state.changeSet.revision, f.actor);

    const metadataCollision = structuredClone(original);
    metadataCollision.package.id = uuidv7();
    metadataCollision.taxonomy = metadataCollision.taxonomy.map((node) => ({ ...node, id: uuidv7() }));
    metadataCollision.questions = metadataCollision.questions.map((question) => {
      const questionId = uuidv7();
      const variantId = uuidv7();
      return {
        ...question,
        id: questionId,
        primaryVariantId: variantId,
        taxonomyAssignments: [{ ...question.taxonomyAssignments[0], taxonomyNodeId: metadataCollision.taxonomy[0].id }],
        variants: question.variants.map((variant) => ({
          ...variant,
          id: variantId,
          occurrences: variant.occurrences.map((occurrence) => ({ ...occurrence, id: uuidv7() })),
        })),
      };
    });
    const metadataAsset = await ingestPackage(f.database, f.actor, metadataCollision, "metadata-collision.json");
    const metadataPreflight = await f.service.preflight(metadataAsset.id, f.actor);
    assert.equal(metadataPreflight.eligible, false);
    assert.deepEqual(new Set(metadataPreflight.blockers.map((item) => item.code)), new Set(["PACKAGE_KEY_COLLISION", "BANK_ENTRY_KEY_COLLISION", "BANK_ENTRY_ORDER_COLLISION"]));

    const identityCollision = structuredClone(original);
    identityCollision.package.id = uuidv7();
    identityCollision.package.key = "identity-collision-package";
    identityCollision.bankBrowse.entry.key = "identity-collision-package";
    identityCollision.bankBrowse.entry.order += 100;
    const identityAsset = await ingestPackage(f.database, f.actor, identityCollision, "identity-collision.json");
    const identityPreflight = await f.service.preflight(identityAsset.id, f.actor);
    assert.equal(identityPreflight.eligible, false);
    assert.deepEqual(
      new Set(identityPreflight.blockers.map((item) => item.code)),
      new Set(["TAXONOMY_ID_COLLISION", "QUESTION_ID_COLLISION", "VARIANT_ID_COLLISION", "OCCURRENCE_ID_COLLISION"]),
    );
    assert.equal(tableCount(f.database, "change_sets"), 1);
  } finally { f.close(); }
});

test("manifest bindings are staged losslessly and persist only at publication", async () => {
  const f = createFixture();
  try {
    const value = fixture("f-asset-ref-valid.json"); const manifest = value.assetsManifest[0];
    f.database.db.insert(assets).values({ id: uuidv7(), originalFilename: manifest.filename, displayName: manifest.filename, mimeType: manifest.mimeType, mediaKind: "image", byteSize: manifest.byteSize, sha256: manifest.sha256, storageKey: `${manifest.sha256.slice(0, 2)}/${manifest.sha256}`, width: null, height: null, durationMs: null, createdBy: f.actor.actorUserId, updatedBy: f.actor.actorUserId, createdAt: 1, updatedAt: 1, revision: 1 }).run();
    const source = await ingestPackage(f.database, f.actor, value);
    const staged = await f.service.stage(source.id, false, f.actor);
    assert.equal(f.database.db.select().from(questionPackageAssetBindings).all().length, 0);
    const details = f.changes.getDetails(staged.changeSetId!, f.actor);
    const packageItem = details.items.find((item) => item.resourceType === "question.package")!;
    assert.equal((packageItem.proposedSnapshot.assetBindings as unknown[]).length, 1);
    let state = f.changes.submit(details.changeSet.id, details.changeSet.revision, f.actor);
    state = f.changes.approve(state.changeSet.id, state.changeSet.revision, f.actor);
    f.changes.publish(state.changeSet.id, state.changeSet.revision, f.actor);
    const binding = f.database.db.select().from(questionPackageAssetBindings).get();
    assert.equal(binding?.assetRef, manifest.ref); assert.equal(binding?.expectedSha256, manifest.sha256);
  } finally { f.close(); }
});

test("manual empty package creates one reviewed DRAFT with server UUID and no canonical mutation", () => {
  const f = createFixture();
  try {
    const result = f.service.createEmptyPackage({ title: "حزمة فارغة", packageKey: "manual-empty", subjectKey: "arabic", language: "ar-IQ", bankBrowseMode: "ALL_PACKAGE_QUESTIONS", bankBrowseEntryKey: "manual-empty", bankBrowseEntryLabel: "حزمة فارغة", bankBrowseEntryOrder: 20 }, f.actor);
    assert.match(result.packageId, /^[0-9a-f-]{36}$/u); assert.equal(result.itemCount, 1);
    assert.equal(tableCount(f.database, "question_packages"), 0);
    const item = f.changes.getDetails(result.changeSetId!, f.actor).items[0];
    assert.equal(item.proposedSnapshot.contentRevision, 1); assert.deepEqual(item.proposedSnapshot.assetBindings, []); assert.equal(item.proposedSnapshot.sourceAssetId, null);
  } finally { f.close(); }
});

test("generated 2000-question package stages atomically with paging and bounded compact result", { timeout: 120_000 }, async () => {
  const f = createFixture();
  try {
    const value = fixture("d-multi-variant-valid.json"); value.package.id = uuidv7(); value.package.key = "generated-two-thousand"; value.bankBrowse.entry.key = "generated-two-thousand"; value.bankBrowse.entry.order = 77; value.taxonomy[0].id = uuidv7();
    const template = value.questions[0];
    value.questions = Array.from({ length: 2_000 }, (_, index) => {
      const questionId = uuidv7(); const variantId = uuidv7();
      return { id: questionId, order: index + 1, primaryVariantId: variantId, taxonomyAssignments: [{ taxonomyNodeId: value.taxonomy[0].id, role: "PRIMARY" as const }], variants: [{ id: variantId, order: 1, content: { type: "doc" as const, version: 1 as const, blocks: [{ id: uuidv7(), type: "paragraph" as const, spans: [{ text: `سؤال اصطناعي ${index + 1}` }] }] }, occurrences: [{ id: uuidv7(), sourceKind: "other" as const, branches: [], qualifiers: [], rawLabel: `مصدر اصطناعي ${index + 1}` }] }], sharedAnswer: { type: "doc" as const, version: 1 as const, blocks: [{ id: uuidv7(), type: "paragraph" as const, spans: [{ text: `جواب اصطناعي ${index + 1}` }] }] } };
    });
    const asset = await ingestPackage(f.database, f.actor, value, "generated-2000.json");
    const staged = await f.service.stage(asset.id, false, f.actor);
    assert.equal(staged.itemCount, 2_002); assert.equal(Object.keys(staged).length <= 5, true);
    assert.equal(tableCount(f.database, "change_set_items"), 2_002); assert.equal(tableCount(f.database, "questions"), 0);
    const first = f.changes.getDetailsPage(staged.changeSetId!, f.actor, 25, 0); const last = f.changes.getDetailsPage(staged.changeSetId!, f.actor, 25, 2_000);
    assert.equal(first.items.length, 25); assert.equal(first.itemPage.total, 2_002); assert.equal(last.items.length, 2);
    const firstPageSnapshotBytes = first.items.map((item) => Buffer.byteLength(JSON.stringify(item.proposedSnapshot)));
    assert.equal(firstPageSnapshotBytes.length, 25);
    assert.equal(Math.max(...firstPageSnapshotBytes) > 100, true);
    assert.equal(firstPageSnapshotBytes.every((byteSize) => byteSize <= 64 * 1024), true);
  } finally { f.close(); }
});

test("preflight blocks an oversized generated question snapshot before creating a Change Set", async () => {
  const f = createFixture();
  try {
    const value = fixture("d-multi-variant-valid.json");
    const question = value.questions[0];
    question.variants[0].content.blocks = Array.from({ length: 90 }, () => ({
      id: uuidv7(),
      type: "paragraph" as const,
      spans: [{ text: "س".repeat(900) }],
    }));
    const asset = await ingestPackage(f.database, f.actor, value, "oversized-question.json");
    const preflight = await f.service.preflight(asset.id, f.actor);
    const blocker = preflight.blockers.find((item) => item.code === "SNAPSHOT_TOO_LARGE");
    assert.equal(preflight.eligible, false);
    assert.equal(blocker?.resourceType, "question.item");
    assert.equal(blocker?.entityId, question.id);
    assert.equal((blocker?.byteSize ?? 0) > (blocker?.maximumBytes ?? Number.MAX_SAFE_INTEGER), true);
    assert.equal(blocker?.maximumBytes, 64 * 1024);
    assert.equal(tableCount(f.database, "change_sets"), 0);
  } finally { f.close(); }
});

test("Question Package APIs enforce Admin identity and same-origin mutations without accepting raw package bodies", () => {
  const rootRoute = readFileSync(path.join(process.cwd(), "src/app/api/admin/question-packages/route.ts"), "utf8");
  const importRoute = readFileSync(path.join(process.cwd(), "src/app/api/admin/question-packages/import/route.ts"), "utf8");
  const preflightRoute = readFileSync(path.join(process.cwd(), "src/app/api/admin/question-packages/preflight/[assetId]/route.ts"), "utf8");
  assert.match(rootRoute, /requireQuestionAdmin\(request\)/u);
  assert.match(rootRoute, /assertTrustedMutationRequest\(request\)/u);
  assert.match(importRoute, /requireQuestionAdmin\(request\)/u);
  assert.match(importRoute, /assertTrustedMutationRequest\(request\)/u);
  assert.match(preflightRoute, /requireQuestionAdmin\(request\)/u);
  assert.doesNotMatch(importRoute, /body\.(?:package|questions|createdBy|actorUserId|role|storageKey|filePath)/u);
  assert.match(importRoute, /\.stage\(body\.assetId, body\.acknowledgeWarnings === true, getAdminActor\(authentication\)\)/u);
});
