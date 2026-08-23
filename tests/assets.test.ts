import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { v7 as uuidv7 } from "uuid";
import { createAdminAuthService, type AdminActor } from "../src/server/admin-auth/index";
import {
  AssetConflictError,
  AssetTooLargeError,
  AssetUnsupportedTypeError,
  AssetService,
  LocalFileAssetStorage,
  SQLiteAssetRepository,
} from "../src/server/assets/index";
import {
  getContentDatabase,
  getContentDatabaseStatus,
  openContentDatabase,
  type ContentDatabase,
} from "../src/server/content/index";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { GET as listAssets, POST as uploadAsset } from "../src/app/api/admin/assets/route";
import { GET as readAssetContent } from "../src/app/api/admin/assets/[id]/content/route";

const migrationsDirectory = path.join(process.cwd(), "drizzle");

function createTemporaryDirectory(prefix = "pythagoras-assets-test-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function listFilesRecursively(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((entry) => {
    const item = path.join(root, entry);
    return statSync(item).isDirectory() ? listFilesRecursively(item) : [item];
  });
}

interface AssetFixture {
  root: string;
  database: ContentDatabase;
  storage: LocalFileAssetStorage;
  repository: SQLiteAssetRepository;
  service: AssetService;
  owner: AdminActor;
  admin: AdminActor;
  stage(bytes: Uint8Array, filename?: string): string;
  close(): void;
}

function createAssetFixture(maximumAssetBytes = 1024 * 1024): AssetFixture {
  const root = createTemporaryDirectory();
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const identities = new SQLiteAdminIdentityRepository(database);
  const now = 1_900_000_000_000;
  const ownerUser = identities.createInitialOwner({
    id: uuidv7(),
    email: "asset-owner@example.test",
    displayName: "Asset Owner",
    passwordHash: "$argon2id$test-only-hash",
    createdAt: now,
  });
  const adminUser = identities.createAdmin({
    id: uuidv7(),
    email: "asset-admin@example.test",
    displayName: "Asset Admin",
    passwordHash: "$argon2id$test-only-hash",
    createdAt: now + 1,
  });
  const storage = new LocalFileAssetStorage(database.paths.objectStorageDirectory);
  const repository = new SQLiteAssetRepository(database, () => now + 2);
  const service = new AssetService(repository, storage, {
    maximumAssetBytes,
    stagingDirectory: database.paths.tempDirectory,
  });
  let stagedFileIndex = 0;

  return {
    root,
    database,
    storage,
    repository,
    service,
    owner: { actorUserId: ownerUser.id, actorRole: "OWNER" },
    admin: { actorUserId: adminUser.id, actorRole: "ADMIN" },
    stage(bytes, filename = "staged.upload") {
      const directory = path.join(database.paths.tempDirectory, "tests");
      mkdirSync(directory, { recursive: true });
      const filePath = path.join(directory, `${stagedFileIndex++}-${filename}`);
      writeFileSync(filePath, bytes);
      return filePath;
    },
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("content-addressed storage is atomic, idempotent, and safe under concurrent identical puts", async () => {
  const root = createTemporaryDirectory("pythagoras-object-store-");
  const storage = new LocalFileAssetStorage(root);
  const bytes = randomBytes(64 * 1024);
  try {
    const [first, second] = await Promise.all([storage.put(bytes), storage.put(bytes)]);
    const expectedHash = createHash("sha256").update(bytes).digest("hex");
    assert.equal(first.sha256, expectedHash);
    assert.equal(second.sha256, expectedHash);
    assert.equal(first.storageKey, `${expectedHash.slice(0, 2)}/${expectedHash}`);
    assert.equal(second.storageKey, first.storageKey);
    assert.equal(Number(first.created) + Number(second.created), 1);
    assert.deepEqual(await storage.read(first.storageKey), bytes);
    assert.equal(listFilesRecursively(root).length, 1);
    assert.equal(
      path.resolve(root, ...first.storageKey.split("/")),
      listFilesRecursively(root)[0],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("asset metadata and bytes persist, identical uploads reuse one logical and physical asset", async () => {
  const fixture = createAssetFixture();
  const bytes = Buffer.from("persistent asset bytes", "utf8");
  try {
    const first = await fixture.service.ingest(
      {
        filePath: fixture.stage(bytes),
        originalFilename: "../../درس عربي.txt",
      },
      fixture.owner,
    );
    const duplicate = await fixture.service.ingest(
      {
        filePath: fixture.stage(bytes),
        originalFilename: "different-name.txt",
      },
      fixture.admin,
    );

    assert.equal(first.reused, false);
    assert.equal(duplicate.reused, true);
    assert.equal(duplicate.asset.id, first.asset.id);
    assert.equal(first.asset.originalFilename, "درس عربي.txt");
    assert.equal(first.asset.createdBy, fixture.owner.actorUserId);
    assert.equal(fixture.repository.list().length, 1);
    assert.equal(listFilesRecursively(fixture.database.paths.objectStorageDirectory).length, 1);
    assert.equal(
      path.resolve(
        fixture.database.paths.objectStorageDirectory,
        ...first.asset.storageKey.split("/"),
      ).startsWith(path.resolve(fixture.database.paths.objectStorageDirectory)),
      true,
    );

    fixture.database.client.pragma("wal_checkpoint(TRUNCATE)");
    const databaseBytes = readFileSync(fixture.database.paths.databaseFile);
    assert.equal(databaseBytes.includes(bytes), false, "binary bytes leaked into SQLite");

    fixture.database.close();
    const reopened = openContentDatabase({
      dataDirectory: fixture.root,
      migrationsDirectory,
    });
    try {
      const restarted = new AssetService(
        new SQLiteAssetRepository(reopened),
        new LocalFileAssetStorage(reopened.paths.objectStorageDirectory),
        { maximumAssetBytes: 1024 * 1024, stagingDirectory: reopened.paths.tempDirectory },
      );
      const persisted = restarted.getById(first.asset.id);
      assert.equal(persisted.originalFilename, "درس عربي.txt");
      assert.deepEqual(
        await new LocalFileAssetStorage(reopened.paths.objectStorageDirectory).read(
          persisted.storageKey,
        ),
        bytes,
      );
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("OWNER and ADMIN attribution, Unicode metadata, image dimensions, and optimistic revisions work", async () => {
  const fixture = createAssetFixture();
  try {
    const png = await sharp({
      create: { width: 11, height: 7, channels: 4, background: "#2468ff" },
    })
      .png()
      .toBuffer();
    const image = await fixture.service.ingest(
      {
        filePath: fixture.stage(png, "image.upload"),
        originalFilename: "صورة المادة.png",
        displayName: "غلاف المادة",
      },
      fixture.owner,
    );
    const adminAsset = await fixture.service.ingest(
      {
        filePath: fixture.stage(Buffer.from("admin asset")),
        originalFilename: "ملف الإدارة.txt",
      },
      fixture.admin,
    );

    assert.equal(image.asset.createdBy, fixture.owner.actorUserId);
    assert.match(
      image.asset.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    assert.equal(image.asset.width, 11);
    assert.equal(image.asset.height, 7);
    assert.equal(image.asset.mimeType, "image/png");
    assert.equal(image.asset.displayName, "غلاف المادة");
    assert.equal(adminAsset.asset.createdBy, fixture.admin.actorUserId);

    const updated = fixture.service.updateDisplayName(
      image.asset.id,
      "غلاف محدّث",
      1,
      fixture.admin,
    );
    assert.equal(updated.revision, 2);
    assert.equal(updated.updatedBy, fixture.admin.actorUserId);
    assert.throws(
      () =>
        fixture.service.updateDisplayName(
          image.asset.id,
          "كتابة قديمة",
          1,
          fixture.owner,
        ),
      AssetConflictError,
    );
  } finally {
    fixture.close();
  }
});

test("dangerous active content and oversized input are rejected without orphan objects", async () => {
  const fixture = createAssetFixture(64);
  try {
    await assert.rejects(
      fixture.service.ingest(
        {
          filePath: fixture.stage(Buffer.from("<svg><script>alert(1)</script></svg>")),
          originalFilename: "renamed.txt",
        },
        fixture.owner,
      ),
      AssetUnsupportedTypeError,
    );
    await assert.rejects(
      fixture.service.ingest(
        {
          filePath: fixture.stage(Buffer.from("x".repeat(65))),
          originalFilename: "large.txt",
        },
        fixture.owner,
      ),
      AssetTooLargeError,
    );
    assert.equal(fixture.repository.list().length, 0);
    assert.equal(listFilesRecursively(fixture.database.paths.objectStorageDirectory).length, 0);
  } finally {
    fixture.close();
  }
});

test("metadata insertion failure compensates only objects created by that ingestion", async () => {
  const fixture = createAssetFixture();
  const invalidActor: AdminActor = {
    actorUserId: uuidv7(),
    actorRole: "ADMIN",
  };
  const newBytes = Buffer.from("new object must be compensated");
  const existingBytes = Buffer.from("pre-existing object must survive");
  try {
    await assert.rejects(
      fixture.service.ingest(
        {
          filePath: fixture.stage(newBytes),
          originalFilename: "new.txt",
        },
        invalidActor,
      ),
    );
    assert.equal(listFilesRecursively(fixture.database.paths.objectStorageDirectory).length, 0);

    const preExisting = await fixture.storage.put(existingBytes);
    assert.equal(preExisting.created, true);
    await assert.rejects(
      fixture.service.ingest(
        {
          filePath: fixture.stage(existingBytes),
          originalFilename: "existing.txt",
        },
        invalidActor,
      ),
    );
    assert.equal(await fixture.storage.exists(preExisting.storageKey), true);
    assert.deepEqual(await fixture.storage.read(preExisting.storageKey), existingBytes);
    assert.equal(fixture.repository.list().length, 0);
  } finally {
    fixture.close();
  }
});

test("integrity verification detects missing, wrong-size, and same-size hash tampering", async () => {
  const fixture = createAssetFixture();
  try {
    const missingAsset = await fixture.service.ingest(
      {
        filePath: fixture.stage(Buffer.from("missing object")),
        originalFilename: "missing.txt",
      },
      fixture.owner,
    );
    await fixture.storage.delete(missingAsset.asset.storageKey);
    assert.equal((await fixture.service.verifyIntegrity(missingAsset.asset)).status, "missing");

    const tamperedAsset = await fixture.service.ingest(
      {
        filePath: fixture.stage(Buffer.from("original bytes")),
        originalFilename: "tampered.txt",
      },
      fixture.owner,
    );
    const objectPath = path.join(
      fixture.database.paths.objectStorageDirectory,
      ...tamperedAsset.asset.storageKey.split("/"),
    );
    writeFileSync(objectPath, Buffer.from("short"));
    assert.equal(
      (await fixture.service.verifyIntegrity(tamperedAsset.asset)).status,
      "size-mismatch",
    );
    writeFileSync(objectPath, Buffer.from("x".repeat(tamperedAsset.asset.byteSize)));
    assert.equal(
      (await fixture.service.verifyIntegrity(tamperedAsset.asset)).status,
      "hash-mismatch",
    );
  } finally {
    fixture.close();
  }
});

test("migration 0002 applies to fresh databases and upgrades an existing M2 database", () => {
  const freshRoot = createTemporaryDirectory("pythagoras-assets-fresh-");
  const upgradeRoot = createTemporaryDirectory("pythagoras-assets-upgrade-");
  const m2Migrations = createTemporaryDirectory("pythagoras-m2-migrations-");
  try {
    const fresh = openContentDatabase({ dataDirectory: freshRoot, migrationsDirectory });
    assert.equal(getContentDatabaseStatus(fresh).migrationsApplied, 7);
    assert.ok(
      fresh.client.prepare("select name from sqlite_master where name = 'assets'").get(),
    );
    fresh.close();

    mkdirSync(path.join(m2Migrations, "meta"), { recursive: true });
    for (const migration of ["0000_content-foundation.sql", "0001_admin-identity.sql"]) {
      copyFileSync(
        path.join(migrationsDirectory, migration),
        path.join(m2Migrations, migration),
      );
    }
    writeFileSync(
      path.join(m2Migrations, "meta", "_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "sqlite",
        entries: [
          {
            idx: 0,
            version: "6",
            when: 1_787_406_399_690,
            tag: "0000_content-foundation",
            breakpoints: true,
          },
          {
            idx: 1,
            version: "6",
            when: 1_787_408_709_277,
            tag: "0001_admin-identity",
            breakpoints: true,
          },
        ],
      }),
    );
    const m2Database = openContentDatabase({
      dataDirectory: upgradeRoot,
      migrationsDirectory: m2Migrations,
    });
    assert.equal(getContentDatabaseStatus(m2Database).migrationsApplied, 2);
    m2Database.close();

    const upgraded = openContentDatabase({ dataDirectory: upgradeRoot, migrationsDirectory });
    assert.equal(getContentDatabaseStatus(upgraded).migrationsApplied, 7);
    assert.ok(
      upgraded.client.prepare("select name from sqlite_master where name = 'assets'").get(),
    );
    upgraded.close();
  } finally {
    rmSync(freshRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    rmSync(upgradeRoot, { recursive: true, force: true });
    rmSync(m2Migrations, { recursive: true, force: true });
  }
});

test("Admin Asset API requires a session, rejects cross-origin mutation, and streams authenticated content", async () => {
  const apiRoot = createTemporaryDirectory("pythagoras-assets-api-");
  const previousDataDirectory = process.env.PYTHAGORAS_DATA_DIR;
  process.env.PYTHAGORAS_DATA_DIR = apiRoot;
  const globals = globalThis as typeof globalThis & {
    __pythagorasAdminAuthService?: unknown;
    __pythagorasAssetService?: unknown;
    __pythagorasContentDatabase?: ContentDatabase;
  };

  try {
    const unauthenticated = await listAssets(
      new NextRequest("http://localhost:3000/api/admin/assets"),
    );
    assert.equal(unauthenticated.status, 401);

    const database = getContentDatabase();
    const auth = createAdminAuthService(database);
    const ownerSession = await auth.setupInitialOwner({
      displayName: "API Owner",
      email: "api-owner@example.test",
      password: randomBytes(32).toString("base64url"),
    });
    const cookie = `pythagoras_admin_session=${ownerSession.rawToken}`;

    const rejected = await uploadAsset(
      new NextRequest("http://localhost:3000/api/admin/assets", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Host: "localhost:3000",
          Origin: "https://evil.example",
        },
      }),
    );
    assert.equal(rejected.status, 403);

    const bytes = Buffer.from("asset API streaming body", "utf8");
    const form = new FormData();
    form.set("file", new File([bytes], "واجهة عربية.txt", { type: "text/html" }));
    form.set("displayName", "API Asset");
    const uploaded = await uploadAsset(
      new NextRequest("http://localhost:3000/api/admin/assets", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Host: "localhost:3000",
          Origin: "http://localhost:3000",
          "Sec-Fetch-Site": "same-origin",
        },
        body: form,
      }),
    );
    assert.equal(uploaded.status, 201);
    const uploadBody = (await uploaded.json()) as {
      asset: { id: string; createdBy: string; storageKey?: string; mimeType: string };
    };
    assert.equal(uploadBody.asset.createdBy, ownerSession.authentication.user.id);
    assert.equal(uploadBody.asset.storageKey, undefined);
    assert.equal(uploadBody.asset.mimeType, "text/plain; charset=utf-8");

    const content = await readAssetContent(
      new NextRequest(
        `http://localhost:3000/api/admin/assets/${uploadBody.asset.id}/content`,
        { headers: { Cookie: cookie } },
      ),
      { params: Promise.resolve({ id: uploadBody.asset.id }) },
    );
    assert.equal(content.status, 200);
    assert.equal(content.headers.get("x-content-type-options"), "nosniff");
    assert.match(content.headers.get("content-disposition") ?? "", /^attachment;/u);
    assert.deepEqual(Buffer.from(await content.arrayBuffer()), bytes);
  } finally {
    globals.__pythagorasContentDatabase?.close();
    delete globals.__pythagorasAdminAuthService;
    delete globals.__pythagorasAssetService;
    delete globals.__pythagorasContentDatabase;
    if (previousDataDirectory === undefined) delete process.env.PYTHAGORAS_DATA_DIR;
    else process.env.PYTHAGORAS_DATA_DIR = previousDataDirectory;
    rmSync(apiRoot, { recursive: true, force: true });
  }
});
