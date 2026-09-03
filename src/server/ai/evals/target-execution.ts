import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import { AIJobError } from "../operations/jobs";
import {
  AIBudgetAdmissionService,
  AIAdmissionError,
  AI_EVALS_ADMISSION_PRINCIPAL_REF,
  createAIAdmissionRequestFingerprint,
  type AIAdmissionCostEstimate,
} from "../admission";
import { AIConversationService, type AIStudentPrincipal } from "../conversations";
import {
  AICostAccountingService,
  AIGenerationUsageAccumulator,
  type AICostOperation,
} from "../economics";
import {
  isAIProviderGatewayError,
  type AIProviderGateway,
  type AIProviderAttemptTrace,
  type NormalizedProviderUsage,
} from "../gateway";
import type { AIModelConfigRepository } from "../model-registry";
import { SQLiteAIModelConfigRepository } from "../model-registry";
import type { AIProviderConfigRepository } from "../configuration";
import { SQLiteAIProviderConfigRepository } from "../configuration";
import type { AIRetrievalConfigRepository } from "../retrieval-config";
import { SQLiteAIRetrievalConfigRepository } from "../retrieval-config";
import type { AITutorConfigRepository } from "../tutor/configuration";
import { SQLiteAITutorConfigRepository } from "../tutor/configuration";
import { AITutorGenerationPlanner } from "../tutor/planner";
import type { AITutorPreflightPlan } from "../tutor/preflight/contracts";
import { AITutorPreflightService } from "../tutor/preflight";
import { AITutorOutputValidator } from "../tutor/validation";
import { AI_TUTOR_CITATION_PROTOCOL_KEY, AI_TUTOR_CITATION_PROTOCOL_REVISION, AI_TUTOR_GROUNDING_PROTOCOL_KEY, AI_TUTOR_GROUNDING_PROTOCOL_REVISION } from "../tutor/configuration";
import type { AIContextTokenEstimator } from "../context";
import { SQLiteAIInstructionPolicyRepository, SQLiteAIContextPolicyRepository } from "../policy";
import { SQLiteAIEvalCaseRepository, SQLiteAIEvalSuiteRepository } from "./configuration";
import type {
  AIEvalCaseRevision,
  AIEvalCaseExecution,
  AIEvalExecutionConfigRevision,
  AIEvalRun,
  AIEvalSuiteRevision,
  AIEvalCandidateSnapshot,
  AIEvalCaseExecutionRepository,
} from "./contracts";
import { AI_EVAL_CLEANUP_PROTOCOL_KEY, AI_EVAL_CLEANUP_PROTOCOL_REVISION, AI_EVAL_TARGET_PROTOCOL_KEY, AI_EVAL_TARGET_PROTOCOL_REVISION } from "./contracts";
import { AIEvalError } from "./errors";
import { SQLiteAIEvalCaseExecutionRepository } from "./case-executions";
import { SQLiteAIEvalExecutionConfigRepository, fingerprintAIEvalExecutionConfig } from "./execution-config";
import { SQLiteAIEvalRunRepository } from "./runs";
import { AIEvalRunService } from "./service";
import type { HybridRetrievalService, AIEvidencePack } from "../retrieval";
import type { AIEmbeddingProjectionRepository } from "../embedding";
import { SQLiteAIEmbeddingProjectionRepository } from "../embedding";
import { AIEvalTargetCleanupService, syntheticPrincipal as deriveSyntheticPrincipal } from "./target-cleanup";

const MAX_TIMESTAMP = 8_640_000_000_000_000;
const MAX_OUTPUT_BYTES = 524_288;

export interface AIEvalTargetBudgetPeriodResolver {
  resolve(input: { principalRef: string; budgetPolicyId: string; budgetPolicyRevision: number; at: number }): { startAt: number; endAt: number } | Promise<{ startAt: number; endAt: number }>;
}

export interface AIEvalTargetExecutionDependencies {
  database: ContentDatabase;
  runs?: SQLiteAIEvalRunRepository;
  suites?: SQLiteAIEvalSuiteRepository;
  cases?: SQLiteAIEvalCaseRepository;
  executions?: AIEvalCaseExecutionRepository;
  executionConfigs?: SQLiteAIEvalExecutionConfigRepository;
  evalRuns?: AIEvalRunService;
  conversations?: AIConversationService;
  preflight: Pick<AITutorPreflightService, "preflight">;
  planner: Pick<AITutorGenerationPlanner, "plan">;
  retrieval: Pick<HybridRetrievalService, "retrieve" | "assertEvidencePackCurrent">;
  gateway: Pick<AIProviderGateway, "generate">;
  accounting: AICostAccountingService;
  admission: AIBudgetAdmissionService;
  estimator: AIContextTokenEstimator;
  tutorConfigs?: AITutorConfigRepository;
  retrievalConfigs?: AIRetrievalConfigRepository;
  models?: AIModelConfigRepository;
  providers?: AIProviderConfigRepository;
  embeddingProjections?: AIEmbeddingProjectionRepository;
  cleanup?: AIEvalTargetCleanupService;
  budgetPeriodResolver: AIEvalTargetBudgetPeriodResolver;
  clock?: () => number;
}

export interface AIEvalTargetExecutionResult {
  runId: string;
  caseId: string;
  caseRevision: number;
  executionId: string;
  status: AIEvalCaseExecution["status"];
  providerInvoked: boolean;
  costOperationId: string;
  budgetReservationId: string | null;
  settlementStatus: "SETTLED" | "RECONCILIATION_REQUIRED" | "RELEASED" | null;
}

/** M9B1 executes one exact Eval target through the existing M8/M7 boundaries. */
export class AIEvalTargetExecutionService {
  private readonly runs: SQLiteAIEvalRunRepository;
  private readonly suites: SQLiteAIEvalSuiteRepository;
  private readonly cases: SQLiteAIEvalCaseRepository;
  private readonly executions: AIEvalCaseExecutionRepository;
  private readonly executionConfigs: SQLiteAIEvalExecutionConfigRepository;
  private readonly evalRuns: AIEvalRunService;
  private readonly conversations: AIConversationService;
  private readonly tutorConfigs: AITutorConfigRepository;
  private readonly retrievalConfigs: AIRetrievalConfigRepository;
  private readonly models: AIModelConfigRepository;
  private readonly providers: AIProviderConfigRepository;
  private readonly embeddingProjections: AIEmbeddingProjectionRepository;
  private readonly cleanup: AIEvalTargetCleanupService;
  private readonly outputValidator = new AITutorOutputValidator();
  private readonly clock: () => number;

  constructor(private readonly dependencies: AIEvalTargetExecutionDependencies) {
    this.runs = dependencies.runs ?? new SQLiteAIEvalRunRepository(dependencies.database);
    this.suites = dependencies.suites ?? new SQLiteAIEvalSuiteRepository(dependencies.database);
    this.cases = dependencies.cases ?? new SQLiteAIEvalCaseRepository(dependencies.database);
    this.executions = dependencies.executions ?? new SQLiteAIEvalCaseExecutionRepository(dependencies.database);
    this.executionConfigs = dependencies.executionConfigs ?? new SQLiteAIEvalExecutionConfigRepository(dependencies.database);
    this.evalRuns = dependencies.evalRuns ?? new AIEvalRunService(dependencies.database);
    this.clock = dependencies.clock ?? Date.now;
    this.conversations = dependencies.conversations ?? new AIConversationService(dependencies.database, { clock: this.clock });
    this.tutorConfigs = dependencies.tutorConfigs ?? new SQLiteAITutorConfigRepository(dependencies.database);
    this.retrievalConfigs = dependencies.retrievalConfigs ?? new SQLiteAIRetrievalConfigRepository(dependencies.database);
    this.models = dependencies.models ?? new SQLiteAIModelConfigRepository(dependencies.database);
    this.providers = dependencies.providers ?? new SQLiteAIProviderConfigRepository(dependencies.database);
    this.embeddingProjections = dependencies.embeddingProjections ?? new SQLiteAIEmbeddingProjectionRepository(dependencies.database);
    this.cleanup = dependencies.cleanup ?? new AIEvalTargetCleanupService({ database: dependencies.database, executions: this.executions, conversations: this.conversations, clock: this.clock });
  }

  async execute(input: { runId: string; caseId: string; caseRevision: number; executionConfigId?: string; executionConfigRevision?: number; signal?: AbortSignal; checkLease?: () => void }): Promise<AIEvalTargetExecutionResult> {
    const now = this.safeNow();
    const target = this.validateTarget(input);
    if ((input.executionConfigId !== undefined && input.executionConfigId !== target.binding.executionConfigId) || (input.executionConfigRevision !== undefined && input.executionConfigRevision !== target.binding.executionConfigRevision)) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target Job does not match the Run Execution Config binding.");
    let execution = target.execution;
    if (execution.status === "COMPLETED" || execution.status === "BLOCKED" || execution.status === "FAILED" || execution.status === "CANCELLED" || execution.status === "AMBIGUOUS") {
      this.cleanup.cleanupForExecution(execution.id, this.safeNow());
      return this.result(execution, null);
    }
    if (execution.status === "RUNNING" && (execution.providerInvocationState !== "NOT_INVOKED" || (execution.targetCostOperationId !== null && this.dependencies.accounting.listUsageCostRecords(execution.targetCostOperationId).length > 0))) {
      const result = await this.finishAmbiguous(target, execution, input.checkLease);
      this.cleanup.cleanupForExecution(execution.id, this.safeNow());
      return result;
    }
    const config = this.requireExecutionConfig(target.binding);
    const admissionRetry = execution.status === "PENDING" && execution.safeFailureCode === "EVAL_ADMISSION_RETRYABLE";
    if (execution.status === "PENDING" && !admissionRetry && !this.cleanup.cleanupForExecution(execution.id, this.safeNow())) throw new AIEvalError("AI_EVAL_TARGET_ADMISSION_RETRYABLE", "The previous synthetic Eval Conversation cleanup is still pending.");
    execution = execution.status === "PENDING" ? this.executions.markRunning(execution.id, now, config.maxConcurrency, admissionRetry) : execution;
    let operation: AICostOperation | null = null;
    let reservationId: string | null = execution.budgetReservationId;
    let providerInvoked = execution.providerInvoked;
    let syntheticPrincipal: AIStudentPrincipal | null = null;
    let syntheticConversationId: string | null = null;
    let syntheticTurnIdempotencyKey: string | null = null;
    const previousCleanup = this.cleanup.getByCaseExecutionId(execution.id);
    if (previousCleanup?.status === "PENDING") {
      syntheticPrincipal = deriveSyntheticPrincipal(execution.id);
      syntheticConversationId = previousCleanup.syntheticConversationId;
      syntheticTurnIdempotencyKey = syntheticTurnKey(execution.id, previousCleanup.id);
    }
    try {
      operation = execution.targetCostOperationId ? this.dependencies.accounting.getOperation(execution.targetCostOperationId) : null;
      if (!operation) {
        operation = this.dependencies.accounting.createOperation({
          costCenter: "EVALS",
          idempotencyKey: null,
          opaquePrincipalRef: null,
          subjectKey: target.suite.subjectKey,
          conversationId: null,
          responseId: null,
          jobId: null,
          evalRunId: target.run.id,
          knowledgeRevision: null,
          status: "OPEN",
          startedAt: now,
          completedAt: null,
        });
        execution = this.executions.bindOperation(execution.id, operation.id, this.safeNow());
      } else if (operation.evalRunId !== target.run.id || operation.costCenter !== "EVALS" || operation.opaquePrincipalRef !== null || operation.subjectKey !== target.suite.subjectKey || operation.conversationId !== null || operation.responseId !== null || operation.jobId !== null || operation.idempotencyKey !== null) {
        throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target Cost Operation ownership is invalid.");
      }
      if (input.signal?.aborted) return await this.finishWithoutProvider(target, execution, "CANCELLED", "EVAL_TARGET_CANCELLED", operation, null, false, input.checkLease);
      input.checkLease?.();
      this.assertCandidateCurrent(target.run, target.suite.subjectKey);
      this.assertCandidateEmbeddingCurrent(target.run, target.suite.subjectKey);
      syntheticPrincipal ??= deriveSyntheticPrincipal(execution.id);
      if (!syntheticConversationId) {
        const conversation = this.dependencies.database.client.transaction(() => {
          const created = this.conversations.createConversationInTransaction(syntheticPrincipal!, { conversationId: uuidv7(), subjectKey: target.suite.subjectKey, createdAt: this.safeNow() });
          const binding = this.cleanup.bindInTransaction({ caseExecutionId: execution.id, syntheticConversationId: created.id, createdAt: created.createdAt });
          syntheticTurnIdempotencyKey = syntheticTurnKey(execution.id, binding.id);
          return created;
        }).immediate();
        syntheticConversationId = conversation.id;
      }
      const turn = this.conversations.beginTurn(syntheticPrincipal, { conversationId: syntheticConversationId!, idempotencyKey: syntheticTurnIdempotencyKey!, userContent: target.caseRevision.inputText });
      const preflight = this.dependencies.preflight.preflight({ principal: syntheticPrincipal, responseId: turn.response.id, tutorConfigId: target.run.candidateSnapshot.tutorConfig.id, estimator: this.dependencies.estimator });
      this.assertPreflightCandidate(target.run, preflight);
      const admission = await this.admit(target, config, operation, preflight, input.signal);
      reservationId = admission.reservation.id;
      execution = this.executions.bindAdmission(execution.id, { targetCostOperationId: operation.id, budgetReservationId: reservationId }, this.safeNow());
      this.dependencies.admission.startExecution(reservationId, this.safeNow());
      if (input.signal?.aborted) return await this.finishWithoutProvider(target, execution, "CANCELLED", "EVAL_TARGET_CANCELLED", operation, reservationId, false, input.checkLease);
      execution = this.executions.markInvoking(execution.id, this.safeNow());
      input.checkLease?.();
      const pack = await this.dependencies.retrieval.retrieve({ requestId: turn.response.id, subjectKey: target.suite.subjectKey, query: target.caseRevision.inputText, retrievalConfigId: preflight.retrievalConfigId, retrievalConfigRevision: preflight.retrievalConfigRevision, providerExecutionContext: { costOperationId: operation.id, budgetReservationId: reservationId, executionScope: "EVAL_TARGET", signal: input.signal, timeoutMs: config.targetTimeoutMs } });
      providerInvoked = providerInvoked || this.dependencies.accounting.listUsageCostRecords(operation.id).length > 0;
      if (providerInvoked && !execution.providerInvoked) execution = this.executions.markInvokedWithAccounting(execution.id, this.safeNow());
      else if (execution.providerInvocationState === "INVOKING") execution = this.executions.markNotInvoked(execution.id, this.safeNow());
      if (input.signal?.aborted) return await this.finishObserved(target, execution, operation, reservationId, "CANCELLED", "EVAL_TARGET_CANCELLED", pack, "", [], "CANCELLED", providerInvoked, null);
      if (pack.status !== "SUFFICIENT" || !pack.sufficient) {
        return await this.finishObserved(target, execution, operation, reservationId, "BLOCKED", "EVAL_RETRIEVAL_INSUFFICIENT", pack, "", [], "OTHER", providerInvoked, null);
      }
      this.assertCandidateRetrieval(target.run.candidateSnapshot, pack);
      const generationPlan = this.dependencies.planner.plan(preflight, pack);
      this.assertCandidatePreProvider(target.run, preflight, pack, generationPlan);
      execution = this.executions.markInvoking(execution.id, this.safeNow());
      const controller = new AbortController();
      const abort = () => controller.abort();
      input.signal?.addEventListener("abort", abort, { once: true });
      let output = "";
      let finishReason: "STOP" | "LENGTH" | "CONTENT_FILTER" | "OTHER" | null = null;
      const usage = new AIGenerationUsageAccumulator();
      let stream: ReturnType<AIProviderGateway["generate"]> | null = null;
      let gatewayError: unknown = null;
      try {
        stream = this.dependencies.gateway.generate(generationPlan.modelSelectionPlan, generationPlan.request, { signal: controller.signal, timeoutMs: config.targetTimeoutMs, expectedIdentity: { modelConfigId: generationPlan.generationModelConfigId, modelConfigRevision: generationPlan.generationModelConfigRevision, providerConfigId: generationPlan.generationProviderConfigId, providerConfigRevision: generationPlan.generationProviderConfigRevision, providerModelId: generationPlan.providerModelId, adapterKey: generationPlan.adapterKey } });
        for await (const event of stream.events) {
          if (event.type === "TEXT_DELTA") {
            const next = output + event.text;
            if (Buffer.byteLength(next, "utf8") > MAX_OUTPUT_BYTES) { controller.abort(); throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target output exceeded its bounded limit."); }
            output = next;
          } else if (event.type === "USAGE" || event.type === "COMPLETED") {
            usage.observe(event.usage);
            if (event.type === "COMPLETED") finishReason = event.finishReason;
          }
        }
      } catch (error) { gatewayError = error; }
      finally { input.signal?.removeEventListener("abort", abort); }
      const attempts = stream ? await stream.trace : [];
      const invoked = attempts.filter((attempt) => attempt.providerInvoked);
      providerInvoked = invoked.length > 0;
      if (providerInvoked) {
        this.recordAttempts(operation.id, invoked, usage.snapshot());
        input.checkLease?.();
        execution = this.executions.markInvokedWithAccounting(execution.id, this.safeNow());
      }
      if (input.signal?.aborted || (isAIProviderGatewayError(gatewayError) && gatewayError.code === "CANCELLED")) {
        return await this.finishObserved(target, execution, operation, reservationId, "CANCELLED", "EVAL_TARGET_CANCELLED", pack, output, generationPlan.citationMap, "CANCELLED", providerInvoked, generationPlan.planFingerprint);
      }
      if (gatewayError || !finishReason || !providerInvoked) {
        const reason = isAIProviderGatewayError(gatewayError) ? `EVAL_PROVIDER_${gatewayError.code}` : "EVAL_TARGET_FAILED";
        return await this.finishObserved(target, execution, operation, reservationId, "FAILED", reason, pack, output, generationPlan.citationMap, "FAILED", providerInvoked, generationPlan.planFingerprint);
      }
      const validation = this.outputValidator.validate({ outputText: output, citationMap: generationPlan.citationMap, finishReason, groundingProtocolKey: generationPlan.groundingProtocolKey, groundingProtocolRevision: generationPlan.groundingProtocolRevision, citationProtocolKey: generationPlan.citationProtocolKey, citationProtocolRevision: generationPlan.citationProtocolRevision });
      if (validation.status !== "VALID") return await this.finishObserved(target, execution, operation, reservationId, "FAILED", "EVAL_OUTPUT_INVALID", pack, output, generationPlan.citationMap, "FAILED", providerInvoked, generationPlan.planFingerprint);
      this.dependencies.retrieval.assertEvidencePackCurrent(pack);
      this.assertCandidateCurrent(target.run, target.suite.subjectKey);
      return await this.finishObserved(target, execution, operation, reservationId, "COMPLETED", null, pack, output, generationPlan.citationMap, finishReason, providerInvoked, generationPlan.planFingerprint);
    } catch (error) {
      if (error instanceof AIJobError && error.code === "AI_JOB_LEASE_LOST") throw error;
      const safe = error instanceof AIEvalError ? error : new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target could not be completed safely.", {}, error);
      if (!operation) throw safe;
      const current = this.executions.getById(execution.id) ?? execution;
      const invoked = providerInvoked || current.providerInvoked || current.providerInvocationState === "INVOKING" || current.providerInvocationState === "INVOKED_WITH_ACCOUNTING" || this.dependencies.accounting.listUsageCostRecords(operation.id).length > 0;
      if (error instanceof AIAdmissionError && !invoked) {
        if (error.code === "AI_RATE_LIMITED" || error.code === "AI_ADMISSION_CONCURRENCY_LIMITED") {
          return await this.finishAdmissionRetry(current, reservationId, input.checkLease);
        }
        return await this.finishAdmissionFailure(current, operation, reservationId, `EVAL_ADMISSION_${error.code}`, input.checkLease);
      }
      if (invoked && !current.providerInvoked && current.providerInvocationState === "NOT_INVOKED") this.executions.markInvokedWithAccounting(current.id, this.safeNow());
      return await this.finishWithoutProvider(target, current, input.signal?.aborted ? "CANCELLED" : "FAILED", safe.code === "AI_EVAL_TARGET_STALE" ? "EVAL_CANDIDATE_STALE" : "EVAL_TARGET_FAILED", operation, reservationId, invoked, input.checkLease);
    } finally {
      const current = this.executions.getById(execution.id);
      if (!(current?.status === "PENDING" && current.safeFailureCode === "EVAL_ADMISSION_RETRYABLE") && syntheticPrincipal && syntheticConversationId) this.cleanup.cleanupForExecution(execution.id, this.safeNow());
    }
  }

  executeCase(input: { runId: string; caseId: string; caseRevision: number; signal?: AbortSignal }): Promise<AIEvalTargetExecutionResult> { return this.execute(input); }

  reconcilePendingCleanup(input: { limit: number; now: number }): { scanned: number; reconciled: number; skipped: number } {
    return this.cleanup.reconcilePending(input);
  }

  private validateTarget(input: { runId: string; caseId: string; caseRevision: number }): { run: AIEvalRun; suite: AIEvalSuiteRevision; caseRevision: AIEvalCaseRevision; execution: AIEvalCaseExecution; binding: ReturnType<SQLiteAIEvalRunRepository["getExecutionBinding"]> & object } {
    const run = this.runs.getById(input.runId);
    if (!run || run.status !== "RUNNING") throw new AIEvalError("AI_EVAL_TARGET_NOT_READY", "The Eval Run is not running.");
    const suite = this.suites.getRevision(run.suiteId, run.suiteRevision);
    const caseRevision = this.cases.getRevision(input.caseId, input.caseRevision);
    const entry = suite?.caseManifest.find((item) => item.caseId === input.caseId && item.caseRevision === input.caseRevision);
    const execution = this.executions.getForTarget(input);
    const binding = this.runs.getExecutionBinding(run.id);
    if (!suite || !suite.enabled || !caseRevision || !caseRevision.enabled || !entry || !execution || !binding || caseRevision.subjectKey !== suite.subjectKey || execution.ordinal !== entry.ordinal || execution.subjectKey !== suite.subjectKey || execution.candidateFingerprint !== run.candidateFingerprint) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target ownership or manifest pin is invalid.");
    return { run, suite, caseRevision, execution, binding };
  }

  private requireExecutionConfig(binding: NonNullable<ReturnType<SQLiteAIEvalRunRepository["getExecutionBinding"]>>): AIEvalExecutionConfigRevision {
    const config = this.executionConfigs.getRevision(binding.executionConfigId, binding.executionConfigRevision);
    if (!config || !config.enabled || fingerprintAIEvalExecutionConfig(config) !== binding.executionConfigFingerprint || config.protocolKey !== AI_EVAL_TARGET_PROTOCOL_KEY || config.protocolRevision !== AI_EVAL_TARGET_PROTOCOL_REVISION || config.cleanupProtocolKey !== AI_EVAL_CLEANUP_PROTOCOL_KEY || config.cleanupProtocolRevision !== AI_EVAL_CLEANUP_PROTOCOL_REVISION) throw new AIEvalError("AI_EVAL_TARGET_STALE", "The pinned Eval Execution Config is unavailable.");
    return config;
  }

  private async admit(target: ReturnType<AIEvalTargetExecutionService["validateTarget"]>, config: AIEvalExecutionConfigRevision, operation: AICostOperation, preflight: AITutorPreflightPlan, signal?: AbortSignal) {
    if (signal?.aborted) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target was cancelled before admission.");
    const period = await this.dependencies.budgetPeriodResolver.resolve({ principalRef: AI_EVALS_ADMISSION_PRINCIPAL_REF, budgetPolicyId: config.budgetPolicyId, budgetPolicyRevision: config.budgetPolicyRevision, at: this.safeNow() });
    const estimate: AIAdmissionCostEstimate = { currency: preflight.costEstimate.currency, maxCostNano: preflight.costEstimate.maxCostNano, estimateBasis: `eval-target:${preflight.costEstimate.estimateBasis}`, modelConfigId: preflight.costEstimate.generation.modelConfigId, modelConfigRevision: preflight.costEstimate.generation.modelConfigRevision, rateCardId: preflight.costEstimate.generation.rateCardId, rateCardRevision: preflight.costEstimate.generation.rateCardRevision };
    const base = { principalRef: AI_EVALS_ADMISSION_PRINCIPAL_REF, budgetPolicyId: config.budgetPolicyId, budgetPolicyRevision: config.budgetPolicyRevision, rateLimitPolicyId: config.rateLimitPolicyId, rateLimitPolicyRevision: config.rateLimitPolicyRevision, budgetPeriod: period, costOperationId: operation.id, costEstimate: estimate, idempotencyKey: target.execution.idempotencyKey };
    const admission = this.dependencies.admission.admit({ ...base, requestFingerprint: createAIAdmissionRequestFingerprint(base) });
    return admission;
  }

  private assertCandidateCurrent(run: AIEvalRun, subjectKey: string): void {
    const candidate = run.candidateSnapshot;
    const tutor = this.tutorConfigs.getById(candidate.tutorConfig.id);
    const retrieval = this.retrievalConfigs.getById(candidate.retrievalConfig.id);
    const retrievalRevision = this.retrievalConfigs.getCurrentRevision(candidate.retrievalConfig.id);
    const model = this.models.getById(candidate.generationModel.id);
    const provider = this.providers.getById(candidate.generationProvider.id);
    const rerankModel = candidate.rerank ? this.models.getById(candidate.rerank.modelConfigId) : null;
    const rerankProvider = candidate.rerank ? this.providers.getById(candidate.rerank.providerConfigId) : null;
    const global = new SQLiteAIInstructionPolicyRepository(this.dependencies.database).getById(candidate.globalPolicy.id);
    const subject = new SQLiteAIInstructionPolicyRepository(this.dependencies.database).getById(candidate.subjectPolicy.id);
    const context = new SQLiteAIContextPolicyRepository(this.dependencies.database).getById(candidate.contextPolicy.id);
    if (!tutor || !retrieval || !retrievalRevision || !model || !provider || !global || !subject || !context || tutor.currentRevision !== candidate.tutorConfig.revision || tutor.subjectKey !== subjectKey || !tutor.enabled || tutor.generationModelConfigId !== candidate.generationModel.id || tutor.retrievalConfigId !== candidate.retrievalConfig.id || tutor.contextPolicyId !== candidate.contextPolicy.id || retrieval.currentRevision !== candidate.retrievalConfig.revision || retrievalRevision.revision !== candidate.retrievalConfig.revision || retrieval.subjectKey !== subjectKey || !retrieval.enabled || model.revision !== candidate.generationModel.revision || model.providerConfigId !== candidate.generationProvider.id || model.capability !== "GENERATION" || !model.enabled || provider.revision !== candidate.generationProvider.revision || !provider.enabled || !provider.credentialRef || !global.enabled || global.currentRevision !== candidate.globalPolicy.revision || !subject.enabled || subject.currentRevision !== candidate.subjectPolicy.revision || !context.enabled || context.currentRevision !== candidate.contextPolicy.revision || (candidate.rerank === null ? retrievalRevision.rerankModelConfigId !== null : retrievalRevision.rerankModelConfigId !== candidate.rerank.modelConfigId || !rerankModel || !rerankProvider || rerankModel.revision !== candidate.rerank.modelConfigRevision || rerankModel.capability !== "RERANK" || !rerankModel.enabled || rerankModel.providerConfigId !== candidate.rerank.providerConfigId || rerankProvider.revision !== candidate.rerank.providerConfigRevision || !rerankProvider.enabled || !rerankProvider.credentialRef)) throw new AIEvalError("AI_EVAL_TARGET_STALE", "The Eval candidate snapshot is no longer current.");
  }

  private assertPreflightCandidate(run: AIEvalRun, plan: AITutorPreflightPlan): void {
    const c = run.candidateSnapshot;
    if (plan.tutorConfigId !== c.tutorConfig.id || plan.tutorConfigRevision !== c.tutorConfig.revision || plan.globalPolicyId !== c.globalPolicy.id || plan.globalPolicyRevision !== c.globalPolicy.revision || plan.subjectPolicyId !== c.subjectPolicy.id || plan.subjectPolicyRevision !== c.subjectPolicy.revision || plan.contextPolicyId !== c.contextPolicy.id || plan.contextPolicyRevision !== c.contextPolicy.revision || plan.retrievalConfigId !== c.retrievalConfig.id || plan.retrievalConfigRevision !== c.retrievalConfig.revision || plan.generationModelConfigId !== c.generationModel.id || plan.generationModelConfigRevision !== c.generationModel.revision || plan.generationProviderConfigId !== c.generationProvider.id || plan.generationProviderConfigRevision !== c.generationProvider.revision) throw new AIEvalError("AI_EVAL_TARGET_STALE", "The Tutor preflight does not match the pinned Eval candidate.");
  }

  private assertCandidateRetrieval(candidate: AIEvalCandidateSnapshot, pack: AIEvidencePack): void {
    const space = candidate.embeddingSpace;
    if (!space && pack.trace.m7bEmbeddingProjectionRevisionIds.length > 0) throw new AIEvalError("AI_EVAL_TARGET_STALE", "The EvidencePack embedding space is not pinned by the Eval candidate.");
    if (space && (!pack.trace.m7bEmbeddingProjectionRevisionIds.includes(space.projectionRevisionId) || pack.trace.embeddingModelConfigId !== space.modelConfigId || pack.trace.embeddingModelConfigRevision !== space.modelConfigRevision)) throw new AIEvalError("AI_EVAL_TARGET_STALE", "The EvidencePack embedding space does not match the Eval candidate.");
    const rerank = candidate.rerank;
    if (!rerank && pack.trace.rerankModelConfigId !== null) throw new AIEvalError("AI_EVAL_TARGET_STALE", "The EvidencePack rerank identity is not pinned by the Eval candidate.");
    if (rerank && (pack.trace.rerankModelConfigId !== rerank.modelConfigId || pack.trace.rerankModelConfigRevision !== rerank.modelConfigRevision || pack.trace.rerankProviderConfigId !== rerank.providerConfigId || pack.trace.rerankProviderConfigRevision !== rerank.providerConfigRevision)) throw new AIEvalError("AI_EVAL_TARGET_STALE", "The EvidencePack rerank identity does not match the Eval candidate.");
  }

  private assertCandidatePreProvider(run: AIEvalRun, preflight: AITutorPreflightPlan, pack: AIEvidencePack, plan: { generationModelConfigId: string; generationModelConfigRevision: number; generationProviderConfigId: string; generationProviderConfigRevision: number; providerModelId: string; adapterKey: string }): void {
    this.assertCandidateCurrent(run, preflight.subjectKey);
    this.assertCandidateRetrieval(run.candidateSnapshot, pack);
    if (plan.generationModelConfigId !== run.candidateSnapshot.generationModel.id || plan.generationModelConfigRevision !== run.candidateSnapshot.generationModel.revision || plan.generationProviderConfigId !== run.candidateSnapshot.generationProvider.id || plan.generationProviderConfigRevision !== run.candidateSnapshot.generationProvider.revision) throw new AIEvalError("AI_EVAL_TARGET_STALE", "The Generation identity does not match the Eval candidate.");
  }

  private assertCandidateEmbeddingCurrent(run: AIEvalRun, subjectKey: string): void {
    const candidate = run.candidateSnapshot;
    const retrievalRevision = this.retrievalConfigs.getCurrentRevision(candidate.retrievalConfig.id);
    const space = candidate.embeddingSpace;
    if (!retrievalRevision || (retrievalRevision.embeddingModelConfigId !== null) !== (space !== null) || (space !== null && retrievalRevision.embeddingModelConfigId !== space.modelConfigId)) {
      throw new AIEvalError("AI_EVAL_TARGET_STALE", "The Eval embedding space no longer matches the pinned Retrieval Config.");
    }
    if (!space) return;
    const revision = this.embeddingProjections.getRevision(space.projectionRevisionId);
    const model = this.models.getById(space.modelConfigId);
    const provider = revision ? this.providers.getById(revision.providerConfigId) : null;
    if (!revision || revision.subjectKey !== subjectKey || revision.modelConfigId !== space.modelConfigId || revision.modelConfigRevision !== space.modelConfigRevision || revision.status !== "READY" || !revision.isCurrent || !model || model.revision !== space.modelConfigRevision || model.capability !== "EMBEDDING" || !model.enabled || model.providerConfigId !== revision.providerConfigId || model.providerModelId !== revision.providerModelId || model.adapterKey !== revision.embeddingAdapterKey || model.embeddingDimensions !== revision.dimensions || !provider || !provider.enabled || provider.revision !== revision.providerConfigRevision) throw new AIEvalError("AI_EVAL_TARGET_STALE", "The Eval embedding projection is no longer pinned to the candidate space.");
  }

  private recordAttempts(operationId: string, attempts: readonly AIProviderAttemptTrace[], usage: NormalizedProviderUsage): void {
    for (const attempt of attempts) this.dependencies.accounting.recordAttempt({ operationId, attempt, normalizedUsage: usage, capability: attempt.capability, providerModelId: attempt.providerModelId ?? "unknown", at: attempt.startedAt, latencyMs: attempt.latencyMs });
  }

  private async finishObserved(target: ReturnType<AIEvalTargetExecutionService["validateTarget"]>, execution: AIEvalCaseExecution, operation: AICostOperation, reservationId: string, status: "COMPLETED" | "BLOCKED" | "FAILED" | "CANCELLED", safeFailureCode: string | null, pack: AIEvidencePack, output: string, citationMap: readonly import("../tutor/preflight/contracts").AITutorCitationMapItem[], finishReason: "STOP" | "LENGTH" | "CONTENT_FILTER" | "OTHER" | "FAILED" | "CANCELLED", providerInvoked: boolean, planFingerprint: string | null): Promise<AIEvalTargetExecutionResult> {
    const completedAt = this.safeNow();
    const elapsedLatencyMs = this.elapsedLatency(execution, completedAt);
    const finalStatus = elapsedLatencyMs === null ? "FAILED" : status;
    const finalFailureCode = elapsedLatencyMs === null ? "EVAL_TARGET_LATENCY_INVALID" : safeFailureCode;
    const finalFinishReason = elapsedLatencyMs === null ? "FAILED" : finishReason;
    this.completeOperation(operation.id, finalStatus === "COMPLETED" || finalStatus === "BLOCKED" ? "COMPLETED" : finalStatus === "CANCELLED" ? "CANCELLED" : "FAILED", completedAt);
    const settlement = this.settle(reservationId, completedAt);
    try {
      this.evalRuns.recordObservationAndGrade({ runId: target.run.id, caseId: target.caseRevision.caseId, caseRevision: target.caseRevision.revision, observedSubjectKey: target.suite.subjectKey, observedStatus: finalStatus === "COMPLETED" ? "COMPLETED" : finalStatus, finishReason: finalFinishReason, outputText: output, citationMap, evidence: pack.items.map((item) => ({ originKind: item.originKind, originId: item.originId, subjectKey: item.subjectKey })), retrievalStatus: pack.status, outputBytes: Buffer.byteLength(output, "utf8"), elapsedLatencyMs, costOperationId: operation.id, groundingProtocolKey: AI_TUTOR_GROUNDING_PROTOCOL_KEY, groundingProtocolRevision: AI_TUTOR_GROUNDING_PROTOCOL_REVISION, citationProtocolKey: AI_TUTOR_CITATION_PROTOCOL_KEY, citationProtocolRevision: AI_TUTOR_CITATION_PROTOCOL_REVISION }, completedAt);
    } catch {
      throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval observation could not be recorded safely.");
    }
    const hash = hashOutput(output);
    const outputByteSize = Buffer.byteLength(output, "utf8");
    const updated = finalStatus === "BLOCKED" ? this.executions.block({ id: execution.id, retrievalStatus: "INSUFFICIENT", safeFailureCode: finalFailureCode ?? "EVAL_TARGET_BLOCKED", now: completedAt }) : finalStatus === "COMPLETED" && planFingerprint && finalFinishReason !== "FAILED" && finalFinishReason !== "CANCELLED" ? this.executions.complete({ id: execution.id, providerInvoked, outputSha256: hash, outputByteSize, finishReason: finalFinishReason, retrievalStatus: pack.status === "SUFFICIENT" ? "SUFFICIENT" : "NOT_APPLICABLE", planFingerprint, now: completedAt }) : finalStatus === "CANCELLED" ? this.executions.cancel({ id: execution.id, providerInvoked, safeFailureCode: finalFailureCode ?? "EVAL_TARGET_CANCELLED", now: completedAt }) : this.executions.fail({ id: execution.id, providerInvoked, outputSha256: output ? hash : null, outputByteSize: output ? outputByteSize : null, finishReason: finalFinishReason === "FAILED" || finalFinishReason === "CANCELLED" ? finalFinishReason : "FAILED", retrievalStatus: pack.status, safeFailureCode: finalFailureCode ?? "EVAL_TARGET_FAILED", now: completedAt });
    return this.result(updated, settlement);
  }

  private async finishAmbiguous(target: ReturnType<AIEvalTargetExecutionService["validateTarget"]>, execution: AIEvalCaseExecution, checkLease?: () => void): Promise<AIEvalTargetExecutionResult> {
    checkLease?.();
    const completedAt = this.safeNow();
    const elapsedLatencyMs = this.elapsedLatency(execution, completedAt);
    const operation = execution.targetCostOperationId ? this.dependencies.accounting.getOperation(execution.targetCostOperationId) : null;
    if (!operation) throw new AIEvalError("AI_EVAL_TARGET_AMBIGUOUS", "The Eval target Provider ownership is ambiguous.");
    this.completeOperation(operation.id, "FAILED", completedAt);
    const settlement = this.settle(execution.budgetReservationId, completedAt);
    const updated = this.executions.ambiguous({ id: execution.id, safeFailureCode: "EVAL_TARGET_PROVIDER_AMBIGUOUS", now: completedAt });
    try {
      this.evalRuns.recordObservationAndGrade({ runId: target.run.id, caseId: target.caseRevision.caseId, caseRevision: target.caseRevision.revision, observedSubjectKey: target.suite.subjectKey, observedStatus: "FAILED", finishReason: "FAILED", outputText: "", citationMap: [], evidence: [], retrievalStatus: "NOT_APPLICABLE", outputBytes: 0, elapsedLatencyMs, costOperationId: operation.id, groundingProtocolKey: AI_TUTOR_GROUNDING_PROTOCOL_KEY, groundingProtocolRevision: AI_TUTOR_GROUNDING_PROTOCOL_REVISION, citationProtocolKey: AI_TUTOR_CITATION_PROTOCOL_KEY, citationProtocolRevision: AI_TUTOR_CITATION_PROTOCOL_REVISION }, completedAt);
    } catch { /* an already recorded observation is idempotent */ }
    return this.result(updated, settlement);
  }

  private async finishWithoutProvider(target: ReturnType<AIEvalTargetExecutionService["validateTarget"]>, execution: AIEvalCaseExecution, status: "CANCELLED" | "FAILED", safeFailureCode: string, operation: AICostOperation | null, reservationId: string | null, providerInvoked = false, checkLease?: () => void): Promise<AIEvalTargetExecutionResult> {
    checkLease?.();
    const completedAt = this.safeNow();
    const elapsedLatencyMs = this.elapsedLatency(execution, completedAt);
    if (operation) this.completeOperation(operation.id, status === "CANCELLED" ? "CANCELLED" : "FAILED", completedAt);
    const settlement = reservationId ? this.settle(reservationId, completedAt) : null;
    try {
      this.evalRuns.recordObservationAndGrade({ runId: target.run.id, caseId: target.caseRevision.caseId, caseRevision: target.caseRevision.revision, observedSubjectKey: target.suite.subjectKey, observedStatus: status, finishReason: status === "CANCELLED" ? "CANCELLED" : "FAILED", outputText: "", citationMap: [], evidence: [], retrievalStatus: "NOT_APPLICABLE", outputBytes: 0, elapsedLatencyMs, costOperationId: operation?.id ?? null, groundingProtocolKey: AI_TUTOR_GROUNDING_PROTOCOL_KEY, groundingProtocolRevision: AI_TUTOR_GROUNDING_PROTOCOL_REVISION, citationProtocolKey: AI_TUTOR_CITATION_PROTOCOL_KEY, citationProtocolRevision: AI_TUTOR_CITATION_PROTOCOL_REVISION }, completedAt);
    } catch { /* safe terminal execution state is retained */ }
    const updated = status === "CANCELLED" ? this.executions.cancel({ id: execution.id, providerInvoked, safeFailureCode, now: completedAt }) : this.executions.fail({ id: execution.id, providerInvoked, safeFailureCode, now: completedAt });
    if (!operation) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target Cost Operation could not be created.");
    return this.result(updated, settlement);
  }

  private async finishAdmissionRetry(execution: AIEvalCaseExecution, reservationId: string | null, checkLease?: () => void): Promise<AIEvalTargetExecutionResult> {
    checkLease?.();
    const updated = this.executions.returnToPendingForAdmission(execution.id, this.safeNow());
    return this.result(updated, reservationId ? this.settle(reservationId, this.safeNow()) : null);
  }

  private async finishAdmissionFailure(execution: AIEvalCaseExecution, operation: AICostOperation, reservationId: string | null, safeFailureCode: string, checkLease?: () => void): Promise<AIEvalTargetExecutionResult> {
    checkLease?.();
    const completedAt = this.safeNow();
    this.completeOperation(operation.id, "FAILED", completedAt);
    const settlement = reservationId ? this.settle(reservationId, completedAt) : null;
    const updated = this.executions.fail({ id: execution.id, providerInvoked: false, safeFailureCode, now: completedAt });
    return this.result(updated, settlement);
  }

  private completeOperation(id: string, status: "COMPLETED" | "FAILED" | "CANCELLED", at = this.safeNow()): void { const current = this.dependencies.accounting.getOperation(id); if (current?.status === "OPEN") this.dependencies.accounting.completeOperation(id, "OPEN", status, at); }
  private settle(id: string | null, at = this.safeNow()): "SETTLED" | "RECONCILIATION_REQUIRED" | "RELEASED" | null { if (!id) return null; const reservation = this.dependencies.admission.getReservation(id); if (!reservation) return null; if (reservation.status === "RESERVED") { this.dependencies.admission.releaseBeforeExecution(id, at); return "RELEASED"; } return this.dependencies.admission.settle(id, at).status; }
  private result(execution: AIEvalCaseExecution, settlement: "SETTLED" | "RECONCILIATION_REQUIRED" | "RELEASED" | null): AIEvalTargetExecutionResult { if (!execution.targetCostOperationId) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target is missing its Cost Operation."); const reservation = execution.budgetReservationId ? this.dependencies.admission.getReservation(execution.budgetReservationId) : null; const durableSettlement = reservation?.status === "SETTLED" ? "SETTLED" : reservation?.status === "RECONCILIATION_REQUIRED" ? "RECONCILIATION_REQUIRED" : reservation?.status === "RELEASED" ? "RELEASED" : null; return { runId: execution.runId, caseId: execution.caseId, caseRevision: execution.caseRevision, executionId: execution.id, status: execution.status, providerInvoked: execution.providerInvoked, costOperationId: execution.targetCostOperationId, budgetReservationId: execution.budgetReservationId, settlementStatus: settlement ?? durableSettlement }; }
  private safeNow(): number { const value = this.clock(); if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) throw new AIEvalError("AI_EVAL_TARGET_INVALID", "The Eval target timestamp is invalid."); return value; }
  private elapsedLatency(execution: AIEvalCaseExecution, completedAt: number): number | null {
    if (execution.startedAt === null || !Number.isSafeInteger(execution.startedAt) || completedAt < execution.startedAt) return null;
    const elapsed = completedAt - execution.startedAt;
    return Number.isSafeInteger(elapsed) && elapsed >= 0 && elapsed <= 8_640_000_000_000 ? elapsed : null;
  }
}

function hashOutput(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

function syntheticTurnKey(executionId: string, cleanupId: string): string {
  return `eval-${executionId}-${cleanupId}`;
}

export function createAIEvalTargetExecutionService(dependencies: AIEvalTargetExecutionDependencies): AIEvalTargetExecutionService {
  return new AIEvalTargetExecutionService(dependencies);
}

export { AIEvalTargetExecutionService as AIEvalExecutionService };
