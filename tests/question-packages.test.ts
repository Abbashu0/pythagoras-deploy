import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";
import { createAssetService } from "../src/server/assets";
import { openContentDatabase } from "../src/server/content";
import { adminUsers } from "../src/server/content/schema";
import {
  createQuestionPackageInspectionService,
  inspectQuestionPackageJson,
  isQuestionPackageEligibleForFutureImport,
  SQLiteQuestionPackageInspectionRepository,
  type QuestionPackageV1,
} from "../src/server/question-packages";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const fixturesDirectory = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "question-packages",
);
const canonicalSubjects = new Set([
  "islamic",
  "arabic",
  "english",
  "biology",
  "math",
  "chemistry",
  "physics",
  "french",
]);

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixturesDirectory, name), "utf8"));
}

function inspect(name: string) {
  return inspectQuestionPackageJson(fixture(name), {
    canonicalSubjectKeys: canonicalSubjects,
  });
}

function diagnosticCodes(name: string): string[] {
  return inspect(name).diagnostics.map((item) => item.code);
}

test("synthetic V1 fixtures cover direct literature, grammar tree, variants, rich blocks, and asset refs", () => {
  for (const name of [
    "a-minimal-valid.json",
    "b-literature-valid.json",
    "c-grammar-tree-valid.json",
    "d-multi-variant-valid.json",
    "e-rich-content-valid.json",
    "f-asset-ref-valid.json",
  ]) {
    const result = inspect(name);
    assert.equal(result.status, "VALID", `${name}: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.package);
  }

  const literature = inspect("b-literature-valid.json").package!;
  assert.equal(literature.bankBrowse.mode, "ALL_PACKAGE_QUESTIONS");
  const grammar = inspect("c-grammar-tree-valid.json").package!;
  assert.equal(grammar.bankBrowse.mode, "TREE");
  assert.equal(grammar.bankBrowse.nodes.length, 9);
  const multi = inspect("d-multi-variant-valid.json").package!;
  assert.equal(multi.questions[0].variants.length, 2);
  assert.equal(multi.questions[0].variants[0].occurrences[0].sourceKind, "ministerial");
  const rich = inspect("e-rich-content-valid.json").package!;
  assert.deepEqual(
    rich.questions[0].variants[0].content.blocks.map((block) => block.type),
    ["heading", "paragraph", "ordered-list", "bullet-list", "quran", "poetry", "table", "divider"],
  );
  assert.equal(
    rich.questions[0].variants[0].content.blocks[0].type === "heading" &&
      rich.questions[0].variants[0].content.blocks[0].spans[0].marks?.includes("underline"),
    true,
  );
  const assetPackage = inspect("f-asset-ref-valid.json").package!;
  assert.equal(assetPackage.assetsManifest[0].ref, "diagram-one");
  assert.equal(JSON.stringify(assetPackage).includes("assetId"), false);
  assert.equal(JSON.stringify(assetPackage).includes("data:image"), false);
});

test("recognition distinguishes invalid, warning, unsupported, and generic JSON states", () => {
  assert.equal(inspect("g-invalid-primary-variant.json").status, "INVALID");
  assert.ok(diagnosticCodes("g-invalid-primary-variant.json").includes("PRIMARY_VARIANT_NOT_FOUND"));
  assert.equal(inspect("h-duplicate-order.json").status, "INVALID");
  assert.ok(diagnosticCodes("h-duplicate-order.json").includes("DUPLICATE_ORDER"));
  assert.equal(inspect("i-taxonomy-cycle.json").status, "INVALID");
  assert.ok(diagnosticCodes("i-taxonomy-cycle.json").includes("TAXONOMY_CYCLE"));
  assert.equal(inspect("j-invalid-browse-target.json").status, "INVALID");
  assert.ok(diagnosticCodes("j-invalid-browse-target.json").includes("BROWSE_TARGET_NOT_FOUND"));
  assert.equal(inspect("k-warning-missing-answer.json").status, "VALID_WITH_WARNINGS");
  assert.ok(diagnosticCodes("k-warning-missing-answer.json").includes("SHARED_ANSWER_MISSING"));
  assert.equal(inspect("l-unsupported-version.json").status, "UNSUPPORTED_VERSION");
  assert.equal(inspect("m-generic-json.json").status, "GENERIC_JSON");
  assert.equal(inspectQuestionPackageJson([], { canonicalSubjectKeys: canonicalSubjects }).status, "GENERIC_JSON");
  assert.equal(isQuestionPackageEligibleForFutureImport("VALID"), true);
  assert.equal(isQuestionPackageEligibleForFutureImport("VALID_WITH_WARNINGS"), true);
  for (const blocked of ["INVALID", "UNSUPPORTED_VERSION", "GENERIC_JSON"] as const) {
    assert.equal(isQuestionPackageEligibleForFutureImport(blocked), false);
  }
});

test("structural and semantic validation remain separate and diagnostics are pointer-addressable", () => {
  const structural = inspectQuestionPackageJson(
    {
      $schema: "https://schemas.pythagoras.local/question-package/1.0.0",
      format: "pythagoras.question-package",
      schemaVersion: "1.0.0",
      contentMode: "question-bank",
    },
    { canonicalSubjectKeys: canonicalSubjects },
  );
  assert.equal(structural.status, "INVALID");
  assert.ok(structural.diagnostics.every((item) => item.code.startsWith("SCHEMA_")));
  assert.ok(structural.diagnostics.every((item) => typeof item.jsonPointer === "string"));

  const unknown = structuredClone(fixture("a-minimal-valid.json")) as QuestionPackageV1;
  unknown.package.subjectKey = "unknown-subject";
  const semantic = inspectQuestionPackageJson(unknown, {
    canonicalSubjectKeys: canonicalSubjects,
  });
  assert.equal(semantic.status, "INVALID");
  assert.deepEqual(semantic.diagnostics.find((item) => item.code === "UNKNOWN_SUBJECT_KEY")?.context, {
    subjectKey: "unknown-subject",
  });
});

test("order checks preserve values, allow non-zero starts, and report only real gaps", () => {
  const packageValue = structuredClone(fixture("c-grammar-tree-valid.json")) as QuestionPackageV1;
  packageValue.taxonomy.forEach((node) => { node.order += 1; });
  if (packageValue.bankBrowse.mode === "TREE") {
    packageValue.bankBrowse.nodes.forEach((node) => { node.order += 1; });
  }
  const contiguous = inspectQuestionPackageJson(packageValue, { canonicalSubjectKeys: canonicalSubjects });
  assert.equal(contiguous.status, "VALID");
  assert.equal(contiguous.diagnostics.some((item) => item.code === "ORDER_GAP"), false);
  assert.equal(packageValue.taxonomy[0].order, 2);

  packageValue.taxonomy[8].order = 12;
  const gap = inspectQuestionPackageJson(packageValue, { canonicalSubjectKeys: canonicalSubjects });
  assert.equal(gap.status, "VALID_WITH_WARNINGS");
  assert.ok(gap.diagnostics.some((item) => item.code === "ORDER_GAP"));
  assert.equal(packageValue.taxonomy[8].order, 12);
});

test("manifest refs reject missing entries and path-bearing filenames", () => {
  const packageValue = structuredClone(fixture("f-asset-ref-valid.json")) as QuestionPackageV1;
  packageValue.assetsManifest[0].filename = "../../unsafe.png";
  packageValue.assetsManifest[0].ref = "different-ref";
  const result = inspectQuestionPackageJson(packageValue, { canonicalSubjectKeys: canonicalSubjects });
  assert.equal(result.status, "INVALID");
  assert.ok(result.diagnostics.some((item) => item.code === "UNSAFE_MANIFEST_FILENAME"));
  assert.ok(result.diagnostics.some((item) => item.code === "ASSET_REF_NOT_FOUND"));
});

test("JSON asset inspection is persisted, cached, and keeps original bytes immutable", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m8-inspection-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const now = Date.now();
  const ownerId = uuidv7();
  database.db.insert(adminUsers).values({
    id: ownerId,
    email: "m8-owner@example.test",
    displayName: "M8 Owner",
    passwordHash: "$argon2id$test-only-hash",
    role: "OWNER",
    enabled: true,
    createdAt: now,
    updatedAt: now,
    passwordChangedAt: now,
    revision: 1,
  }).run();
  const assets = createAssetService(database);
  const stagingDirectory = path.join(database.paths.tempDirectory, "m8");
  mkdirSync(stagingDirectory, { recursive: true });
  const stagedPath = path.join(stagingDirectory, "package.json");
  const bytes = readFileSync(path.join(fixturesDirectory, "b-literature-valid.json"));
  writeFileSync(stagedPath, bytes);
  try {
    const ingested = await assets.ingest(
      { filePath: stagedPath, originalFilename: "حزمة-أدب.json" },
      { actorUserId: ownerId, actorRole: "OWNER" },
    );
    const service = createQuestionPackageInspectionService(database);
    const first = await service.inspectAsset(ingested.asset.id);
    assert.equal(first?.status, "VALID");
    assert.equal(first?.questionCount, 1);
    const stored = new SQLiteQuestionPackageInspectionRepository(database).findByAssetId(ingested.asset.id);
    assert.equal(stored?.sourceSha256, ingested.asset.sha256);
    assert.equal(stored?.title, "الأدب — بيانات اصطناعية");
    assert.deepEqual(
      Buffer.from(await new Response((await assets.openContent(ingested.asset.id)).body).arrayBuffer()),
      bytes,
    );

    database.close();
    const reopened = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    try {
      const afterRestart = await createQuestionPackageInspectionService(reopened).inspectAsset(ingested.asset.id);
      assert.equal(afterRestart?.status, "VALID");
      assert.equal(afterRestart?.inspectedAt, first?.inspectedAt);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("0006 inspection cache migration applies to fresh and existing 0005 databases", () => {
  const freshRoot = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m8-fresh-"));
  const oldRoot = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m8-old-"));
  const oldMigrations = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m8-migrations-"));
  try {
    const fresh = openContentDatabase({ dataDirectory: freshRoot, migrationsDirectory });
    assert.equal((fresh.client.prepare("select count(*) count from __drizzle_migrations").get() as { count: number }).count, 7);
    assert.ok(fresh.client.prepare("select name from sqlite_master where name='question_package_inspections'").get());
    fresh.close();

    mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
    for (const name of [
      "0000_content-foundation.sql",
      "0001_admin-identity.sql",
      "0002_assets.sql",
      "0003_change-management.sql",
      "0004_legacy-migration.sql",
      "0005_canonical-content.sql",
    ]) copyFileSync(path.join(migrationsDirectory, name), path.join(oldMigrations, name));
    const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 6);
    writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify(journal));
    const old = openContentDatabase({ dataDirectory: oldRoot, migrationsDirectory: oldMigrations });
    old.close();
    const upgraded = openContentDatabase({ dataDirectory: oldRoot, migrationsDirectory });
    assert.equal((upgraded.client.prepare("select count(*) count from __drizzle_migrations").get() as { count: number }).count, 7);
    assert.ok(upgraded.client.prepare("select name from sqlite_master where name='question_package_inspections'").get());
    upgraded.close();
  } finally {
    for (const target of [freshRoot, oldRoot, oldMigrations]) rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("Student question-bank placement remains subject-scoped and does not load question data", () => {
  const dataSource = readFileSync(path.join(process.cwd(), "public/pythagoras/src/scripts/data.js"), "utf8");
  const subjectSource = readFileSync(path.join(process.cwd(), "public/pythagoras/src/pages/SubjectTestsPage.js"), "utf8");
  const placeholderSource = readFileSync(path.join(process.cwd(), "public/pythagoras/src/pages/QuestionBankPlaceholderPage.js"), "utf8");
  const headerSource = readFileSync(path.join(process.cwd(), "public/pythagoras/src/components/PageHeader.js"), "utf8");
  const appSource = readFileSync(path.join(process.cwd(), "public/pythagoras/src/scripts/app.js"), "utf8");
  const routerSource = readFileSync(path.join(process.cwd(), "public/pythagoras/src/scripts/router.js"), "utf8");
  assert.ok(dataSource.includes("questions-${subjectId}"));
  assert.ok(subjectSource.includes("getQuestionBankView(subject.id)"));
  assert.equal(subjectSource.includes('navTo: "questions"'), false);
  assert.ok(placeholderSource.includes("getTestsSubjectView(subject.id)"));
  assert.ok(placeholderSource.includes("subject.title"));
  assert.ok(appSource.includes("getQuestionBankSubjectByView(view)"));
  assert.ok(routerSource.includes("getQuestionBankSubjectByView(view)"));
  assert.ok(headerSource.includes('data-nav-to="${options.backView}"'));
  for (const source of [subjectSource, placeholderSource, appSource]) {
    assert.equal(/fetch\([^)]*question|questionBankLoader|biologyQuestionBank/u.test(source), false);
  }
});

test("Asset Library surfaces cached package recognition without adding an import action", () => {
  const browserSource = readFileSync(path.join(process.cwd(), "src/components/admin/library/AssetBrowser.tsx"), "utf8");
  const detailsSource = readFileSync(path.join(process.cwd(), "src/components/admin/library/AssetDetailsDialog.tsx"), "utf8");
  const listRoute = readFileSync(path.join(process.cwd(), "src/app/api/admin/assets/route.ts"), "utf8");
  assert.ok(browserSource.includes("حزمة أسئلة صالحة"));
  assert.ok(browserSource.includes("حزمة أسئلة غير صالحة"));
  assert.ok(detailsSource.includes("فحص حزمة الأسئلة"));
  assert.ok(detailsSource.includes("inspection.diagnostics"));
  assert.ok(listRoute.includes("getQuestionPackageInspectionService"));
  assert.equal(/استيراد الحزمة|importQuestionPackage|convertQuestionPackage/u.test(`${browserSource}\n${detailsSource}\n${listRoute}`), false);
});
