import type { ContentDatabase } from "../../content/database";
import type { AIBudgetAdmissionService } from "../admission";
import type { AIJobExecutionContext, AIJobHandlerDefinition, AIJobQueueService } from "../operations/jobs";
import type { AIJobHandlerRegistry } from "../operations/jobs";
import { AIJobExecutionError } from "../operations/jobs";
import type {
  AIEvalCaseExecution,
  AIEvalCaseExecutionRepository,
  AIEvalDimension,
  AIEvalJudgeCoverage,
  AIEvalJudgeExecutionRepository,
} from "./contracts";
import { AI_EVAL_TARGET_JOB_KIND, AI_EVAL_TARGET_JOB_PAYLOAD_VERSION } from "./contracts";
import { AIEvalError } from "./errors";
import { SQLiteAIEvalCaseExecutionRepository } from "./case-executions";
import { SQLiteAIEvalExecutionConfigRepository, fingerprintAIEvalExecutionConfig } from "./execution-config";
import { SQLiteAIEvalJudgeConfigRepository } from "./judge-config";
import { SQLiteAIEvalJudgeExecutionRepository } from "./judge-executions";
import { SQLiteAIEvalRunRepository } from "./runs";
import { SQLiteAIEvalSuiteRepository } from "./configuration";
import { AIEvalRunService } from "./service";
import type { AIEvalTargetExecutionService } from "./target-execution";
import { AIEvalTargetCleanupService } from "./target-cleanup";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_TIMESTAMP = 8_640_000_000_000_000;
export const AI_EVAL_TARGET_SCHEDULING_BATCH_SIZE = 100;

export interface AIEvalTargetScheduleResult {
  runId: string;
  executionConfigId: string;
  executionConfigRevision: number;
  maxConcurrency: number;
  executionIds: readonly string[];
  jobIds: readonly string[];
  scheduledThisBatch: number;
  totalExpected: number;
  totalScheduled: number;
  remaining: number;
  schedulingComplete: boolean;
}

export interface AIEvalTargetCoverage {
  runId: string;
  expected: number;
  terminal: number;
  nonAmbiguous: number;
  observed: number;
  complete: boolean;
}

export interface AIEvalTargetOrchestratorDependencies {
  database: ContentDatabase;
  jobs: AIJobQueueService;
  runs?: SQLiteAIEvalRunRepository;
  executions?: AIEvalCaseExecutionRepository;
  executionConfigs?: SQLiteAIEvalExecutionConfigRepository;
  judgeConfigs?: SQLiteAIEvalJudgeConfigRepository;
  judgeExecutions?: AIEvalJudgeExecutionRepository;
  evalRuns?: AIEvalRunService;
  clock?: () => number;
}

/** Schedules the exact pinned Suite manifest; it never starts scoring automatically. */
export class AIEvalTargetOrchestrator {
  private readonly runs: SQLiteAIEvalRunRepository;
  private readonly executions: AIEvalCaseExecutionRepository;
  private readonly executionConfigs: SQLiteAIEvalExecutionConfigRepository;
  private readonly judgeConfigs: SQLiteAIEvalJudgeConfigRepository;
  private readonly judgeExecutions: AIEvalJudgeExecutionRepository;
  private readonly evalRuns: AIEvalRunService;
  private readonly clock: () => number;

  constructor(private readonly dependencies: AIEvalTargetOrchestratorDependencies) {
    this.runs = dependencies.runs ?? new SQLiteAIEvalRunRepository(dependencies.database);
    this.executions = dependencies.executions ?? new SQLiteAIEvalCaseExecutionRepository(dependencies.database);
    this.executionConfigs = dependencies.executionConfigs ?? new SQLiteAIEvalExecutionConfigRepository(dependencies.database);
    this.judgeConfigs = dependencies.judgeConfigs ?? new SQLiteAIEvalJudgeConfigRepository(dependencies.database);
    this.judgeExecutions = dependencies.judgeExecutions ?? new SQLiteAIEvalJudgeExecutionRepository(dependencies.database);
    this.evalRuns = dependencies.evalRuns ?? new AIEvalRunService(dependencies.database, { runs: this.runs, judgeExecutions: this.judgeExecutions });
    this.clock = dependencies.clock ?? Date.now;
  }

  scheduleRun(input: { runId: string; executionConfigId: string; executionConfigRevision: number; createdBy: string; now?: number }): AIEvalTargetScheduleResult {
    const now = input.now ?? this.clock();
    if (!Number.isSafeInteger(now) || now < 0 || now > MAX_TIMESTAMP) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target schedule timestamp is invalid.");
    return this.dependencies.database.client.transaction(() => {
      const run = this.runs.getById(input.runId);
      if (!run || (run.status !== "CREATED" && run.status !== "RUNNING")) throw new AIEvalError("AI_EVAL_TARGET_NOT_READY", "Only an active Eval Run can be scheduled.");
      const suite = new SQLiteAIEvalSuiteRepository(this.dependencies.database).getRevision(run.suiteId, run.suiteRevision);
      const config = this.executionConfigs.getRevision(input.executionConfigId, input.executionConfigRevision);
      if (!suite || !config || !config.enabled || config.subjectKey !== suite.subjectKey) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target Execution Config does not match the Suite.");
      const fingerprint = fingerprintAIEvalExecutionConfig(config);
      const binding = this.runs.getExecutionBinding(run.id);
      if (run.status === "CREATED") {
        this.runs.bindExecutionConfig({ runId: run.id, executionConfigId: config.executionConfigId, executionConfigRevision: config.revision, executionConfigFingerprint: fingerprint, createdAt: now, createdBy: input.createdBy });
        this.runs.transition({ id: run.id, expectedStatus: "CREATED", status: "RUNNING", startedAt: now, updatedAt: now });
      } else if (!binding || binding.executionConfigId !== config.executionConfigId || binding.executionConfigRevision !== config.revision || binding.executionConfigFingerprint !== fingerprint) {
        throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The active Eval Run is pinned to a different Execution Config.");
      }
      const executionIds: string[] = [];
      const jobIds: string[] = [];
      let scheduledThisBatch = 0;
      const knownExecutions = new Map<string, AIEvalCaseExecution>(this.executions.listForRun(run.id).map((execution) => [`${execution.caseId}\u0000${execution.caseRevision}`, execution]));
      for (const entry of suite.caseManifest) {
        const executionKey = `${entry.caseId}\u0000${entry.caseRevision}`;
        let execution = knownExecutions.get(executionKey) ?? null;
        if (!execution) {
          if (scheduledThisBatch >= AI_EVAL_TARGET_SCHEDULING_BATCH_SIZE) break;
          execution = this.executions.create({
            runId: run.id,
            caseId: entry.caseId,
            caseRevision: entry.caseRevision,
            ordinal: entry.ordinal,
            subjectKey: suite.subjectKey,
            executionConfigId: config.executionConfigId,
            executionConfigRevision: config.revision,
            executionConfigFingerprint: fingerprint,
            executionProtocolKey: config.protocolKey,
            executionProtocolRevision: config.protocolRevision,
            cleanupProtocolKey: config.cleanupProtocolKey,
            cleanupProtocolRevision: config.cleanupProtocolRevision,
            admissionAttempt: 0,
            targetCostOperationId: null,
            budgetReservationId: null,
            jobId: null,
            status: "PENDING",
            providerInvocationState: "NOT_INVOKED",
            providerInvoked: false,
            outputSha256: null,
            outputByteSize: null,
            finishReason: null,
            retrievalStatus: null,
            candidateFingerprint: run.candidateFingerprint,
            planFingerprint: null,
            safeFailureCode: null,
            createdAt: now,
            startedAt: null,
            completedAt: null,
            updatedAt: now,
          });
          knownExecutions.set(executionKey, execution);
        }
        if (execution.jobId) {
          if (scheduledThisBatch === 0 && executionIds.length < AI_EVAL_TARGET_SCHEDULING_BATCH_SIZE) {
            executionIds.push(execution.id);
            jobIds.push(execution.jobId);
          }
          continue;
        }
        if (scheduledThisBatch >= AI_EVAL_TARGET_SCHEDULING_BATCH_SIZE) break;
        const job = this.dependencies.jobs.enqueueInTransaction({
          kind: AI_EVAL_TARGET_JOB_KIND,
          payloadVersion: AI_EVAL_TARGET_JOB_PAYLOAD_VERSION,
          payload: { runId: run.id, caseId: entry.caseId, caseRevision: entry.caseRevision, executionConfigId: config.executionConfigId, executionConfigRevision: config.revision },
          dedupeKey: `eval-target:${run.id}:${entry.caseId}:${entry.caseRevision}:${config.executionConfigId}:${config.revision}`,
          costCenter: "EVALS",
          costOperationId: null,
          priority: "NORMAL",
          maxAttempts: 8,
          timeoutMs: config.targetTimeoutMs,
          leaseDurationMs: Math.min(86_400_000, Math.max(120_000, config.targetTimeoutMs + 30_000)),
          backoffBaseMs: 1_000,
          backoffMaxMs: 60_000,
          scheduledAt: now,
        }, now);
        execution = this.executions.bindJob(execution.id, job.id, now);
        knownExecutions.set(executionKey, execution);
        if (scheduledThisBatch === 0) {
          executionIds.length = 0;
          jobIds.length = 0;
        }
        executionIds.push(execution.id);
        jobIds.push(job.id);
        scheduledThisBatch += 1;
      }
      const totalExpected = suite.caseManifest.length;
      const totalScheduled = [...knownExecutions.values()].filter((candidate) => candidate.jobId !== null).length;
      return { runId: run.id, executionConfigId: config.executionConfigId, executionConfigRevision: config.revision, maxConcurrency: config.maxConcurrency, executionIds, jobIds, scheduledThisBatch, totalExpected, totalScheduled, remaining: totalExpected - totalScheduled, schedulingComplete: totalScheduled === totalExpected };
    }).immediate();
  }

  getCoverage(runId: string): AIEvalTargetCoverage {
    const run = this.runs.getById(runId);
    if (!run) throw new AIEvalError("AI_EVAL_NOT_FOUND", "The Eval Run was not found.");
    const suite = new SQLiteAIEvalSuiteRepository(this.dependencies.database).getRevision(run.suiteId, run.suiteRevision);
    if (!suite) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The pinned Eval Suite revision is unavailable.");
    const executions = this.executions.listForRun(runId);
    const results = this.runs.listCaseResults(runId);
    const terminal = executions.filter((execution) => ["COMPLETED", "BLOCKED", "FAILED", "CANCELLED", "AMBIGUOUS"].includes(execution.status)).length;
    const nonAmbiguous = executions.filter((execution) => execution.status !== "AMBIGUOUS" && ["COMPLETED", "BLOCKED", "FAILED", "CANCELLED"].includes(execution.status)).length;
    const observed = results.filter((result) => suite.caseManifest.some((entry) => entry.caseId === result.caseId && entry.caseRevision === result.caseRevision && entry.ordinal === result.ordinal)).length;
    const pendingCleanup = new AIEvalTargetCleanupService({ database: this.dependencies.database, executions: this.executions }).pendingCountForRun(runId);
    const complete = executions.length === suite.caseManifest.length && nonAmbiguous === suite.caseManifest.length && observed === suite.caseManifest.length && pendingCleanup === 0 && suite.caseManifest.every((entry) => executions.some((execution) => execution.caseId === entry.caseId && execution.caseRevision === entry.caseRevision && execution.ordinal === entry.ordinal && execution.jobId !== null) && results.some((result) => result.caseId === entry.caseId && result.caseRevision === entry.caseRevision && result.ordinal === entry.ordinal));
    return { runId, expected: suite.caseManifest.length, terminal, nonAmbiguous, observed, complete };
  }

  getJudgeCoverage(runId: string): AIEvalJudgeCoverage {
    const run = this.runs.getById(runId);
    if (!run) throw new AIEvalError("AI_EVAL_NOT_FOUND", "The Eval Run was not found.");
    const suite = new SQLiteAIEvalSuiteRepository(this.dependencies.database).getRevision(run.suiteId, run.suiteRevision);
    if (!suite) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The pinned Eval Suite revision is unavailable.");
    const judgeRequiredDimensions = suite.requiredDimensions
      .filter((d) => d.mode === "JUDGE_REQUIRED")
      .map((d) => d.dimension as AIEvalDimension);

    if (judgeRequiredDimensions.length === 0) {
      return {
        runId,
        expectedCases: suite.caseManifest.length,
        expectedDimensions: 0,
        completedExecutions: 0,
        nonAmbiguousExecutions: 0,
        judgeResults: 0,
        complete: true,
      };
    }

    const judgeExecutions = this.judgeExecutions.listForRun(runId);
    const terminal = judgeExecutions.filter((e) => ["COMPLETED", "FAILED", "CANCELLED", "AMBIGUOUS", "INPUT_LOST"].includes(e.status)).length;
    const nonAmbiguous = judgeExecutions.filter((e) => e.status !== "AMBIGUOUS" && ["COMPLETED", "FAILED", "CANCELLED", "INPUT_LOST"].includes(e.status)).length;
    const allResults = this.runs.listJudgeResultsForRun(runId);
    const results = allResults.filter((r) => judgeRequiredDimensions.includes(r.dimension));

    const manifestExactExecutions = suite.caseManifest.every((entry) =>
      judgeExecutions.some((e) => e.caseId === entry.caseId && e.caseRevision === entry.caseRevision && e.status === "COMPLETED")
    );

    const expectedResultsCount = suite.caseManifest.length * judgeRequiredDimensions.length;
    const manifestExactResults = suite.caseManifest.every((entry) => {
      const caseResult = this.runs.listCaseResults(runId).find((c) => c.caseId === entry.caseId && c.caseRevision === entry.caseRevision && c.ordinal === entry.ordinal);
      if (!caseResult) return false;
      return judgeRequiredDimensions.every((dim) => {
        const matching = results.filter((r) => r.caseResultId === caseResult.id && r.dimension === dim);
        return matching.length === 1;
      });
    });

    const complete = judgeExecutions.length === suite.caseManifest.length
      && nonAmbiguous === suite.caseManifest.length
      && manifestExactExecutions
      && results.length === expectedResultsCount
      && allResults.length === expectedResultsCount
      && manifestExactResults;

    return {
      runId,
      expectedCases: suite.caseManifest.length,
      expectedDimensions: judgeRequiredDimensions.length,
      completedExecutions: terminal,
      nonAmbiguousExecutions: nonAmbiguous,
      judgeResults: results.length,
      complete,
    };
  }

  assertCanBeginScoring(runId: string): void {
    const run = this.runs.getById(runId);
    if (!run || run.status !== "RUNNING") {
      throw new AIEvalError("AI_EVAL_RUN_NOT_SCORABLE", "Only a RUNNING Eval Run can begin scoring.");
    }
    const suite = new SQLiteAIEvalSuiteRepository(this.dependencies.database).getRevision(run.suiteId, run.suiteRevision);
    if (!suite) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The pinned Eval Suite revision is unavailable.");

    // 1. Target coverage check
    const targetCoverage = this.getCoverage(runId);
    if (!targetCoverage.complete) {
      throw new AIEvalError("AI_EVAL_RUN_NOT_SCORABLE", "Target execution is not complete for this Eval Run.");
    }

    // 2. Judge coverage check
    const judgeCoverage = this.getJudgeCoverage(runId);
    if (!judgeCoverage.complete) {
      throw new AIEvalError("AI_EVAL_RUN_NOT_SCORABLE", "Supplementary judge evaluation is not complete for this Eval Run.");
    }

    // 3. Judge Config currentness check
    if (suite.supplementaryJudgeConfig) {
      const judgeConfig = this.judgeConfigs.getRevisionByKey(
        suite.supplementaryJudgeConfig.referenceKey,
        suite.supplementaryJudgeConfig.revision,
      );
      if (!judgeConfig || !judgeConfig.enabled) {
        throw new AIEvalError("AI_EVAL_RUN_NOT_SCORABLE", "The pinned supplementary Judge Config is disabled or unavailable.");
      }
    }
  }

  finalizeAndScoreRun(runId: string, now = this.clock()): ReturnType<AIEvalRunService["completeRun"]> {
    this.assertCanBeginScoring(runId);
    this.evalRuns.beginScoring(runId, now);
    return this.evalRuns.completeRun(runId, now);
  }
}

export { AIEvalTargetOrchestrator as AIEvalExecutionOrchestrator };

/** Exact payload boundary for the M9B1 durable target Job. */
export function createAIEvalTargetExecutionJobHandler(executor: Pick<AIEvalTargetExecutionService, "execute">): AIJobHandlerDefinition {
  return {
    kind: AI_EVAL_TARGET_JOB_KIND,
    payloadVersion: AI_EVAL_TARGET_JOB_PAYLOAD_VERSION,
    validatePayload(value: unknown): Record<string, unknown> {
      if (!isRecord(value) || Object.keys(value).sort().join("\u0000") !== "caseId\u0000caseRevision\u0000executionConfigId\u0000executionConfigRevision\u0000runId") throw new AIJobExecutionError("AI_JOB_PAYLOAD_INVALID", false);
      if (!["runId", "caseId", "executionConfigId"].every((key) => typeof value[key] === "string" && UUID.test(value[key] as string)) || !Number.isSafeInteger(value.caseRevision) || (value.caseRevision as number) < 1 || !Number.isSafeInteger(value.executionConfigRevision) || (value.executionConfigRevision as number) < 1) throw new AIJobExecutionError("AI_JOB_PAYLOAD_INVALID", false);
      return { runId: value.runId, caseId: value.caseId, caseRevision: value.caseRevision, executionConfigId: value.executionConfigId, executionConfigRevision: value.executionConfigRevision };
    },
    async execute(payload: Record<string, unknown>, context: AIJobExecutionContext): Promise<void> {
      context.checkLease();
      if (context.signal.aborted) throw new AIJobExecutionError("AI_JOB_CANCELLED", false);
      try {
        const result = await executor.execute({ runId: payload.runId as string, caseId: payload.caseId as string, executionConfigId: payload.executionConfigId as string, executionConfigRevision: payload.executionConfigRevision as number, caseRevision: payload.caseRevision as number, signal: context.signal, checkLease: context.checkLease });
        if (result.status === "PENDING") throw new AIJobExecutionError("AI_EVAL_TARGET_ADMISSION_RETRYABLE", true);
      } catch (error) {
        if (error instanceof AIEvalError && (error.code === "AI_EVAL_TARGET_CONCURRENCY_LIMITED" || error.code === "AI_EVAL_TARGET_ADMISSION_RETRYABLE")) throw new AIJobExecutionError(error.code, true);
        throw error;
      }
    },
  };
}

export function registerAIEvalTargetExecutionHandler(registry: AIJobHandlerRegistry, executor: Pick<AIEvalTargetExecutionService, "execute">): void {
  registry.register(createAIEvalTargetExecutionJobHandler(executor));
}

/** Terminal recovery reads Case Execution ownership, never the Job payload. */
export class AIEvalTargetTerminalReconciler {
  private readonly executions: AIEvalCaseExecutionRepository;
  private readonly cleanup: AIEvalTargetCleanupService;

  constructor(
    private readonly dependencies: {
      jobs: Pick<AIJobQueueService, "getJob">;
      executions?: AIEvalCaseExecutionRepository;
      database: ContentDatabase;
      accounting: Pick<import("../economics").AICostAccountingService, "getOperation" | "completeOperation">;
      admission: Pick<AIBudgetAdmissionService, "getReservation" | "releaseBeforeExecution" | "settle">;
      evalRuns?: import("./service").AIEvalRunService;
      cases?: import("./configuration").SQLiteAIEvalCaseRepository;
      cleanup?: AIEvalTargetCleanupService;
      clock?: () => number;
    },
  ) {
    this.executions = dependencies.executions ?? new SQLiteAIEvalCaseExecutionRepository(dependencies.database);
    this.cleanup = dependencies.cleanup ?? new AIEvalTargetCleanupService({ database: dependencies.database, executions: this.executions, clock: dependencies.clock });
  }

  reconcile(job: import("../operations/jobs").AIJob, now: number): void {
    if (job.kind !== AI_EVAL_TARGET_JOB_KIND || job.payloadVersion !== AI_EVAL_TARGET_JOB_PAYLOAD_VERSION || job.costOperationId !== null || !["DEAD_LETTER", "CANCELLED"].includes(job.status)) return;
    const execution = this.executions.getByJob(job.id);
    if (!execution || ["COMPLETED", "BLOCKED", "FAILED", "CANCELLED", "AMBIGUOUS"].includes(execution.status)) return;
    const mayHaveInvoked = execution.providerInvoked || execution.providerInvocationState !== "NOT_INVOKED";
    const operationalAdmissionRetry = execution.safeFailureCode === "EVAL_ADMISSION_RETRYABLE";
    this.reconcileFinancials(execution, now);
    const updated = mayHaveInvoked
      ? this.executions.ambiguous({ id: execution.id, safeFailureCode: "EVAL_TARGET_PROVIDER_AMBIGUOUS", now })
      : job.status === "CANCELLED"
        ? this.executions.cancel({ id: execution.id, providerInvoked: false, safeFailureCode: "EVAL_TARGET_JOB_CANCELLED", now })
        : this.executions.fail({ id: execution.id, providerInvoked: false, safeFailureCode: "EVAL_TARGET_JOB_DEAD_LETTER", now });
    if (!operationalAdmissionRetry) this.recordRecoveryObservation(updated, now);
    this.cleanup.cleanupForExecution(updated.id, now);
  }

  reconcilePending(input: { limit: number; now: number }): { scanned: number; reconciled: number; skipped: number } {
    const cleanupResult = this.cleanup.reconcilePending(input);
    const pending = this.executions.listPendingTerminalReconciliation(input.limit);
    let reconciled = 0;
    let skipped = 0;
    for (const execution of pending) {
      if (!execution.jobId) { skipped += 1; continue; }
      const job = this.dependencies.jobs.getJob(execution.jobId);
      if (!job || (job.status !== "DEAD_LETTER" && job.status !== "CANCELLED")) { skipped += 1; continue; }
      try { this.reconcile(job, input.now); reconciled += 1; } catch { skipped += 1; }
    }
    return { scanned: cleanupResult.scanned + pending.length, reconciled: cleanupResult.reconciled + reconciled, skipped: cleanupResult.skipped + skipped };
  }

  private reconcileFinancials(execution: AIEvalCaseExecution, now: number): void {
    if (execution.targetCostOperationId) {
      const operation = this.dependencies.accounting.getOperation(execution.targetCostOperationId);
      if (operation?.status === "OPEN") this.dependencies.accounting.completeOperation(operation.id, "OPEN", "FAILED", now);
    }
    if (execution.budgetReservationId) {
      const reservation = this.dependencies.admission.getReservation(execution.budgetReservationId);
      if (reservation?.status === "RESERVED") this.dependencies.admission.releaseBeforeExecution(reservation.id, now);
      else if (reservation && (reservation.status === "EXECUTING" || reservation.status === "RECONCILIATION_REQUIRED")) this.dependencies.admission.settle(reservation.id, now);
    }
  }

  private recordRecoveryObservation(execution: AIEvalCaseExecution, now: number): void {
    if (!this.dependencies.evalRuns) return;
    const elapsedLatencyMs = execution.startedAt !== null && now >= execution.startedAt && now - execution.startedAt <= 8_640_000_000_000 ? now - execution.startedAt : null;
    try {
      this.dependencies.evalRuns.recordObservationAndGrade({ runId: execution.runId, caseId: execution.caseId, caseRevision: execution.caseRevision, observedSubjectKey: execution.subjectKey, observedStatus: execution.status === "CANCELLED" ? "CANCELLED" : execution.status === "BLOCKED" ? "BLOCKED" : "FAILED", finishReason: execution.status === "CANCELLED" ? "CANCELLED" : "FAILED", outputText: "", citationMap: [], evidence: [], retrievalStatus: "NOT_APPLICABLE", outputBytes: 0, elapsedLatencyMs, costOperationId: execution.targetCostOperationId, groundingProtocolKey: "evidence-grounded-v1", groundingProtocolRevision: 1, citationProtocolKey: "evidence-ref-v1", citationProtocolRevision: 1 }, now);
    } catch { /* duplicate/terminal Run state is a safe idempotent no-op */ }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
