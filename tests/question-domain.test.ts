import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";
import type { AdminActor } from "../src/server/admin-auth/contracts";
import { createCanonicalContentRepository } from "../src/server/canonical-content";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import {
  adminUsers,
  assets,
  canonicalBanners,
  canonicalMaterials,
  questionBankBrowseNodes,
  questionOccurrences,
  questionPackages,
  questionTaxonomyAssignments,
  questionTaxonomyNodes,
  questionVariants,
  questions,
} from "../src/server/content/schema";
import {
  inspectQuestionPackageJson,
  type QuestionPackageV1,
} from "../src/server/question-packages";
import {
  createQuestionDomainService,
  QuestionDomainConflictError,
  QuestionDomainError,
  SQLiteQuestionRepository,
  type QuestionMaterializationPlan,
} from "../src/server/questions";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const fixturesDirectory = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "question-packages",
);
const subjectKeys = new Set([
  "islamic",
  "arabic",
  "english",
  "biology",
  "math",
  "chemistry",
  "physics",
  "french",
]);

interface QuestionFixture {
  root: string;
  database: ContentDatabase;
  actor: AdminActor;
  repository: SQLiteQuestionRepository;
  service: ReturnType<typeof createQuestionDomainService>;
}

function temp(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fixtureJson(name: string): unknown {
  return JSON.parse(
    readFileSync(path.join(fixturesDirectory, name), "utf8"),
  );
}

function validation(name: string) {
  return inspectQuestionPackageJson(fixtureJson(name), {
    canonicalSubjectKeys: subjectKeys,
  });
}

function createFixture(): QuestionFixture {
  const root = temp("pythagoras-m9-");
  const database = openContentDatabase({
    dataDirectory: root,
    migrationsDirectory,
  });
  const actor: AdminActor = { actorUserId: uuidv7(), actorRole: "OWNER" };
  const now = Date.now();
  database.db.insert(adminUsers).values({
    id: actor.actorUserId,
    email: `${actor.actorUserId}@m9.test`,
    displayName: "M9 Owner",
    passwordHash: "$argon2id$m9-test-only",
    role: "OWNER",
    enabled: true,
    createdAt: now,
    updatedAt: now,
    passwordChangedAt: now,
    revision: 1,
  }).run();
  createCanonicalContentRepository(database).bootstrap();
  return {
    root,
    database,
    actor,
    repository: new SQLiteQuestionRepository(database, () => now),
    service: createQuestionDomainService(database, () => now),
  };
}

function closeFixture(fixture: QuestionFixture): void {
  fixture.database.close();
  rmSync(fixture.root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}

function plan(
  fixture: QuestionFixture,
  fixtureName: string,
): QuestionMaterializationPlan {
  return fixture.service.createMaterializationPlan(
    validation(fixtureName),
    fixture.actor,
  );
}

function count(database: ContentDatabase, table: string): number {
  return Number(
    (database.client
      .prepare(`select count(*) as count from ${table}`)
      .get() as { count: number }).count,
  );
}

test("0007 creates an empty Question domain and upgrades 0006 without touching canonical content", () => {
  const freshRoot = temp("pythagoras-m9-fresh-");
  const oldRoot = temp("pythagoras-m9-old-");
  const oldMigrations = temp("pythagoras-m9-migrations-");
  try {
    const fresh = openContentDatabase({
      dataDirectory: freshRoot,
      migrationsDirectory,
    });
    assert.equal(count(fresh, "__drizzle_migrations"), 41);
    for (const table of [
      "question_packages",
      "question_taxonomy_nodes",
      "question_bank_browse_nodes",
      "questions",
      "question_variants",
      "question_primary_variants",
      "question_occurrences",
      "question_occurrence_branches",
      "question_occurrence_qualifiers",
      "question_taxonomy_assignments",
      "question_package_asset_bindings",
    ]) {
      assert.ok(
        fresh.client
          .prepare("select name from sqlite_master where type='table' and name=?")
          .get(table),
      );
      assert.equal(count(fresh, table), 0);
    }
    assert.equal(fresh.client.pragma("foreign_keys", { simple: true }), 1);
    assert.deepEqual(fresh.client.pragma("foreign_key_check"), []);
    const taxonomyForeignKeys = fresh.client.pragma(
      "foreign_key_list('question_taxonomy_nodes')",
    ) as Array<{ table: string; from: string; to: string }>;
    assert.ok(
      taxonomyForeignKeys.some(
        (foreignKey) =>
          foreignKey.table === "question_taxonomy_nodes" &&
          foreignKey.from === "parent_id" &&
          foreignKey.to === "id",
      ),
    );
    const taxonomyIndexes = fresh.client.pragma(
      "index_list('question_taxonomy_nodes')",
    ) as Array<{ name: string }>;
    assert.ok(
      taxonomyIndexes.some(
        (index) => index.name === "question_taxonomy_sibling_order_unique",
      ),
    );
    assert.equal(fresh.client.pragma("quick_check", { simple: true }), "ok");
    fresh.close();

    mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
    for (const name of [
      "0000_content-foundation.sql",
      "0001_admin-identity.sql",
      "0002_assets.sql",
      "0003_change-management.sql",
      "0004_legacy-migration.sql",
      "0005_canonical-content.sql",
      "0006_pretty_marvex.sql",
    ]) {
      copyFileSync(
        path.join(migrationsDirectory, name),
        path.join(oldMigrations, name),
      );
    }
    const journal = JSON.parse(
      readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8"),
    );
    journal.entries = journal.entries.slice(0, 7);
    writeFileSync(
      path.join(oldMigrations, "meta", "_journal.json"),
      JSON.stringify(journal),
    );
    const before = openContentDatabase({
      dataDirectory: oldRoot,
      migrationsDirectory: oldMigrations,
    });
    const oldActor = uuidv7();
    const now = Date.now();
    before.db.insert(adminUsers).values({
      id: oldActor,
      email: "m9-upgrade@example.test",
      displayName: "Upgrade Owner",
      passwordHash: "$argon2id$m9-test-only",
      role: "OWNER",
      enabled: true,
      createdAt: now,
      updatedAt: now,
      passwordChangedAt: now,
      revision: 1,
    }).run();
    const canonicalBefore = createCanonicalContentRepository(before).bootstrap();
    const bannerCount = count(before, "canonical_banners");
    const materialLabels = before.db
      .select({ label: canonicalMaterials.label })
      .from(canonicalMaterials)
      .all();
    before.close();

    const upgraded = openContentDatabase({
      dataDirectory: oldRoot,
      migrationsDirectory,
    });
    assert.equal(count(upgraded, "__drizzle_migrations"), 41);
    assert.equal(count(upgraded, "canonical_banners"), bannerCount);
    assert.deepEqual(
      upgraded.db
        .select({ label: canonicalMaterials.label })
        .from(canonicalMaterials)
        .all(),
      materialLabels,
    );
    assert.equal(
      createCanonicalContentRepository(upgraded).getSnapshot().state.id,
      canonicalBefore.id,
    );
    assert.equal(count(upgraded, "question_packages"), 0);
    assert.equal(count(upgraded, "questions"), 0);
    assert.equal(upgraded.client.pragma("quick_check", { simple: true }), "ok");
    upgraded.close();
  } finally {
    for (const target of [freshRoot, oldRoot, oldMigrations]) {
      try { rmSync(target, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      }); } catch { /* best-effort test fixture cleanup */ }
    }
  }
});

test("eligible Literature and Grammar packages map losslessly without generating identities", () => {
  const literatureFixture = createFixture();
  const grammarFixture = createFixture();
  try {
    const literaturePlan = plan(literatureFixture, "b-literature-valid.json");
    const sourceLiterature = validation("b-literature-valid.json").package!;
    assert.equal(literaturePlan.package.id, sourceLiterature.package.id);
    assert.equal(literaturePlan.questions[0].id, sourceLiterature.questions[0].id);
    assert.equal(
      literaturePlan.questions[0].variants[0].id,
      sourceLiterature.questions[0].variants[0].id,
    );
    assert.equal(
      literaturePlan.questions[0].variants[0].occurrences[0].id,
      sourceLiterature.questions[0].variants[0].occurrences[0].id,
    );
    const literature = literatureFixture.service.materializePlan(literaturePlan);
    assert.equal(literature.package.contentRevision, 1);
    assert.equal(literature.package.revision, 1);
    assert.equal(literature.questions[0].primaryVariantId, sourceLiterature.questions[0].primaryVariantId);

    const grammarPlan = plan(grammarFixture, "c-grammar-tree-valid.json");
    assert.equal(grammarPlan.package.bankBrowseMode, "TREE");
    assert.equal(grammarPlan.browseNodes.length, 9);
    grammarPlan.browseNodes.forEach((node, index) => {
      assert.equal(node.taxonomyNodeId, validation("c-grammar-tree-valid.json").package!.bankBrowse.mode === "TREE" ? validation("c-grammar-tree-valid.json").package!.bankBrowse.nodes[index].filter?.taxonomyNodeId : null);
    });
    const grammar = grammarFixture.service.materializePlan(grammarPlan);
    assert.equal(grammar.browseNodes.length, 9);
    assert.equal(grammar.questions.length, 0);
  } finally {
    closeFixture(literatureFixture);
    closeFixture(grammarFixture);
  }
});

test("nested hierarchy, multi-topic assignments, primary ownership, and missing answers persist", () => {
  const nestedFixture = createFixture();
  const assignmentFixture = createFixture();
  const warningFixture = createFixture();
  try {
    const nested = nestedFixture.service.materializePlan(
      plan(nestedFixture, "n-nested-hierarchy-valid.json"),
    );
    assert.equal(
      nested.taxonomy.find((node) => node.nodeKey === "unit-one-topic")?.parentId,
      nested.taxonomy.find((node) => node.nodeKey === "unit-one")?.id,
    );

    const packageValue = structuredClone(
      fixtureJson("b-literature-valid.json"),
    ) as QuestionPackageV1;
    packageValue.taxonomy.push({
      id: "01910000-0000-7000-8000-000000000017",
      key: "related-topic",
      label: "موضوع مرتبط",
      kind: "topic",
      parentId: null,
      order: 2,
    });
    packageValue.questions[0].taxonomyAssignments.push({
      taxonomyNodeId: "01910000-0000-7000-8000-000000000017",
      role: "RELATED",
    });
    const multiTopicValidation = inspectQuestionPackageJson(packageValue, {
      canonicalSubjectKeys: subjectKeys,
    });
    const multiTopicPlan = assignmentFixture.service.createMaterializationPlan(
      multiTopicValidation,
      assignmentFixture.actor,
    );
    const multiTopic = assignmentFixture.service.materializePlan(multiTopicPlan);
    assert.deepEqual(
      multiTopic.questions[0].taxonomyAssignments.map((item) => item.role),
      ["PRIMARY", "RELATED"],
    );
    const relatedAssignment = multiTopic.questions[0].taxonomyAssignments[1];
    assertSqlConstraint(
      assignmentFixture.database,
      "update question_taxonomy_assignments set role='PRIMARY' where question_id=? and taxonomy_node_id=?",
      [multiTopic.questions[0].id, relatedAssignment.taxonomyNodeId],
    );
    assert.equal(
      multiTopic.questions[0].variants.some(
        (variant) => variant.id === multiTopic.questions[0].primaryVariantId,
      ),
      true,
    );

    const warningPlan = plan(warningFixture, "k-warning-missing-answer.json");
    assert.ok(
      warningPlan.warnings.some(
        (diagnostic) => diagnostic.code === "SHARED_ANSWER_MISSING",
      ),
    );
    const warningAggregate = warningFixture.service.materializePlan(warningPlan);
    assert.equal(warningAggregate.questions[0].sharedAnswer, null);
  } finally {
    closeFixture(nestedFixture);
    closeFixture(assignmentFixture);
    closeFixture(warningFixture);
  }
});

test("multi-Variant provenance, branches, qualifiers, and exact rawLabel survive restart", () => {
  const fixture = createFixture();
  try {
    const source = validation("d-multi-variant-valid.json").package!;
    const aggregate = fixture.service.materializePlan(
      plan(fixture, "d-multi-variant-valid.json"),
    );
    assert.equal(aggregate.questions.length, 1);
    assert.equal(aggregate.questions[0].variants.length, 2);
    const occurrence = aggregate.questions[0].variants[0].occurrences[0];
    assert.equal(occurrence.variantId, source.questions[0].variants[0].id);
    assert.deepEqual(occurrence.branches, ["العلمي", "الأدبي"]);
    assert.deepEqual(occurrence.qualifiers, ["داخل القطر", "نازحين"]);
    assert.equal(occurrence.rawLabel, source.questions[0].variants[0].occurrences[0].rawLabel);
    assert.equal(count(fixture.database, "question_occurrence_branches"), 2);
    assert.equal(count(fixture.database, "question_occurrence_qualifiers"), 2);

    const packageId = aggregate.package.id;
    fixture.database.close();
    const reopened = openContentDatabase({
      dataDirectory: fixture.root,
      migrationsDirectory,
    });
    try {
      const persisted = new SQLiteQuestionRepository(reopened).getPackageAggregate(packageId);
      assert.equal(persisted?.questions[0].variants.length, 2);
      assert.deepEqual(
        persisted?.questions[0].variants[0].occurrences[0].branches,
        occurrence.branches,
      );
      assert.equal(reopened.client.pragma("quick_check", { simple: true }), "ok");
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(fixture.root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});

test("RichDocument block and verse IDs persist while portable assetRef resolves to Asset ID", () => {
  const richFixture = createFixture();
  const imageFixture = createFixture();
  try {
    const richSource = validation("e-rich-content-valid.json").package!;
    const rich = richFixture.service.materializePlan(
      plan(richFixture, "e-rich-content-valid.json"),
    );
    assert.deepEqual(
      rich.questions[0].variants[0].content.blocks.map((block) => block.id),
      richSource.questions[0].variants[0].content.blocks.map((block) => block.id),
    );
    const sourceQuran = richSource.questions[0].variants[0].content.blocks.find(
      (block) => block.type === "quran",
    );
    const canonicalQuran = rich.questions[0].variants[0].content.blocks.find(
      (block) => block.type === "quran",
    );
    assert.equal(
      sourceQuran?.type === "quran" && canonicalQuran?.type === "quran"
        ? canonicalQuran.verses[0].id
        : null,
      sourceQuran?.type === "quran" ? sourceQuran.verses[0].id : null,
    );

    const manifest = validation("f-asset-ref-valid.json").package!.assetsManifest[0];
    const assetId = insertAsset(imageFixture, manifest.sha256, manifest.byteSize, manifest.mimeType);
    const sourceAssetId = insertAsset(
      imageFixture,
      "c".repeat(64),
      42,
      "application/json",
      "json",
    );
    const imagePlan = imageFixture.service.createMaterializationPlan(
      validation("f-asset-ref-valid.json"),
      imageFixture.actor,
      { sourceAssetId },
    );
    assert.equal(imagePlan.package.sourceAssetId, sourceAssetId);
    assert.equal(imagePlan.assetBindings[0].assetId, assetId);
    const imageBlock = imagePlan.questions[0].variants[0].content.blocks[0];
    assert.equal(imageBlock.type === "image" ? imageBlock.assetId : null, assetId);
    assert.equal(JSON.stringify(imageBlock).includes("assetRef"), false);
    const imageAggregate = imageFixture.service.materializePlan(imagePlan);
    assert.equal(imageAggregate.assetBindings[0].expectedSha256, manifest.sha256);
    assert.equal(imageAggregate.package.sourceAssetId, sourceAssetId);
    const binding = imageAggregate.assetBindings[0];
    assertSqlConstraint(
      imageFixture.database,
      "insert into question_package_asset_bindings (package_id,asset_ref,expected_sha256,asset_id,filename,mime_type,byte_size,metadata,position) values (?,?,?,?,?,?,?,?,?)",
      [
        imageAggregate.package.id,
        binding.assetRef,
        binding.expectedSha256,
        binding.assetId,
        binding.filename,
        binding.mimeType,
        binding.byteSize,
        null,
        binding.position + 1,
      ],
    );
  } finally {
    closeFixture(richFixture);
    closeFixture(imageFixture);
  }
});

test("asset resolution is hash-authoritative, blocks missing required assets, and never uses paths", () => {
  const wrongFixture = createFixture();
  const missingFixture = createFixture();
  try {
    const manifest = validation("f-asset-ref-valid.json").package!.assetsManifest[0];
    insertAsset(wrongFixture, "b".repeat(64), manifest.byteSize, manifest.mimeType);
    assert.throws(
      () => plan(wrongFixture, "f-asset-ref-valid.json"),
      (error) =>
        error instanceof QuestionDomainError &&
        error.code === "QUESTION_ASSET_UNRESOLVED",
    );
    assert.throws(
      () => plan(missingFixture, "f-asset-ref-valid.json"),
      (error) =>
        error instanceof QuestionDomainError &&
        error.code === "QUESTION_ASSET_UNRESOLVED",
    );
    const resolverSource = readFileSync(
      path.join(process.cwd(), "src/server/questions/asset-resolver.ts"),
      "utf8",
    );
    const materializerSource = readFileSync(
      path.join(process.cwd(), "src/server/questions/materializer.ts"),
      "utf8",
    );
    assert.equal(/node:fs|readFile|storageKey|fetch\(|https?:\/\//u.test(`${resolverSource}\n${materializerSource}`), false);
  } finally {
    closeFixture(wrongFixture);
    closeFixture(missingFixture);
  }
});

test("invalid packages cannot plan, while warnings remain visible and atomic failures roll back", () => {
  const invalidFixture = createFixture();
  const rollbackFixture = createFixture();
  const ownershipFixture = createFixture();
  try {
    assert.throws(
      () =>
        invalidFixture.service.createMaterializationPlan(
          validation("g-invalid-primary-variant.json"),
          invalidFixture.actor,
        ),
      (error) =>
        error instanceof QuestionDomainError &&
        error.code === "QUESTION_PACKAGE_INELIGIBLE",
    );

    const rollbackPlan = structuredClone(
      plan(rollbackFixture, "d-multi-variant-valid.json"),
    ) as QuestionMaterializationPlan;
    rollbackPlan.questions[0].variants[0].occurrences[0].branches[0] = "";
    assert.throws(() => rollbackFixture.repository.materialize(rollbackPlan));
    for (const table of [
      "question_packages",
      "question_taxonomy_nodes",
      "questions",
      "question_variants",
      "question_occurrences",
      "question_occurrence_branches",
    ]) {
      assert.equal(count(rollbackFixture.database, table), 0, table);
    }

    const noPrimaryPlan = structuredClone(
      plan(ownershipFixture, "b-literature-valid.json"),
    ) as QuestionMaterializationPlan;
    noPrimaryPlan.questions[0].taxonomyAssignments[0].role = "RELATED";
    assert.throws(
      () => ownershipFixture.repository.materialize(noPrimaryPlan),
      (error) =>
        error instanceof QuestionDomainError &&
        error.code === "QUESTION_DOMAIN_VALIDATION_FAILED",
    );
    assert.equal(count(ownershipFixture.database, "question_packages"), 0);
  } finally {
    closeFixture(invalidFixture);
    closeFixture(rollbackFixture);
    closeFixture(ownershipFixture);
  }
});

test("database constraints reject duplicate identities/orders and stale optimistic writes", () => {
  const fixture = createFixture();
  try {
    const materializationPlan = plan(fixture, "d-multi-variant-valid.json");
    const aggregate = fixture.repository.materialize(materializationPlan);
    assert.throws(
      () => fixture.repository.materialize(materializationPlan),
      (error) =>
        error instanceof QuestionDomainError &&
        error.code === "QUESTION_DOMAIN_DUPLICATE",
    );
    assertSqlConstraint(
      fixture.database,
      "insert into question_packages (id,package_key,title,subject_key,language,content_revision,bank_browse_mode,bank_browse_entry_key,bank_browse_entry_label,bank_browse_entry_order,source_asset_id,created_at,updated_at,updated_by,revision) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        uuidv7(),
        aggregate.package.packageKey,
        "Duplicate key",
        "biology",
        "ar-IQ",
        1,
        "ALL_PACKAGE_QUESTIONS",
        "duplicate-key-entry",
        "Duplicate key entry",
        1,
        null,
        Date.now(),
        Date.now(),
        fixture.actor.actorUserId,
        1,
      ],
    );

    const question = aggregate.questions[0];
    assertSqlConstraint(fixture.database, "insert into questions (id,package_id,display_order,shared_answer,created_at,updated_at,updated_by,revision) values (?,?,?,?,?,?,?,?)", [uuidv7(), aggregate.package.id, question.displayOrder, null, Date.now(), Date.now(), fixture.actor.actorUserId, 1]);
    assertSqlConstraint(fixture.database, "insert into question_variants (id,question_id,display_order,content,created_at,updated_at,updated_by,revision) values (?,?,?,?,?,?,?,?)", [uuidv7(), question.id, question.variants[0].displayOrder, JSON.stringify(question.variants[0].content), Date.now(), Date.now(), fixture.actor.actorUserId, 1]);
    const firstOccurrence = question.variants[0].occurrences[0];
    assertSqlConstraint(fixture.database, "insert into question_occurrences (id,variant_id,display_order,source_kind,raw_label,created_at,updated_at,updated_by,revision) values (?,?,?,?,?,?,?,?,?)", [uuidv7(), question.variants[0].id, firstOccurrence.displayOrder, "other", "duplicate", Date.now(), Date.now(), fixture.actor.actorUserId, 1]);

    const updated = fixture.repository.updatePackageTitle({
      id: aggregate.package.id,
      title: "عنوان محدث",
      expectedRevision: 1,
      actor: fixture.actor,
    });
    assert.equal(updated.revision, 2);
    assert.throws(
      () =>
        fixture.repository.updatePackageTitle({
          id: aggregate.package.id,
          title: "تعديل قديم",
          expectedRevision: 1,
          actor: fixture.actor,
        }),
      (error) => error instanceof QuestionDomainConflictError,
    );
  } finally {
    closeFixture(fixture);
  }
});

test("sibling and cross-aggregate foreign keys reject relational corruption", () => {
  const fixture = createFixture();
  try {
    const nested = fixture.service.materializePlan(
      plan(fixture, "n-nested-hierarchy-valid.json"),
    );
    const now = Date.now();
    assertSqlConstraint(fixture.database, "insert into question_taxonomy_nodes (id,package_id,node_key,label,kind,parent_id,display_order,created_at,updated_at,updated_by,revision) values (?,?,?,?,?,?,?,?,?,?,?)", [uuidv7(), nested.package.id, "duplicate-root", "Duplicate", "topic", null, 1, now, now, fixture.actor.actorUserId, 1]);
    assertSqlConstraint(fixture.database, "insert into question_bank_browse_nodes (id,package_id,node_key,label,node_type,parent_id,display_order,taxonomy_node_id,include_descendants,created_at,updated_at,updated_by,revision) values (?,?,?,?,?,?,?,?,?,?,?,?,?)", [uuidv7(), nested.package.id, "duplicate-browse", "Duplicate", "GROUP", null, 1, null, null, now, now, fixture.actor.actorUserId, 1]);

    const otherPackageId = uuidv7();
    fixture.database.db.insert(questionPackages).values({
      id: otherPackageId,
      packageKey: "other-package",
      title: "Other",
      subjectKey: "biology",
      language: "ar-IQ",
      contentRevision: 1,
      bankBrowseMode: "TREE",
      bankBrowseEntryKey: "other",
      bankBrowseEntryLabel: "Other",
      bankBrowseEntryOrder: 1,
      sourceAssetId: null,
      createdAt: now,
      updatedAt: now,
      updatedBy: fixture.actor.actorUserId,
      revision: 1,
    }).run();
    const otherTaxonomyId = uuidv7();
    fixture.database.db.insert(questionTaxonomyNodes).values({
      id: otherTaxonomyId,
      packageId: otherPackageId,
      nodeKey: "other-topic",
      label: "Other",
      kind: "topic",
      parentId: null,
      displayOrder: 1,
      createdAt: now,
      updatedAt: now,
      updatedBy: fixture.actor.actorUserId,
      revision: 1,
    }).run();
    const otherBrowseId = uuidv7();
    fixture.database.db.insert(questionBankBrowseNodes).values({
      id: otherBrowseId,
      packageId: otherPackageId,
      nodeKey: "other-group",
      label: "Other group",
      nodeType: "GROUP",
      parentId: null,
      displayOrder: 1,
      taxonomyNodeId: null,
      includeDescendants: null,
      createdAt: now,
      updatedAt: now,
      updatedBy: fixture.actor.actorUserId,
      revision: 1,
    }).run();
    assertSqlConstraint(fixture.database, "insert into question_taxonomy_nodes (id,package_id,node_key,label,kind,parent_id,display_order,created_at,updated_at,updated_by,revision) values (?,?,?,?,?,?,?,?,?,?,?)", [uuidv7(), nested.package.id, "cross-parent", "Cross", "topic", otherTaxonomyId, 3, now, now, fixture.actor.actorUserId, 1]);
    assertSqlConstraint(fixture.database, "insert into question_bank_browse_nodes (id,package_id,node_key,label,node_type,parent_id,display_order,taxonomy_node_id,include_descendants,created_at,updated_at,updated_by,revision) values (?,?,?,?,?,?,?,?,?,?,?,?,?)", [uuidv7(), nested.package.id, "cross-target", "Cross", "QUESTION_LIST", null, 3, otherTaxonomyId, 1, now, now, fixture.actor.actorUserId, 1]);
    assertSqlConstraint(fixture.database, "insert into question_bank_browse_nodes (id,package_id,node_key,label,node_type,parent_id,display_order,taxonomy_node_id,include_descendants,created_at,updated_at,updated_by,revision) values (?,?,?,?,?,?,?,?,?,?,?,?,?)", [uuidv7(), nested.package.id, "cross-parent", "Cross parent", "GROUP", otherBrowseId, 3, null, null, now, now, fixture.actor.actorUserId, 1]);

    const questionId = uuidv7();
    fixture.database.db.insert(questions).values({ id: questionId, packageId: nested.package.id, displayOrder: 1, sharedAnswer: null, createdAt: now, updatedAt: now, updatedBy: fixture.actor.actorUserId, revision: 1 }).run();
    assertSqlConstraint(fixture.database, "insert into question_taxonomy_assignments (package_id,question_id,taxonomy_node_id,role,position) values (?,?,?,?,?)", [nested.package.id, questionId, otherTaxonomyId, "PRIMARY", 0]);

    const firstVariantId = uuidv7();
    const secondQuestionId = uuidv7();
    const secondVariantId = uuidv7();
    const document = JSON.stringify({ type: "doc", version: 1, blocks: [{ id: uuidv7(), type: "paragraph", spans: [{ text: "x" }] }] });
    fixture.database.db.insert(questionVariants).values({ id: firstVariantId, questionId, displayOrder: 1, content: JSON.parse(document), createdAt: now, updatedAt: now, updatedBy: fixture.actor.actorUserId, revision: 1 }).run();
    fixture.database.db.insert(questions).values({ id: secondQuestionId, packageId: nested.package.id, displayOrder: 2, sharedAnswer: null, createdAt: now, updatedAt: now, updatedBy: fixture.actor.actorUserId, revision: 1 }).run();
    fixture.database.db.insert(questionVariants).values({ id: secondVariantId, questionId: secondQuestionId, displayOrder: 1, content: JSON.parse(document), createdAt: now, updatedAt: now, updatedBy: fixture.actor.actorUserId, revision: 1 }).run();
    assertSqlConstraint(fixture.database, "insert into question_primary_variants (question_id,variant_id) values (?,?)", [secondQuestionId, firstVariantId]);
  } finally {
    closeFixture(fixture);
  }
});

test("Question foundation keeps search as a separate derived projection and excludes quiz and corpus data", () => {
  const apiFiles = readFileTree(path.join(process.cwd(), "src/app/api"));
  assert.equal(/api[\\/]admin[\\/]questions|api[\\/]content[\\/]questions/u.test(apiFiles.paths), false);
  assert.equal(/getQuestionDomainService|materializePlan|createMaterializationPlan/u.test(apiFiles.contents), false);
  const adminQuestions = readFileSync(
    path.join(process.cwd(), "src/app/admin/(protected)/questions/page.tsx"),
    "utf8",
  );
  assert.ok(adminQuestions.includes("QuestionPackagesWorkspace"));
  assert.equal(/server\/questions|api\/admin\/questions/u.test(adminQuestions), false);
  const questionServer = readFileTree(path.join(process.cwd(), "src/server/questions"));
  assert.equal(/fts5|content_resources|quiz|mcq|istifham/iu.test(questionServer.contents), false);
});

function insertAsset(
  fixture: QuestionFixture,
  sha256: string,
  byteSize: number,
  mimeType: string,
  mediaKind: "image" | "json" = "image",
): string {
  const id = uuidv7();
  const now = Date.now();
  fixture.database.db.insert(assets).values({
    id,
    originalFilename: mediaKind === "json" ? "package.json" : "diagram.png",
    displayName: mediaKind === "json" ? "Question Package" : "Diagram",
    mimeType,
    mediaKind,
    byteSize,
    sha256,
    storageKey: `${sha256.slice(0, 2)}/${sha256}`,
    width: mediaKind === "image" ? 1 : null,
    height: mediaKind === "image" ? 1 : null,
    durationMs: null,
    createdBy: fixture.actor.actorUserId,
    updatedBy: fixture.actor.actorUserId,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }).run();
  return id;
}

function assertSqlConstraint(
  database: ContentDatabase,
  statement: string,
  values: unknown[],
): void {
  assert.throws(() => database.client.prepare(statement).run(...values));
}

function readFileTree(root: string): { paths: string; contents: string } {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, {
      withFileTypes: true,
    })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else files.push(target);
    }
  };
  visit(root);
  return {
    paths: files.join("\n"),
    contents: files.map((file) => readFileSync(file, "utf8")).join("\n"),
  };
}
