import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ContentConflictError,
  ContentDuplicateError,
  ContentFoundationError,
  SQLiteContentRepository,
  ensurePythagorasDataDirectories,
  getContentDatabaseStatus,
  openContentDatabase,
  resolvePythagorasDataDirectory,
} from "../src/server/content/index";

const migrationsDirectory = path.join(process.cwd(), "drizzle");

function createTemporaryDirectory(): string {
  return mkdtempSync(path.join(os.tmpdir(), "pythagoras-content-test-"));
}

test("resolves configured and fallback data directories without hardcoded platform paths", () => {
  const configured = resolvePythagorasDataDirectory({
    env: { PYTHAGORAS_DATA_DIR: ".\\runtime-content" },
    homeDirectory: "C:\\Users\\example",
    platform: "win32",
  });
  assert.equal(configured, path.resolve(".\\runtime-content"));

  const fallback = resolvePythagorasDataDirectory({
    env: {},
    homeDirectory: path.join(path.parse(process.cwd()).root, "test-home"),
    platform: "linux",
  });
  assert.equal(fallback, path.join(path.parse(process.cwd()).root, "test-home", ".pythagoras", "data"));
});

test("creates the complete local data layout", () => {
  const temporaryDirectory = createTemporaryDirectory();
  try {
    const paths = ensurePythagorasDataDirectories(temporaryDirectory);
    for (const directory of [
      paths.databaseDirectory,
      paths.objectStorageDirectory,
      paths.exportsDirectory,
      paths.backupsDirectory,
      paths.tempDirectory,
      paths.logsDirectory,
    ]) {
      assert.equal(existsSync(directory), true, `missing directory: ${directory}`);
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("runs migrations and persists repository data across database restarts", () => {
  const temporaryDirectory = createTemporaryDirectory();
  try {
    const firstDatabase = openContentDatabase({
      dataDirectory: temporaryDirectory,
      migrationsDirectory,
    });
    const firstRepository = new SQLiteContentRepository(firstDatabase, () => 1_700_000_000_000);
    const created = firstRepository.create({
      resourceType: "system-setting",
      resourceKey: "foundation-check",
      payload: { enabled: true },
    });
    assert.equal(created.revision, 1);
    assert.match(created.id, /^[0-9a-f-]{36}$/);
  assert.equal(getContentDatabaseStatus(firstDatabase).migrationsApplied, 44);
    firstDatabase.close();

    const secondDatabase = openContentDatabase({
      dataDirectory: temporaryDirectory,
      migrationsDirectory,
    });
    const secondRepository = new SQLiteContentRepository(secondDatabase, () => 1_700_000_001_000);
    const persisted = secondRepository.findByKey<{ enabled: boolean }>(
      "system-setting",
      "foundation-check",
    );
    assert.equal(persisted?.id, created.id);
    assert.deepEqual(persisted?.payload, { enabled: true });

    const updated = secondRepository.update({
      id: created.id,
      expectedRevision: 1,
      payload: { enabled: false },
    });
    assert.equal(updated.revision, 2);
    assert.deepEqual(updated.payload, { enabled: false });
    assert.equal(secondRepository.listByType("system-setting").length, 1);
    secondDatabase.close();
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("rejects duplicate keys and stale writes instead of silently overwriting", () => {
  const temporaryDirectory = createTemporaryDirectory();
  const database = openContentDatabase({ dataDirectory: temporaryDirectory, migrationsDirectory });
  try {
    const repository = new SQLiteContentRepository(database);
    const created = repository.create({
      resourceType: "banner",
      resourceKey: "home-primary",
      payload: { title: "A" },
    });

    assert.throws(
      () =>
        repository.create({
          resourceType: "banner",
          resourceKey: "home-primary",
          payload: { title: "B" },
        }),
      ContentDuplicateError,
    );

    repository.update({
      id: created.id,
      expectedRevision: 1,
      payload: { title: "Published-safe" },
    });

    assert.throws(
      () =>
        repository.update({
          id: created.id,
          expectedRevision: 1,
          payload: { title: "Stale write" },
        }),
      (error) =>
        error instanceof ContentConflictError &&
        error.expectedRevision === 1 &&
        error.actualRevision === 2,
    );
  } finally {
    database.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("reports an explicit storage failure for an invalid configured directory", () => {
  const temporaryDirectory = createTemporaryDirectory();
  const filePath = path.join(temporaryDirectory, "not-a-directory");
  writeFileSync(filePath, "occupied");
  try {
    assert.throws(
      () => openContentDatabase({ dataDirectory: filePath, migrationsDirectory }),
      (error) =>
        error instanceof ContentFoundationError &&
        error.code === "CONTENT_STORAGE_UNAVAILABLE",
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
