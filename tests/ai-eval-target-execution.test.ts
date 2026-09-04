import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import { AIBudgetAdmissionService, AI_EVALS_ADMISSION_PRINCIPAL_REF, createAIAdmissionRequestFingerprint } from "../src/server/ai/admission";
import { SQLiteAIBudgetPolicyRepository } from "../src/server/ai/budget";
import {
  AIEvalRunService,
  AIEvalTargetOrchestrator,
  AIEvalTargetTerminalReconciler,
  AI_EVAL_TARGET_SCHEDULING_BATCH_SIZE,
  AI_EVAL_EXECUTION_CONFIG_RESOURCE_TYPE,
  AI_EVAL_TARGET_JOB_KIND,
  AI_EVAL_TARGET_JOB_PAYLOAD_VERSION,
  SQLiteAIEvalExecutionConfigRepository,
  SQLiteAIEvalCaseExecutionRepository,
  SQLiteAIEvalCaseRepository,
  SQLiteAIEvalSuiteRepository,
  type AIEvalCaseContent,
  SQLiteAIEvalRunRepository,
  normalizeAIEvalCandidateSnapshot,
  fingerprintAIEvalExecutionConfig,
} from "../src/server/ai/evals";
import { SQLiteAIRateLimitPolicyRepository } from "../src/server/ai/rate-limits";
import { SQLiteAIAccountingRepository } from "../src/server/ai/economics";
import { AIJobHandlerRegistry, AIJobQueueService } from "../src/server/ai/operations/jobs";
import { createCanonicalContentRepository } from "../src/server/canonical-content";
import { createChangeManagementService } from "../src/server/change-management";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const BASE_TIME = 1_905_000_000_000;

interface Fixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  budgetPolicyId: string;
  rateLimitPolicyId: string;
  close(): void;
}

function fixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m9b1-boundary-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  createCanonicalContentRepository(database).bootstrap();
  const ownerUser = new SQLiteAdminIdentityRepository(database).createInitialOwner({ id: uuidv7(), email: `owner-${uuidv7()}@m9b1.test`, displayName: "M9B1 Owner", passwordHash: "fixture", createdAt: BASE_TIME });
  const owner: AdminActor = { actorUserId: ownerUser.id, actorRole: "OWNER" };
  const budgetPolicyId = uuidv7();
  new SQLiteAIBudgetPolicyRepository(database).create({ id: budgetPolicyId, content: { key: `m9b1-evals-budget-${uuidv7()}`, displayName: "M9B1 Evals Budget", currency: "USD", costCenter: "EVALS", hardCapNano: 10_000_000, enabled: true }, actor: owner, now: BASE_TIME });
  const rateLimitPolicyId = uuidv7();
  new SQLiteAIRateLimitPolicyRepository(database).create({ id: rateLimitPolicyId, content: { key: `m9b1-evals-rate-${uuidv7()}`, displayName: "M9B1 Evals Rate", windowMs: 60_000, maxRequests: 100, maxConcurrentRequests: 100, enabled: true }, actor: owner, now: BASE_TIME });
  return { root, database, owner, budgetPolicyId, rateLimitPolicyId, close() { database.close(); rmSync(root, { recursive: true, force: true }); } };
}

function publish(fixtureValue: Fixture, resourceType: string, resourceId: string, desired: unknown): void {
  const changes = createChangeManagementService(fixtureValue.database);
  let change = changes.createChangeSet({ title: "M9B1 test publication", initialItem: { resourceType, resourceId, expectedRevision: 0, operation: "CREATE", desired } }, fixtureValue.owner);
  change = changes.submit(change.changeSet.id, change.changeSet.revision, fixtureValue.owner);
  change = changes.approve(change.changeSet.id, change.changeSet.revision, fixtureValue.owner);
  changes.publish(change.changeSet.id, change.changeSet.revision, fixtureValue.owner);
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
    groundingProtocol: { key: "evidence-grounded-v1", revision: 1 },
    citationProtocol: { key: "evidence-ref-v1", revision: 1 },
  });
}

function caseContent(key = `m9b1.case.${uuidv7()}`): AIEvalCaseContent {
  return { key, subjectKey: "biology", displayName: "M9B1 case", description: null, inputText: "Synthetic target input", origin: "SYNTHETIC", privacyClass: "SYNTHETIC_PUBLIC_SAFE", deidentificationProof: null, expectedStatus: "BLOCKED", allowedFinishReasons: ["OTHER"], requiredOutputLiterals: [], forbiddenOutputLiterals: [], requiredEvidenceOrigins: [], forbiddenEvidenceOrigins: [], requiredCitationLabels: [], minimumEvidenceItemCount: 0, securityLeakageMarkers: [], maximumOutputBytes: 1024, sourceRevisionReferences: [], enabled: true };
}

test("M9B1 EVALS admission uses the code-owned null-private-identity scope", () => {
  const f = fixture();
  try {
    const accounting = new SQLiteAIAccountingRepository(f.database);
    const operationId = uuidv7();
    accounting.createOperation({ id: operationId, content: { costCenter: "EVALS", idempotencyKey: null, opaquePrincipalRef: null, subjectKey: "biology", conversationId: null, responseId: null, jobId: null, evalRunId: uuidv7(), knowledgeRevision: null, status: "OPEN", startedAt: BASE_TIME, completedAt: null } });
    const base = { principalRef: AI_EVALS_ADMISSION_PRINCIPAL_REF, budgetPolicyId: f.budgetPolicyId, budgetPolicyRevision: 1, rateLimitPolicyId: f.rateLimitPolicyId, rateLimitPolicyRevision: 1, budgetPeriod: { startAt: 0, endAt: BASE_TIME + 100_000 }, costOperationId: operationId, costEstimate: { currency: "USD", maxCostNano: 10, estimateBasis: "m9b1-test" }, idempotencyKey: `m9b1-${uuidv7()}` };
    const admission = new AIBudgetAdmissionService(f.database, { clock: () => BASE_TIME });
    const result = admission.admit({ ...base, requestFingerprint: createAIAdmissionRequestFingerprint(base) });
    assert.equal(result.account.principalRef, AI_EVALS_ADMISSION_PRINCIPAL_REF);
    assert.equal(result.reservation.principalRef, AI_EVALS_ADMISSION_PRINCIPAL_REF);
    assert.equal((f.database.client.prepare("select opaque_principal_ref, conversation_id, response_id, job_id, idempotency_key from ai_cost_operations where id=?").get(operationId) as Record<string, unknown>).opaque_principal_ref, null);
  } finally { f.close(); }
});

test("M9B1 Execution Config is governed and target scheduling is exact/idempotent", () => {
  const f = fixture();
  try {
    const caseId = uuidv7();
    publish(f, "ai.eval-case", caseId, caseContent());
    const suiteId = uuidv7();
    publish(f, "ai.eval-suite", suiteId, { key: `m9b1.suite.${uuidv7()}`, subjectKey: "biology", displayName: "M9B1 suite", enabled: true, caseManifest: [{ ordinal: 1, caseId, caseRevision: 1 }], requiredDimensions: [{ dimension: "RELEVANCE", mode: "NOT_APPLICABLE" }], graderConfigs: [], gateConfig: { minimumScores: [], maximumCostNano: null, maximumLatencyMs: null, requireSecurityPass: false }, permittedRegressionDeltas: [], baselineMode: "OPTIONAL", supplementaryJudgeConfig: null });
    const executionConfigId = uuidv7();
    publish(f, AI_EVAL_EXECUTION_CONFIG_RESOURCE_TYPE, executionConfigId, { key: `m9b1.execution.${uuidv7()}`, subjectKey: "biology", displayName: "M9B1 execution", enabled: true, budgetPolicyId: f.budgetPolicyId, budgetPolicyRevision: 1, rateLimitPolicyId: f.rateLimitPolicyId, rateLimitPolicyRevision: 1, protocolKey: "eval-target-v1", protocolRevision: 1, targetTimeoutMs: 30_000, maxConcurrency: 2, cleanupProtocolKey: "synthetic-c4-cleanup-v1", cleanupProtocolRevision: 1 });
    const executionConfig = new SQLiteAIEvalExecutionConfigRepository(f.database).getById(executionConfigId)!;
    assert.equal(executionConfig.currentRevision, 1);
    assert.throws(() => f.database.client.prepare("update ai_eval_execution_config_revisions set display_name='mutated' where execution_config_id=?").run(executionConfigId), /append-only|immutable/i);
    assert.throws(() => f.database.client.prepare("delete from ai_eval_execution_config_revisions where execution_config_id=?").run(executionConfigId), /append-only|history/i);
    const snapshot = candidateSnapshot();
    const run = new AIEvalRunService(f.database).createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: snapshot, createdAt: BASE_TIME + 1 });
    const handlers = new AIJobHandlerRegistry();
    handlers.register({ kind: AI_EVAL_TARGET_JOB_KIND, payloadVersion: AI_EVAL_TARGET_JOB_PAYLOAD_VERSION, validatePayload: (value) => value as Record<string, unknown>, execute: () => undefined });
    const jobs = new AIJobQueueService(f.database, handlers, { clock: () => BASE_TIME + 2 });
    const orchestrator = new AIEvalTargetOrchestrator({ database: f.database, jobs, clock: () => BASE_TIME + 2 });
    const first = orchestrator.scheduleRun({ runId: run.id, executionConfigId, executionConfigRevision: 1, createdBy: f.owner.actorUserId, now: BASE_TIME + 2 });
    const second = orchestrator.scheduleRun({ runId: run.id, executionConfigId, executionConfigRevision: 1, createdBy: f.owner.actorUserId, now: BASE_TIME + 3 });
    assert.deepEqual(second.jobIds, first.jobIds);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_eval_case_executions where run_id=?").get(run.id) as { count: number }).count), 1);
    const executionId = first.executionIds[0]!;
    assert.throws(() => f.database.client.prepare("update ai_eval_case_executions set status='COMPLETED' where id=?").run(executionId), /lifecycle|invalid/i);
    assert.throws(() => f.database.client.prepare("update ai_eval_case_executions set subject_key='physics' where id=?").run(executionId), /identity|immutable/i);
    assert.throws(() => f.database.client.prepare("delete from ai_eval_case_executions where id=?").run(executionId), /append-only|history/i);
    const payload = f.database.client.prepare("select payload_json from ai_jobs where id=?").get(first.jobIds[0]) as { payload_json: string };
    assert.equal(payload.payload_json.includes("Synthetic target input"), false);
    assert.equal(payload.payload_json.includes("TOP_SECRET"), false);
    assert.match(new SQLiteAIEvalRunRepository(f.database).getExecutionBinding(run.id)?.executionConfigFingerprint ?? "", /^[0-9a-f]{64}$/u);
    const configRepository = new SQLiteAIEvalExecutionConfigRepository(f.database);
    const revisionOne = configRepository.getRevision(executionConfigId, 1)!;
    assert.equal(configRepository.appendRevision({ id: executionConfigId, expectedRevision: 1, content: { key: revisionOne.key, subjectKey: revisionOne.subjectKey, displayName: "Execution revision two", enabled: revisionOne.enabled, budgetPolicyId: revisionOne.budgetPolicyId, budgetPolicyRevision: revisionOne.budgetPolicyRevision, rateLimitPolicyId: revisionOne.rateLimitPolicyId, rateLimitPolicyRevision: revisionOne.rateLimitPolicyRevision, protocolKey: revisionOne.protocolKey, protocolRevision: revisionOne.protocolRevision, targetTimeoutMs: revisionOne.targetTimeoutMs, maxConcurrency: revisionOne.maxConcurrency, cleanupProtocolKey: revisionOne.cleanupProtocolKey, cleanupProtocolRevision: revisionOne.cleanupProtocolRevision }, actor: f.owner, now: BASE_TIME + 4 }).revision, 2);
    assert.throws(() => f.database.client.prepare("update ai_eval_execution_configs set current_revision=1 where id=?").run(executionConfigId), /advance|revision/i);
    assert.throws(() => f.database.client.prepare("update ai_eval_execution_configs set current_revision=4 where id=?").run(executionConfigId), /advance|revision/i);
  } finally { f.close(); }
});

test("M9B1 terminal recovery uses relational ownership even when Job payload is malformed", () => {
  const f = fixture();
  try {
    const caseId = uuidv7();
    publish(f, "ai.eval-case", caseId, caseContent());
    const suiteId = uuidv7();
    publish(f, "ai.eval-suite", suiteId, { key: `m9b1.recovery.suite.${uuidv7()}`, subjectKey: "biology", displayName: "Recovery suite", enabled: true, caseManifest: [{ ordinal: 1, caseId, caseRevision: 1 }], requiredDimensions: [{ dimension: "RELEVANCE", mode: "NOT_APPLICABLE" }], graderConfigs: [], gateConfig: { minimumScores: [], maximumCostNano: null, maximumLatencyMs: null, requireSecurityPass: false }, permittedRegressionDeltas: [], baselineMode: "OPTIONAL", supplementaryJudgeConfig: null });
    const executionConfigId = uuidv7();
    publish(f, AI_EVAL_EXECUTION_CONFIG_RESOURCE_TYPE, executionConfigId, { key: `m9b1.recovery.config.${uuidv7()}`, subjectKey: "biology", displayName: "Recovery config", enabled: true, budgetPolicyId: f.budgetPolicyId, budgetPolicyRevision: 1, rateLimitPolicyId: f.rateLimitPolicyId, rateLimitPolicyRevision: 1, protocolKey: "eval-target-v1", protocolRevision: 1, targetTimeoutMs: 30_000, maxConcurrency: 1, cleanupProtocolKey: "synthetic-c4-cleanup-v1", cleanupProtocolRevision: 1 });
    const run = new AIEvalRunService(f.database).createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 1 });
    const handlers = new AIJobHandlerRegistry();
    handlers.register({ kind: AI_EVAL_TARGET_JOB_KIND, payloadVersion: AI_EVAL_TARGET_JOB_PAYLOAD_VERSION, validatePayload: (value) => value as Record<string, unknown>, execute: () => undefined });
    const jobs = new AIJobQueueService(f.database, handlers, { clock: () => BASE_TIME + 2 });
    const scheduled = new AIEvalTargetOrchestrator({ database: f.database, jobs, clock: () => BASE_TIME + 2 }).scheduleRun({ runId: run.id, executionConfigId, executionConfigRevision: 1, createdBy: f.owner.actorUserId, now: BASE_TIME + 2 });
    f.database.client.prepare("update ai_jobs set status='DEAD_LETTER', payload_json='{}', last_error_code='AI_JOB_PAYLOAD_INVALID' where id=?").run(scheduled.jobIds[0]);
    const reconciler = new AIEvalTargetTerminalReconciler({ database: f.database, jobs, executions: new SQLiteAIEvalCaseExecutionRepository(f.database), accounting: { getOperation: (id) => new SQLiteAIAccountingRepository(f.database).getOperation(id), completeOperation: (id, expectedStatus, status, completedAt) => new SQLiteAIAccountingRepository(f.database).updateOperationStatus({ id, expectedStatus, status, completedAt }) }, admission: new AIBudgetAdmissionService(f.database, { clock: () => BASE_TIME + 3 }), evalRuns: new AIEvalRunService(f.database), clock: () => BASE_TIME + 3 });
    const first = reconciler.reconcilePending({ limit: 1, now: BASE_TIME + 3 });
    assert.equal(first.reconciled, 1);
    const execution = new SQLiteAIEvalCaseExecutionRepository(f.database).getByJob(scheduled.jobIds[0]!);
    assert.equal(execution?.status, "FAILED");
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_eval_case_results where run_id=?").get(run.id) as { count: number }).count), 1);
    assert.equal(reconciler.reconcilePending({ limit: 1, now: BASE_TIME + 4 }).reconciled, 0);
  } finally { f.close(); }
});

test("M9B1 marks an in-flight Provider window AMBIGUOUS instead of blindly retrying", () => {
  const f = fixture();
  try {
    const caseId = uuidv7();
    publish(f, "ai.eval-case", caseId, caseContent());
    const suiteId = uuidv7();
    publish(f, "ai.eval-suite", suiteId, { key: `m9b1.ambiguous.suite.${uuidv7()}`, subjectKey: "biology", displayName: "Ambiguous suite", enabled: true, caseManifest: [{ ordinal: 1, caseId, caseRevision: 1 }], requiredDimensions: [{ dimension: "RELEVANCE", mode: "NOT_APPLICABLE" }], graderConfigs: [], gateConfig: { minimumScores: [], maximumCostNano: null, maximumLatencyMs: null, requireSecurityPass: false }, permittedRegressionDeltas: [], baselineMode: "OPTIONAL", supplementaryJudgeConfig: null });
    const executionConfigId = createExecutionConfig(f);
    const run = new AIEvalRunService(f.database).createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 1 });
    const handlers = new AIJobHandlerRegistry();
    handlers.register({ kind: AI_EVAL_TARGET_JOB_KIND, payloadVersion: AI_EVAL_TARGET_JOB_PAYLOAD_VERSION, validatePayload: (value) => value as Record<string, unknown>, execute: () => undefined });
    const jobs = new AIJobQueueService(f.database, handlers, { clock: () => BASE_TIME + 2 });
    const scheduled = new AIEvalTargetOrchestrator({ database: f.database, jobs, clock: () => BASE_TIME + 2 }).scheduleRun({ runId: run.id, executionConfigId, executionConfigRevision: 1, createdBy: f.owner.actorUserId, now: BASE_TIME + 2 });
    const executions = new SQLiteAIEvalCaseExecutionRepository(f.database);
    let execution = executions.getByJob(scheduled.jobIds[0]!)!;
    execution = executions.markRunning(execution.id, BASE_TIME + 3);
    const accounting = new SQLiteAIAccountingRepository(f.database);
    const operationId = uuidv7();
    accounting.createOperation({ id: operationId, content: { costCenter: "EVALS", idempotencyKey: null, opaquePrincipalRef: null, subjectKey: "biology", conversationId: null, responseId: null, jobId: null, evalRunId: run.id, knowledgeRevision: null, status: "OPEN", startedAt: BASE_TIME + 3, completedAt: null } });
    executions.bindOperation(execution.id, operationId, BASE_TIME + 3);
    executions.markInvoking(execution.id, BASE_TIME + 3);
    f.database.client.prepare("update ai_jobs set status='DEAD_LETTER', last_error_code='AI_JOB_TIMEOUT' where id=?").run(scheduled.jobIds[0]);
    const reconciler = new AIEvalTargetTerminalReconciler({ database: f.database, jobs, executions, accounting: { getOperation: (id) => accounting.getOperation(id), completeOperation: (id, expectedStatus, status, completedAt) => accounting.updateOperationStatus({ id, expectedStatus, status, completedAt }) }, admission: new AIBudgetAdmissionService(f.database, { clock: () => BASE_TIME + 4 }), evalRuns: new AIEvalRunService(f.database), clock: () => BASE_TIME + 4 });
    reconciler.reconcile(jobs.getJob(scheduled.jobIds[0]!)!, BASE_TIME + 4);
    assert.equal(executions.getById(execution.id)?.status, "AMBIGUOUS");
    assert.equal((accounting.getOperation(operationId)!).status, "FAILED");
    assert.equal(reconciler.reconcilePending({ limit: 10, now: BASE_TIME + 5 }).reconciled, 0);
  } finally { f.close(); }
});

test("M9B1 bounded terminal recovery drains a backlog larger than one batch", () => {
  const f = fixture();
  try {
    const cases = new SQLiteAIEvalCaseRepository(f.database);
    const suites = new SQLiteAIEvalSuiteRepository(f.database);
    const manifest = Array.from({ length: 150 }, (_, index) => { const caseId = uuidv7(); cases.create({ id: caseId, content: { ...caseContent(`m9b1.backlog.case.${index}.${uuidv7()}`), inputText: `synthetic backlog input ${index}` }, actor: f.owner, now: BASE_TIME + index }); return { ordinal: index + 1, caseId, caseRevision: 1 }; });
    const suiteId = uuidv7();
    suites.create({ id: suiteId, content: { key: `m9b1.backlog.suite.${uuidv7()}`, subjectKey: "biology", displayName: "Backlog suite", enabled: true, caseManifest: manifest, requiredDimensions: [{ dimension: "RELEVANCE", mode: "NOT_APPLICABLE" }], graderConfigs: [], gateConfig: { minimumScores: [], maximumCostNano: null, maximumLatencyMs: null, requireSecurityPass: false }, permittedRegressionDeltas: [], baselineMode: "OPTIONAL", supplementaryJudgeConfig: null }, actor: f.owner, now: BASE_TIME + 200 });
    const run = new AIEvalRunService(f.database).createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 201 });
    const handlers = new AIJobHandlerRegistry();
    handlers.register({ kind: AI_EVAL_TARGET_JOB_KIND, payloadVersion: AI_EVAL_TARGET_JOB_PAYLOAD_VERSION, validatePayload: (value) => value as Record<string, unknown>, execute: () => undefined });
    const jobs = new AIJobQueueService(f.database, handlers, { clock: () => BASE_TIME + 202 });
    const orchestrator = new AIEvalTargetOrchestrator({ database: f.database, jobs, clock: () => BASE_TIME + 202 });
    const executionConfigId = createExecutionConfig(f);
    let scheduled = orchestrator.scheduleRun({ runId: run.id, executionConfigId, executionConfigRevision: 1, createdBy: f.owner.actorUserId, now: BASE_TIME + 202 });
    while (!scheduled.schedulingComplete) scheduled = orchestrator.scheduleRun({ runId: run.id, executionConfigId, executionConfigRevision: 1, createdBy: f.owner.actorUserId, now: BASE_TIME + 202 });
    f.database.client.prepare("update ai_jobs set status='DEAD_LETTER', last_error_code='AI_JOB_TIMEOUT' where kind=?").run(AI_EVAL_TARGET_JOB_KIND);
    const accounting = new SQLiteAIAccountingRepository(f.database);
    const reconciler = new AIEvalTargetTerminalReconciler({ database: f.database, jobs, executions: new SQLiteAIEvalCaseExecutionRepository(f.database), accounting: { getOperation: (id) => accounting.getOperation(id), completeOperation: (id, expectedStatus, status, completedAt) => accounting.updateOperationStatus({ id, expectedStatus, status, completedAt }) }, admission: new AIBudgetAdmissionService(f.database, { clock: () => BASE_TIME + 203 }), evalRuns: new AIEvalRunService(f.database), clock: () => BASE_TIME + 203 });
    let total = 0;
    for (let index = 0; index < 20; index += 1) { const result = reconciler.reconcilePending({ limit: 25, now: BASE_TIME + 203 + index }); total += result.reconciled; if (result.scanned === 0) break; }
    assert.equal(total, 150);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_eval_case_executions where run_id=? and status='BUILDING'").get(run.id) as { count: number }).count), 0);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_eval_case_executions where run_id=? and status='FAILED'").get(run.id) as { count: number }).count), 150);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_eval_case_results where run_id=?").get(run.id) as { count: number }).count), 150);
    assert.equal(reconciler.reconcilePending({ limit: 25, now: BASE_TIME + 300 }).reconciled, 0);
  } finally { f.close(); }
});

test("0035 to 0036 preserves populated M9B1 data and hardens retry lifecycle", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m9b1-upgrade-"));
    const previous = createMigrationDirectory("pythagoras-ai-m9b1-0035-", 36);
  let oldDatabase: ContentDatabase | null = null;
  let upgraded: ContentDatabase | null = null;
  try {
    oldDatabase = openContentDatabase({ dataDirectory: root, migrationsDirectory: previous });
    createCanonicalContentRepository(oldDatabase).bootstrap();
    const identities = new SQLiteAdminIdentityRepository(oldDatabase);
    const user = identities.createInitialOwner({ id: uuidv7(), email: `owner-${uuidv7()}@m9b1-upgrade.test`, displayName: "M9B1 Upgrade Owner", passwordHash: "fixture", createdAt: BASE_TIME });
    const actor: AdminActor = { actorUserId: user.id, actorRole: "OWNER" };
    const caseId = uuidv7();
    new SQLiteAIEvalCaseRepository(oldDatabase).create({ id: caseId, content: caseContent("m9b1.upgrade.case"), actor, now: BASE_TIME + 1 });
    const suiteId = uuidv7();
    new SQLiteAIEvalSuiteRepository(oldDatabase).create({ id: suiteId, content: { key: "m9b1.upgrade.suite", subjectKey: "biology", displayName: "Upgrade suite", enabled: true, caseManifest: [{ ordinal: 1, caseId, caseRevision: 1 }], requiredDimensions: [{ dimension: "RELEVANCE", mode: "NOT_APPLICABLE" }], graderConfigs: [], gateConfig: { minimumScores: [], maximumCostNano: null, maximumLatencyMs: null, requireSecurityPass: false }, permittedRegressionDeltas: [], baselineMode: "OPTIONAL", supplementaryJudgeConfig: null }, actor, now: BASE_TIME + 2 });
    const budgetPolicyId = uuidv7();
    new SQLiteAIBudgetPolicyRepository(oldDatabase).create({ id: budgetPolicyId, content: { key: `m9b1.upgrade.budget.${uuidv7()}`, displayName: "Upgrade budget", currency: "USD", costCenter: "EVALS", hardCapNano: 10_000_000, enabled: true }, actor, now: BASE_TIME + 3 });
    const rateLimitPolicyId = uuidv7();
    new SQLiteAIRateLimitPolicyRepository(oldDatabase).create({ id: rateLimitPolicyId, content: { key: `m9b1.upgrade.rate.${uuidv7()}`, displayName: "Upgrade rate", windowMs: 60_000, maxRequests: 100, maxConcurrentRequests: 100, enabled: true }, actor, now: BASE_TIME + 3 });
    const executionConfigId = uuidv7();
    const executionConfig = new SQLiteAIEvalExecutionConfigRepository(oldDatabase).create({ id: executionConfigId, content: { key: `m9b1.upgrade.config.${uuidv7()}`, subjectKey: "biology", displayName: "Upgrade execution config", enabled: true, budgetPolicyId, budgetPolicyRevision: 1, rateLimitPolicyId, rateLimitPolicyRevision: 1, protocolKey: "eval-target-v1", protocolRevision: 1, targetTimeoutMs: 30_000, maxConcurrency: 1, cleanupProtocolKey: "synthetic-c4-cleanup-v1", cleanupProtocolRevision: 1 }, actor, now: BASE_TIME + 4 });
    const run = new AIEvalRunService(oldDatabase).createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 5 });
    const runRepository = new SQLiteAIEvalRunRepository(oldDatabase);
    runRepository.bindExecutionConfig({ runId: run.id, executionConfigId, executionConfigRevision: 1, executionConfigFingerprint: fingerprintAIEvalExecutionConfig(executionConfig), createdAt: BASE_TIME + 5, createdBy: actor.actorUserId });
    runRepository.transition({ id: run.id, expectedStatus: "CREATED", status: "RUNNING", startedAt: BASE_TIME + 5, updatedAt: BASE_TIME + 5 });
    const executionId = uuidv7();
    oldDatabase.client.prepare("insert into ai_eval_case_executions (id,run_id,case_id,case_revision,ordinal,subject_key,execution_config_id,execution_config_revision,execution_config_fingerprint,execution_protocol_key,execution_protocol_revision,cleanup_protocol_key,cleanup_protocol_revision,target_cost_operation_id,budget_reservation_id,job_id,status,provider_invocation_state,provider_invoked,output_sha256,output_byte_size,finish_reason,retrieval_status,candidate_fingerprint,plan_fingerprint,safe_failure_code,created_at,started_at,completed_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(executionId, run.id, caseId, 1, 1, "biology", executionConfigId, 1, fingerprintAIEvalExecutionConfig(executionConfig), executionConfig.protocolKey, executionConfig.protocolRevision, executionConfig.cleanupProtocolKey, executionConfig.cleanupProtocolRevision, null, null, null, "PENDING", "NOT_INVOKED", 0, null, null, null, null, run.candidateFingerprint, null, null, BASE_TIME + 6, null, null, BASE_TIME + 6);
    assert.equal(Number((oldDatabase.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count), 36);
    oldDatabase.close(); oldDatabase = null;
    upgraded = openContentDatabase({ dataDirectory: root, migrationsDirectory });
    assert.equal(Number((upgraded.client.prepare("select count(*) as count from __drizzle_migrations").get() as { count: number }).count), 41);
    assert.ok(upgraded.client.prepare("select id from ai_eval_cases where id=?").get(caseId));
    assert.ok(upgraded.client.prepare("select id from ai_eval_suites where id=?").get(suiteId));
    assert.deepEqual(upgraded.client.prepare("select status, admission_attempt, execution_config_id, execution_config_revision, case_id, ordinal from ai_eval_case_executions where id=?").get(executionId), { status: "PENDING", admission_attempt: 0, execution_config_id: executionConfigId, execution_config_revision: 1, case_id: caseId, ordinal: 1 });
    for (const table of ["ai_eval_execution_configs", "ai_eval_execution_config_revisions", "ai_eval_run_execution_bindings", "ai_eval_case_executions", "ai_eval_target_cleanups"]) assert.ok(upgraded.client.prepare("select name from sqlite_master where type='table' and name=?").get(table));
    assert.equal((upgraded.client.prepare("pragma table_info(ai_eval_case_executions)").all() as Array<{ name: string }>).some((column) => column.name === "admission_attempt"), true);
    assert.ok(upgraded.client.prepare("select name from sqlite_master where type='trigger' and name='ai_eval_case_executions_insert_valid'").get());
  } finally { oldDatabase?.close(); upgraded?.close(); rmSync(root, { recursive: true, force: true }); rmSync(previous, { recursive: true, force: true }); }
});

test("M9B1 schedules a 10,000-case manifest in bounded deterministic batches", () => {
  const f = fixture();
  try {
    const cases = new SQLiteAIEvalCaseRepository(f.database);
    const suites = new SQLiteAIEvalSuiteRepository(f.database);
    const manifest = Array.from({ length: 10_000 }, (_, index) => {
      const caseId = uuidv7();
      cases.create({ id: caseId, content: { ...caseContent(`m9b1.schedule.case.${index}.${uuidv7()}`), inputText: `bounded target ${index}` }, actor: f.owner, now: BASE_TIME + index });
      return { ordinal: index + 1, caseId, caseRevision: 1 };
    });
    const suiteId = uuidv7();
    suites.create({ id: suiteId, content: { key: `m9b1.schedule.suite.${uuidv7()}`, subjectKey: "biology", displayName: "Bounded schedule suite", enabled: true, caseManifest: manifest, requiredDimensions: [{ dimension: "RELEVANCE", mode: "NOT_APPLICABLE" }], graderConfigs: [], gateConfig: { minimumScores: [], maximumCostNano: null, maximumLatencyMs: null, requireSecurityPass: false }, permittedRegressionDeltas: [], baselineMode: "OPTIONAL", supplementaryJudgeConfig: null }, actor: f.owner, now: BASE_TIME + 10_001 });
    const run = new AIEvalRunService(f.database).createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 10_002 });
    const configId = createExecutionConfig(f);
    const handlers = new AIJobHandlerRegistry();
    handlers.register({ kind: AI_EVAL_TARGET_JOB_KIND, payloadVersion: AI_EVAL_TARGET_JOB_PAYLOAD_VERSION, validatePayload: (value) => value as Record<string, unknown>, execute: () => undefined });
    const jobs = new AIJobQueueService(f.database, handlers, { clock: () => BASE_TIME + 10_003 });
    const orchestrator = new AIEvalTargetOrchestrator({ database: f.database, jobs, clock: () => BASE_TIME + 10_003 });
    let progress = orchestrator.scheduleRun({ runId: run.id, executionConfigId: configId, executionConfigRevision: 1, createdBy: f.owner.actorUserId, now: BASE_TIME + 10_003 });
    assert.ok(progress.scheduledThisBatch <= AI_EVAL_TARGET_SCHEDULING_BATCH_SIZE);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_eval_case_executions where run_id=?").get(run.id) as { count: number }).count), AI_EVAL_TARGET_SCHEDULING_BATCH_SIZE);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_jobs where kind=?").get(AI_EVAL_TARGET_JOB_KIND) as { count: number }).count), AI_EVAL_TARGET_SCHEDULING_BATCH_SIZE);
    while (!progress.schedulingComplete) progress = orchestrator.scheduleRun({ runId: run.id, executionConfigId: configId, executionConfigRevision: 1, createdBy: f.owner.actorUserId, now: BASE_TIME + 10_003 });
    assert.equal(progress.totalScheduled, 10_000);
    assert.equal(progress.remaining, 0);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_eval_case_executions where run_id=?").get(run.id) as { count: number }).count), 10_000);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_jobs where kind=?").get(AI_EVAL_TARGET_JOB_KIND) as { count: number }).count), 10_000);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_eval_case_executions where run_id=? and ordinal between 1 and 10000").get(run.id) as { count: number }).count), 10_000);
    const rerun = orchestrator.scheduleRun({ runId: run.id, executionConfigId: configId, executionConfigRevision: 1, createdBy: f.owner.actorUserId, now: BASE_TIME + 10_004 });
    assert.equal(rerun.scheduledThisBatch, 0);
    assert.equal(rerun.schedulingComplete, true);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_jobs where kind=?").get(AI_EVAL_TARGET_JOB_KIND) as { count: number }).count), 10_000);
  } finally { f.close(); }
});

test("M9B1 applies the Job batch bound to pre-existing unbound Case Executions", () => {
  const f = fixture();
  try {
    const cases = new SQLiteAIEvalCaseRepository(f.database);
    const suites = new SQLiteAIEvalSuiteRepository(f.database);
    const manifest = Array.from({ length: 150 }, (_, index) => {
      const caseId = uuidv7();
      cases.create({ id: caseId, content: { ...caseContent(`m9b1.orphan.case.${index}.${uuidv7()}`), inputText: `orphan target ${index}` }, actor: f.owner, now: BASE_TIME + index });
      return { ordinal: index + 1, caseId, caseRevision: 1 };
    });
    const suiteId = uuidv7();
    suites.create({ id: suiteId, content: { key: `m9b1.orphan.suite.${uuidv7()}`, subjectKey: "biology", displayName: "Unbound execution suite", enabled: true, caseManifest: manifest, requiredDimensions: [{ dimension: "RELEVANCE", mode: "NOT_APPLICABLE" }], graderConfigs: [], gateConfig: { minimumScores: [], maximumCostNano: null, maximumLatencyMs: null, requireSecurityPass: false }, permittedRegressionDeltas: [], baselineMode: "OPTIONAL", supplementaryJudgeConfig: null }, actor: f.owner, now: BASE_TIME + 151 });
    const configId = createExecutionConfig(f);
    const config = new SQLiteAIEvalExecutionConfigRepository(f.database).getById(configId)!;
    const run = new AIEvalRunService(f.database).createRun({ id: uuidv7(), suiteId, suiteRevision: 1, candidateSnapshot: candidateSnapshot(), createdAt: BASE_TIME + 152 });
    const runRepository = new SQLiteAIEvalRunRepository(f.database);
    runRepository.bindExecutionConfig({ runId: run.id, executionConfigId: configId, executionConfigRevision: 1, executionConfigFingerprint: fingerprintAIEvalExecutionConfig(config), createdAt: BASE_TIME + 152, createdBy: f.owner.actorUserId });
    runRepository.transition({ id: run.id, expectedStatus: "CREATED", status: "RUNNING", startedAt: BASE_TIME + 152, updatedAt: BASE_TIME + 152 });
    const executions = new SQLiteAIEvalCaseExecutionRepository(f.database);
    for (const entry of manifest) executions.create({ runId: run.id, caseId: entry.caseId, caseRevision: entry.caseRevision, ordinal: entry.ordinal, subjectKey: "biology", executionConfigId: configId, executionConfigRevision: 1, executionConfigFingerprint: fingerprintAIEvalExecutionConfig(config), executionProtocolKey: config.protocolKey, executionProtocolRevision: config.protocolRevision, cleanupProtocolKey: config.cleanupProtocolKey, cleanupProtocolRevision: config.cleanupProtocolRevision, admissionAttempt: 0, targetCostOperationId: null, budgetReservationId: null, jobId: null, status: "PENDING", providerInvocationState: "NOT_INVOKED", providerInvoked: false, outputSha256: null, outputByteSize: null, finishReason: null, retrievalStatus: null, candidateFingerprint: run.candidateFingerprint, planFingerprint: null, safeFailureCode: null, createdAt: BASE_TIME + 153, startedAt: null, completedAt: null, updatedAt: BASE_TIME + 153 });
    const handlers = new AIJobHandlerRegistry();
    handlers.register({ kind: AI_EVAL_TARGET_JOB_KIND, payloadVersion: AI_EVAL_TARGET_JOB_PAYLOAD_VERSION, validatePayload: (value) => value as Record<string, unknown>, execute: () => undefined });
    const jobs = new AIJobQueueService(f.database, handlers, { clock: () => BASE_TIME + 154 });
    const orchestrator = new AIEvalTargetOrchestrator({ database: f.database, jobs, clock: () => BASE_TIME + 154 });
    let progress = orchestrator.scheduleRun({ runId: run.id, executionConfigId: configId, executionConfigRevision: 1, createdBy: f.owner.actorUserId, now: BASE_TIME + 154 });
    assert.ok(progress.scheduledThisBatch <= AI_EVAL_TARGET_SCHEDULING_BATCH_SIZE);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_eval_case_executions where run_id=? and job_id is null").get(run.id) as { count: number }).count), 50);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_jobs where kind=?").get(AI_EVAL_TARGET_JOB_KIND) as { count: number }).count), 100);
    while (!progress.schedulingComplete) progress = orchestrator.scheduleRun({ runId: run.id, executionConfigId: configId, executionConfigRevision: 1, createdBy: f.owner.actorUserId, now: BASE_TIME + 154 });
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_eval_case_executions where run_id=?").get(run.id) as { count: number }).count), 150);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_jobs where kind=?").get(AI_EVAL_TARGET_JOB_KIND) as { count: number }).count), 150);
    assert.equal(Number((f.database.client.prepare("select count(distinct ordinal) as count from ai_eval_case_executions where run_id=?").get(run.id) as { count: number }).count), 150);
    const rerun = orchestrator.scheduleRun({ runId: run.id, executionConfigId: configId, executionConfigRevision: 1, createdBy: f.owner.actorUserId, now: BASE_TIME + 155 });
    assert.equal(rerun.scheduledThisBatch, 0);
    assert.equal(Number((f.database.client.prepare("select count(*) as count from ai_jobs where kind=?").get(AI_EVAL_TARGET_JOB_KIND) as { count: number }).count), 150);
  } finally { f.close(); }
});

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


function createExecutionConfig(f: Fixture): string {
  const id = uuidv7();
  publish(f, AI_EVAL_EXECUTION_CONFIG_RESOURCE_TYPE, id, { key: `m9b1.backlog.config.${uuidv7()}`, subjectKey: "biology", displayName: "Backlog config", enabled: true, budgetPolicyId: f.budgetPolicyId, budgetPolicyRevision: 1, rateLimitPolicyId: f.rateLimitPolicyId, rateLimitPolicyRevision: 1, protocolKey: "eval-target-v1", protocolRevision: 1, targetTimeoutMs: 30_000, maxConcurrency: 1, cleanupProtocolKey: "synthetic-c4-cleanup-v1", cleanupProtocolRevision: 1 });
  return id;
}
