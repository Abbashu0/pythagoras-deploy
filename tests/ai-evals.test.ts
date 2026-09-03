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
} from "../src/server/ai/evals";
import {
  AI_TUTOR_CITATION_PROTOCOL_KEY,
  AI_TUTOR_CITATION_PROTOCOL_REVISION,
  AI_TUTOR_GROUNDING_PROTOCOL_KEY,
  AI_TUTOR_GROUNDING_PROTOCOL_REVISION,
} from "../src/server/ai/tutor";
import { SQLiteAIAccountingRepository } from "../src/server/ai/economics";
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
    assert.equal(count, 32);
    assert.equal(fixture.database.client.prepare("select 1 from sqlite_master where type='table' and name='ai_eval_suites'").get() !== undefined, true);
    assert.equal(fixture.database.client.prepare("select 1 from sqlite_master where type='table' and name='ai_eval_runs'").get() !== undefined, true);
  } finally { fixture.close(); }
});

test("0030 to 0031 upgrade keeps the existing database and installs Eval tables", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m9a-upgrade-"));
  const oldMigrations = mkdtempSync(path.join(os.tmpdir(), "pythagoras-m9a-old-migrations-"));
  let oldDatabase: ContentDatabase | null = null;
  let upgraded: ContentDatabase | null = null;
  try {
    mkdirSync(path.join(oldMigrations, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }>; [key: string]: unknown };
    const preEvalEntries = journal.entries.slice(0, 31);
    for (const entry of preEvalEntries) {
      copyFileSync(path.join(migrationsDirectory, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
      const snapshotName = `${entry.idx.toString().padStart(4, "0")}_snapshot.json`;
      if (existsSync(path.join(migrationsDirectory, "meta", snapshotName))) copyFileSync(path.join(migrationsDirectory, "meta", snapshotName), path.join(oldMigrations, "meta", snapshotName));
    }
    writeFileSync(path.join(oldMigrations, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: preEvalEntries }));
    oldDatabase = openContentDatabase({ dataDirectory: root, migrationsDirectory: oldMigrations });
    assert.equal(Number((oldDatabase.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count), 31);
    createCanonicalContentRepository(oldDatabase).bootstrap();
    oldDatabase.close(); oldDatabase = null;
    upgraded = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    assert.equal(Number((upgraded.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count), 32);
    for (const table of ["ai_eval_suites", "ai_eval_suite_revisions", "ai_eval_suite_case_refs", "ai_eval_cases", "ai_eval_case_revisions", "ai_eval_runs", "ai_eval_case_results", "ai_eval_grader_results", "ai_eval_dimension_aggregates", "ai_eval_gate_results"]) assert.ok(upgraded.client.prepare("select name from sqlite_master where type='table' and name=?").get(table));
    assert.ok(upgraded.client.prepare("select name from sqlite_master where type='trigger' and name='ai_eval_suites_identity_immutable'").get());
    assert.ok(upgraded.client.prepare("select subject_key from canonical_materials where subject_key='biology'").get());
  } finally {
    oldDatabase?.close(); upgraded?.close(); rmSync(root, { recursive: true, force: true }); rmSync(oldMigrations, { recursive: true, force: true });
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
    assert.throws(() => fixture.database.client.prepare("delete from ai_eval_runs where id=?").run(run.id), /append-only|history/i);
    assert.throws(() => fixture.database.client.prepare("update ai_eval_cases set current_revision=3 where id=?").run(caseId), /advance|revision/i);
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
    assert.equal(runService.completeRun(run.id, BASE_TIME + 24).run.recommendation, "PASS_RECOMMENDED");
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
    const costAware = new AIEvalRunService(fixture.database, { accounting: { getOperation: (id) => accounting.getOperation(id), getOperationCostSummary: (id) => ({ operationId: id, totals: [{ currency: "USD", totalNano: 999 }] }) } });
    costAware.startRun(expensiveRun.id, BASE_TIME + 36);
    costAware.recordObservationAndGrade(observation(expensiveRun.id, caseId, { costOperationId }), BASE_TIME + 37);
    costAware.beginScoring(expensiveRun.id, BASE_TIME + 38);
    const expensiveResult = costAware.completeRun(expensiveRun.id, BASE_TIME + 39);
    assert.equal(expensiveResult.report.gates.some((gate) => gate.gateKey === "MAX_COST_NANO" && gate.verdict === "BLOCKED"), true);
    assert.equal(fixture.database.client.prepare("select count(*) as count from publications").get() !== undefined, true);
  } finally { fixture.close(); }
});

test("missing deterministic/judge dimensions produce INCOMPLETE and baseline comparisons are bounded", () => {
  const fixture = createFixture();
  try {
    const caseId = createPublishedCase(fixture);
    const suiteId = createPublishedSuite(fixture, caseId, suiteContent(caseId, 1, { requiredDimensions: [{ dimension: "ARABIC_QUALITY", mode: "JUDGE_REQUIRED" }], graderConfigs: [], baselineMode: "REQUIRED" }));
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
