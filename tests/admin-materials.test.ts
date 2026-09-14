import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { v7 as uuidv7 } from "uuid";
import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth";
import {
  createCanonicalContentRepository,
  createDirectMaterialService,
} from "../src/server/canonical-content";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import { assets } from "../src/server/content/schema";
import {
  createDirectMaterialQuestionBankService,
} from "../src/server/material-question-bank";
import { createMaterialQuestionBankService } from "../src/server/material-question-bank/service";
import { createDirectQuestionPackageService } from "../src/server/question-import";
import { createQuestionPackageInspectionService } from "../src/server/question-packages";
import { createQuestionSearchService } from "../src/server/question-search";
import { createAssetService } from "../src/server/assets";
import type { QuestionPackageV1 } from "../src/server/question-packages";
import { SQLiteQuestionRepository } from "../src/server/questions";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const packageFixture = path.join(
  process.cwd(),
  "tests/fixtures/question-packages/b-literature-valid.json",
);

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-admin-materials-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  createCanonicalContentRepository(database).bootstrap();
  const identities = new SQLiteAdminIdentityRepository(database);
  const user = identities.createInitialOwner({
    id: uuidv7(),
    email: "materials-owner@example.test",
    displayName: "Materials Owner",
    passwordHash: "$argon2id$test-only-hash",
    createdAt: Date.now(),
  });
  const actor: AdminActor = { actorUserId: user.id, actorRole: "OWNER" };
  return {
    root,
    database,
    actor,
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
    },
  };
}

async function ingestJson(
  database: ContentDatabase,
  actor: AdminActor,
  value: QuestionPackageV1,
  filename: string,
) {
  const directory = path.join(database.paths.tempDirectory, uuidv7());
  mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, filename);
  writeFileSync(filePath, JSON.stringify(value));
  return createAssetService(database).ingest(
    { filePath, originalFilename: filename },
    actor,
  );
}

async function ingestImage(database: ContentDatabase, actor: AdminActor) {
  const directory = path.join(database.paths.tempDirectory, uuidv7());
  mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, "material.png");
  const bytes = await sharp({
    create: { width: 32, height: 20, channels: 4, background: "#2468ff" },
  })
    .png()
    .toBuffer();
  writeFileSync(filePath, bytes);
  return createAssetService(database).ingest(
    { filePath, originalFilename: "material.png", displayName: "غلاف المادة" },
    actor,
  );
}

function tableCount(database: ContentDatabase, table: string): number {
  return Number(
    (database.client.prepare(`select count(*) count from ${table}`).get() as { count: number }).count,
  );
}

test("direct Materials writes preserve artwork, appearance, ordering, and public revision", async () => {
  const state = fixture();
  try {
    const service = createDirectMaterialService(state.database);
    const initial = service.list();
    assert.equal(initial.length, 8);
    const biology = initial.find((item) => item.subjectKey === "biology")!;
    const image = await ingestImage(state.database, state.actor);

    const updated = service.update(
      "biology",
      {
        label: "الأحياء المتقدم",
        englishTitle: "ADVANCED BIOLOGY",
        available: true,
        assetId: image.asset.id,
        offsetX: 8,
        offsetY: -6,
        scale: 1.25,
      },
      biology.revision,
      state.actor,
    );
    assert.equal(updated.id, biology.id);
    assert.equal(updated.revision, biology.revision + 1);
    assert.equal(updated.assetId, image.asset.id);
    assert.equal(updated.offsetX, 8);
    assert.equal(updated.offsetY, -6);
    assert.equal(updated.scale, 1.25);

    const settings = service.getSettings();
    const changedSettings = service.updateSettings(
      { fadeIntensity: 0.41, textVerticalPosition: 18, textScale: 1.16, cardHeight: 280 },
      settings.revision,
      state.actor,
    );
    assert.equal(changedSettings.fadeIntensity, 0.41);
    assert.equal(changedSettings.textVerticalPosition, 18);
    assert.equal(changedSettings.textScale, 1.16);
    assert.equal(changedSettings.cardHeight, 280);
    assert.equal(
      createCanonicalContentRepository(state.database).getPublicContent().content?.materialSettings.cardHeight,
      280,
    );

    const ordered = [...service.list()].reverse();
    const reordered = service.reorder(
      ordered.map((item) => item.subjectKey),
      Object.fromEntries(service.list().map((item) => [item.subjectKey, item.revision])),
      state.actor,
    );
    assert.deepEqual(reordered.map((item) => item.subjectKey), ordered.map((item) => item.subjectKey));
    assert.throws(
      () => service.update("biology", { label: "نسخة قديمة" }, biology.revision, state.actor),
      (error) => error instanceof Error && "code" in error && (error as { code?: string }).code === "CANONICAL_CONFLICT",
    );
  } finally {
    state.close();
  }
});

test("Storage recognition distinguishes generic JSON from valid and invalid Question Packages", async () => {
  const state = fixture();
  try {
    const valid = JSON.parse(readFileSync(packageFixture, "utf8")) as QuestionPackageV1;
    const validAsset = await ingestJson(state.database, state.actor, valid, "recognized.json");
    const genericAsset = await ingestJson(state.database, state.actor, { hello: "world" } as unknown as QuestionPackageV1, "generic.json");
    const invalidValue = { ...valid, package: { ...valid.package, id: "not-a-uuid" } };
    const invalidAsset = await ingestJson(state.database, state.actor, invalidValue as QuestionPackageV1, "invalid-package.json");
    const inspections = createQuestionPackageInspectionService(state.database);
    assert.equal((await inspections.inspectAsset(validAsset.asset.id))?.status, "VALID");
    assert.equal((await inspections.inspectAsset(genericAsset.asset.id))?.status, "GENERIC_JSON");
    assert.equal((await inspections.inspectAsset(invalidAsset.asset.id))?.status, "INVALID");
    const preflight = await createDirectQuestionPackageService(state.database).inspect(validAsset.asset.id, state.actor);
    assert.equal(preflight.counts.occurrences, 1);
    assert.equal(preflight.counts.taxonomy, 1);
    assert.equal(preflight.package?.contentRevision, 1);
  } finally {
    state.close();
  }
});

test("direct import resolves immutable manifest Assets into canonical RichDocument references", async () => {
  const state = fixture();
  try {
    const value = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/question-packages/f-asset-ref-valid.json"), "utf8")) as QuestionPackageV1;
    const manifest = value.assetsManifest[0];
    const assetId = uuidv7();
    state.database.db.insert(assets).values({
      id: assetId,
      originalFilename: manifest.filename,
      displayName: manifest.filename,
      mimeType: manifest.mimeType,
      mediaKind: "image",
      byteSize: manifest.byteSize,
      sha256: manifest.sha256,
      storageKey: `${manifest.sha256.slice(0, 2)}/${manifest.sha256}`,
      width: null,
      height: null,
      durationMs: null,
      createdBy: state.actor.actorUserId,
      updatedBy: state.actor.actorUserId,
      createdAt: 1,
      updatedAt: 1,
      revision: 1,
    }).run();
    const source = await ingestJson(state.database, state.actor, value, "manifest-package.json");
    const result = await createDirectQuestionPackageService(state.database).apply(source.asset.id, false, state.actor);
    const binding = state.database.client.prepare("select asset_id from question_package_asset_bindings where package_id=? and asset_ref=?").get(value.package.id, manifest.ref) as { asset_id: string | null };
    assert.equal(binding.asset_id, assetId);
    const block = result.package.questions[0].variants[0].content.blocks[0];
    assert.equal(block.type, "image");
    if (block.type === "image") assert.equal(block.assetId, assetId);
  } finally {
    state.close();
  }
});

test("direct Question Package apply is additive-safe, FTS-coherent, and assigns Arabic Product BANK slots", async () => {
  const state = fixture();
  try {
    const original = JSON.parse(readFileSync(packageFixture, "utf8")) as QuestionPackageV1;
    const firstAsset = await ingestJson(state.database, state.actor, original, "literature-v1.json");
    const inspection = await createQuestionPackageInspectionService(state.database).inspectAsset(firstAsset.asset.id);
    assert.equal(inspection?.status, "VALID");
    assert.equal(inspection?.questionCount, 1);
    assert.equal(inspection?.variantCount, 1);
    const directPackages = createDirectQuestionPackageService(state.database);
    const firstPreflight = await directPackages.inspect(firstAsset.asset.id, state.actor);
    assert.equal(firstPreflight.eligible, true);
    const imported = await directPackages.apply(firstAsset.asset.id, false, state.actor);
    assert.equal(imported.operation, "IMPORTED");
    assert.equal(imported.package.package.id, original.package.id);
    assert.equal(imported.package.questions.length, 1);
    assert.equal(createQuestionSearchService(state.database).getHealth().healthy, true);
    assert.equal(tableCount(state.database, "change_sets"), 0);

    const warningValue = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/question-packages/k-warning-missing-answer.json"), "utf8")) as QuestionPackageV1;
    warningValue.bankBrowse.entry.key = "missing-answer-test";
    warningValue.bankBrowse.entry.order = 2;
    const warningAsset = await ingestJson(state.database, state.actor, warningValue, "warning-package.json");
    const warningPreflight = await directPackages.inspect(warningAsset.asset.id, state.actor);
    assert.equal(warningPreflight.acknowledgementRequired, true);
    await assert.rejects(() => directPackages.apply(warningAsset.asset.id, false, state.actor), /acknowledged/i);
    assert.equal((await directPackages.apply(warningAsset.asset.id, true, state.actor)).operation, "IMPORTED");
    assert.equal(tableCount(state.database, "change_sets"), 0);

    const bank = createDirectMaterialQuestionBankService(state.database);
    const initialWorkspace = bank.getWorkspace("arabic", state.actor);
    assert.equal(initialWorkspace.productPreset, "ARABIC_FIXED");
    assert.equal(initialWorkspace.layout?.nodes.length, 11);
    assert.deepEqual(
      initialWorkspace.layout?.nodes.filter((node) => node.parentId === "0195a100-0002-7000-8000-000000000002").map((node) => node.label),
      ["الاستفهام", "النفي", "التقديم والتأخير", "التوكيد", "النداء", "التعجب", "المدح والذم", "التمني والترجي", "العرض والتحضيض"],
    );
    const literature = initialWorkspace.layout!.nodes.find((node) => node.nodeKey === "arabic-literature")!;
    const istifham = initialWorkspace.layout!.nodes.find((node) => node.nodeKey === "arabic-grammar-istifham")!;
    const assignedLayout = structuredClone(initialWorkspace.layout!);
    assignedLayout.nodes = assignedLayout.nodes.map((node) => node.id === literature.id || node.id === istifham.id ? { ...node, packageId: original.package.id } : node);
    const assigned = await bank.save(
      "arabic",
      assignedLayout,
      initialWorkspace.canonicalRevision,
      [{ packageId: original.package.id, assetId: firstAsset.asset.id }],
      { acknowledgeWarnings: false, acknowledgeCrossSubject: false },
      state.actor,
    );
    assert.equal(assigned.layout?.nodes.find((node) => node.id === literature.id)?.packageId, original.package.id);
    assert.equal(assigned.layout?.nodes.find((node) => node.id === istifham.id)?.packageId, original.package.id);
    const publicLayout = createMaterialQuestionBankService(state.database).getPublicLayout("arabic");
    assert.equal(publicLayout.nodes.find((node) => node.id === literature.id)?.available, true);
    assert.equal(publicLayout.nodes.find((node) => node.id === istifham.id)?.available, true);
    const publicSearch = createMaterialQuestionBankService(state.database).searchPublicQuestions("arabic", literature.id, "أدبي", 0, 25);
    assert.equal(publicSearch.total, 1);
    assert.equal(tableCount(state.database, "change_sets"), 0);

    const invalidTopology = structuredClone(assignedLayout);
    const grammarSlot = invalidTopology.nodes.find((node) => node.nodeKey === "arabic-grammar-istifham")!;
    invalidTopology.nodes = invalidTopology.nodes.map((node) => node.id === grammarSlot.id ? { ...node, targetMode: "TAXONOMY_FILTER" as const, taxonomyNodeId: "01910000-0000-7000-8000-000000000011", includeDescendants: true } : node);
    await assert.rejects(
      () => bank.save("arabic", invalidTopology, assigned.canonicalRevision, [{ packageId: original.package.id, assetId: firstAsset.asset.id }], { acknowledgeWarnings: false, acknowledgeCrossSubject: false }, state.actor),
      /Product-defined|package assignment|BANK/i,
    );

    const newer = structuredClone(original);
    newer.package.contentRevision = 2;
    const paragraph = newer.questions[0].variants[0].content.blocks[0];
    if (paragraph.type !== "paragraph") throw new Error("Expected fixture paragraph.");
    paragraph.spans[0].text = "سؤال أدبي محدث مباشرة.";
    const secondAsset = await ingestJson(state.database, state.actor, newer, "literature-v2.json");
    const updated = await directPackages.apply(secondAsset.asset.id, false, state.actor);
    assert.equal(updated.operation, "UPDATED");
    assert.equal(updated.package.package.contentRevision, 2);
    assert.equal(updated.package.questions[0].id, original.questions[0].id);
    assert.equal(createQuestionSearchService(state.database).getHealth().healthy, true);

    const removedLayout = structuredClone(assigned.layout!);
    removedLayout.nodes = removedLayout.nodes.map((node) => node.id === literature.id ? { ...node, packageId: null } : node);
    const removed = await bank.save(
      "arabic",
      removedLayout,
      assigned.canonicalRevision,
      [{ packageId: original.package.id, assetId: secondAsset.asset.id }],
      { acknowledgeWarnings: false, acknowledgeCrossSubject: false },
      state.actor,
    );
    assert.equal(removed.layout?.nodes.find((node) => node.id === literature.id)?.packageId, null);
    assert.ok(new SQLiteQuestionRepository(state.database).getPackage(original.package.id));
    assert.equal(tableCount(state.database, "questions"), 2);
    assert.equal(tableCount(state.database, "change_sets"), 0);

    const downgrade = await ingestJson(state.database, state.actor, original, "literature-downgrade.json");
    await assert.rejects(
      () => directPackages.apply(downgrade.asset.id, false, state.actor),
      /blocking issues/i,
    );
  } finally {
    state.close();
  }
});
