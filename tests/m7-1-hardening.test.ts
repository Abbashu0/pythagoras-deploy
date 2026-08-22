import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { NextRequest } from "next/server";
import { v7 as uuidv7 } from "uuid";
import { POST as createCanonicalChanges } from "../src/app/api/admin/content/change-sets/route";
import { POST as createCutover } from "../src/app/api/admin/content/cutover/route";
import { GET as readPublicAsset } from "../src/app/api/content/assets/[id]/route";
import type { AdminActor, AdminAuthentication, AdminRole } from "../src/server/admin-auth/contracts";
import { createCanonicalContentRepository } from "../src/server/canonical-content/service";
import { createChangeManagementService } from "../src/server/change-management/service";
import { openContentDatabase } from "../src/server/content/database";
import { adminUsers, assets } from "../src/server/content/schema";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const owner: AdminActor = { actorUserId: "01900000-0000-7000-8000-000000000091", actorRole: "OWNER" };
const admin: AdminActor = { actorUserId: "01900000-0000-7000-8000-000000000092", actorRole: "ADMIN" };

function desired(item: Record<string, unknown>): Record<string, unknown> {
  const omitted = new Set(["id", "asset", "createdAt", "updatedAt", "revision"]);
  return Object.fromEntries(Object.entries(item).filter(([key]) => !omitted.has(key)));
}

function authentication(role: AdminRole): AdminAuthentication {
  const now = Date.now();
  return { sessionId: `session-${role}`, expiresAt: now + 60_000, user: { id: role === "OWNER" ? owner.actorUserId : admin.actorUserId, email: `${role.toLowerCase()}@m7-1.test`, displayName: role, passwordHash: "not-returned", role, enabled: true, createdAt: now, updatedAt: now, lastLoginAt: now, passwordChangedAt: now, revision: 1 } };
}

test("M7.1 public content and Asset visibility expose only Student-visible canonical records", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m7-1-public-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  try {
    const now = Date.now();
    database.db.insert(adminUsers).values([
      { id: owner.actorUserId, email: "owner@m7-1.test", displayName: "Owner", passwordHash: "fixture", role: "OWNER", enabled: true, createdAt: now, updatedAt: now, passwordChangedAt: now, revision: 1 },
      { id: admin.actorUserId, email: "admin@m7-1.test", displayName: "Admin", passwordHash: "fixture", role: "ADMIN", enabled: true, createdAt: now, updatedAt: now, passwordChangedAt: now, revision: 1 },
    ]).run();
    const assetIds = Array.from({ length: 5 }, () => uuidv7());
    database.db.insert(assets).values(assetIds.map((id, index) => {
      const sha256 = String(index + 1).repeat(64);
      return { id, originalFilename: `${index}.png`, displayName: `Asset ${index}`, mimeType: "image/png", mediaKind: "image" as const, byteSize: 8, sha256, storageKey: `${sha256.slice(0, 2)}/${sha256}`, width: 1, height: 1, durationMs: null, createdBy: owner.actorUserId, updatedBy: owner.actorUserId, createdAt: now, updatedAt: now, revision: 1 };
    })).run();
    const canonical = createCanonicalContentRepository(database);
    const changes = createChangeManagementService(database);
    const snapshot = canonical.getSnapshot();
    assert.equal(snapshot.state.runtimeSourceMode, "LEGACY");
    for (const id of assetIds) assert.equal(canonical.isStudentVisibleAsset(id), false);

    const firstBanner = snapshot.banners[0];
    const secondBanner = snapshot.banners[1];
    const firstMaterial = snapshot.materials[0];
    const secondMaterial = snapshot.materials[1];
    const firstNavigation = snapshot.navigation[0];
    const proposal = changes.createChangeSet({ title: "Public visibility", submit: true, initialItems: [
      { resourceType: "banner", resourceId: firstBanner.id, expectedRevision: firstBanner.revision, desired: { ...desired(firstBanner as unknown as Record<string, unknown>), assetId: assetIds[0], status: "ACTIVE" } },
      { resourceType: "banner", resourceId: secondBanner.id, expectedRevision: secondBanner.revision, desired: { ...desired(secondBanner as unknown as Record<string, unknown>), assetId: assetIds[1], status: "ARCHIVED" } },
      { resourceType: "material", resourceId: firstMaterial.id, expectedRevision: firstMaterial.revision, desired: { ...desired(firstMaterial as unknown as Record<string, unknown>), assetId: assetIds[2], available: true } },
      { resourceType: "material", resourceId: secondMaterial.id, expectedRevision: secondMaterial.revision, desired: { ...desired(secondMaterial as unknown as Record<string, unknown>), assetId: assetIds[3], available: false } },
      { resourceType: "navigation", resourceId: firstNavigation.id, expectedRevision: firstNavigation.revision, desired: { ...desired(firstNavigation as unknown as Record<string, unknown>), enabled: false } },
      { resourceType: "platform.runtime-content", resourceId: "global", expectedRevision: snapshot.state.revision, desired: { runtimeSourceMode: "CANONICAL" } },
    ] }, owner);
    const approved = changes.approve(proposal.changeSet.id, proposal.changeSet.revision, owner);
    changes.publish(approved.changeSet.id, approved.changeSet.revision, owner);

    assert.equal(canonical.isStudentVisibleAsset(assetIds[0]), true, "ACTIVE Banner Asset must be public");
    assert.equal(canonical.isStudentVisibleAsset(assetIds[1]), false, "ARCHIVED Banner Asset must be private");
    assert.equal(canonical.isStudentVisibleAsset(assetIds[2]), true, "available Material Asset must be public");
    assert.equal(canonical.isStudentVisibleAsset(assetIds[3]), false, "unavailable Material Asset must be private");
    assert.equal(canonical.isStudentVisibleAsset(assetIds[4]), false, "unreferenced Asset must be private");
    const publicContent = canonical.getPublicContent().content;
    assert.ok(publicContent);
    assert.equal(publicContent.materials.some((item) => !item.available), false);
    assert.equal(publicContent.navigation.some((item) => !item.enabled), false);
    assert.equal(publicContent.tools.length, snapshot.tools.length, "unavailable tools remain visible as coming soon");
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("public Asset route allows safe visible images and denies private or non-image Assets", async () => {
  const globals = globalThis as typeof globalThis & { __pythagorasCanonicalContentRepository?: unknown; __pythagorasAssetService?: unknown };
  try {
    globals.__pythagorasCanonicalContentRepository = { isStudentVisibleAsset: (id: string) => id !== "private" };
    globals.__pythagorasAssetService = { openContent: async (id: string) => ({ asset: { mimeType: id === "document" ? "application/pdf" : "image/png", byteSize: 3 }, body: new Uint8Array([1, 2, 3]) }) };
    const request = new NextRequest("http://localhost:3000/api/content/assets/visible");
    assert.equal((await readPublicAsset(request, { params: Promise.resolve({ id: "visible" }) })).status, 200);
    assert.equal((await readPublicAsset(request, { params: Promise.resolve({ id: "private" }) })).status, 404);
    assert.equal((await readPublicAsset(request, { params: Promise.resolve({ id: "document" }) })).status, 404);
  } finally {
    delete globals.__pythagorasCanonicalContentRepository;
    delete globals.__pythagorasAssetService;
  }
});

test("runtime cutover is rejected by the generic endpoint and accepted only for OWNER through the dedicated endpoint", async () => {
  const globals = globalThis as typeof globalThis & { __pythagorasAdminAuthService?: unknown; __pythagorasCanonicalContentRepository?: unknown; __pythagorasChangeManagementService?: unknown };
  const headers = { Host: "localhost:3000", Origin: "http://localhost:3000", Cookie: "pythagoras_admin_session=opaque", "Content-Type": "application/json" };
  try {
    globals.__pythagorasAdminAuthService = { authenticateSessionToken: () => authentication("ADMIN") };
    const generic = await createCanonicalChanges(new NextRequest("http://localhost:3000/api/admin/content/change-sets", { method: "POST", headers, body: JSON.stringify({ initialItems: [{ resourceType: "platform.runtime-content", resourceId: "global", expectedRevision: 1, desired: { runtimeSourceMode: "CANONICAL" } }] }) }));
    assert.equal(generic.status, 403);
    assert.equal((await createCutover(new NextRequest("http://localhost:3000/api/admin/content/cutover", { method: "POST", headers }))).status, 403);

    globals.__pythagorasAdminAuthService = { authenticateSessionToken: () => authentication("OWNER") };
    globals.__pythagorasCanonicalContentRepository = { getSnapshot: () => ({ state: { runtimeSourceMode: "LEGACY", revision: 4 } }) };
    let actorSeen: AdminActor | null = null;
    globals.__pythagorasChangeManagementService = { createChangeSet: (_input: unknown, actorValue: AdminActor) => { actorSeen = actorValue; return { changeSet: { id: "cutover-change" } }; } };
    const ownerResponse = await createCutover(new NextRequest("http://localhost:3000/api/admin/content/cutover", { method: "POST", headers }));
    assert.equal(ownerResponse.status, 201);
    assert.deepEqual(actorSeen, owner);
  } finally {
    delete globals.__pythagorasAdminAuthService;
    delete globals.__pythagorasCanonicalContentRepository;
    delete globals.__pythagorasChangeManagementService;
  }
});

test("specialized canonical editors do not restore browser persistence or direct upload paths", () => {
  const files = [
    "src/components/admin/canonical/CanonicalBannersWorkspace.tsx",
    "src/components/admin/canonical/CanonicalMaterialsWorkspace.tsx",
    "src/components/admin/canonical/CanonicalSimpleWorkspace.tsx",
    "src/components/admin/canonical/useCanonicalContentDraft.ts",
    ...["banners", "materials", "tools", "navigation"].map((area) => `src/app/admin/(protected)/${area}/page.tsx`),
  ];
  const source = files.map((file) => readFileSync(path.join(process.cwd(), file), "utf8")).join("\n");
  assert.equal(/localStorage|sessionStorage|indexedDB|ImageDB|image-db|AdminStore|ContentStore|NavStore|UploadArea/u.test(source), false);
  assert.ok(source.includes("AssetPickerDialog"));
  assert.ok(source.includes("ImagePositioner"));
  assert.ok(source.includes("LiveCarouselPreview"));
  assert.ok(source.includes("MaterialCardPreview"));
  assert.ok(source.includes("/api/admin/content/change-sets"));
});

test("Student image rendering accepts canonical public Asset URLs without allowing active-content schemes", async () => {
  const dataModuleUrl = pathToFileURL(path.join(process.cwd(), "public/pythagoras/src/scripts/data.js")).href;
  const { isDisplayableImageSource } = await import(dataModuleUrl) as { isDisplayableImageSource: (value: unknown) => boolean };
  assert.equal(isDisplayableImageSource("/api/content/assets/01a02b8f-c243-705f-9a3d-cfcfa00f80b5"), true);
  assert.equal(isDisplayableImageSource("data:image/png;base64,AA=="), true);
  assert.equal(isDisplayableImageSource("https://example.test/image.png"), true);
  assert.equal(isDisplayableImageSource("/api/content/assets/not-a-valid-id"), false);
  assert.equal(isDisplayableImageSource("linear-gradient(red, blue)"), false);
  assert.equal(isDisplayableImageSource("javascript:alert(1)"), false);
  assert.equal(isDisplayableImageSource("data:text/html,<script>alert(1)</script>"), false);
  const materials = readFileSync(path.join(process.cwd(), "public/pythagoras/src/pages/MaterialsPage.js"), "utf8");
  const carousel = readFileSync(path.join(process.cwd(), "public/pythagoras/src/components/SponsoredCarouselCard.js"), "utf8");
  assert.ok(materials.includes("isDisplayableImageSource(subject.image)"));
  assert.ok(carousel.includes("isDisplayableImageSource(slide.image)"));
});
