import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";
import type { AdminActor } from "../src/server/admin-auth/contracts";
import { createCanonicalContentRepository } from "../src/server/canonical-content/service";
import { createChangeManagementService } from "../src/server/change-management/service";
import { ChangeManagementError } from "../src/server/change-management/errors";
import { openContentDatabase, type ContentDatabase } from "../src/server/content/database";
import { adminUsers, assets } from "../src/server/content/schema";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const owner: AdminActor = { actorUserId: "01900000-0000-7000-8000-000000000001", actorRole: "OWNER" };
const admin: AdminActor = { actorUserId: "01900000-0000-7000-8000-000000000002", actorRole: "ADMIN" };

function temp(prefix = "pythagoras-m7-") { return mkdtempSync(path.join(os.tmpdir(), prefix)); }
function closeAndRemove(database: ContentDatabase, root: string) { database.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
function fixture() {
  const root = temp(); const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const now = 1_780_000_000_000;
  database.db.insert(adminUsers).values([
    { id: owner.actorUserId, email: "owner@m7.test", displayName: "M7 Owner", passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture", role: "OWNER", enabled: true, createdAt: now, updatedAt: now, passwordChangedAt: now, revision: 1 },
    { id: admin.actorUserId, email: "admin@m7.test", displayName: "M7 Admin", passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture", role: "ADMIN", enabled: true, createdAt: now, updatedAt: now, passwordChangedAt: now, revision: 1 },
  ]).run();
  return { root, database, canonical: createCanonicalContentRepository(database), changes: createChangeManagementService(database) };
}
function strip(item: Record<string, unknown>, omitted: string[]) { return Object.fromEntries(Object.entries(item).filter(([key]) => !omitted.includes(key))); }
function entitySnapshot(item: Record<string, unknown>) { return strip(item, ["id", "asset", "createdAt", "updatedAt", "revision"]); }
function publish(service: ReturnType<typeof createChangeManagementService>, details: ReturnType<typeof service.createChangeSet>) {
  const submitted = details.changeSet.status === "SUBMITTED" ? details : service.submit(details.changeSet.id, details.changeSet.revision, owner);
  const approved = service.approve(submitted.changeSet.id, submitted.changeSet.revision, owner);
  return service.publish(approved.changeSet.id, approved.changeSet.revision, owner);
}

test("M7 canonical bootstrap is atomic, idempotent, durable, and starts in LEGACY mode", () => {
  const { root, database, canonical } = fixture();
  try {
    const first = canonical.getSnapshot();
    assert.equal(first.banners.length, 5); assert.equal(first.materials.length, 8); assert.equal(first.tools.length, 5); assert.equal(first.navigation.length, 5);
    assert.deepEqual(first.materials.map((item) => item.subjectKey), ["islamic", "arabic", "english", "biology", "math", "chemistry", "physics", "french"]);
    assert.deepEqual(first.tools.map((item) => item.toolKey), ["spaced", "pomodoro", "notebook", "assistants", "lectures"]);
    assert.deepEqual(first.navigation.map((item) => item.navKey), ["home", "materials", "tools", "lectures", "settings"]);
    assert.equal(first.materialSettings.fadeIntensity, 0.72); assert.equal(first.carouselSettings.autoSlideInterval, 10_000);
    assert.equal(first.state.runtimeSourceMode, "LEGACY"); assert.equal(canonical.getPublicContent().content, null);
    canonical.bootstrap(); assert.equal(canonical.getSnapshot().banners.length, 5);
    database.close();
    const reopened = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    try { assert.equal(createCanonicalContentRepository(reopened).getSnapshot().banners.length, 5); }
    finally { reopened.close(); }
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
});

test("all canonical domains change only through reviewed publication and preserve attribution", () => {
  const { root, database, canonical, changes } = fixture();
  try {
    const snapshot = canonical.getSnapshot();
    const banner = snapshot.banners[0], material = snapshot.materials[0], tool = snapshot.tools[0], nav = snapshot.navigation[0];
    const details = changes.createChangeSet({ title: "تحديث شامل", submit: true, initialItems: [
      { resourceType: "banner", resourceId: banner.id, expectedRevision: banner.revision, desired: { ...entitySnapshot(banner as unknown as Record<string, unknown>), title: "عنوان جديد" } },
      { resourceType: "material", resourceId: material.id, expectedRevision: material.revision, desired: { ...entitySnapshot(material as unknown as Record<string, unknown>), label: "مادة محدثة" } },
      { resourceType: "materials.settings", resourceId: "global", expectedRevision: snapshot.materialSettings.revision, desired: { ...strip(snapshot.materialSettings as unknown as Record<string, unknown>, ["id", "updatedAt", "revision"]), cardHeight: 220 } },
      { resourceType: "tool", resourceId: tool.id, expectedRevision: tool.revision, desired: { ...entitySnapshot(tool as unknown as Record<string, unknown>), available: true } },
      { resourceType: "navigation", resourceId: nav.id, expectedRevision: nav.revision, desired: { ...entitySnapshot(nav as unknown as Record<string, unknown>), label: "البدء" } },
      { resourceType: "carousel.settings", resourceId: "global", expectedRevision: snapshot.carouselSettings.revision, desired: { autoSlideInterval: 12_000 } },
    ] }, admin);
    assert.equal(canonical.getSnapshot().banners[0].title, banner.title, "draft leaked into canonical state");
    const approved = changes.approve(details.changeSet.id, details.changeSet.revision, owner);
    assert.equal(canonical.getSnapshot().materials[0].label, material.label, "approval leaked before publication");
    const result = changes.publish(approved.changeSet.id, approved.changeSet.revision, owner);
    const after = canonical.getSnapshot();
    assert.equal(result.publicationRevision, 1); assert.equal(after.banners[0].title, "عنوان جديد"); assert.equal(after.materials[0].label, "مادة محدثة");
    assert.equal(after.materialSettings.cardHeight, 220); assert.equal(after.tools[0].available, true); assert.equal(after.navigation[0].label, "البدء"); assert.equal(after.carouselSettings.autoSlideInterval, 12_000);
    assert.equal(result.changeSet.changeSet.createdBy, admin.actorUserId);
  } finally { closeAndRemove(database, root); }
});

test("banner CREATE uses a stable entity ID, image Assets are validated, and the active limit is transactional", () => {
  const { root, database, canonical, changes } = fixture();
  try {
    const now = Date.now(); const assetId = uuidv7(); const hash = "a".repeat(64);
    database.db.insert(assets).values({ id: assetId, originalFilename: "صورة.png", displayName: "صورة", mimeType: "image/png", mediaKind: "image", byteSize: 8, sha256: hash, storageKey: `aa/${hash}`, width: 1, height: 1, durationMs: null, createdBy: owner.actorUserId, updatedBy: owner.actorUserId, createdAt: now, updatedAt: now, revision: 1 }).run();
    const resourceId = uuidv7();
    const created = changes.createChangeSet({ title: "بانر جديد", submit: true, initialItem: { resourceType: "banner", resourceId, expectedRevision: 0, operation: "CREATE", desired: { bannerType: "FULL", title: "سادس", subtitle: "", iconKey: "image", gradient: "linear-gradient(#111,#222)", assetId, status: "ARCHIVED", displayOrder: 6, offsetX: 0, offsetY: 0, scale: 1 } } }, admin);
    publish(changes, created); assert.equal(canonical.getSnapshot().banners.find((item) => item.id === resourceId)?.assetId, assetId);
    const sixth = canonical.getSnapshot().banners.find((item) => item.id === resourceId)!;
    const activation = changes.createChangeSet({ title: "تفعيل سادس", submit: true, initialItem: { resourceType: "banner", resourceId, expectedRevision: sixth.revision, desired: { ...entitySnapshot(sixth as unknown as Record<string, unknown>), status: "ACTIVE" } } }, admin);
    const approved = changes.approve(activation.changeSet.id, activation.changeSet.revision, owner);
    assert.throws(() => changes.publish(approved.changeSet.id, approved.changeSet.revision, owner), (error) => error instanceof ChangeManagementError && error.code === "CHANGE_VALIDATION_FAILED");
    assert.equal(canonical.getSnapshot().banners.filter((item) => item.status === "ACTIVE").length, 5);
  } finally { closeAndRemove(database, root); }
});

test("disjoint canonical edits auto-merge while same-field edits conflict", () => {
  const { root, database, canonical, changes } = fixture();
  try {
    const material = canonical.getSnapshot().materials[0]; const base = entitySnapshot(material as unknown as Record<string, unknown>);
    const label = changes.createChangeSet({ title: "اسم", submit: true, initialItem: { resourceType: "material", resourceId: material.id, expectedRevision: 1, desired: { ...base, label: "اسم أ" } } }, admin);
    const english = changes.createChangeSet({ title: "English", submit: true, initialItem: { resourceType: "material", resourceId: material.id, expectedRevision: 1, desired: { ...base, englishTitle: "UPDATED" } } }, admin);
    publish(changes, label); publish(changes, english);
    const merged = canonical.getSnapshot().materials[0]; assert.equal(merged.label, "اسم أ"); assert.equal(merged.englishTitle, "UPDATED");
    const first = changes.createChangeSet({ title: "أول", submit: true, initialItem: { resourceType: "material", resourceId: merged.id, expectedRevision: merged.revision, desired: { ...entitySnapshot(merged as unknown as Record<string, unknown>), label: "أول" } } }, admin);
    const second = changes.createChangeSet({ title: "ثان", submit: true, initialItem: { resourceType: "material", resourceId: merged.id, expectedRevision: merged.revision, desired: { ...entitySnapshot(merged as unknown as Record<string, unknown>), label: "ثان" } } }, admin);
    publish(changes, first);
    assert.throws(() => changes.approve(second.changeSet.id, second.changeSet.revision, owner), (error) => error instanceof ChangeManagementError && error.code === "CHANGE_CONFLICT");
  } finally { closeAndRemove(database, root); }
});

test("controlled OWNER publication activates canonical Student content and drafts remain invisible", () => {
  const { root, database, canonical, changes } = fixture();
  try {
    const state = canonical.getSnapshot().state;
    const cutover = changes.createChangeSet({ title: "تحويل", submit: true, initialItem: { resourceType: "platform.runtime-content", resourceId: "global", expectedRevision: state.revision, desired: { runtimeSourceMode: "CANONICAL" } } }, owner);
    assert.equal(canonical.getPublicContent().runtimeSourceMode, "LEGACY"); publish(changes, cutover);
    const publicBefore = canonical.getPublicContent(); assert.equal(publicBefore.runtimeSourceMode, "CANONICAL"); assert.equal(publicBefore.content?.banners.length, 5);
    const material = canonical.getSnapshot().materials[0];
    changes.createChangeSet({ title: "غير منشور", initialItem: { resourceType: "material", resourceId: material.id, expectedRevision: material.revision, desired: { ...entitySnapshot(material as unknown as Record<string, unknown>), label: "لن يظهر" } } }, admin);
    assert.notEqual(canonical.getPublicContent().content?.materials[0].label, "لن يظهر");
  } finally { closeAndRemove(database, root); }
});

test("0005 applies to fresh and existing 0004 databases without altering earlier migrations", () => {
  const freshRoot = temp("pythagoras-m7-fresh-"); const oldRoot = temp("pythagoras-m7-old-"); const oldMigrations = temp("pythagoras-m7-migrations-");
  try {
    const fresh = openContentDatabase({ dataDirectory: freshRoot, migrationsDirectory }); assert.equal((fresh.client.prepare("select count(*) count from __drizzle_migrations").get() as { count: number }).count, 40); fresh.close();
    mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
    for (const name of ["0000_content-foundation.sql", "0001_admin-identity.sql", "0002_assets.sql", "0003_change-management.sql", "0004_legacy-migration.sql"]) copyFileSync(path.join(migrationsDirectory, name), path.join(oldMigrations, name));
    const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8")); journal.entries = journal.entries.slice(0, 5); writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify(journal));
    const before = openContentDatabase({ dataDirectory: oldRoot, migrationsDirectory: oldMigrations }); before.close();
    const upgraded = openContentDatabase({ dataDirectory: oldRoot, migrationsDirectory }); assert.equal((upgraded.client.prepare("select count(*) count from __drizzle_migrations").get() as { count: number }).count, 40); assert.ok(upgraded.client.prepare("select name from sqlite_master where name='canonical_banners'").get()); upgraded.close();
  } finally { for (const target of [freshRoot, oldRoot, oldMigrations]) try { rmSync(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* best-effort test fixture cleanup */ } }
});

test("M7 Admin surfaces no longer import legacy product stores and remain server-backed", () => {
  for (const area of ["banners", "materials", "tools", "navigation"]) {
    const source = readFileSync(path.join(process.cwd(), "src", "app", "admin", "(protected)", area, "page.tsx"), "utf8");
    assert.equal(/admin-store|content-store|nav-store|image-db|localStorage|indexedDB/u.test(source), false);
  }
  for (const workspaceName of ["CanonicalBannersWorkspace.tsx", "CanonicalMaterialsWorkspace.tsx", "CanonicalSimpleWorkspace.tsx", "useCanonicalContentDraft.ts"]) {
    const workspace = readFileSync(path.join(process.cwd(), "src/components/admin/canonical", workspaceName), "utf8");
    assert.equal(/localStorage|indexedDB|ImageDB/u.test(workspace), false);
  }
  const picker = readFileSync(path.join(process.cwd(), "src/components/admin/library/AssetPickerDialog.tsx"), "utf8");
  assert.ok(picker.includes("تحميل المزيد"));
  const cutover = readFileSync(path.join(process.cwd(), "src/components/admin/CanonicalCutoverPanel.tsx"), "utf8");
  assert.ok(cutover.includes("معاينة Canonical"));
});
