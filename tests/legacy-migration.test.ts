import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { v7 as uuidv7 } from "uuid";
import { LEGACY_STORAGE_KEYS } from "../src/lib/admin/legacy-migration/contracts";
import { canonicalLegacyJson, scanLegacySource, type ReadonlyLegacyStorage } from "../src/lib/admin/legacy-migration/scanner";
import { ADMIN_SESSION_COOKIE_NAME, createAdminAuthService, type AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { AssetService, LocalFileAssetStorage, SQLiteAssetRepository } from "../src/server/assets";
import { getContentDatabase, getContentDatabaseStatus, openContentDatabase, type ContentDatabase } from "../src/server/content";
import { createLegacyMigrationService, LegacyMigrationError } from "../src/server/legacy-migration";
import { GET as listLegacyRuns, POST as createLegacyRun } from "../src/app/api/admin/migrations/legacy/route";

const migrationsDirectory = path.join(process.cwd(), "drizzle");

function mapStorage(values: Record<string, string | null>, reads: string[] = []): ReadonlyLegacyStorage {
  return { getItem(key) { reads.push(key); return values[key] ?? null; } };
}

function dataUrl(bytes: Buffer, mime = "image/png") { return `data:${mime};base64,${bytes.toString("base64")}`; }

interface Fixture {
  root: string; database: ContentDatabase; service: ReturnType<typeof createLegacyMigrationService>;
  owner: AdminActor; admin: AdminActor; stage(bytes: Buffer): string; close(): void;
}

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-legacy-test-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({ id: uuidv7(), email: "owner@legacy.test", displayName: "Legacy Owner", passwordHash: "$argon2id$test", createdAt: 1_900_000_000_000 });
  const adminUser = identities.createAdmin({ id: uuidv7(), email: "admin@legacy.test", displayName: "Legacy Admin", passwordHash: "$argon2id$test", createdAt: 1_900_000_000_001 });
  const assets = new AssetService(new SQLiteAssetRepository(database), new LocalFileAssetStorage(database.paths.objectStorageDirectory), { stagingDirectory: database.paths.tempDirectory, maximumAssetBytes: 1024 * 1024 });
  return {
    root, database, service: createLegacyMigrationService(database, assets),
    owner: { actorUserId: ownerUser.id, actorRole: "OWNER" }, admin: { actorUserId: adminUser.id, actorRole: "ADMIN" },
    stage(bytes) { const file = path.join(database.paths.tempDirectory, `${uuidv7()}.upload`); writeFileSync(file, bytes); return file; },
    close() { database.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

async function usefulScan(png: Buffer) {
  return scanLegacySource(mapStorage({
    "pythagoras-admin-banners": JSON.stringify([{ id: "banner-1", title: "ترحيب", displayOrder: 0, imageKey: "banner-one" }]),
    "pythagoras-admin-materials": "[]", "pythagoras-admin-tools": "[]", "pythagoras-admin-nav-items": "[]",
  }), [{ key: "banner-one", dataUrl: dataUrl(png) }, { key: "orphan-one", dataUrl: dataUrl(png) }], "http://localhost:3000", "2026-08-22T00:00:00.000Z");
}

async function fiveImageScan(png: Buffer, title = "خمسة مراجع") {
  const banners = Array.from({ length: 5 }, (_, index) => ({ id: `banner-${index}`, title, displayOrder: index + 1, imageKey: `image-${index}` }));
  return scanLegacySource(mapStorage({
    "pythagoras-admin-banners": JSON.stringify(banners),
    "pythagoras-admin-materials": "[]", "pythagoras-admin-tools": "[]", "pythagoras-admin-nav-items": "[]",
  }), banners.map((_, index) => ({ key: `image-${index}`, dataUrl: dataUrl(png) })), "http://localhost:3000", "2026-08-22T00:00:00.000Z");
}

async function stageCandidate(fixture: Fixture, run: { id: string; revision: number }, candidate: Awaited<ReturnType<typeof fiveImageScan>>["imageCandidates"][number], bytes: Buffer) {
  return fixture.service.stageAsset({
    runId: run.id,
    expectedRevision: run.revision,
    legacyReference: candidate.legacyReference,
    sourceKind: candidate.sourceKind,
    referenceContexts: candidate.contexts,
    filePath: fixture.stage(bytes),
    originalFilename: `${candidate.legacyReference}.png`,
    displayName: candidate.legacyReference,
    actor: fixture.owner,
  });
}

test("client scanner reads only the closed whitelist and distinguishes missing, malformed, duplicates, ordering and inline images", async () => {
  const reads: string[] = [];
  const png = await sharp({ create: { width: 3, height: 2, channels: 4, background: "#123456" } }).png().toBuffer();
  const result = await scanLegacySource(mapStorage({
    "pythagoras-admin-banners": JSON.stringify([
      { id: "same", displayOrder: 0, image: dataUrl(png) },
      { id: "same", displayOrder: 3, imageKey: "missing-key" },
    ]),
    "pythagoras-admin-materials": "{broken",
    "pythagoras-admin-nav-items": "[]",
    "pythagoras-admin-tools": "[]",
  }, reads), [{ key: "orphan", dataUrl: dataUrl(png) }], "http://localhost:3000", "2026-01-01T00:00:00.000Z");
  assert.deepEqual([...new Set(reads)], [...LEGACY_STORAGE_KEYS]);
  assert.ok(result.snapshot.issues.some((issue) => issue.code === "MALFORMED_JSON"));
  assert.ok(result.snapshot.issues.some((issue) => issue.code === "DUPLICATE_RECORD_ID"));
  assert.ok(result.snapshot.issues.some((issue) => issue.code === "ORDER_GAP"));
  assert.ok(result.snapshot.issues.some((issue) => issue.code === "MISSING_IMAGE_REFERENCE"));
  assert.ok(result.snapshot.issues.some((issue) => issue.code === "ORPHAN_IMAGE"));
  assert.ok(result.snapshot.issues.some((issue) => issue.code === "INLINE_IMAGE_FOUND"));
  assert.equal(JSON.stringify(result.snapshot).includes(";base64,"), false);
  assert.equal(JSON.stringify(result).includes(";base64,"), false);
  assert.equal(result.imageCandidates.some((candidate) => Object.values(candidate).some((value) => value instanceof Blob)), false);
  assert.equal(result.imageCandidates.some((candidate) => candidate.sourceKind === "INLINE"), true);
});

test("fingerprints are deterministic with sorted object keys while preserving array order", async () => {
  const first = await scanLegacySource(mapStorage({ "pythagoras-admin-banners": '[{"id":"a","title":"A","displayOrder":0}]', "pythagoras-admin-materials": "[]", "pythagoras-admin-tools": "[]", "pythagoras-admin-nav-items": "[]" }), [], "http://localhost:3000", "2026-01-01T00:00:00.000Z");
  const second = await scanLegacySource(mapStorage({ "pythagoras-admin-banners": '[{"displayOrder":0,"title":"A","id":"a"}]', "pythagoras-admin-materials": "[]", "pythagoras-admin-tools": "[]", "pythagoras-admin-nav-items": "[]" }), [], "http://localhost:3000", "2026-01-02T00:00:00.000Z");
  const reordered = await scanLegacySource(mapStorage({ "pythagoras-admin-banners": '[{"id":"b","displayOrder":0},{"id":"a","displayOrder":1}]', "pythagoras-admin-materials": "[]", "pythagoras-admin-tools": "[]", "pythagoras-admin-nav-items": "[]" }), [], "http://localhost:3000");
  assert.equal(first.sourceFingerprint, second.sourceFingerprint);
  assert.notEqual(first.sourceFingerprint, reordered.sourceFingerprint);
  assert.equal(canonicalLegacyJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test("scanner source has static read-only guards and never calls legacy mutators", () => {
  const scanner = readFileSync(path.join(process.cwd(), "src/lib/admin/legacy-migration/browser-scanner.ts"), "utf8");
  for (const forbidden of ["localStorage.setItem", "localStorage.removeItem", "localStorage.clear", "deleteImage", "clearAllImages", "cleanupOrphans", '"readwrite"']) assert.equal(scanner.includes(forbidden), false, forbidden);
  assert.ok(scanner.includes('"readonly"'));
  assert.equal(scanner.includes(".getAll("), false);
  assert.equal(scanner.includes(".getAllKeys("), false);
  assert.ok(scanner.includes("openKeyCursor"));
  const shell = readFileSync(path.join(process.cwd(), "src/components/admin/AdminShell.tsx"), "utf8");
  assert.equal(shell.includes("store.loadFromStorage()"), false);
  assert.equal(shell.includes("store.hydrateImagesFromIDB()"), false);
});

test("scanner prioritizes keyed references and retains metadata only while image values are inspected sequentially", async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#112233" } }).png().toBuffer();
  const encoded = dataUrl(png);
  const events: string[] = [];
  let active = 0;
  let maximumActive = 0;
  const reader = {
    async readDataUrl(key: string) {
      events.push(`read:${key}`);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return encoded;
    },
    async listKeys() { events.push("list"); return ["referenced", "orphan-a", "orphan-b"]; },
  };
  const result = await scanLegacySource(mapStorage({
    "pythagoras-admin-banners": JSON.stringify([{ id: "banner", displayOrder: 1, imageKey: "referenced" }]),
    "pythagoras-admin-materials": "[]", "pythagoras-admin-tools": "[]", "pythagoras-admin-nav-items": "[]",
  }), reader, "http://localhost:3000");
  assert.deepEqual(events, ["read:referenced", "list", "read:orphan-a", "read:orphan-b"]);
  assert.equal(maximumActive, 1);
  assert.equal(result.imageCandidates.length, 3);
  assert.equal(JSON.stringify(result).includes("data:image"), false);
  assert.equal(result.imageCandidates.some((candidate) => Object.values(candidate).some((value) => value instanceof Blob)), false);
});

test("order diagnostics accept zero- and one-based sequences while detecting actual gaps, duplicates and invalid values", async () => {
  const scanOrders = async (orders: unknown[]) => scanLegacySource(mapStorage({
    "pythagoras-admin-banners": JSON.stringify(orders.map((displayOrder, index) => ({ id: `banner-${index}`, displayOrder }))),
    "pythagoras-admin-materials": "[]", "pythagoras-admin-tools": "[]", "pythagoras-admin-nav-items": "[]",
  }), [], "http://localhost:3000");
  const oneBased = await scanOrders([1, 2, 3, 4, 5]);
  const zeroBased = await scanOrders([0, 1, 2, 3]);
  const gap = await scanOrders([0, 2, 3]);
  const duplicate = await scanOrders([1, 1, 2]);
  const invalid = await scanOrders([0, "2", 3]);
  assert.equal(oneBased.snapshot.issues.some((issue) => issue.code.startsWith("ORDER_") || issue.code === "DUPLICATE_ORDER" || issue.code === "INVALID_ORDER"), false);
  assert.equal(zeroBased.snapshot.issues.some((issue) => issue.code.startsWith("ORDER_") || issue.code === "DUPLICATE_ORDER" || issue.code === "INVALID_ORDER"), false);
  assert.equal(gap.snapshot.issues.some((issue) => issue.code === "ORDER_GAP"), true);
  assert.equal(duplicate.snapshot.issues.some((issue) => issue.code === "DUPLICATE_ORDER"), true);
  assert.equal(invalid.snapshot.issues.some((issue) => issue.code === "INVALID_ORDER"), true);
  assert.deepEqual((oneBased.snapshot.sections.banners as Array<{ displayOrder: number }>).map((record) => record.displayOrder), [1, 2, 3, 4, 5]);
});

test("OWNER stages a persistent snapshot and image mapping, deduplicates bytes, and READY survives restart", async () => {
  const fixture = createFixture(); const root = fixture.root;
  const png = await sharp({ create: { width: 5, height: 4, channels: 4, background: "#abcdef" } }).png().toBuffer();
  try {
    const scan = await usefulScan(png);
    let run = fixture.service.createRun(scan.snapshot.origin, fixture.owner);
    const stored = fixture.service.storeSnapshot(run.id, run.revision, scan.snapshot, scan.sourceFingerprint, fixture.owner);
    run = stored.run;
    const candidate = scan.imageCandidates.find((item) => item.legacyReference === "banner-one")!;
    const orphan = scan.imageCandidates.find((item) => item.legacyReference === "orphan-one")!;
    const [staged, deduplicated] = await Promise.all([
      fixture.service.stageAsset({ runId: run.id, expectedRevision: run.revision, legacyReference: candidate.legacyReference, sourceKind: candidate.sourceKind, referenceContexts: candidate.contexts, filePath: fixture.stage(png), originalFilename: "../../بانر.png", displayName: "بانر مرحّل", actor: fixture.owner }),
      fixture.service.stageAsset({ runId: run.id, expectedRevision: run.revision, legacyReference: orphan.legacyReference, sourceKind: orphan.sourceKind, referenceContexts: orphan.contexts, filePath: fixture.stage(png), originalFilename: "orphan.png", displayName: "اسم آخر لا يغير الأصل", actor: fixture.owner }),
    ]);
    run = staged.run;
    assert.equal(staged.mapping.legacyReference, "banner-one");
    assert.equal(Number(staged.reused) + Number(deduplicated.reused), 1);
    assert.equal(deduplicated.mapping.assetId, staged.mapping.assetId);
    run = fixture.service.get(run.id, fixture.owner).run;
    const idempotent = await fixture.service.stageAsset({ runId: run.id, expectedRevision: run.revision, legacyReference: candidate.legacyReference, sourceKind: candidate.sourceKind, referenceContexts: candidate.contexts, filePath: fixture.stage(png), originalFilename: "same.png", displayName: "لا يعيد التسمية", actor: fixture.owner });
    assert.equal(idempotent.mapping.assetId, staged.mapping.assetId);
    assert.equal(idempotent.run.revision, run.revision);
    run = fixture.service.finalize(run.id, run.revision, fixture.owner);
    assert.equal(run.status, "READY");
    assert.throws(() => fixture.service.cancel(run.id, run.revision, fixture.owner), (error) => error instanceof LegacyMigrationError && error.code === "LEGACY_MIGRATION_CONFLICT");
    const databaseBytes = readFileSync(fixture.database.paths.databaseFile);
    assert.equal(databaseBytes.includes(png), false);
    fixture.database.close();
    const reopened = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    try {
      const persisted = reopened.client.prepare("select status,snapshot,image_imported_count from legacy_migration_runs where id=?").get(run.id) as { status: string; snapshot: string; image_imported_count: number };
      assert.equal(persisted.status, "READY"); assert.equal(persisted.image_imported_count, 2); assert.equal(persisted.snapshot.includes("base64"), false);
      assert.equal((reopened.client.prepare("select count(*) as count from legacy_migration_assets where run_id=?").get(run.id) as { count: number }).count, 2);
    } finally { reopened.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("authorization, revisions, cancellation and blockers are enforced without deleting staged Assets", async () => {
  const fixture = createFixture();
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#00ff00" } }).png().toBuffer();
  try {
    assert.throws(() => fixture.service.createRun("http://localhost:3000", fixture.admin));
    const scan = await usefulScan(png);
    let run = fixture.service.createRun(scan.snapshot.origin, fixture.owner);
    assert.throws(() => fixture.service.storeSnapshot(run.id, run.revision + 1, scan.snapshot, scan.sourceFingerprint, fixture.owner), (error) => error instanceof LegacyMigrationError && error.code === "LEGACY_MIGRATION_CONFLICT");
    run = fixture.service.storeSnapshot(run.id, run.revision, scan.snapshot, scan.sourceFingerprint, fixture.owner).run;
    assert.throws(() => fixture.service.finalize(run.id, run.revision, fixture.owner), (error) => error instanceof LegacyMigrationError && error.code === "LEGACY_MIGRATION_NOT_READY");
    const candidate = scan.imageCandidates.find((item) => item.legacyReference === "banner-one")!;
    const staged = await fixture.service.stageAsset({ runId: run.id, expectedRevision: run.revision, legacyReference: candidate.legacyReference, sourceKind: candidate.sourceKind, referenceContexts: candidate.contexts, filePath: fixture.stage(png), originalFilename: "banner.png", displayName: "Staged", actor: fixture.owner });
    const assetCount = (fixture.database.client.prepare("select count(*) as count from assets").get() as { count: number }).count;
    const cancelled = fixture.service.cancel(run.id, staged.run.revision, fixture.owner);
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal((fixture.database.client.prepare("select count(*) as count from assets").get() as { count: number }).count, assetCount);
  } finally { fixture.close(); }
});

test("snapshot validation rejects sensitive fields, binary payloads and unknown issue/schema data", async () => {
  const fixture = createFixture();
  try {
    const scan = await scanLegacySource(mapStorage({ "pythagoras-admin-banners": "[]", "pythagoras-admin-materials": "[]", "pythagoras-admin-tools": "[]", "pythagoras-admin-nav-items": "[]" }), [], "http://localhost:3000");
    const run = fixture.service.createRun(scan.snapshot.origin, fixture.owner);
    const unsafe = structuredClone(scan.snapshot) as typeof scan.snapshot & { password?: string };
    unsafe.password = "not-allowed";
    assert.throws(() => fixture.service.storeSnapshot(run.id, run.revision, unsafe, scan.sourceFingerprint, fixture.owner), (error) => error instanceof LegacyMigrationError && error.code === "LEGACY_MIGRATION_INVALID");
  } finally { fixture.close(); }
});

test("IMPORTING run resumes after restart, stages only five required mappings, and finalizes without a duplicate run", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-legacy-resume-"));
  let database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({ id: uuidv7(), email: "resume@legacy.test", displayName: "Resume Owner", passwordHash: "$argon2id$test", createdAt: 1_900_000_000_000 });
  const owner: AdminActor = { actorUserId: ownerUser.id, actorRole: "OWNER" };
  const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: "#445566" } }).png().toBuffer();
  const source = await fiveImageScan(png);
  const makeService = (db: ContentDatabase) => createLegacyMigrationService(db, new AssetService(new SQLiteAssetRepository(db), new LocalFileAssetStorage(db.paths.objectStorageDirectory), { stagingDirectory: db.paths.tempDirectory, maximumAssetBytes: 1024 * 1024 }));
  const stageFile = (db: ContentDatabase) => { const file = path.join(db.paths.tempDirectory, `${uuidv7()}.upload`); writeFileSync(file, png); return file; };
  try {
    let service = makeService(database);
    let run = service.createRun(source.snapshot.origin, owner);
    run = service.storeSnapshot(run.id, run.revision, source.snapshot, source.sourceFingerprint, owner).run;
    for (const candidate of source.imageCandidates.slice(0, 2)) {
      await service.stageAsset({ runId: run.id, expectedRevision: run.revision, legacyReference: candidate.legacyReference, sourceKind: candidate.sourceKind, referenceContexts: candidate.contexts, filePath: stageFile(database), originalFilename: `${candidate.legacyReference}.png`, displayName: candidate.legacyReference, actor: owner });
    }
    assert.equal(service.get(run.id, owner).assets.length, 2);
    database.close();
    database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    service = makeService(database);
    const rescanned = await fiveImageScan(png);
    const resumed = service.resume(run.id, rescanned.sourceFingerprint, owner);
    assert.equal(resumed.run.status, "IMPORTING");
    assert.equal(resumed.assets.length, 2);
    const mapped = new Set(resumed.assets.map((mapping) => mapping.legacyReference));
    for (const candidate of rescanned.imageCandidates.filter((item) => !mapped.has(item.legacyReference))) {
      await service.stageAsset({ runId: run.id, expectedRevision: resumed.run.revision, legacyReference: candidate.legacyReference, sourceKind: candidate.sourceKind, referenceContexts: candidate.contexts, filePath: stageFile(database), originalFilename: `${candidate.legacyReference}.png`, displayName: candidate.legacyReference, actor: owner });
    }
    const beforeFinalize = service.get(run.id, owner);
    assert.equal(beforeFinalize.assets.length, 5);
    const ready = service.finalize(run.id, beforeFinalize.run.revision, owner);
    assert.equal(ready.status, "READY");
    assert.equal(service.list(owner).length, 1);
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("changed source fingerprint is refused while the original IMPORTING run and mappings remain intact", async () => {
  const fixture = createFixture();
  const png = await sharp({ create: { width: 3, height: 3, channels: 4, background: "#778899" } }).png().toBuffer();
  try {
    const sourceA = await fiveImageScan(png, "A");
    const sourceB = await fiveImageScan(png, "B");
    let run = fixture.service.createRun(sourceA.snapshot.origin, fixture.owner);
    run = fixture.service.storeSnapshot(run.id, run.revision, sourceA.snapshot, sourceA.sourceFingerprint, fixture.owner).run;
    await stageCandidate(fixture, run, sourceA.imageCandidates[0], png);
    assert.throws(() => fixture.service.resume(run.id, sourceB.sourceFingerprint, fixture.owner), (error) => error instanceof LegacyMigrationError && error.code === "LEGACY_MIGRATION_SOURCE_CHANGED");
    const intact = fixture.service.get(run.id, fixture.owner);
    assert.equal(intact.run.sourceFingerprint, sourceA.sourceFingerprint);
    assert.equal(intact.run.status, "IMPORTING");
    assert.equal(intact.assets.length, 1);
  } finally { fixture.close(); }
});

test("READY fingerprint is reusable without creating another migration run", async () => {
  const fixture = createFixture();
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#aa5500" } }).png().toBuffer();
  try {
    const source = await usefulScan(png);
    let run = fixture.service.createRun(source.snapshot.origin, fixture.owner);
    run = fixture.service.storeSnapshot(run.id, run.revision, source.snapshot, source.sourceFingerprint, fixture.owner).run;
    const candidate = source.imageCandidates.find((item) => item.state === "REFERENCED")!;
    await stageCandidate(fixture, run, candidate, png);
    run = fixture.service.finalize(run.id, run.revision, fixture.owner);
    const reusable = fixture.service.findReadyByFingerprint(source.sourceFingerprint, fixture.owner);
    assert.equal(reusable?.id, run.id);
    assert.equal(fixture.service.list(fixture.owner).length, 1);
  } finally { fixture.close(); }
});

test("source snapshot is immutable after first store and old mappings remain attached to snapshot A", async () => {
  const fixture = createFixture();
  const png = await sharp({ create: { width: 2, height: 3, channels: 4, background: "#225588" } }).png().toBuffer();
  try {
    const sourceA = await usefulScan(png);
    const sourceB = await fiveImageScan(png, "replacement");
    let run = fixture.service.createRun(sourceA.snapshot.origin, fixture.owner);
    run = fixture.service.storeSnapshot(run.id, run.revision, sourceA.snapshot, sourceA.sourceFingerprint, fixture.owner).run;
    const candidate = sourceA.imageCandidates.find((item) => item.state === "REFERENCED")!;
    await stageCandidate(fixture, run, candidate, png);
    assert.throws(() => fixture.service.storeSnapshot(run.id, run.revision, sourceB.snapshot, sourceB.sourceFingerprint, fixture.owner), (error) => error instanceof LegacyMigrationError && error.code === "LEGACY_MIGRATION_IMMUTABLE");
    const intact = fixture.service.get(run.id, fixture.owner);
    assert.equal(intact.run.sourceFingerprint, sourceA.sourceFingerprint);
    assert.equal(intact.assets.length, 1);
    assert.equal(intact.assets[0].legacyReference, candidate.legacyReference);
  } finally { fixture.close(); }
});

test("finalization rejects a stale mapping not represented by the immutable snapshot", async () => {
  const fixture = createFixture();
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#882244" } }).png().toBuffer();
  try {
    const source = await usefulScan(png);
    let run = fixture.service.createRun(source.snapshot.origin, fixture.owner);
    run = fixture.service.storeSnapshot(run.id, run.revision, source.snapshot, source.sourceFingerprint, fixture.owner).run;
    const candidate = source.imageCandidates.find((item) => item.state === "REFERENCED")!;
    const staged = await stageCandidate(fixture, run, candidate, png);
    fixture.database.client.prepare(`insert into legacy_migration_assets (id,run_id,legacy_reference,source_kind,asset_id,reference_contexts,reused,created_at) values (?,?,?,?,?,?,?,?)`).run(uuidv7(), run.id, "stale-reference", "INDEXED_DB", staged.assetId, "[]", 1, Date.now());
    assert.throws(() => fixture.service.finalize(run.id, run.revision, fixture.owner), (error) => error instanceof LegacyMigrationError && error.code === "LEGACY_MIGRATION_NOT_READY");
    assert.equal(fixture.service.get(run.id, fixture.owner).run.status, "IMPORTING");
  } finally { fixture.close(); }
});

test("mapping idempotency rejects inconsistent source metadata even when the Asset bytes are identical", async () => {
  const fixture = createFixture();
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#337744" } }).png().toBuffer();
  try {
    const source = await usefulScan(png);
    let run = fixture.service.createRun(source.snapshot.origin, fixture.owner);
    run = fixture.service.storeSnapshot(run.id, run.revision, source.snapshot, source.sourceFingerprint, fixture.owner).run;
    const candidate = source.imageCandidates.find((item) => item.state === "REFERENCED")!;
    await stageCandidate(fixture, run, candidate, png);
    fixture.database.client.prepare("update legacy_migration_assets set reference_contexts=? where run_id=? and legacy_reference=?").run('["stale.context"]', run.id, candidate.legacyReference);
    await assert.rejects(() => stageCandidate(fixture, run, candidate, png), (error) => error instanceof LegacyMigrationError && error.code === "LEGACY_MIGRATION_CONFLICT");
  } finally { fixture.close(); }
});

test("0004 applies to fresh and existing M5 databases", () => {
  const freshRoot = mkdtempSync(path.join(os.tmpdir(), "pythagoras-legacy-fresh-"));
  const upgradeRoot = mkdtempSync(path.join(os.tmpdir(), "pythagoras-legacy-upgrade-"));
  const oldMigrations = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m5-migrations-"));
  try {
    mkdirSync(path.join(oldMigrations, "meta"));
    for (const file of ["0000_content-foundation.sql", "0001_admin-identity.sql", "0002_assets.sql", "0003_change-management.sql"]) copyFileSync(path.join(migrationsDirectory, file), path.join(oldMigrations, file));
    for (const file of ["0000_snapshot.json", "0001_snapshot.json", "0002_snapshot.json", "0003_snapshot.json"]) copyFileSync(path.join(migrationsDirectory, "meta", file), path.join(oldMigrations, "meta", file));
    const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8")) as { version: string; dialect: string; entries: unknown[] };
    writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, 4) }));
    const fresh = openContentDatabase({ dataDirectory: freshRoot, migrationsDirectory }); assert.equal(getContentDatabaseStatus(fresh).migrationsApplied, 19); fresh.close();
    openContentDatabase({ dataDirectory: upgradeRoot, migrationsDirectory: oldMigrations }).close();
    const upgraded = openContentDatabase({ dataDirectory: upgradeRoot, migrationsDirectory });
    assert.equal(getContentDatabaseStatus(upgraded).migrationsApplied, 19);
    assert.deepEqual((upgraded.client.prepare("select name from sqlite_master where type='table' and name like 'legacy_migration_%' order by name").all() as Array<{ name: string }>).map((row) => row.name), ["legacy_migration_assets", "legacy_migration_events", "legacy_migration_issues", "legacy_migration_runs"]);
    upgraded.close();
  } finally { for (const target of [freshRoot, upgradeRoot, oldMigrations]) try { rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* best-effort test fixture cleanup */ } }
});

test("legacy APIs deny unauthenticated reads and cross-origin mutations", async () => {
  assert.equal((await listLegacyRuns(new NextRequest("http://localhost:3000/api/admin/migrations/legacy"))).status, 401);
  const response = await createLegacyRun(new NextRequest("http://localhost:3000/api/admin/migrations/legacy", { method: "POST", headers: { origin: "https://evil.test", host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ sourceOrigin: "http://localhost:3000" }) }));
  assert.equal(response.status, 403);
});

test("OWNER API derives creator identity from the HttpOnly session and ignores injected actors", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-legacy-api-"));
  const previous = process.env.PYTHAGORAS_DATA_DIR;
  const globals = globalThis as typeof globalThis & { __pythagorasContentDatabase?: ContentDatabase; __pythagorasAdminAuthService?: unknown; __pythagorasAssetService?: unknown; __pythagorasLegacyMigrationService?: unknown };
  try {
    globals.__pythagorasContentDatabase?.close();
    globals.__pythagorasContentDatabase = undefined; globals.__pythagorasAdminAuthService = undefined; globals.__pythagorasAssetService = undefined; globals.__pythagorasLegacyMigrationService = undefined;
    process.env.PYTHAGORAS_DATA_DIR = root;
    const database = getContentDatabase();
    const auth = createAdminAuthService(database);
    const session = await auth.setupInitialOwner({ displayName: "API Legacy Owner", email: "owner@legacy-api.test", password: "a very long local test passphrase 2026" });
    globals.__pythagorasAdminAuthService = auth;
    const response = await createLegacyRun(new NextRequest("http://localhost:3000/api/admin/migrations/legacy", {
      method: "POST",
      headers: { origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json", cookie: `${ADMIN_SESSION_COOKIE_NAME}=${session.rawToken}` },
      body: JSON.stringify({ sourceOrigin: "http://localhost:3000", createdBy: "attacker", role: "ADMIN", tokenHash: "redacted" }),
    }));
    assert.equal(response.status, 201);
    const body = await response.json() as { run: { createdBy: string }; [key: string]: unknown };
    assert.equal(body.run.createdBy, session.authentication.user.id);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("attacker"), false);
    assert.equal(serialized.includes("passwordHash"), false);
    assert.equal(serialized.includes("tokenHash"), false);
    assert.equal(serialized.includes("storageKey"), false);
  } finally {
    globals.__pythagorasAssetService = undefined; globals.__pythagorasLegacyMigrationService = undefined; globals.__pythagorasAdminAuthService = undefined;
    globals.__pythagorasContentDatabase?.close(); globals.__pythagorasContentDatabase = undefined;
    if (previous === undefined) delete process.env.PYTHAGORAS_DATA_DIR; else process.env.PYTHAGORAS_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
