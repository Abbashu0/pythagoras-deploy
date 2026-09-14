import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { v7 as uuidv7 } from "uuid";
import {
  AdminUntrustedOriginError,
  assertLocalAdminRequest,
  assertTrustedLocalAdminMutationRequest,
  getLocalAdminActor,
  type AdminActor,
} from "../src/server/admin-auth";
import {
  CanonicalContentError,
  createCanonicalContentRepository,
  createDirectBannerService,
  createDirectCarouselSettingsService,
} from "../src/server/canonical-content";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import { adminUsers, assets } from "../src/server/content/schema";
import {
  AssetService,
  LocalFileAssetStorage,
  SQLiteAssetRepository,
} from "../src/server/assets";
import { toLocalAdminAssetView } from "../src/server/assets/admin-view";

const migrationsDirectory = path.join(process.cwd(), "drizzle");

function temporaryDirectory(prefix = "pythagoras-admin-pages-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fixture() {
  const root = temporaryDirectory();
  const database = openContentDatabase({
    dataDirectory: root,
    migrationsDirectory,
  });
  const actor: AdminActor = {
    actorUserId: "01900000-0000-7000-8000-000000000001",
    actorRole: "OWNER",
  };
  const now = 1_900_000_000_000;
  database.db
    .insert(adminUsers)
    .values({
      id: actor.actorUserId,
      email: "admin-pages-owner@example.test",
      displayName: "Admin Pages Owner",
      passwordHash: "$argon2id$test-only-hash",
      role: "OWNER",
      enabled: true,
      createdAt: now,
      updatedAt: now,
      passwordChangedAt: now,
      revision: 1,
    })
    .run();

  return {
    root,
    database,
    actor,
    now,
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
    },
  };
}

function addAsset(
  database: ContentDatabase,
  actor: AdminActor,
  input: { id?: string; mimeType: string; mediaKind: "image" | "other-safe-file" },
): string {
  const id = input.id ?? uuidv7();
  const hash = id.replaceAll("-", "").padEnd(64, "0").slice(0, 64);
  database.db
    .insert(assets)
    .values({
      id,
      originalFilename: input.mediaKind === "image" ? "banner.png" : "notes.txt",
      displayName: input.mediaKind === "image" ? "Banner image" : "Notes",
      mimeType: input.mimeType,
      mediaKind: input.mediaKind,
      byteSize: 8,
      sha256: hash,
      storageKey: `${hash.slice(0, 2)}/${hash}`,
      width: input.mediaKind === "image" ? 4 : null,
      height: input.mediaKind === "image" ? 2 : null,
      durationMs: null,
      createdBy: actor.actorUserId,
      updatedBy: actor.actorUserId,
      createdAt: 1_900_000_000_001,
      updatedAt: 1_900_000_000_001,
      revision: 1,
    })
    .run();
  return id;
}

function insertRawBanner(
  database: ContentDatabase,
  id: string,
  assetId: string | null,
  startsAt: number | null,
  endsAt: number | null,
): void {
  database.client
    .prepare(
      `insert into canonical_banners
        (id, banner_type, title, subtitle, icon_key, gradient, asset_id, status,
         display_order, offset_x, offset_y, scale, starts_at, ends_at,
         created_at, updated_at, updated_by, revision)
       values (?, 'FULL', '', '', 'image', 'linear-gradient(#111,#222)', ?,
               'ACTIVE', 0, 0, 0, 1, ?, ?, 1900000000002, 1900000000002, null, 1)`,
    )
    .run(id, assetId, startsAt, endsAt);
}

test("fresh Admin content runtime has no seeded banners and direct banner lifecycle is real", () => {
  const state = fixture();
  try {
    const canonical = createCanonicalContentRepository(state.database);
    assert.equal(canonical.getSnapshot().banners.length, 0);
    assert.equal(canonical.getSnapshot().materials.length, 8);

    const imageId = addAsset(state.database, state.actor, {
      mimeType: "image/png",
      mediaKind: "image",
    });
    const banners = createDirectBannerService(state.database);
    const created = banners.create(
      {
        title: "واجهة الصيف",
        assetId: imageId,
        offsetX: 12,
        offsetY: -4,
        scale: 1.2,
        enabled: true,
      },
      state.actor,
    );

    assert.equal(created.bannerType, "FULL");
    assert.equal(created.title, "واجهة الصيف");
    assert.equal(created.offsetX, 12);
    assert.equal(created.offsetY, -4);
    assert.equal(created.scale, 1.2);
    assert.equal(created.subtitle, "");
    assert.equal(canonical.getPublicContent().content?.banners.length, 1);

    const updated = banners.update(
      created.id,
      { title: "واجهة محدثة", enabled: false },
      created.revision,
      state.actor,
    );
    assert.equal(updated.id, created.id);
    assert.equal(updated.revision, created.revision + 1);
    assert.equal(updated.status, "ARCHIVED");
    assert.throws(
      () => banners.update(created.id, { title: "تعديل قديم" }, created.revision, state.actor),
      (error) => error instanceof CanonicalContentError && error.code === "CANONICAL_CONFLICT",
    );

    banners.delete(created.id, updated.revision, state.actor);
    assert.equal(banners.list().length, 0);
    assert.equal(canonical.getPublicContent().content?.banners.length, 0);
  } finally {
    state.close();
  }
});

test("banner scheduling excludes out-of-window rows and enforces image/schedule SQL boundaries", () => {
  const state = fixture();
  try {
    const imageId = addAsset(state.database, state.actor, {
      mimeType: "image/png",
      mediaKind: "image",
    });
    const textId = addAsset(state.database, state.actor, {
      mimeType: "text/plain; charset=utf-8",
      mediaKind: "other-safe-file",
    });
    const banners = createDirectBannerService(state.database);
    const now = Date.now();

    for (let index = 0; index < 4; index += 1) {
      banners.create({ assetId: imageId, title: `حالٍ ${index}` }, state.actor);
    }
    banners.create(
      {
        assetId: imageId,
        title: "لاحقًا",
        startsAt: now + 60 * 60 * 1000,
        endsAt: now + 2 * 60 * 60 * 1000,
      },
      state.actor,
    );
    banners.create(
      {
        assetId: imageId,
        title: "منتهٍ",
        startsAt: now - 2 * 60 * 60 * 1000,
        endsAt: now - 60 * 60 * 1000,
      },
      state.actor,
    );
    assert.equal(banners.list().length, 6);
    assert.equal(state.database.db.select().from(assets).all().length, 2);
    assert.equal(createCanonicalContentRepository(state.database).getPublicContent().content?.banners.length, 4);

    assert.throws(
      () => banners.create({ assetId: textId }, state.actor),
      (error) => error instanceof CanonicalContentError && error.code === "CANONICAL_VALIDATION_FAILED",
    );
    assert.throws(
      () => insertRawBanner(state.database, uuidv7(), imageId, 10, 10),
      /Canonical banner schedule is invalid/u,
    );
    assert.throws(
      () => insertRawBanner(state.database, uuidv7(), textId, null, null),
      /validated image Asset/u,
    );
  } finally {
    state.close();
  }
});

test("local Admin asset DTO is safe and AssetService retains real content-addressed behavior", async () => {
  const state = fixture();
  try {
    const storage = new LocalFileAssetStorage(state.database.paths.objectStorageDirectory);
    const service = new AssetService(
      new SQLiteAssetRepository(state.database),
      storage,
      { stagingDirectory: state.database.paths.tempDirectory },
    );
    const stageDirectory = path.join(state.database.paths.tempDirectory, "admin-pages");
    mkdirSync(stageDirectory, { recursive: true });
    const source = path.join(stageDirectory, "banner.png");
    const bytes = await sharp({
      create: { width: 20, height: 8, channels: 4, background: "#2468ff" },
    })
      .png()
      .toBuffer();
    writeFileSync(source, bytes);

    const result = await service.ingest(
      { filePath: source, originalFilename: "banner.png", displayName: "واجهة" },
      state.actor,
    );
    const view = await toLocalAdminAssetView(
      state.database,
      service,
      service.getByIdWithCreator(result.asset.id),
    );
    assert.equal(view.id, result.asset.id);
    assert.equal(view.previewUrl, `/api/admin/local/assets/${encodeURIComponent(result.asset.id)}/content`);
    assert.equal(view.integrity, "ok");
    assert.equal(view.width, 20);
    assert.equal(view.height, 8);
    assert.equal(view.references.length, 0);
    assert.equal("storageKey" in view, false, "the safe DTO must not expose a storage key");

    const deleted = await service.delete(result.asset.id, result.asset.revision, state.actor);
    assert.equal(deleted.storageCleanup, "complete");
    assert.equal(existsSync(path.join(state.database.paths.objectStorageDirectory, ...result.asset.storageKey.split("/"))), false);
  } finally {
    state.close();
  }
});

test("local Admin APIs are loopback-only and use an attribution-only disabled operator", () => {
  const state = fixture();
  try {
    const localRead = new Request("http://localhost:3000/api/admin/local/assets", {
      headers: { host: "localhost:3000" },
    });
    assert.doesNotThrow(() => assertLocalAdminRequest(localRead));
    assert.throws(
      () =>
        assertLocalAdminRequest(
          new Request("http://example.test/api/admin/local/assets", {
            headers: { host: "example.test" },
          }),
        ),
      AdminUntrustedOriginError,
    );

    const trustedMutation = new Request("http://localhost:3000/api/admin/local/assets", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
      },
    });
    assert.doesNotThrow(() => assertTrustedLocalAdminMutationRequest(trustedMutation));
    assert.throws(
      () =>
        assertTrustedLocalAdminMutationRequest(
          new Request("http://example.test/api/admin/local/assets", {
            method: "POST",
            headers: { host: "example.test", origin: "https://example.test" },
          }),
        ),
      AdminUntrustedOriginError,
    );

    const actor = getLocalAdminActor(state.database);
    assert.equal(actor.actorUserId, "local-admin-operator");
    assert.equal(actor.actorRole, "ADMIN");
    const row = state.database.client
      .prepare("select enabled from admin_users where id = ?")
      .get(actor.actorUserId) as { enabled: number };
    assert.equal(row.enabled, 0);
  } finally {
    state.close();
  }
});

test("carousel interval uses the canonical setting, optimistic revision, and public API", () => {
  const state = fixture();
  try {
    const canonical = createCanonicalContentRepository(state.database);
    const carousel = createDirectCarouselSettingsService(state.database);
    const initial = carousel.get();
    assert.equal(initial.autoSlideInterval, 10_000);

    const fiveSeconds = carousel.update(
      { autoSlideInterval: 5_000 },
      initial.revision,
      state.actor,
    );
    assert.equal(fiveSeconds.autoSlideInterval, 5_000);
    assert.equal(fiveSeconds.revision, initial.revision + 1);
    assert.equal(canonical.getSnapshot().carouselSettings.autoSlideInterval, 5_000);
    assert.equal(canonical.getPublicContent().content?.carouselSettings.autoSlideInterval, 5_000);

    const thirtySeconds = createDirectCarouselSettingsService(state.database).update(
      { autoSlideInterval: 30_000 },
      fiveSeconds.revision,
      state.actor,
    );
    assert.equal(thirtySeconds.autoSlideInterval, 30_000);
    assert.equal(
      createDirectCarouselSettingsService(state.database).get().autoSlideInterval,
      30_000,
    );
    assert.equal(canonical.getPublicContent().content?.carouselSettings.autoSlideInterval, 30_000);

    assert.throws(
      () => carousel.update({ autoSlideInterval: 15_000 }, initial.revision, state.actor),
      (error) => error instanceof CanonicalContentError && error.code === "CANONICAL_CONFLICT",
    );
    assert.throws(
      () => carousel.update({ autoSlideInterval: 4_000 }, thirtySeconds.revision, state.actor),
      (error) => error instanceof CanonicalContentError && error.code === "CANONICAL_VALIDATION_FAILED",
    );
  } finally {
    state.close();
  }
});
