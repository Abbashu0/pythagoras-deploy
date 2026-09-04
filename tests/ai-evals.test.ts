import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { createCanonicalContentRepository } from "../src/server/canonical-content";
import {
  AIEvalCaseChangeAdapter,
  AIEvalError,
  fingerprintAIEvalAccountingBasis,
  type AIEvalAccountingReader,
  AIEvalRunService,
  AIEvalSuiteChangeAdapter,
  AI_EVAL_CASE_RESOURCE_TYPE,
  AI_EVAL_GRADER_KEYS,
  AI_EVAL_GRADER_REGISTRY_KEY,
  AI_EVAL_GRADER_REGISTRY_REVISION,
  AI_EVAL_SCORE_SCALE,
  AI_EVAL_SUITE_RESOURCE_TYPE,
  AIDeterministicEvalGraderRegistry,
  SQLiteAIEvalCaseRepository,
  SQLiteAIEvalRunRepository,
  SQLiteAIEvalSuiteRepository,
  createDefaultAIEvalGraderRegistry,
  fingerprintAIEvalCandidate,
  fingerprintAIEvalManifest,
  hashEvalOutput,
  normalizeAIEvalCandidateSnapshot,
  normalizeAIEvalCaseContent,
  normalizeAIEvalObservation,
  normalizeAIEvalSuiteContent,
  AI_EVAL_JUDGE_CONFIG_RESOURCE_TYPE,
  AI_EVAL_JUDGE_PROTOCOL_KEY,
  AI_EVAL_JUDGE_PROTOCOL_REVISION,
} from "../src/server/ai/evals";
import {
  AI_TUTOR_CITATION_PROTOCOL_KEY,
  AI_TUTOR_CITATION_PROTOCOL_REVISION,
  AI_TUTOR_GROUNDING_PROTOCOL_KEY,
  AI_TUTOR_GROUNDING_PROTOCOL_REVISION,
} from "../src/server/ai/tutor";
import { SQLiteAIBudgetPolicyRepository } from "../src/server/ai/budget";
import { SQLiteAIProviderConfigRepository } from "../src/server/ai/configuration";
import { SQLiteAIModelConfigRepository } from "../src/server/ai/model-registry";
import { SQLiteAIRateLimitPolicyRepository } from "../src/server/ai/rate-limits";
import { SQLiteAIAccountingRepository, type AICostOperationContent, type AIUsageCostRecord } from "../src/server/ai/economics";
import { createChangeManagementService } from "../src/server/change-management";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const BASE_TIME = 1_900_500_000_000;

interface Fixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  changes: ReturnType<typeof createChangeManagementService>;
  cases: SQLiteAIEvalCaseRepository;
  suites: SQLiteAIEvalSuiteRepository;
  runs: SQLiteAIEvalRunRepository;
  close(): void;
}

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m9a-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  createCanonicalContentRepository(database).bootstrap();
  const identities = new SQLiteAdminIdentityRepository(database);
  const owner = identities.createInitialOwner({ id: uuidv7(), email: `owner-${uuidv7()}@m9a.test`, displayName: "M9A Owner", passwordHash: "fixture", createdAt: BASE_TIME });
  return {
    root,
    database,
    owner: { actorUserId: owner.id, actorRole: "OWNER" },
    changes: createChangeManagementService(database),
    cases: new SQLiteAIEvalCaseRepository(database),
    suites: new SQLiteAIEvalSuiteRepository(database),
    runs: new SQLiteAIEvalRunRepository(database),
    close() { database.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

function createMigrationDirectory(prefix: string, count: number): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  mkdirSync(path.join(directory, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }>; [key: string]: unknown };
  const entries = journal.entries.slice(0, count);
  for (const entry of entries) {
    copyFileSync(path.join(migrationsDirectory, `${entry.tag}.sql`), path.join(directory, `${entry.tag}.sql`));
    const snapshotName = `${entry.idx.toString().padStart(4, "0")}_snapshot.json`;
    if (existsSync(path.join(migrationsDirectory, "meta", snapshotName))) copyFileSync(path.join(migrationsDirectory, "meta", snapshotName), path.join(directory, "meta", snapshotName));
  }
  writeFileSync(path.join(directory, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
  return directory;
}

function fakeUsageRecord(operationId: string, costCompleteness: "COMPLETE" | "PARTIAL"): AIUsageCostRecord {
  return { id: uuidv7(), operationId, costCompleteness, completedAt: BASE_TIME + 1 } as AIUsageCostRecord;
}

function evalAccountingReader(
  accounting: SQLiteAIAccountingRepository,
  records: readonly AIUsageCostRecord[],
  totalNano: number,
  correctionIds: readonly string[] = [],
): AIEvalAccountingReader {
  return {
    getOperation: (id) => accounting.getOperation(id),
    getOperationCostSummary: (id) => ({ operationId: id, totals: [{ currency: "USD", totalNano }] }),
    listUsageCostRecords: () => [...records],
    listCorrections: () => correctionIds.map((id) => ({ id })),
  };
}

function createEvalOperation(database: ContentDatabase, evalRunId: string, overrides: Partial<AICostOperationContent> = {}): { accounting: SQLiteAIAccountingRepository; id: string } {
  const accounting = new SQLiteAIAccountingRepository(database);
  const id = uuidv7();
  accounting.createOperation({
    id,
    content: {
      costCenter: "EVALS",
      idempotencyKey: null,
      opaquePrincipalRef: null,
      subjectKey: "biology",
      conversationId: null,
      responseId: null,
      jobId: null,
      evalRunId,
      knowledgeRevision: null,
      status: "OPEN",
      startedAt: BASE_TIME,
      completedAt: null,
      ...overrides,
    },
  });
  return { accounting, id };
}

function publishChange(fixture: Fixture, input: Parameters<Fixture["changes"]["createChangeSet"]>[0]): void {
  const draft = fixture.changes.createChangeSet(input, fixture.owner);
  const submitted = fixture.changes.submit(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
  const approved = fixture.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
  fixture.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
}

function caseContent(key = `m9a.case.${uuidv7()}`, overrides: Record<string, unknown> = {}) {
  return {
    key,
    subjectKey: "biology",
    displayName: "Synthetic biology case",
    description: null,
    inputText: "Explain one safe synthetic fact.",
    origin: "SYNTHETIC" as const,
    privacyClass: "SYNTHETIC_PUBLIC_SAFE" as const,
    deidentificationProof: null,
    expectedStatus: "COMPLETED" as const,
    allowedFinishReasons: ["STOP"] as const,
    requiredOutputLiterals: ["safe"],
    forbiddenOutputLiterals: ["leak"],
    requiredEvidenceOrigins: [],
    forbiddenEvidenceOrigins: [],
    requiredCitationLabels: ["[E1]"],
    minimumEvidenceItemCount: 0,
    securityLeakageMarkers: ["TOP_SECRET_REAL_STUDENT_M9A_73"],
    maximumOutputBytes: 1_024,
    sourceRevisionReferences: [],
    enabled: true,
    ...overrides,
  };
}

function suiteContent(caseId: string, caseRevision = 1, overrides: Record<string, unknown> = {}) {
  return {
    key: `m9a.suite.${uuidv7()}`,
    subjectKey: "biology",
    displayName: "Synthetic deterministic suite",
    enabled: true,
    caseManifest: [{ ordinal: 1, caseId, caseRevision }],
    requiredDimensions: [
      { dimension: "CORRECTNESS" as const, mode: "DETERMINISTICALLY_GRADED" as const },
      { dimension: "GROUNDEDNESS" as const, mode: "DETERMINISTICALLY_GRADED" as const },
      { dimension: "SECURITY" as const, mode: "DETERMINISTICALLY_GRADED" as const },
    ],
    graderConfigs: [
      { graderKey: AI_EVAL_GRADER_KEYS.STATUS_MATCH, graderRevision: 1, dimension: "CORRECTNESS" as const, required: true },
      { graderKey: AI_EVAL_GRADER_KEYS.LITERAL_OUTPUT, graderRevision: 1, dimension: "CORRECTNESS" as const, required: true },
      { graderKey: AI_EVAL_GRADER_KEYS.CITATION_INTEGRITY, graderRevision: 1, dimension: "GROUNDEDNESS" as const, required: true },
      { graderKey: AI_EVAL_GRADER_KEYS.SECURITY_LEAK, graderRevision: 1, dimension: "SECURITY" as const, required: true },
    ],
    gateConfig: { minimumScores: [], maximumCostNano: null, maximumLatencyMs: null, requireSecurityPass: true },
    permittedRegressionDeltas: [],
    baselineMode: "OPTIONAL" as const,
    supplementaryJudgeConfig: null,
    ...overrides,
  };
}

function createPublishedCase(fixture: Fixture, content = caseContent()): string {
  const id = uuidv7();
  publishChange(fixture, { title: "Publish synthetic Eval Case", initialItem: { resourceType: AI_EVAL_CASE_RESOURCE_TYPE, resourceId: id, operation: "CREATE", expectedRevision: 0, desired: content } });
  assert.ok(fixture.cases.getById(id));
  return id;
}

function createPublishedSuite(fixture: Fixture, caseId: string, content = suiteContent(caseId)): string {
  const id = uuidv7();
  publishChange(fixture, { title: "Publish synthetic Eval Suite", initialItem: { resourceType: AI_EVAL_SUITE_RESOURCE_TYPE, resourceId: id, operation: "CREATE", expectedRevision: 0, desired: { ...content, key: content.key } } });
  assert.ok(fixture.suites.getById(id));
  return id;
}

function createPublishedJudgeInfrastructure(fixture: Fixture): { referenceKey: string; revision: number } {
  const credentialRef = uuidv7();
  fixture.database.client
    .prepare("insert into ai_secret_refs (credential_ref, status, secret_version, created_at, updated_at, revision) values (?, 'ACTIVE', 1, ?, ?, 1)")
    .run(credentialRef, BASE_TIME, BASE_TIME);

  const providerId = uuidv7();
  new SQLiteAIProviderConfigRepository(fixture.database).create({
    id: providerId,
    content: {
      key: `eval-judge-provider-${providerId.slice(0, 8)}`,
      displayName: "Judge Provider",
      baseUrl: "https://fake.provider.test",
      enabled: true,
      credentialRef,
      retentionPolicy: "ZERO_RETENTION",
      trainingPolicy: "NOT_USED_FOR_TRAINING",
      zdrSupported: true,
      zdrRequired: false,
    },
    actor: fixture.owner,
    now: BASE_TIME,
  });

  const modelId = uuidv7();
  new SQLiteAIModelConfigRepository(fixture.database).create({
    id: modelId,
    content: {
      key: `eval-judge-model-${modelId.slice(0, 8)}`,
      displayName: "Judge Model",
      providerConfigId: providerId,
      providerModelId: "judge-model-1",
      capability: "GENERATION",
      adapterKey: "fake-generation",
      enabled: true,
      contextWindowTokens: 8192,
      maxOutputTokens: 2048,
      embeddingDimensions: null,
      supportsStreaming: true,
      supportsReasoning: false,
      supportsStructuredOutput: true,
    },
    actor: fixture.owner,
    now: BASE_TIME,
  });

  const budgetPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(fixture.database).create({
    id: budgetPolicyId,
    content: {
      key: `eval-judge-budget-${budgetPolicyId.slice(0, 8)}`,
      displayName: "Eval Judge Budget",
      currency: "USD",
      costCenter: "EVALS",
      hardCapNano: 10_000_000,
      enabled: true,
    },
    actor: fixture.owner,
    now: BASE_TIME,
  });

  const rateLimitPolicyId = uuidv7();
  new SQLiteAIRateLimitPolicyRepository(fixture.database).create({
    id: rateLimitPolicyId,
    content: {
      key: `eval-judge-rate-${rateLimitPolicyId.slice(0, 8)}`,
      displayName: "Eval Judge Rate",
      windowMs: 60_000,
      maxRequests: 100,
      maxConcurrentRequests: 100,
      enabled: true,
    },
    actor: fixture.owner,
    now: BASE_TIME,
  });

  const judgeConfigId = uuidv7();
  const judgeKey = `eval-judge-${judgeConfigId.slice(0, 8)}`;
  publishChange(fixture, {
    title: "Publish Eval Judge Config",
    initialItem: {
      resourceType: AI_EVAL_JUDGE_CONFIG_RESOURCE_TYPE,
      resourceId: judgeConfigId,
      operation: "CREATE",
      expectedRevision: 0,
      desired: {
        key: judgeKey,
        subjectKey: "biology",
        displayName: "Biology Eval Judge",
        enabled: true,
        modelConfigId: modelId,
        modelConfigRevision: 1,
        providerConfigId: providerId,
        providerConfigRevision: 1,
        budgetPolicyId,
        budgetPolicyRevision: 1,
        rateLimitPolicyId,
        rateLimitPolicyRevision: 1,
        protocolKey: AI_EVAL_JUDGE_PROTOCOL_KEY,
        protocolRevision: AI_EVAL_JUDGE_PROTOCOL_REVISION,
        timeoutMs: 15_000,
        maxOutputTokens: 2048,
      },
    },
  });

  return { referenceKey: judgeKey, revision: 1 };
}

function candidateSnapshot() {
  return normalizeAIEvalCandidateSnapshot({
    tutorConfig: { id: uuidv7(), revision: 1 },
    globalPolicy: { id: uuidv7(), revision: 1 },
    subjectPolicy: { id: uuidv7(), revision: 1 },
    contextPolicy: { id: uuidv7(), revision: 1 },
    retrievalConfig: { id: uuidv7(), revision: 1 },
    generationModel: { id: uuidv7(), revision: 1 },
    generationProvider: { id: uuidv7(), revision: 1 },
    embeddingSpace: null,
    rerank: null,
    groundingProtocol: { key: AI_TUTOR_GROUNDING_PROTOCOL_KEY, revision: AI_TUTOR_GROUNDING_PROTOCOL_REVISION },
    citationProtocol: { key: AI_TUTOR_CITATION_PROTOCOL_KEY, revision: AI_TUTOR_CITATION_PROTOCOL_REVISION },
  });
}

function citation(): Record<string, unknown> {
  return { label: "[E1]", ordinal: 1, chunkId: uuidv7(), m7aProjectionRevisionId: uuidv7(), m7bEmbeddingProjectionRevisionId: null, originKind: "KNOWLEDGE_PACKAGE", originId: uuidv7(), questionId: null, questionRevision: null };
}

function observation(runId: string, caseId: string, overrides: Record<string, unknown> = {}) {
  const outputText = "safe answer [E1]";
  const value = {
    runId,
    caseId,
    caseRevision: 1,
    observedSubjectKey: "biology",
    observedStatus: "COMPLETED" as const,
    finishReason: "STOP" as const,
    outputText,
    citationMap: [citation()],
    evidence: [],
    retrievalStatus: "NOT_APPLICABLE" as const,
    outputBytes: Buffer.byteLength(outputText, "utf8"),
    elapsedLatencyMs: 4,
    costOperationId: null,
    groundingProtocolKey: AI_TUTOR_GROUNDING_PROTOCOL_KEY,
    groundingProtocolRevision: AI_TUTOR_GROUNDING_PROTOCOL_REVISION,
    citationProtocolKey: AI_TUTOR_CITATION_PROTOCOL_KEY,
    citationProtocolRevision: AI_TUTOR_CITATION_PROTOCOL_REVISION,
    ...overrides,
  };
  return { ...value, outputBytes: "outputBytes" in overrides ? value.outputBytes : Buffer.byteLength(value.outputText, "utf8") };
}

test("M9A migration is present and exposes no Provider execution path", () => {
  const fixture = createFixture();
  try {
    const count = Number((fixture.database.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count);
    assert.equal(count, 38);
    assert.equal(fixture.database.client.prepare("select 1 from sqlite_master where type='table' and name='ai_eval_suites'").get() !== undefined, true);
    assert.equal(fixture.database.client.prepare("select 1 from sqlite_master where type='table' and name='ai_eval_runs'").get() !== undefined, true);
  } finally { fixture.close(); }
});

test("0030 to 0031 upgrade keeps the existing database and installs Eval tables", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m9a-upgrade-"));
  const oldMigrations = createMigrationDirectory("pythagoras-m9a-old-migrations-", 31);
  const migrationsThrough0031 = createMigrationDirectory("pythagoras-m9a-0031-migrations-", 32);
  let oldDatabase: ContentDatabase | null = null;
  let upgraded: ContentDatabase | null = null;
  try {
    oldDatabase = openContentDatabase({ dataDirectory: root, migrationsDirectory: oldMigrations });
    assert.equal(Number((oldDatabase.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count), 31);
    createCanonicalContentRepository(oldDatabase).bootstrap();
    oldDatabase.close(); oldDatabase = null;
    upgraded = openContentDatabase({ dataDirectory: root, migrationsDirectory: migrationsThrough0031 });
    assert.equal(Number((upgraded.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count), 32);
    for (const table of ["ai_eval_suites", "ai_eval_suite_revisions", "ai_eval_suite_case_refs", "ai_eval_cases", "ai_eval_case_revisions", "ai_eval_runs", "ai_eval_case_results", "ai_eval_grader_results", "ai_eval_dimension_aggregates", "ai_eval_gate_results"]) assert.ok(upgraded.client.prepare("select name from sqlite_master where type='table' and name=?").get(table));
    assert.ok(upgraded.client.prepare("select name from sqlite_master where type='trigger' and name='ai_eval_suites_identity_immutable'").get());
    assert.ok(upgraded.client.prepare("select subject_key from canonical_materials where subject_key='biology'").get());
  } finally {
    oldDatabase?.close(); upgraded?.close(); rmSync(root, { recursive: true, force: true }); rmSync(oldMigrations, { recursive: true, force: true }); rmSync(migrationsThrough0031, { recursive: true, force: true });
  }
});

test("populated 0032 database upgrades to 0033 without rewriting Eval history", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m9a-populated-upgrade-"));
  const migrationsThrough0032 = createMigrationDirectory("pythagoras-m9a-populated-0032-", 33);
  let oldDatabase: ContentDatabase | null = null;
  let upgraded: ContentDatabase | null = null;
  try {
    oldDatabase = openContentDatabase({ dataDirectory: root, migrationsDirectory: migrationsThrough0032 });
    createCanonicalContentRepository(oldDatabase).bootstrap();
    const identities = new SQLiteAdminIdentityRepository(oldDatabase);
    const owner = identities.createInitialOwner({ id: uuidv7(), email: `owner-${uuidv7()}@m9a-upgrade.test`, displayName: "M9A Upgrade Owner", passwordHash: "fixture", createdAt: BASE_TIME });
    const actor: AdminActor = { actorUserId: owner.id, actorRole: "OWNER" };
    const cases = new SQLiteAIEvalCaseRepository(oldDatabase);
    const suites = new SQLiteAIEvalSuiteRepository(oldDatabase);
    const caseId = uuidv7();
    cases.create({ id: caseId, content: normalizeAIEvalCaseContent(caseContent(`m9a.upgrade.case.${uuidv7()}`)), actor, now: BASE_TIME + 1 });
    const suiteId = uuidv7();
    const firstSuiteContent = normalizeAIEvalSuiteContent(suiteContent(caseId));
    suites.create({ id: suiteId, content: firstSuiteContent, actor, now: BASE_TIME + 2 });
    const suiteIdentity = suites.getById(suiteId)!;
    suites.appendRevision({ id: suiteId, expectedRevision: 1, content: { ...firstSuiteContent, displayName: "Populated revision two", key: suiteIdentity.key, subjectKey: suiteIdentity.subjectKey }, actor, now: BASE_TIME + 3 });
    const runService = new AIEvalRunService(oldDatabase);
    const run = runService.createRun({ id: uuidv7(), suiteId, suiteRevision: 2, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 4 });
    runService.startRun(run.id, BASE_TIME + 5);
    runService.recordObservationAndGrade(observation(run.id, caseId), BASE_TIME + 6);
    runService.beginScoring(run.id, BASE_TIME + 7);
    oldDatabase.client.prepare("insert into ai_eval_gate_results (run_id,gate_key,verdict,observed_value,threshold_value,safe_reason_code) values (?,?,?,?,?,?)").run(run.id, "SEEDED_GATE", "PASS", 1, 1, "SEEDED");
    const historicalBefore = oldDatabase.client.prepare("select id, suite_id, revision, display_name, enabled, required_dimensions, grader_configs, gate_config, permitted_regression_deltas, baseline_mode, supplementary_judge_config, created_at, created_by from ai_eval_suite_revisions where suite_id=? order by revision").all(suiteId) as Array<Record<string, unknown>>;
    assert.equal(historicalBefore.length, 2);
    oldDatabase.close(); oldDatabase = null;

    upgraded = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    assert.equal(Number((upgraded.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count), 38);
    assert.deepEqual(upgraded.client.prepare("select key, subject_key, current_revision from ai_eval_suites where id=?").get(suiteId), { key: suiteIdentity.key, subject_key: "biology", current_revision: 2 });
    const historicalAfter = upgraded.client.prepare("select id, suite_id, revision, display_name, enabled, required_dimensions, grader_configs, gate_config, permitted_regression_deltas, baseline_mode, supplementary_judge_config, created_at, created_by from ai_eval_suite_revisions where suite_id=? order by revision").all(suiteId) as Array<Record<string, unknown>>;
    assert.deepEqual(historicalAfter, historicalBefore);
    assert.deepEqual(upgraded.client.prepare("select status, suite_id, suite_revision from ai_eval_runs where id=?").get(run.id), { status: "SCORING", suite_id: suiteId, suite_revision: 2 });
    assert.equal((upgraded.client.prepare("select count(*) as count from ai_eval_case_results where run_id=?").get(run.id) as { count: number }).count, 1);
    assert.equal((upgraded.client.prepare("select count(*) as count from ai_eval_grader_results where case_result_id=(select id from ai_eval_case_results where run_id=? )").get(run.id) as { count: number }).count, 4);
    assert.deepEqual(upgraded.client.prepare("select verdict, accounting_basis from ai_eval_gate_results where run_id=? and gate_key='SEEDED_GATE'").get(run.id), { verdict: "PASS", accounting_basis: null });
    assert.ok(upgraded.client.prepare("select accounting_basis from ai_eval_gate_results limit 0").columns().some((column) => column.name === "accounting_basis"));
    assert.ok(upgraded.client.prepare("select name from sqlite_master where type='trigger' and name='ai_usage_cost_records_operation_open'").get());
    assert.ok(upgraded.client.prepare("select name from sqlite_master where type='trigger' and name='ai_eval_case_results_insert_valid'").get());
    assert.ok(upgraded.client.prepare("select name from sqlite_master where type='trigger' and name='ai_eval_grader_results_insert_valid'").get());
    assert.ok(upgraded.client.prepare("select name from sqlite_master where type='trigger' and name='ai_eval_gate_results_update_blocked'").get());
    const revisionOneId = historicalBefore[0]?.id as string;
    assert.throws(() => upgraded!.client.prepare("update ai_eval_suite_revisions set display_name='mutated' where id=?").run(revisionOneId), /immutable/i);
    assert.throws(() => upgraded!.client.prepare("delete from ai_eval_suite_revisions where id=?").run(revisionOneId), /append-only|history/i);
    assert.throws(() => upgraded!.client.prepare("update ai_eval_suites set current_revision=1 where id=?").run(suiteId), /advance|revision/i);
    assert.throws(() => upgraded!.client.prepare("update ai_eval_suites set current_revision=4 where id=?").run(suiteId), /advance|revision/i);
    const upgradedSuites = new SQLiteAIEvalSuiteRepository(upgraded);
    const current = upgradedSuites.getById(suiteId)!;
    assert.equal(upgradedSuites.appendRevision({ id: suiteId, expectedRevision: 2, content: { ...firstSuiteContent, displayName: "Populated revision three", key: current.key, subjectKey: current.subjectKey }, actor, now: BASE_TIME + 9 }).revision, 3);
    const historicalAfterAppend = upgraded.client.prepare("select id, suite_id, revision, display_name, enabled, required_dimensions, grader_configs, gate_config, permitted_regression_deltas, baseline_mode, supplementary_judge_config, created_at, created_by from ai_eval_suite_revisions where suite_id=? and revision <= 2 order by revision").all(suiteId) as Array<Record<string, unknown>>;
    assert.deepEqual(historicalAfterAppend, historicalBefore);
  } finally {
    oldDatabase?.close(); upgraded?.close(); rmSync(root, { recursive: true, force: true }); rmSync(migrationsThrough0032, { recursive: true, force: true });
  }
});

test("Eval Case and Suite are invisible before OWNER publication and governed after publication", () => {
  const fixture = createFixture();
  try {
    const caseId = uuidv7();
    const caseValue = caseContent();
    const draft = fixture.changes.createChangeSet({ title: "Draft Eval Case", initialItem: { resourceType: AI_EVAL_CASE_RESOURCE_TYPE, resourceId: caseId, operation: "CREATE", expectedRevision: 0, desired: caseValue } }, fixture.owner);
    assert.equal(fixture.cases.getById(caseId), null);
    const submitted = fixture.changes.submit(draft.changeSet.id, draft.changeSet.revision, fixture.owner);
    const approved = fixture.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
    assert.equal(fixture.cases.getById(caseId), null);
    fixture.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
    assert.equal(fixture.cases.getById(caseId)?.currentRevision, 1);
    const suiteId = createPublishedSuite(fixture, caseId);
    assert.equal(fixture.suites.getById(suiteId)?.caseManifest[0]?.caseRevision, 1);
  } finally { fixture.close(); }
});

test("Case and Suite revisions pin immutable identities and exact manifest revisions", () => {
  const fixture = createFixture();
  try {
    const caseId = createPublishedCase(fixture);
    const firstCase = fixture.cases.getById(caseId)!;
    const update = { ...caseContent(firstCase.key, { displayName: "Case revision two", inputText: "Updated safe fact." }), key: firstCase.key, subjectKey: firstCase.subjectKey };
    publishChange(fixture, { title: "Publish Case revision two", initialItem: { resourceType: AI_EVAL_CASE_RESOURCE_TYPE, resourceId: caseId, operation: "UPDATE", expectedRevision: 1, desired: update } });
    assert.equal(fixture.cases.getById(caseId)?.currentRevision, 2);
    const suiteId = createPublishedSuite(fixture, caseId, suiteContent(caseId, 1));
    const suiteOne = fixture.suites.getRevision(suiteId, 1)!;
    assert.equal(suiteOne.caseManifest[0]?.caseRevision, 1);
    const suiteCurrent = fixture.suites.getById(suiteId)!;
    publishChange(fixture, { title: "Publish Suite revision two", initialItem: { resourceType: AI_EVAL_SUITE_RESOURCE_TYPE, resourceId: suiteId, operation: "UPDATE", expectedRevision: 1, desired: { ...suiteContent(caseId, 2), key: suiteCurrent.key, subjectKey: suiteCurrent.subjectKey } } });
    assert.equal(fixture.suites.getRevision(suiteId, 1)?.caseManifest[0]?.caseRevision, 1);
    assert.equal(fixture.suites.getById(suiteId)?.caseManifest[0]?.caseRevision, 2);
    assert.throws(() => fixture.database.client.prepare("update ai_eval_case_revisions set display_name='mutated' where case_id=? and revision=1").run(caseId), /immutable/i);
    assert.throws(() => fixture.database.client.prepare("delete from ai_eval_case_revisions where case_id=? and revision=1").run(caseId), /append-only|immutable/i);
    assert.throws(() => fixture.database.client.prepare("update ai_eval_cases set key='mutated' where id=?").run(caseId), /immutable/i);
  } finally { fixture.close(); }
});

test("Suite staging rejects cross-subject Cases and unknown graders", () => {
  const fixture = createFixture();
  try {
    const physicsCase = createPublishedCase(fixture, caseContent(`m9a.physics.${uuidv7()}`, { subjectKey: "physics" }));
    const biologySuite = uuidv7();
    assert.throws(() => new AIEvalSuiteChangeAdapter().captureProposal(fixture.database, biologySuite, suiteContent(physicsCase, 1, {}), "CREATE"), /subject|Case|validation/i);
    const biologyCase = createPublishedCase(fixture);
    assert.throws(() => new AIEvalSuiteChangeAdapter().captureProposal(fixture.database, uuidv7(), suiteContent(biologyCase, 1, { graderConfigs: [{ graderKey: "future-grader", graderRevision: 99, dimension: "CORRECTNESS", required: true }] }), "CREATE"), /grader|unsupported/i);
  } finally { fixture.close(); }
});

test("direct SQL cannot mutate or delete Eval definitions or published Run truth", () => {
  const fixture = createFixture();
  try {
    const caseId = createPublishedCase(fixture);
    const suiteId = createPublishedSuite(fixture, caseId);
    assert.throws(() => fixture.database.client.prepare("update ai_eval_suites set subject_key='physics' where id=?").run(suiteId), /immutable/i);
    assert.throws(() => fixture.database.client.prepare("update ai_eval_suites set current_revision=3 where id=?").run(suiteId), /advance|revision/i);
    assert.throws(() => fixture.database.client.prepare("delete from ai_eval_suites where id=?").run(suiteId), /append-only|history/i);
    const suiteRevisionId = (fixture.database.client.prepare("select id from ai_eval_suite_revisions where suite_id=? and revision=1").get(suiteId) as { id: string }).id;
    assert.throws(() => fixture.database.client.prepare("insert into ai_eval_suite_case_refs (suite_revision_id,ordinal,case_id,case_revision) values (?,?,?,?)").run(suiteRevisionId, 2, caseId, 1), /manifest|immutable|sealed/i);
    const revisionRow = fixture.database.client.prepare("select display_name,enabled,required_dimensions,grader_configs,gate_config,permitted_regression_deltas,baseline_mode,supplementary_judge_config,created_by from ai_eval_suite_revisions where id=?").get(suiteRevisionId) as Record<string, unknown>;
    assert.throws(() => fixture.database.client.prepare("insert into ai_eval_suite_revisions (id,suite_id,revision,display_name,enabled,required_dimensions,grader_configs,gate_config,permitted_regression_deltas,baseline_mode,supplementary_judge_config,manifest_sealed,created_at,created_by) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(uuidv7(), suiteId, 2, revisionRow.display_name, revisionRow.enabled, revisionRow.required_dimensions, revisionRow.grader_configs, revisionRow.gate_config, revisionRow.permitted_regression_deltas, revisionRow.baseline_mode, revisionRow.supplementary_judge_config, 1, BASE_TIME + 9, revisionRow.created_by), /seal|invalid|revision/i);
    assert.throws(() => fixture.database.client.prepare("insert into ai_eval_suite_revisions (id,suite_id,revision,display_name,enabled,required_dimensions,grader_configs,gate_config,permitted_regression_deltas,baseline_mode,supplementary_judge_config,manifest_sealed,created_at,created_by) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(uuidv7(), suiteId, 2, revisionRow.display_name, revisionRow.enabled, revisionRow.required_dimensions, revisionRow.grader_configs, JSON.stringify({ minimumScores: [{ dimension: "CORRECTNESS", scoreUnits: 1_000_001 }], maximumCostNano: null, maximumLatencyMs: null, requireSecurityPass: false }), revisionRow.permitted_regression_deltas, revisionRow.baseline_mode, revisionRow.supplementary_judge_config, 0, BASE_TIME + 9, revisionRow.created_by), /JSON|invalid|configuration/i);
    const runService = new AIEvalRunService(fixture.database);
    const run = runService.createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 10 });
    runService.startRun(run.id, BASE_TIME + 11);
    runService.recordObservationAndGrade(observation(run.id, caseId), BASE_TIME + 12);
    runService.beginScoring(run.id, BASE_TIME + 13);
    const complete = runService.completeRun(run.id, BASE_TIME + 14);
    assert.equal(complete.run.recommendation, "PASS_RECOMMENDED");
    assert.throws(() => fixture.database.client.prepare("update ai_eval_runs set candidate_fingerprint=? where id=?").run("f".repeat(64), run.id), /immutable/i);
    assert.throws(() => fixture.database.client.prepare("delete from ai_eval_case_results where run_id=?").run(run.id), /append-only|immutable/i);
    assert.throws(() => fixture.database.client.prepare("update ai_eval_gate_results set observed_value=0 where run_id=? and gate_key='MANIFEST_RESULTS_COMPLETE'").run(run.id), /immutable/i);
    assert.throws(() => fixture.database.client.prepare("delete from ai_eval_gate_results where run_id=? and gate_key='MANIFEST_RESULTS_COMPLETE'").run(run.id), /append-only|immutable/i);
    assert.throws(() => fixture.database.client.prepare("delete from ai_eval_runs where id=?").run(run.id), /append-only|history/i);
    assert.throws(() => fixture.database.client.prepare("update ai_eval_cases set current_revision=3 where id=?").run(caseId), /advance|revision/i);
  } finally { fixture.close(); }
});

test("deterministic grader rows cannot impersonate a JUDGE_REQUIRED dimension", () => {
  const fixture = createFixture();
  try {
    const caseId = createPublishedCase(fixture);
    const judgeRef = createPublishedJudgeInfrastructure(fixture);
    const suiteId = createPublishedSuite(fixture, caseId, suiteContent(caseId, 1, {
      requiredDimensions: [{ dimension: "ARABIC_QUALITY", mode: "JUDGE_REQUIRED" }],
      graderConfigs: [],
      baselineMode: "OPTIONAL",
      supplementaryJudgeConfig: judgeRef,
    }));
    const runService = new AIEvalRunService(fixture.database);
    const run = runService.createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 90 });
    runService.startRun(run.id, BASE_TIME + 91);
    const result = runService.recordObservation(observation(run.id, caseId, { citationMap: [] }), BASE_TIME + 92);
    const fake = { caseResultId: result.id, dimension: "ARABIC_QUALITY" as const, graderKey: "fake-judge", graderRevision: 1, verdict: "PASS" as const, scoreUnits: AI_EVAL_SCORE_SCALE, safeReasonCode: "FAKE_PASS", blocking: false, createdAt: BASE_TIME + 93 };
    assert.throws(() => fixture.runs.insertGraderResult(fake), /grader|deterministic|configured|unsupported/i);
    assert.throws(() => fixture.database.client.prepare("insert into ai_eval_grader_results (id,case_result_id,dimension,grader_key,grader_revision,verdict,score_units,safe_reason_code,blocking,created_at) values (?,?,?,?,?,?,?,?,?,?)").run(uuidv7(), result.id, fake.dimension, fake.graderKey, fake.graderRevision, fake.verdict, fake.scoreUnits, fake.safeReasonCode, 0, fake.createdAt), /grader|deterministic|configured|unsupported/i);
    runService.beginScoring(run.id, BASE_TIME + 94);
    const complete = runService.completeRun(run.id, BASE_TIME + 95);
    assert.equal(complete.report.gates.find((gate) => gate.gateKey === "MANIFEST_RESULTS_COMPLETE")?.verdict, "PASS");
    assert.equal(complete.report.gates.find((gate) => gate.gateKey === "REQUIRED_ARABIC_QUALITY")?.verdict, "INCOMPLETE");
    assert.equal(complete.run.recommendation, "INCOMPLETE");
  } finally { fixture.close(); }
});

test("unconfigured and dimension-mismatched deterministic graders are rejected at both boundaries", () => {
  const fixture = createFixture();
  try {
    const caseId = createPublishedCase(fixture);
    const suiteId = createPublishedSuite(fixture, caseId);
    const runService = new AIEvalRunService(fixture.database);
    const run = runService.createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 100 });
    runService.startRun(run.id, BASE_TIME + 101);
    const result = runService.recordObservation(observation(run.id, caseId), BASE_TIME + 102);
    const mismatched = { caseResultId: result.id, dimension: "GROUNDEDNESS" as const, graderKey: AI_EVAL_GRADER_KEYS.STATUS_MATCH, graderRevision: 1, verdict: "PASS" as const, scoreUnits: AI_EVAL_SCORE_SCALE, safeReasonCode: "MISMATCHED_DIMENSION", blocking: false, createdAt: BASE_TIME + 103 };
    assert.throws(() => fixture.runs.insertGraderResult(mismatched), /grader|deterministic|configured|unsupported/i);
    assert.throws(() => fixture.database.client.prepare("insert into ai_eval_grader_results (id,case_result_id,dimension,grader_key,grader_revision,verdict,score_units,safe_reason_code,blocking,created_at) values (?,?,?,?,?,?,?,?,?,?)").run(uuidv7(), result.id, mismatched.dimension, mismatched.graderKey, mismatched.graderRevision, mismatched.verdict, mismatched.scoreUnits, mismatched.safeReasonCode, 0, mismatched.createdAt), /grader|deterministic|configured|unsupported/i);
  } finally { fixture.close(); }
});

test("SCORING freezes Case and deterministic Grader inputs while allowing final completion", () => {
  const fixture = createFixture();
  try {
    const firstCaseId = createPublishedCase(fixture);
    const secondCaseId = createPublishedCase(fixture, caseContent(`m9a.freeze.second.${uuidv7()}`));
    const suiteId = createPublishedSuite(fixture, firstCaseId, suiteContent(firstCaseId, 1, { caseManifest: [{ ordinal: 1, caseId: firstCaseId, caseRevision: 1 }, { ordinal: 2, caseId: secondCaseId, caseRevision: 1 }] }));
    const runService = new AIEvalRunService(fixture.database);
    const run = runService.createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 110 });
    runService.startRun(run.id, BASE_TIME + 111);
    const first = runService.recordObservationAndGrade(observation(run.id, firstCaseId), BASE_TIME + 112);
    runService.beginScoring(run.id, BASE_TIME + 113);
    const secondResult = { runId: run.id, caseId: secondCaseId, caseRevision: 1, ordinal: 2, observedSubjectKey: "biology", observedStatus: "COMPLETED" as const, finishReason: "STOP" as const, outputSha256: hashEvalOutput("safe answer [E1]"), outputByteSize: Buffer.byteLength("safe answer [E1]", "utf8"), evidence: [], retrievalStatus: "NOT_APPLICABLE" as const, elapsedLatencyMs: 4, costOperationId: null, privacyClass: "SYNTHETIC_PUBLIC_SAFE" as const, createdAt: BASE_TIME + 114 };
    assert.throws(() => fixture.runs.insertCaseResult(secondResult), /RUNNING|scor/i);
    assert.throws(() => fixture.database.client.prepare("insert into ai_eval_case_results (id,run_id,case_id,case_revision,ordinal,observed_subject_key,observed_status,finish_reason,output_sha256,output_byte_size,evidence,retrieval_status,elapsed_latency_ms,cost_operation_id,privacy_class,created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(uuidv7(), secondResult.runId, secondResult.caseId, secondResult.caseRevision, secondResult.ordinal, secondResult.observedSubjectKey, secondResult.observedStatus, secondResult.finishReason, secondResult.outputSha256, secondResult.outputByteSize, "[]", secondResult.retrievalStatus, secondResult.elapsedLatencyMs, null, secondResult.privacyClass, secondResult.createdAt), /RUNNING|manifest|active/i);
    const extraGrader = { caseResultId: first.result.id, dimension: "CORRECTNESS" as const, graderKey: AI_EVAL_GRADER_KEYS.STATUS_MATCH, graderRevision: 1, verdict: "PASS" as const, scoreUnits: AI_EVAL_SCORE_SCALE, safeReasonCode: "EXTRA", blocking: false, createdAt: BASE_TIME + 115 };
    assert.throws(() => fixture.runs.insertGraderResult(extraGrader), /RUNNING|scor/i);
    assert.throws(() => fixture.database.client.prepare("insert into ai_eval_grader_results (id,case_result_id,dimension,grader_key,grader_revision,verdict,score_units,safe_reason_code,blocking,created_at) values (?,?,?,?,?,?,?,?,?,?)").run(uuidv7(), extraGrader.caseResultId, extraGrader.dimension, extraGrader.graderKey, extraGrader.graderRevision, extraGrader.verdict, extraGrader.scoreUnits, extraGrader.safeReasonCode, 0, extraGrader.createdAt), /RUNNING|active|grader/i);
    const complete = runService.completeRun(run.id, BASE_TIME + 116);
    assert.equal(complete.run.status, "COMPLETED");
    assert.equal(complete.report.gates.find((gate) => gate.gateKey === "MANIFEST_RESULTS_COMPLETE")?.verdict, "INCOMPLETE");
  } finally { fixture.close(); }
});

test("MANIFEST_RESULTS_COMPLETE blocks an all-NOT_APPLICABLE suite with no observations", () => {
  const fixture = createFixture();
  try {
    const caseId = createPublishedCase(fixture);
    const suiteId = createPublishedSuite(fixture, caseId, suiteContent(caseId, 1, { requiredDimensions: [{ dimension: "RELEVANCE", mode: "NOT_APPLICABLE" }], graderConfigs: [], gateConfig: { minimumScores: [], maximumCostNano: null, maximumLatencyMs: null, requireSecurityPass: false } }));
    const runService = new AIEvalRunService(fixture.database);
    const run = runService.createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 120 });
    runService.startRun(run.id, BASE_TIME + 121);
    runService.beginScoring(run.id, BASE_TIME + 122);
    const complete = runService.completeRun(run.id, BASE_TIME + 123);
    assert.equal(complete.report.gates.find((gate) => gate.gateKey === "MANIFEST_RESULTS_COMPLETE")?.verdict, "INCOMPLETE");
    assert.equal(complete.run.recommendation, "INCOMPLETE");
  } finally { fixture.close(); }
});

test("deterministic graders cover status, citations, evidence, literals, security, output, cost, and latency", () => {
  const registry = createDefaultAIEvalGraderRegistry();
  assert.equal(AI_EVAL_GRADER_REGISTRY_KEY, "deterministic-evals-v1");
  assert.equal(AI_EVAL_GRADER_REGISTRY_REVISION, 1);
  const caseRevision = { ...normalizeAIEvalCaseContent(caseContent()), caseId: uuidv7(), revisionId: uuidv7(), revision: 1, createdAt: BASE_TIME, createdBy: uuidv7() };
  const base = normalizeAIEvalObservation(observation(uuidv7(), uuidv7()));
  const status = registry.get(AI_EVAL_GRADER_KEYS.STATUS_MATCH, 1)!;
  assert.equal(status.grade({ caseRevision: { ...caseRevision, expectedStatus: "COMPLETED" }, observation: base, context: { costNano: null } }).verdict, "PASS");
  assert.equal(status.grade({ caseRevision: { ...caseRevision, expectedStatus: "BLOCKED" }, observation: base, context: { costNano: null } }).verdict, "FAIL");
  assert.equal(registry.get(AI_EVAL_GRADER_KEYS.CITATION_INTEGRITY, 1)!.grade({ caseRevision, observation: base, context: { costNano: null } }).verdict, "PASS");
  const fabricated = normalizeAIEvalObservation(observation(base.runId, base.caseId, { outputText: "safe [E99]" }));
  assert.equal(registry.get(AI_EVAL_GRADER_KEYS.CITATION_INTEGRITY, 1)!.grade({ caseRevision, observation: fabricated, context: { costNano: null } }).verdict, "FAIL");
  const evidenceCase = { ...normalizeAIEvalCaseContent(caseContent(undefined, { requiredCitationLabels: [], requiredEvidenceOrigins: [{ originKind: "KNOWLEDGE_PACKAGE", originId: "origin-1", subjectKey: "biology" }] })), caseId: uuidv7(), revisionId: uuidv7(), revision: 1, createdAt: BASE_TIME, createdBy: uuidv7() };
  assert.equal(registry.get(AI_EVAL_GRADER_KEYS.EVIDENCE_EXPECTATION, 1)!.grade({ caseRevision: evidenceCase, observation: normalizeAIEvalObservation(observation(base.runId, base.caseId, { citationMap: [], evidence: [{ originKind: "KNOWLEDGE_PACKAGE", originId: "origin-1", subjectKey: "biology" }] })), context: { costNano: null } }).verdict, "PASS");
  assert.equal(registry.get(AI_EVAL_GRADER_KEYS.LITERAL_OUTPUT, 1)!.grade({ caseRevision, observation: normalizeAIEvalObservation(observation(base.runId, base.caseId, { outputText: "wrong [E1]" })), context: { costNano: null } }).verdict, "FAIL");
  const leaked = normalizeAIEvalObservation(observation(base.runId, base.caseId, { outputText: "safe TOP_SECRET_REAL_STUDENT_M9A_73 [E1]" }));
  const security = registry.get(AI_EVAL_GRADER_KEYS.SECURITY_LEAK, 1)!.grade({ caseRevision, observation: leaked, context: { costNano: null } });
  assert.equal(security.verdict, "FAIL"); assert.equal(security.blocking, true);
  assert.equal(registry.get(AI_EVAL_GRADER_KEYS.OUTPUT_BOUND, 1)!.grade({ caseRevision, observation: base, context: { costNano: null } }).verdict, "PASS");
  assert.equal(registry.get(AI_EVAL_GRADER_KEYS.COST_GATE, 1)!.grade({ caseRevision, observation: base, context: { costNano: 10 } }).verdict, "PASS");
  assert.equal(registry.get(AI_EVAL_GRADER_KEYS.LATENCY_GATE, 1)!.grade({ caseRevision, observation: base, context: { costNano: null } }).verdict, "PASS");
  assert.deepEqual(registry.supported(), [...registry.supported()].sort((left, right) => left.graderKey.localeCompare(right.graderKey)));
});

test("fixed-point gates recommend, block security/cost/latency, and never publish", () => {
  const fixture = createFixture();
  try {
    const caseId = createPublishedCase(fixture);
    const suiteId = createPublishedSuite(fixture, caseId, suiteContent(caseId, 1, { gateConfig: { minimumScores: [{ dimension: "CORRECTNESS", scoreUnits: AI_EVAL_SCORE_SCALE }], maximumCostNano: null, maximumLatencyMs: 10, requireSecurityPass: true } }));
    const runService = new AIEvalRunService(fixture.database);
    const run = runService.createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 20 });
    runService.startRun(run.id, BASE_TIME + 21);
    runService.recordObservationAndGrade(observation(run.id, caseId), BASE_TIME + 22);
    runService.beginScoring(run.id, BASE_TIME + 23);
    const passingReport = runService.completeRun(run.id, BASE_TIME + 24);
    assert.equal(passingReport.run.recommendation, "PASS_RECOMMENDED");
    assert.equal(passingReport.report.gates.find((gate) => gate.gateKey === "MANIFEST_RESULTS_COMPLETE")?.verdict, "PASS");
    const blockedRun = runService.createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 30 });
    runService.startRun(blockedRun.id, BASE_TIME + 31);
    runService.recordObservationAndGrade(observation(blockedRun.id, caseId, { outputText: "safe TOP_SECRET_REAL_STUDENT_M9A_73 [E1]" }), BASE_TIME + 32);
    runService.beginScoring(blockedRun.id, BASE_TIME + 33);
    assert.equal(runService.completeRun(blockedRun.id, BASE_TIME + 34).run.recommendation, "BLOCKED");
    const accounting = new SQLiteAIAccountingRepository(fixture.database);
    const costSuiteId = createPublishedSuite(fixture, caseId, suiteContent(caseId, 1, { gateConfig: { minimumScores: [], maximumCostNano: 10, maximumLatencyMs: null, requireSecurityPass: true } }));
    const expensiveRun = runService.createRun({ id: uuidv7(), suiteId: costSuiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 35 });
    const costOperationId = uuidv7();
    accounting.createOperation({ id: costOperationId, content: { costCenter: "EVALS", idempotencyKey: null, opaquePrincipalRef: null, subjectKey: "biology", conversationId: null, responseId: null, jobId: null, evalRunId: expensiveRun.id, knowledgeRevision: null, status: "OPEN", startedAt: BASE_TIME + 35, completedAt: null } });
    const costAware = new AIEvalRunService(fixture.database, { accounting: { getOperation: (id) => accounting.getOperation(id), getOperationCostSummary: (id) => ({ operationId: id, totals: [{ currency: "USD", totalNano: 999 }] }), listUsageCostRecords: () => [], listCorrections: () => [] } });
    costAware.startRun(expensiveRun.id, BASE_TIME + 36);
    costAware.recordObservationAndGrade(observation(expensiveRun.id, caseId, { costOperationId }), BASE_TIME + 37);
    costAware.beginScoring(expensiveRun.id, BASE_TIME + 38);
    const expensiveResult = costAware.completeRun(expensiveRun.id, BASE_TIME + 39);
    assert.equal(expensiveResult.report.gates.some((gate) => gate.gateKey === "MAX_COST_NANO" && gate.verdict === "INCOMPLETE"), true);
    assert.equal(fixture.database.client.prepare("select count(*) as count from publications").get() !== undefined, true);
  } finally { fixture.close(); }
});

test("EVALS cost gates require a terminal operation with complete canonical usage", () => {
  const fixture = createFixture();
  try {
    const caseId = createPublishedCase(fixture);
    const suiteId = createPublishedSuite(fixture, caseId, suiteContent(caseId, 1, { gateConfig: { minimumScores: [], maximumCostNano: 10, maximumLatencyMs: null, requireSecurityPass: true } }));
    const score = (runService: AIEvalRunService, runId: string, costOperationId: string, start: number) => {
      runService.startRun(runId, start);
      runService.recordObservationAndGrade(observation(runId, caseId, { costOperationId }), start + 1);
      runService.beginScoring(runId, start + 2);
      return runService.completeRun(runId, start + 3);
    };

    const openRun = new AIEvalRunService(fixture.database).createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 130 });
    const open = createEvalOperation(fixture.database, openRun.id);
    const openResult = score(new AIEvalRunService(fixture.database, { accounting: evalAccountingReader(open.accounting, [], 999) }), openRun.id, open.id, BASE_TIME + 131);
    assert.equal(openResult.report.gates.find((gate) => gate.gateKey === "MAX_COST_NANO")?.verdict, "INCOMPLETE");
    assert.equal(openResult.report.gates.find((gate) => gate.gateKey === "MAX_COST_NANO")?.observedValue, null);

    const partialRun = new AIEvalRunService(fixture.database).createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 140 });
    const partial = createEvalOperation(fixture.database, partialRun.id, { status: "COMPLETED", completedAt: BASE_TIME + 141 });
    const partialResult = score(new AIEvalRunService(fixture.database, { accounting: evalAccountingReader(partial.accounting, [fakeUsageRecord(partial.id, "PARTIAL")], 5) }), partialRun.id, partial.id, BASE_TIME + 142);
    assert.equal(partialResult.report.gates.find((gate) => gate.gateKey === "MAX_COST_NANO")?.verdict, "INCOMPLETE");

    const underRun = new AIEvalRunService(fixture.database).createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 150 });
    const under = createEvalOperation(fixture.database, underRun.id, { status: "COMPLETED", completedAt: BASE_TIME + 151 });
    const underResult = score(new AIEvalRunService(fixture.database, { accounting: evalAccountingReader(under.accounting, [fakeUsageRecord(under.id, "COMPLETE")], 5) }), underRun.id, under.id, BASE_TIME + 152);
    assert.equal(underResult.report.gates.find((gate) => gate.gateKey === "MAX_COST_NANO")?.verdict, "PASS");
    assert.equal(underResult.report.gates.find((gate) => gate.gateKey === "MAX_COST_NANO")?.observedValue, 5);

    const overRun = new AIEvalRunService(fixture.database).createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 160 });
    const over = createEvalOperation(fixture.database, overRun.id, { status: "COMPLETED", completedAt: BASE_TIME + 161 });
    const overResult = score(new AIEvalRunService(fixture.database, { accounting: evalAccountingReader(over.accounting, [fakeUsageRecord(over.id, "COMPLETE")], 999) }), overRun.id, over.id, BASE_TIME + 162);
    assert.equal(overResult.report.gates.find((gate) => gate.gateKey === "MAX_COST_NANO")?.verdict, "BLOCKED");

    const emptyRun = new AIEvalRunService(fixture.database).createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 165 });
    const empty = createEvalOperation(fixture.database, emptyRun.id, { status: "COMPLETED", completedAt: BASE_TIME + 166 });
    const emptyResult = score(new AIEvalRunService(fixture.database, { accounting: evalAccountingReader(empty.accounting, [], 0) }), emptyRun.id, empty.id, BASE_TIME + 167);
    assert.equal(emptyResult.report.gates.find((gate) => gate.gateKey === "MAX_COST_NANO")?.verdict, "INCOMPLETE");

    const multiRun = new AIEvalRunService(fixture.database).createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 170 });
    const multi = createEvalOperation(fixture.database, multiRun.id, { status: "COMPLETED", completedAt: BASE_TIME + 171 });
    const multiRecord = fakeUsageRecord(multi.id, "COMPLETE");
    const multiReader: AIEvalAccountingReader = { getOperation: (id) => multi.accounting.getOperation(id), getOperationCostSummary: (id) => ({ operationId: id, totals: [{ currency: "EUR", totalNano: 1 }, { currency: "USD", totalNano: 5 }] }), listUsageCostRecords: () => [multiRecord], listCorrections: () => [] };
    const multiResult = score(new AIEvalRunService(fixture.database, { accounting: multiReader }), multiRun.id, multi.id, BASE_TIME + 172);
    assert.equal(multiResult.report.gates.find((gate) => gate.gateKey === "MAX_COST_NANO")?.verdict, "INCOMPLETE");
  } finally { fixture.close(); }
});

test("Eval cost gates persist an immutable accounting basis and detect later Corrections", () => {
  const fixture = createFixture();
  try {
    const caseId = createPublishedCase(fixture);
    const suiteId = createPublishedSuite(fixture, caseId, suiteContent(caseId, 1, { gateConfig: { minimumScores: [], maximumCostNano: 10, maximumLatencyMs: null, requireSecurityPass: true } }));
    const run = new AIEvalRunService(fixture.database).createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 180 });
    const operation = createEvalOperation(fixture.database, run.id, { status: "COMPLETED", completedAt: BASE_TIME + 181 });
    const usageRecord = fakeUsageRecord(operation.id, "COMPLETE");
    const correctionIds: string[] = [];
    let totalNano = 5;
    const accounting: AIEvalAccountingReader = {
      getOperation: (id) => operation.id === id ? operation.accounting.getOperation(id) : null,
      getOperationCostSummary: (id) => ({ operationId: id, totals: [{ currency: "USD", totalNano }] }),
      listUsageCostRecords: (id) => id === operation.id ? [usageRecord] : [],
      listCorrections: (recordId) => recordId === usageRecord.id ? correctionIds.map((id) => ({ id })) : [],
    };
    const service = new AIEvalRunService(fixture.database, { accounting });
    service.startRun(run.id, BASE_TIME + 182);
    service.recordObservationAndGrade(observation(run.id, caseId, { costOperationId: operation.id }), BASE_TIME + 183);
    service.beginScoring(run.id, BASE_TIME + 184);
    const scored = service.completeRun(run.id, BASE_TIME + 185);
    const costGate = scored.report.gates.find((gate) => gate.gateKey === "MAX_COST_NANO");
    assert.equal(costGate?.verdict, "PASS");
    assert.equal(costGate?.accountingBasis?.totalNano, 5);
    assert.equal(costGate?.accountingBasis?.operations[0]?.operationId, operation.id);
    assert.deepEqual(costGate?.accountingBasis?.operations[0]?.records[0]?.correctionIds, []);
    const persisted = JSON.parse((fixture.database.client.prepare("select accounting_basis from ai_eval_gate_results where run_id=? and gate_key='MAX_COST_NANO'").get(run.id) as { accounting_basis: string }).accounting_basis) as { totalNano: number; fingerprint: string };
    assert.equal(persisted.totalNano, 5);
    assert.match(persisted.fingerprint, /^[0-9a-f]{64}$/u);
    assert.equal(service.getAccountingBasisStatus(run.id).status, "CURRENT");

    const correctionId = uuidv7();
    correctionIds.push(correctionId);
    totalNano = 25;
    const freshness = service.getAccountingBasisStatus(run.id);
    assert.equal(freshness.status, "STALE");
    assert.equal(freshness.pinnedFingerprint, persisted.fingerprint);
    assert.notEqual(freshness.currentFingerprint, persisted.fingerprint);
    const semanticallySame = {
      version: 1 as const,
      operations: [
        { operationId: "operation-b", records: [{ recordId: "record-b", correctionIds: ["correction-2", "correction-1"] }] },
        { operationId: "operation-a", records: [{ recordId: "record-a", correctionIds: [] }] },
      ],
      currency: "USD",
      totalNano: 25,
    };
    const reordered = {
      ...semanticallySame,
      operations: [
        { operationId: "operation-a", records: [{ recordId: "record-a", correctionIds: [] }] },
        { operationId: "operation-b", records: [{ recordId: "record-b", correctionIds: ["correction-1", "correction-2"] }] },
      ],
    };
    assert.equal(fingerprintAIEvalAccountingBasis(semanticallySame), fingerprintAIEvalAccountingBasis(reordered));
    assert.equal((JSON.parse((fixture.database.client.prepare("select accounting_basis from ai_eval_gate_results where run_id=? and gate_key='MAX_COST_NANO'").get(run.id) as { accounting_basis: string }).accounting_basis) as { totalNano: number }).totalNano, 5);
  } finally { fixture.close(); }
});

test("Eval cost ownership rejects wrong Run, private identity, and Suite subject", () => {
  const fixture = createFixture();
  try {
    const caseId = createPublishedCase(fixture);
    const suiteId = createPublishedSuite(fixture, caseId);
    const runService = new AIEvalRunService(fixture.database);
    const run = runService.createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 170 });
    runService.startRun(run.id, BASE_TIME + 171);
    const wrongRun = createEvalOperation(fixture.database, uuidv7());
    assert.throws(() => runService.recordObservationAndGrade(observation(run.id, caseId, { costOperationId: wrongRun.id }), BASE_TIME + 172), (error) => error instanceof AIEvalError && error.code === "AI_EVAL_RUN_INVALID");
    const privateOperation = createEvalOperation(fixture.database, run.id, { opaquePrincipalRef: "student-X", conversationId: "conversation-X", responseId: "response-X", jobId: "job-X", idempotencyKey: "idempotency-X" });
    assert.throws(() => runService.recordObservationAndGrade(observation(run.id, caseId, { costOperationId: privateOperation.id }), BASE_TIME + 173), (error) => error instanceof AIEvalError && error.code === "AI_EVAL_RUN_INVALID");
    const wrongSubject = createEvalOperation(fixture.database, run.id, { subjectKey: "physics" });
    assert.throws(() => runService.recordObservationAndGrade(observation(run.id, caseId, { costOperationId: wrongSubject.id }), BASE_TIME + 174), (error) => error instanceof AIEvalError && error.code === "AI_EVAL_RUN_INVALID");
    assert.equal((fixture.database.client.prepare("select count(*) as count from ai_eval_case_results where run_id=?").get(run.id) as { count: number }).count, 0);
  } finally { fixture.close(); }
});

test("missing deterministic/judge dimensions produce INCOMPLETE and baseline comparisons are bounded", () => {
  const fixture = createFixture();
  try {
    const caseId = createPublishedCase(fixture);
    const judgeRef = createPublishedJudgeInfrastructure(fixture);
    const suiteId = createPublishedSuite(fixture, caseId, suiteContent(caseId, 1, { requiredDimensions: [{ dimension: "ARABIC_QUALITY", mode: "JUDGE_REQUIRED" }], graderConfigs: [], baselineMode: "REQUIRED", supplementaryJudgeConfig: judgeRef }));
    const runService = new AIEvalRunService(fixture.database);
    const run = runService.createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 40 });
    runService.startRun(run.id, BASE_TIME + 41);
    runService.recordObservationAndGrade(observation(run.id, caseId, { citationMap: [] }), BASE_TIME + 42);
    runService.beginScoring(run.id, BASE_TIME + 43);
    const incomplete = runService.completeRun(run.id, BASE_TIME + 44);
    assert.equal(incomplete.run.recommendation, "INCOMPLETE");
    const caseTwo = createPublishedCase(fixture, caseContent(`m9a.case.two.${uuidv7()}`, { requiredCitationLabels: [] }));
    const suiteTwo = createPublishedSuite(fixture, caseTwo, suiteContent(caseTwo, 1, { requiredDimensions: [{ dimension: "CORRECTNESS", mode: "DETERMINISTICALLY_GRADED" }], graderConfigs: [{ graderKey: AI_EVAL_GRADER_KEYS.STATUS_MATCH, graderRevision: 1, dimension: "CORRECTNESS", required: true }], gateConfig: { minimumScores: [], maximumCostNano: null, maximumLatencyMs: null, requireSecurityPass: false }, baselineMode: "OPTIONAL", permittedRegressionDeltas: [{ dimension: "CORRECTNESS", maximumRegressionUnits: 0 }] }));
    const baseline = runService.createRun({ id: uuidv7(), suiteId: suiteTwo, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 50 });
    runService.startRun(baseline.id, BASE_TIME + 51); runService.recordObservationAndGrade(observation(baseline.id, caseTwo, { outputText: "safe" }), BASE_TIME + 52); runService.beginScoring(baseline.id, BASE_TIME + 53); assert.equal(runService.completeRun(baseline.id, BASE_TIME + 54).run.recommendation, "PASS_RECOMMENDED");
    const candidate = runService.createRun({ id: uuidv7(), suiteId: suiteTwo, suiteRevision: 1, baselineRunId: baseline.id, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 60 });
    runService.startRun(candidate.id, BASE_TIME + 61); runService.recordObservationAndGrade(observation(candidate.id, caseTwo, { observedStatus: "FAILED", finishReason: "FAILED", outputText: "" }), BASE_TIME + 62); runService.beginScoring(candidate.id, BASE_TIME + 63);
    const candidateResult = runService.completeRun(candidate.id, BASE_TIME + 64);
    assert.equal(candidateResult.report.gates.some((gate) => gate.gateKey === "BASELINE_COMPARISON" && gate.verdict === "BLOCKED"), true);
    assert.equal(candidateResult.run.recommendation, "BLOCKED");
  } finally { fixture.close(); }
});

test("Eval observation persistence is hash-only, exact, immutable, and privacy bounded", () => {
  const fixture = createFixture();
  try {
    const caseId = createPublishedCase(fixture, caseContent(`m9a.privacy.${uuidv7()}`, { inputText: "safe de-identified question" }));
    const suiteId = createPublishedSuite(fixture, caseId);
    const runService = new AIEvalRunService(fixture.database);
    const run = runService.createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 70 });
    runService.startRun(run.id, BASE_TIME + 71);
    const marker = "TOP_SECRET_REAL_STUDENT_M9A_73";
    runService.recordObservationAndGrade(observation(run.id, caseId, { outputText: `safe ${marker} [E1]` }), BASE_TIME + 72);
    const durable = fixture.database.client.prepare("select output_sha256, output_byte_size from ai_eval_case_results where run_id=?").get(run.id) as { output_sha256: string; output_byte_size: number };
    assert.equal(durable.output_sha256, hashEvalOutput(`safe ${marker} [E1]`));
    assert.equal(JSON.stringify(fixture.database.client.prepare("select * from ai_eval_case_results where run_id=?").get(run.id)).includes(marker), false);
    assert.equal(JSON.stringify(fixture.database.client.prepare("select * from ai_eval_runs where id=?").get(run.id)).includes(marker), false);
    assert.equal(JSON.stringify(fixture.database.client.prepare("select * from ai_eval_grader_results where case_result_id=(select id from ai_eval_case_results where run_id=? )").all(run.id)).includes(marker), false);
    assert.equal(durable.output_byte_size, Buffer.byteLength(`safe ${marker} [E1]`, "utf8"));
    assert.throws(() => normalizeAIEvalCaseContent({ ...caseContent(`m9a.bad.${uuidv7()}`, { origin: "DEIDENTIFIED_REGRESSION", privacyClass: "DEIDENTIFIED_REGRESSION", deidentificationProof: null, sourceRevisionReferences: [{ kind: "REGRESSION", id: "safe", revision: 1 }] }), principalRef: "raw-student" }), /fields|de-identification/i);
    const validRegression = normalizeAIEvalCaseContent(caseContent(`m9a.regression.${uuidv7()}`, { origin: "DEIDENTIFIED_REGRESSION", privacyClass: "DEIDENTIFIED_REGRESSION", deidentificationProof: { approved: true, methodKey: "fixture-redaction", reviewerReference: "review-1" }, sourceRevisionReferences: [{ kind: "REGRESSION", id: "regression-fixture", revision: 1 }] }));
    assert.equal(validRegression.privacyClass, "DEIDENTIFIED_REGRESSION");
  } finally { fixture.close(); }
});

test("candidate and manifest fingerprints are deterministic and contain no prompt/identity payload", () => {
  const candidate = candidateSnapshot();
  const clone = structuredClone(candidate);
  assert.equal(fingerprintAIEvalCandidate(candidate), fingerprintAIEvalCandidate(clone));
  const manifest = [{ ordinal: 1, caseId: uuidv7(), caseRevision: 1 }];
  assert.equal(fingerprintAIEvalManifest(manifest), fingerprintAIEvalManifest(structuredClone(manifest)));
  assert.equal(JSON.stringify(candidate).includes("inputText"), false);
  assert.equal(JSON.stringify(candidate).includes("principalRef"), false);
  assert.equal(JSON.stringify(candidate).includes("credential"), false);
});

test("M9A repository refuses terminal Run reopening and duplicate/foreign results", () => {
  const fixture = createFixture();
  try {
    const caseId = createPublishedCase(fixture);
    const suiteId = createPublishedSuite(fixture, caseId);
    const runService = new AIEvalRunService(fixture.database);
    const run = runService.createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 80 });
    runService.startRun(run.id, BASE_TIME + 81); const first = runService.recordObservationAndGrade(observation(run.id, caseId), BASE_TIME + 82); runService.beginScoring(run.id, BASE_TIME + 83); runService.completeRun(run.id, BASE_TIME + 84);
    assert.throws(() => runService.startRun(run.id, BASE_TIME + 85), /terminal|lifecycle|invalid/i);
    assert.throws(() => fixture.database.client.prepare("insert into ai_eval_case_results (id,run_id,case_id,case_revision,ordinal,observed_subject_key,observed_status,finish_reason,output_sha256,output_byte_size,evidence,retrieval_status,elapsed_latency_ms,cost_operation_id,privacy_class,created_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(uuidv7(), run.id, caseId, 99, 1, "biology", "COMPLETED", "STOP", "a".repeat(64), 0, "[]", "NOT_APPLICABLE", 0, null, "SYNTHETIC_PUBLIC_SAFE", BASE_TIME + 86), /manifest|result|immutable|active/i);
    assert.ok(first.result.id);
  } finally { fixture.close(); }
});

test("M9A grader registry is code-owned and has a stable deterministic identity", () => {
  const registry = new AIDeterministicEvalGraderRegistry();
  const supported = registry.supported();
  assert.ok(supported.some((item) => item.graderKey === AI_EVAL_GRADER_KEYS.SECURITY_LEAK && item.graderRevision === 1));
  assert.equal(registry.get("status-match-v1", 2), null);
  assert.equal(JSON.stringify(supported).includes("function"), false);
  assert.equal(typeof createDefaultAIEvalGraderRegistry().get(AI_EVAL_GRADER_KEYS.STATUS_MATCH, 1)?.grade, "function");
});

test("M9A error details remain safe and do not include Eval input text", () => {
  const inputMarker = "PRIVATE_EVAL_INPUT_SHOULD_NOT_BE_IN_ERROR";
  assert.throws(() => normalizeAIEvalObservation({}), (error) => error instanceof AIEvalError && !error.message.includes(inputMarker));
});
