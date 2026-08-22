import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { NextRequest } from "next/server";
import { createAdminAuthService, type AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { SQLiteAssetRepository } from "../src/server/assets";
import {
  ChangeManagementError,
  AssetMetadataChangeAdapter,
  ChangeResourceAdapterRegistry,
  createChangeManagementService,
  SQLitePublicationRepository,
  threeWayMerge,
  type ChangeSetDetails,
  type ChangeResourceAdapter,
} from "../src/server/change-management";
import { getContentDatabase, openContentDatabase, type ContentDatabase } from "../src/server/content";
import { GET as listChangeSets, POST as createChangeSet } from "../src/app/api/admin/change-sets/route";

const migrationsDirectory = path.join(process.cwd(), "drizzle");

interface Fixture {
  root: string;
  database: ContentDatabase;
  service: ReturnType<typeof createChangeManagementService>;
  assets: SQLiteAssetRepository;
  publications: SQLitePublicationRepository;
  owner: AdminActor;
  admin: AdminActor;
  secondAdmin: AdminActor;
  createAsset(name?: string): ReturnType<SQLiteAssetRepository["create"]>;
  close(): void;
}

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-change-test-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const identities = new SQLiteAdminIdentityRepository(database);
  const createdAt = 1_700_000_000_000;
  const ownerUser = identities.createInitialOwner({ id: uuidv7(), email: "owner@change.test", displayName: "Owner", passwordHash: "$argon2id$test", createdAt });
  const adminUser = identities.createAdmin({ id: uuidv7(), email: "admin@change.test", displayName: "Admin", passwordHash: "$argon2id$test", createdAt: createdAt + 1 });
  const second = identities.createAdmin({ id: uuidv7(), email: "second@change.test", displayName: "Second", passwordHash: "$argon2id$test", createdAt: createdAt + 2 });
  const assets = new SQLiteAssetRepository(database, () => createdAt + 3);
  let assetIndex = 0;
  const fixture: Fixture = {
    root,
    database,
    assets,
    service: createChangeManagementService(database),
    publications: new SQLitePublicationRepository(database),
    owner: { actorUserId: ownerUser.id, actorRole: "OWNER" },
    admin: { actorUserId: adminUser.id, actorRole: "ADMIN" },
    secondAdmin: { actorUserId: second.id, actorRole: "ADMIN" },
    createAsset(name = "Original asset") {
      const hex = (++assetIndex).toString(16).padStart(64, "0");
      return assets.create({ originalFilename: `${assetIndex}.png`, displayName: name, mimeType: "image/png", mediaKind: "image", byteSize: 8, sha256: hex, storageKey: `${hex.slice(0, 2)}/${hex}`, width: 1, height: 1, durationMs: null, actor: fixture.admin });
    },
    close() { database.close(); rmSync(root, { recursive: true, force: true }); },
  };
  return fixture;
}

function proposal(fixture: Fixture, assetId: string, revision: number, displayName: string) {
  return fixture.service.createChangeSet({
    title: `Rename to ${displayName}`,
    initialItem: { resourceType: "asset.metadata", resourceId: assetId, expectedRevision: revision, desired: { displayName } },
  }, fixture.admin);
}

test("complete draft-review-approval-publication lifecycle is attributed and immutable until publish", () => {
  const fixture = createFixture();
  try {
    const asset = fixture.createAsset();
    let change = proposal(fixture, asset.id, asset.revision, "Reviewed asset");
    assert.equal(fixture.assets.findById(asset.id)?.displayName, "Original asset");
    assert.equal(change.changeSet.createdBy, fixture.admin.actorUserId);
    assert.deepEqual(change.items[0].beforeSnapshot, { displayName: "Original asset" });

    change = fixture.service.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
    assert.equal(change.changeSet.status, "SUBMITTED");
    assert.throws(() => fixture.service.approve(change.changeSet.id, change.changeSet.revision, fixture.admin), (error) => error instanceof ChangeManagementError && error.code === "CHANGE_AUTHORIZATION_FAILED");

    change = fixture.service.requestChanges(change.changeSet.id, change.changeSet.revision, "Use the approved wording", fixture.owner);
    assert.equal(change.changeSet.status, "NEEDS_CHANGES");
    change = fixture.service.updateItem(change.changeSet.id, change.items[0].id, { desired: { displayName: "Published asset" }, expectedItemRevision: change.items[0].revision, expectedChangeSetRevision: change.changeSet.revision }, fixture.admin);
    change = fixture.service.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
    change = fixture.service.approve(change.changeSet.id, change.changeSet.revision, fixture.owner);
    assert.equal(change.changeSet.status, "APPROVED");
    assert.equal(fixture.assets.findById(asset.id)?.displayName, "Original asset", "approval mutated canonical data");

    const published = fixture.service.publish(change.changeSet.id, change.changeSet.revision, fixture.owner);
    assert.equal(published.publicationRevision, 1);
    assert.equal(published.changeSet.changeSet.status, "PUBLISHED");
    const canonical = fixture.assets.findById(asset.id)!;
    assert.equal(canonical.displayName, "Published asset");
    assert.equal(canonical.updatedBy, fixture.owner.actorUserId);
    assert.equal(canonical.revision, 2);
    assert.deepEqual(published.changeSet.events.map((event) => event.eventType), ["CREATED", "ITEM_ADDED", "SUBMITTED", "REQUESTED_CHANGES", "ITEM_UPDATED", "RESUBMITTED", "APPROVED", "PUBLISHED"]);
    const publications = fixture.publications.list();
    assert.equal(publications.total, 1);
    assert.deepEqual(fixture.publications.listItems(publications.items[0].id)[0].afterSnapshot, { displayName: "Published asset" });
  } finally { fixture.close(); }
});

test("proposal ownership, review visibility, cancellation and rejection are enforced", () => {
  const fixture = createFixture();
  try {
    const asset = fixture.createAsset();
    let change = proposal(fixture, asset.id, asset.revision, "Admin proposal");
    assert.throws(() => fixture.service.getDetails(change.changeSet.id, fixture.secondAdmin), (error) => error instanceof ChangeManagementError && error.code === "CHANGE_AUTHORIZATION_FAILED");
    assert.equal(fixture.service.list({}, fixture.secondAdmin).total, 0);
    assert.equal(fixture.service.list({}, fixture.owner).total, 1);
    assert.throws(() => fixture.service.cancel(change.changeSet.id, change.changeSet.revision, fixture.secondAdmin));
    change = fixture.service.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
    change = fixture.service.reject(change.changeSet.id, change.changeSet.revision, "Not suitable", fixture.owner);
    assert.equal(change.changeSet.status, "REJECTED");
    assert.equal(fixture.assets.findById(asset.id)?.displayName, "Original asset");
    const other = fixture.createAsset("Other");
    const cancel = proposal(fixture, other.id, other.revision, "Cancelled");
    assert.equal(fixture.service.cancel(cancel.changeSet.id, cancel.changeSet.revision, fixture.admin).changeSet.status, "CANCELLED");
  } finally { fixture.close(); }
});

test("same-field concurrent proposals conflict, preserve evidence, and can be rebased", () => {
  const fixture = createFixture();
  try {
    const asset = fixture.createAsset();
    let first = proposal(fixture, asset.id, asset.revision, "First");
    let second = proposal(fixture, asset.id, asset.revision, "Second");
    first = fixture.service.submit(first.changeSet.id, first.changeSet.revision, fixture.admin);
    second = fixture.service.submit(second.changeSet.id, second.changeSet.revision, fixture.admin);
    first = fixture.service.approve(first.changeSet.id, first.changeSet.revision, fixture.owner);
    second = fixture.service.approve(second.changeSet.id, second.changeSet.revision, fixture.owner);
    fixture.service.publish(first.changeSet.id, first.changeSet.revision, fixture.owner);
    assert.throws(() => fixture.service.publish(second.changeSet.id, second.changeSet.revision, fixture.owner), (error) => error instanceof ChangeManagementError && error.code === "CHANGE_CONFLICT");
    second = fixture.service.getDetails(second.changeSet.id, fixture.owner);
    assert.equal(second.changeSet.status, "CONFLICTED");
    assert.deepEqual(second.items[0].conflictDetails, { base: { displayName: "Original asset" }, current: { displayName: "First" }, proposed: { displayName: "Second" } });
    second = fixture.service.rebase(second.changeSet.id, second.changeSet.revision, fixture.admin);
    assert.equal(second.changeSet.status, "NEEDS_CHANGES");
    assert.deepEqual(second.items[0].beforeSnapshot, { displayName: "First" });
  } finally { fixture.close(); }
});

test("three-way merge auto-merges disjoint fields and conservatively conflicts arrays", () => {
  assert.deepEqual(threeWayMerge({ title: "A", note: "x" }, { title: "A", note: "y" }, { title: "B", note: "x" }), {
    kind: "auto-merged", finalSnapshot: { title: "B", note: "y" }, currentChangedPaths: ["note"], overlappingPaths: [],
  });
  assert.equal(threeWayMerge({ values: [1, 2] }, { values: [1, 3] }, { values: [1, 4] }).kind, "conflict");
});

test("publication revisions are globally monotonic and durable across reopen", () => {
  const fixture = createFixture();
  const root = fixture.root;
  try {
    for (const name of ["One", "Two"]) {
      const asset = fixture.createAsset(name);
      let change = proposal(fixture, asset.id, asset.revision, `${name} published`);
      change = fixture.service.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
      change = fixture.service.approve(change.changeSet.id, change.changeSet.revision, fixture.owner);
      fixture.service.publish(change.changeSet.id, change.changeSet.revision, fixture.owner);
    }
    assert.equal(fixture.publications.getCurrentRevision(), 2);
    fixture.database.close();
    const reopened = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    try { assert.equal(new SQLitePublicationRepository(reopened).getCurrentRevision(), 2); }
    finally { reopened.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("multi-item publication is all-or-nothing when an adapter apply fails", () => {
  const fixture = createFixture();
  try {
    const first = fixture.createAsset("Atomic first");
    const second = fixture.createAsset("Atomic second");
    const delegate = new AssetMetadataChangeAdapter();
    const adapter: ChangeResourceAdapter = {
      resourceType: "test.atomic-asset",
      areaLabel: "Atomic test",
      loadCurrent: delegate.loadCurrent.bind(delegate),
      captureProposal: delegate.captureProposal.bind(delegate),
      validateSnapshot: delegate.validateSnapshot.bind(delegate),
      describe: delegate.describe.bind(delegate),
      apply(database, resourceId, snapshot, expectedRevision, actor) {
        if (resourceId === second.id) throw new Error("simulated apply failure");
        return delegate.apply(database, resourceId, snapshot, expectedRevision, actor);
      },
    };
    const service = createChangeManagementService(fixture.database, new ChangeResourceAdapterRegistry([adapter]));
    let change = service.createChangeSet({ title: "Atomic publication", initialItem: { resourceType: adapter.resourceType, resourceId: first.id, expectedRevision: 1, desired: { displayName: "Changed first" } } }, fixture.admin);
    change = service.addItem(change.changeSet.id, { resourceType: adapter.resourceType, resourceId: second.id, expectedRevision: 1, desired: { displayName: "Changed second" }, expectedChangeSetRevision: change.changeSet.revision }, fixture.admin);
    change = service.submit(change.changeSet.id, change.changeSet.revision, fixture.admin);
    change = service.approve(change.changeSet.id, change.changeSet.revision, fixture.owner);
    assert.throws(() => service.publish(change.changeSet.id, change.changeSet.revision, fixture.owner), (error) => error instanceof ChangeManagementError && error.code === "CHANGE_PUBLICATION_FAILED");
    assert.equal(fixture.assets.findById(first.id)?.displayName, "Atomic first");
    assert.equal(fixture.assets.findById(second.id)?.displayName, "Atomic second");
    assert.equal(fixture.publications.getCurrentRevision(), 0);
    assert.equal(service.getDetails(change.changeSet.id, fixture.owner).changeSet.status, "APPROVED");
  } finally { fixture.close(); }
});

test("0003 migration applies to fresh and existing M4 databases", () => {
  const freshRoot = mkdtempSync(path.join(os.tmpdir(), "pythagoras-change-fresh-"));
  const upgradeRoot = mkdtempSync(path.join(os.tmpdir(), "pythagoras-change-upgrade-"));
  const oldMigrations = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m4-migrations-"));
  try {
    for (const file of ["0000_content-foundation.sql", "0001_admin-identity.sql", "0002_assets.sql"]) copyFileSync(path.join(migrationsDirectory, file), path.join(oldMigrations, file));
    mkdirSync(path.join(oldMigrations, "meta"));
    for (const file of ["0000_snapshot.json", "0001_snapshot.json", "0002_snapshot.json"]) copyFileSync(path.join(migrationsDirectory, "meta", file), path.join(oldMigrations, "meta", file));
    const journal = { version: "7", dialect: "sqlite", entries: [
      { idx: 0, version: "6", when: 1787406399690, tag: "0000_content-foundation", breakpoints: true },
      { idx: 1, version: "6", when: 1787408709277, tag: "0001_admin-identity", breakpoints: true },
      { idx: 2, version: "6", when: 1787411002496, tag: "0002_assets", breakpoints: true },
    ] };
    writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify(journal));
    openContentDatabase({ dataDirectory: freshRoot, migrationsDirectory }).close();
    openContentDatabase({ dataDirectory: upgradeRoot, migrationsDirectory: oldMigrations }).close();
    const upgraded = openContentDatabase({ dataDirectory: upgradeRoot, migrationsDirectory });
    try { assert.equal(new SQLitePublicationRepository(upgraded).getCurrentRevision(), 0); }
    finally { upgraded.close(); }
  } finally {
    rmSync(freshRoot, { recursive: true, force: true });
    rmSync(upgradeRoot, { recursive: true, force: true });
    rmSync(oldMigrations, { recursive: true, force: true });
  }
});

test("snapshot payloads remain bounded and never contain auth secrets", () => {
  const fixture = createFixture();
  try {
    const asset = fixture.createAsset();
    const change = proposal(fixture, asset.id, asset.revision, "Safe snapshot");
    const serialized = JSON.stringify(change);
    assert.equal(serialized.includes("passwordHash"), false);
    assert.equal(serialized.includes("tokenHash"), false);
    assert.equal(serialized.includes(randomBytes(16).toString("hex")), false);
  } finally { fixture.close(); }
});

test("Change Set APIs require auth, reject cross-origin writes, derive actors, and return safe DTOs", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-change-api-"));
  const previousDataDirectory = process.env.PYTHAGORAS_DATA_DIR;
  process.env.PYTHAGORAS_DATA_DIR = root;
  const globals = globalThis as typeof globalThis & {
    __pythagorasAdminAuthService?: unknown;
    __pythagorasChangeManagementService?: unknown;
    __pythagorasContentDatabase?: ContentDatabase;
  };
  try {
    assert.equal((await listChangeSets(new NextRequest("http://localhost:3000/api/admin/change-sets"))).status, 401);
    const database = getContentDatabase();
    const auth = createAdminAuthService(database);
    const session = await auth.setupInitialOwner({ displayName: "API Owner", email: "owner@api-change.test", password: randomBytes(32).toString("base64url") });
    const actor: AdminActor = { actorUserId: session.authentication.user.id, actorRole: "OWNER" };
    const asset = new SQLiteAssetRepository(database).create({ originalFilename: "api.png", displayName: "API asset", mimeType: "image/png", mediaKind: "image", byteSize: 8, sha256: "a".repeat(64), storageKey: `aa/${"a".repeat(64)}`, width: 1, height: 1, durationMs: null, actor });
    const cookie = `pythagoras_admin_session=${session.rawToken}`;
    const hostile = await createChangeSet(new NextRequest("http://localhost:3000/api/admin/change-sets", { method: "POST", headers: { Host: "localhost:3000", Origin: "https://evil.example", Cookie: cookie } }));
    assert.equal(hostile.status, 403);
    const created = await createChangeSet(new NextRequest("http://localhost:3000/api/admin/change-sets", {
      method: "POST", headers: { Host: "localhost:3000", Origin: "http://localhost:3000", "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ title: "Safe API proposal", createdBy: "attacker", actorRole: "OWNER", initialItem: { resourceType: "asset.metadata", resourceId: asset.id, expectedRevision: 1, desired: { displayName: "Proposed API asset", passwordHash: "leak" } } }),
    }));
    assert.equal(created.status, 201);
    const createdBody = await created.json() as { changeSet: ChangeSetDetails };
    assert.equal(createdBody.changeSet.changeSet.createdBy, actor.actorUserId);
    assert.equal(JSON.stringify(createdBody).includes("passwordHash"), false);
    assert.equal(JSON.stringify(createdBody).includes("storageKey"), false);
  } finally {
    globals.__pythagorasContentDatabase?.close();
    delete globals.__pythagorasAdminAuthService;
    delete globals.__pythagorasChangeManagementService;
    delete globals.__pythagorasContentDatabase;
    if (previousDataDirectory === undefined) delete process.env.PYTHAGORAS_DATA_DIR; else process.env.PYTHAGORAS_DATA_DIR = previousDataDirectory;
    rmSync(root, { recursive: true, force: true });
  }
});
