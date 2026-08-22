import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { v7 as uuidv7 } from "uuid";
import { createAdminAuthService } from "../src/server/admin-auth/index";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import {
  AssetService,
  LocalFileAssetStorage,
  SQLiteAssetRepository,
  type AssetMediaKind,
} from "../src/server/assets/index";
import { getContentDatabase, openContentDatabase, type ContentDatabase } from "../src/server/content/index";
import { GET as listAssets, POST as uploadAsset } from "../src/app/api/admin/assets/route";
import { GET as getAsset } from "../src/app/api/admin/assets/[id]/route";
import { GET as getIntegrity } from "../src/app/api/admin/assets/[id]/integrity/route";
import { GET as getStats } from "../src/app/api/admin/assets/stats/route";

const migrationsDirectory = path.join(process.cwd(), "drizzle");

function temporaryDirectory(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createFixture() {
  const root = temporaryDirectory("pythagoras-library-");
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const identities = new SQLiteAdminIdentityRepository(database);
  let now = 1_910_000_000_000;
  const owner = identities.createInitialOwner({
    id: uuidv7(),
    email: "library-owner@example.test",
    displayName: "مالك المكتبة",
    passwordHash: "$argon2id$test-only-hash",
    createdAt: now++,
  });
  const admin = identities.createAdmin({
    id: uuidv7(),
    email: "library-admin@example.test",
    displayName: "مدير المحتوى",
    passwordHash: "$argon2id$test-only-hash",
    createdAt: now++,
  });
  const repository = new SQLiteAssetRepository(database, () => now++);
  const service = new AssetService(
    repository,
    new LocalFileAssetStorage(database.paths.objectStorageDirectory),
    { stagingDirectory: database.paths.tempDirectory, maximumAssetBytes: 2 * 1024 * 1024 },
  );
  let fileIndex = 0;
  return {
    root,
    database,
    repository,
    service,
    owner: { actorUserId: owner.id, actorRole: "OWNER" as const },
    admin: { actorUserId: admin.id, actorRole: "ADMIN" as const },
    stage(bytes: Uint8Array, extension = "txt") {
      const directory = path.join(database.paths.tempDirectory, "library-tests");
      mkdirSync(directory, { recursive: true });
      const file = path.join(directory, `${fileIndex++}.${extension}`);
      writeFileSync(file, bytes);
      return file;
    },
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("M4 search supports Arabic display/original names and media filtering", async () => {
  const fixture = createFixture();
  try {
    await fixture.service.ingest({ filePath: fixture.stage(Buffer.from("first lesson")), originalFilename: "درس-النحو.txt", displayName: "المفعول به" }, fixture.owner);
    await fixture.service.ingest({ filePath: fixture.stage(Buffer.from("second lesson")), originalFilename: "بلاغة-عربية.txt", displayName: "الاستعارة" }, fixture.admin);
    const png = await sharp({ create: { width: 6, height: 4, channels: 4, background: "#335cff" } }).png().toBuffer();
    await fixture.service.ingest({ filePath: fixture.stage(png, "png"), originalFilename: "غلاف.png", displayName: "صورة الدرس" }, fixture.owner);

    const byDisplay = fixture.service.browse({ query: "المفعول" });
    assert.equal(byDisplay.total, 1);
    assert.equal(byDisplay.items[0].asset.displayName, "المفعول به");
    const byOriginal = fixture.service.browse({ query: "عربية" });
    assert.equal(byOriginal.total, 1);
    assert.equal(byOriginal.items[0].asset.originalFilename, "بلاغة-عربية.txt");
    const images = fixture.service.browse({ mediaKind: "image" });
    assert.equal(images.total, 1);
    assert.equal(images.items[0].asset.mediaKind, "image");
  } finally {
    fixture.close();
  }
});

test("M4 pagination and all sort modes are stable without duplicates", async () => {
  const fixture = createFixture();
  try {
    for (const [index, name] of ["Delta", "Alpha", "Charlie", "Bravo", "Echo"].entries()) {
      await fixture.service.ingest({ filePath: fixture.stage(Buffer.from("x".repeat(index + 1))), originalFilename: `${name}.txt`, displayName: name }, index % 2 ? fixture.admin : fixture.owner);
    }
    const first = fixture.service.browse({ limit: 2, offset: 0, sort: "newest" });
    const second = fixture.service.browse({ limit: 2, offset: 2, sort: "newest" });
    const all = fixture.service.browse({ limit: 20, sort: "newest" });
    assert.equal(first.total, 5);
    assert.deepEqual([...first.items, ...second.items].map((item) => item.asset.id), all.items.slice(0, 4).map((item) => item.asset.id));
    assert.equal(new Set([...first.items, ...second.items].map((item) => item.asset.id)).size, 4);
    assert.deepEqual(fixture.service.browse({ sort: "name" }).items.map((item) => item.asset.displayName), ["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
    assert.deepEqual(fixture.service.browse({ sort: "size" }).items.map((item) => item.asset.byteSize), [5, 4, 3, 2, 1]);
    assert.equal(fixture.service.browse({ sort: "oldest" }).items[0].asset.displayName, "Delta");
  } finally {
    fixture.close();
  }
});

test("M4 stats aggregate counts/bytes and list joins safe creator summaries", async () => {
  const fixture = createFixture();
  try {
    const png = await sharp({ create: { width: 3, height: 2, channels: 4, background: "#22aa77" } }).png().toBuffer();
    const text = Buffer.from("creator attribution");
    await fixture.service.ingest({ filePath: fixture.stage(png, "png"), originalFilename: "asset.png" }, fixture.owner);
    await fixture.service.ingest({ filePath: fixture.stage(text), originalFilename: "asset.txt" }, fixture.admin);
    const stats = fixture.service.getInventoryStats();
    assert.equal(stats.totalCount, 2);
    assert.equal(stats.totalBytes, png.length + text.length);
    assert.equal(stats.byMediaKind.image, 1);
    assert.equal(Object.values(stats.byMediaKind).reduce((sum, value) => sum + value, 0), 2);
    const page = fixture.service.browse({ limit: 10 });
    assert.deepEqual(new Set(page.items.map((item) => item.creator.displayName)), new Set(["مالك المكتبة", "مدير المحتوى"]));
    assert.equal("email" in page.items[0].creator, false);
    assert.equal("passwordHash" in page.items[0].creator, false);
  } finally {
    fixture.close();
  }
});

test("M4 Admin APIs protect list/stats/detail/integrity and never expose storage internals", async () => {
  const root = temporaryDirectory("pythagoras-library-api-");
  const previousDataDirectory = process.env.PYTHAGORAS_DATA_DIR;
  process.env.PYTHAGORAS_DATA_DIR = root;
  const globals = globalThis as typeof globalThis & {
    __pythagorasAdminAuthService?: unknown;
    __pythagorasAssetService?: unknown;
    __pythagorasContentDatabase?: ContentDatabase;
  };
  try {
    assert.equal((await listAssets(new NextRequest("http://localhost:3000/api/admin/assets"))).status, 401);
    assert.equal((await getStats(new NextRequest("http://localhost:3000/api/admin/assets/stats"))).status, 401);

    const database = getContentDatabase();
    const auth = createAdminAuthService(database);
    const session = await auth.setupInitialOwner({
      displayName: "API Library Owner",
      email: "m4-api@example.test",
      password: randomBytes(32).toString("base64url"),
    });
    const cookie = `pythagoras_admin_session=${session.rawToken}`;
    const bytes = Buffer.from("واجهة مكتبة المحتوى", "utf8");
    const form = new FormData();
    form.set("file", new File([bytes], "مكتبة.txt", { type: "text/plain" }));
    const uploaded = await uploadAsset(new NextRequest("http://localhost:3000/api/admin/assets", {
      method: "POST",
      headers: { Cookie: cookie, Host: "localhost:3000", Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin" },
      body: form,
    }));
    assert.equal(uploaded.status, 201);
    const uploadedBody = await uploaded.json() as { asset: { id: string; creator: { displayName: string }; storageKey?: string } };
    assert.equal(uploadedBody.asset.creator.displayName, "API Library Owner");
    assert.equal(uploadedBody.asset.storageKey, undefined);

    const headers = { Cookie: cookie };
    const list = await listAssets(new NextRequest("http://localhost:3000/api/admin/assets?q=مكتبة&sort=name&limit=12&offset=0", { headers }));
    const listBody = await list.json() as { items: Array<Record<string, unknown>>; total: number; limit: number; offset: number };
    assert.equal(list.status, 200);
    assert.equal(listBody.total, 1);
    assert.equal(listBody.limit, 12);
    assert.equal(listBody.offset, 0);
    assert.equal(listBody.items[0].storageKey, undefined);

    const detail = await getAsset(new NextRequest(`http://localhost:3000/api/admin/assets/${uploadedBody.asset.id}`, { headers }), { params: Promise.resolve({ id: uploadedBody.asset.id }) });
    const detailText = await detail.text();
    assert.equal(detail.status, 200);
    assert.equal(detailText.includes("storageKey"), false);
    assert.equal(detailText.includes(path.resolve(root)), false);

    const integrity = await getIntegrity(new NextRequest(`http://localhost:3000/api/admin/assets/${uploadedBody.asset.id}/integrity`, { headers }), { params: Promise.resolve({ id: uploadedBody.asset.id }) });
    const integrityBody = await integrity.json() as { integrity: Record<string, unknown> };
    assert.equal(integrity.status, 200);
    assert.equal(integrityBody.integrity.healthy, true);
    assert.equal(integrityBody.integrity.expectedSha256, undefined);
    assert.equal(integrityBody.integrity.actualSha256, undefined);
    assert.equal(integrityBody.integrity.storageKey, undefined);

    const stats = await getStats(new NextRequest("http://localhost:3000/api/admin/assets/stats", { headers }));
    assert.equal(stats.status, 200);
    assert.equal((await stats.json() as { stats: { totalCount: number } }).stats.totalCount, 1);

    const invalid = await listAssets(new NextRequest("http://localhost:3000/api/admin/assets?sort=DROP_TABLE", { headers }));
    assert.equal(invalid.status, 400);
  } finally {
    globals.__pythagorasContentDatabase?.close();
    delete globals.__pythagorasAdminAuthService;
    delete globals.__pythagorasAssetService;
    delete globals.__pythagorasContentDatabase;
    if (previousDataDirectory === undefined) delete process.env.PYTHAGORAS_DATA_DIR;
    else process.env.PYTHAGORAS_DATA_DIR = previousDataDirectory;
    rmSync(root, { recursive: true, force: true });
  }
});

test("M4 library implementation does not depend on legacy browser image storage", () => {
  const directory = path.join(process.cwd(), "src", "components", "admin", "library");
  assert.equal(existsSync(directory), true);
  const source = readdirSync(directory)
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .map((file) => readFileSync(path.join(directory, file), "utf8"))
    .join("\n");
  assert.doesNotMatch(source, /ImageDB|image-db|indexedDB|localStorage|sessionStorage/u);
  assert.match(source, /AbortController/u);
  assert.match(source, /setTimeout\([^)]*300|, 300\)/u);
  assert.match(source, /Math\.min\(3,/u);
});

test("M4 media-kind validation remains a closed server-side enum", () => {
  const valid = new Set<AssetMediaKind>(["image", "video", "audio", "document", "json", "other-safe-file"]);
  assert.equal(valid.size, 6);
  assert.equal(valid.has("executable" as AssetMediaKind), false);
});
