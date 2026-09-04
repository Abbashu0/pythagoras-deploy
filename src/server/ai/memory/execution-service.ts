import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";

import { AIAdmissionError, createAIAdmissionRequestFingerprint, type AIAdmissionPlan } from "../admission";
import { AIBudgetAdmissionService } from "../admission";
import type { AIBudgetReservation } from "../budget";
import { AIConversationError, SQLiteAIConversationRepository } from "../conversations";
import { AICostAccountingService, type AICostOperation } from "../economics";
import { AIProviderGateway, isAIProviderGatewayError, type AIProviderAttemptTrace, type GatewayGenerationStreamEvent } from "../gateway";
import { SQLiteAIModelConfigRepository } from "../model-registry";
import { SQLiteAIProviderConfigRepository } from "../configuration";
import type { AIJobExecutionContext, AIJobHandlerDefinition, AIJobTerminalReconciler, AIJob, AIJobTerminalReconciliationResult } from "../operations/jobs";
import { AIJobExecutionError } from "../operations/jobs";
import type { AIMemoryPolicyRepository } from "./contracts";
import { AIMemoryService } from "./service";
import { SQLiteAIMemoryPolicyRepository } from "./policy-repository";
import type { AIConversationSummaryRepository } from "./summary-contracts";
import { SQLiteAIConversationSummaryRepository } from "./summary-repository";
import { SQLiteAIMemoryExecutionConfigRepository } from "./execution-config-repository";
import { fingerprintAIMemoryExecutionConfig } from "./execution-config-validation";
import type { AIMemoryGenerationCostEstimator } from "./cost-estimator";
import { SQLiteAIMemoryExecutionRepository } from "./execution-repository";
import type {
  AIMemoryExecution,
  AIMemoryExecutionConfigRepository,
  AIMemoryExecutionRepository,
  AIMemoryExecutionRunResult,
  AIMemoryExecutionSourceMessage,
} from "./execution-contracts";
import {
  AI_MEMORY_EXECUTION_KINDS,
  AI_MEMORY_EXECUTION_PAYLOAD_VERSION,
  AI_MEMORY_EXECUTION_MAX_OUTPUT_BYTES,
  AI_MEMORY_EXTRACTION_JOB_KIND,
  AI_MEMORY_COMPACTION_JOB_KIND,
} from "./execution-contracts";
import { AIMemoryExecutionError } from "./execution-errors";
import { buildCompactionGatewayRequest, buildExtractionGatewayRequest, parseAIConversationCompactionOutput, parseAIMemoryExtractionOutput } from "./protocol";
import { AIMemoryExecutionSourceReader } from "./execution-source";
import type { ContentDatabase } from "../../content/database";

const MAX_TIMESTAMP = 8_640_000_000_000_000;
const MAX_ADMISSION_ATTEMPTS = 10;
const OPERATION_PREFIX = "memory-execution-v1";

export interface AIMemoryBudgetPeriodResolver {
  resolve(input: { principalRef: string; budgetPolicyId: string; budgetPolicyRevision: number; at: number }): { startAt: number; endAt: number } | Promise<{ startAt: number; endAt: number }>;
}

export interface AIMemoryExecutionServiceDependencies {
  database: ContentDatabase;
  executions?: AIMemoryExecutionRepository;
  configs?: AIMemoryExecutionConfigRepository;
  conversations?: SQLiteAIConversationRepository;
  memories?: AIMemoryService;
  memoryPolicies?: AIMemoryPolicyRepository;
  summaries?: AIConversationSummaryRepository;
  gateway: AIProviderGateway;
  accounting: AICostAccountingService;
  admission: AIBudgetAdmissionService;
  costEstimator: AIMemoryGenerationCostEstimator;
  budgetPeriodResolver?: AIMemoryBudgetPeriodResolver;
  clock?: () => number;
  idFactory?: () => string;
}

/**
 * The M10B execution boundary owns one exact pinned Generation attempt.  It
 * resolves private source text only at runtime and writes only the authorized
 * Memory/Summary result, never a prompt or Provider envelope.
 */
export class AIMemoryExecutionService implements AIJobTerminalReconciler {
  private readonly executions: AIMemoryExecutionRepository;
  private readonly configs: AIMemoryExecutionConfigRepository;
  private readonly conversations: SQLiteAIConversationRepository;
  private readonly memories: AIMemoryService;
  private readonly memoryPolicies: AIMemoryPolicyRepository;
  private readonly summaries: AIConversationSummaryRepository;
  private readonly source: AIMemoryExecutionSourceReader;
  private readonly models: SQLiteAIModelConfigRepository;
  private readonly providers: SQLiteAIProviderConfigRepository;
  private readonly periodResolver: AIMemoryBudgetPeriodResolver;
  private readonly clock: () => number;
  private readonly idFactory: () => string;

  constructor(private readonly dependencies: AIMemoryExecutionServiceDependencies) {
    this.executions = dependencies.executions ?? new SQLiteAIMemoryExecutionRepository(dependencies.database);
    this.configs = dependencies.configs ?? new SQLiteAIMemoryExecutionConfigRepository(dependencies.database);
    this.conversations = dependencies.conversations ?? new SQLiteAIConversationRepository(dependencies.database);
    this.memories = dependencies.memories ?? new AIMemoryService(dependencies.database);
    this.memoryPolicies = dependencies.memoryPolicies ?? new SQLiteAIMemoryPolicyRepository(dependencies.database);
    this.summaries = dependencies.summaries ?? new SQLiteAIConversationSummaryRepository(dependencies.database);
    this.source = new AIMemoryExecutionSourceReader(this.conversations);
    this.models = new SQLiteAIModelConfigRepository(dependencies.database);
    this.providers = new SQLiteAIProviderConfigRepository(dependencies.database);
    this.periodResolver = dependencies.budgetPeriodResolver ?? new DailyMemoryBudgetPeriodResolver();
    this.clock = dependencies.clock ?? Date.now;
    this.idFactory = dependencies.idFactory ?? uuidv7;
  }

  getExecution(id: string): AIMemoryExecution | null {
    return this.executions.getById(id);
  }

  async executeJob(executionId: string, context?: AIJobExecutionContext): Promise<AIMemoryExecutionRunResult> {
    let execution = this.requireExecution(executionId);
    if (isTerminal(execution.status)) return resultFromExecution(execution, this.executions.listExtractionResults(execution.id).map((link) => link.memoryId));
    if (context) {
      const expectedJobKind = execution.executionKind === "EXTRACTION" ? "ai.memory.extraction" : "ai.memory.compaction";
      if (context.job.kind !== expectedJobKind || context.job.payloadVersion !== 1) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory Job kind does not match its canonical execution.");
      execution = this.executions.bindJob(execution.id, context.job.id, this.safeNow());
      if (isTerminal(execution.status)) return resultFromExecution(execution, this.executions.listExtractionResults(execution.id).map((link) => link.memoryId));
    }
    if (execution.providerInvocationState !== "NOT_INVOKED" || execution.providerInvoked) {
      return this.reconcileAmbiguous(execution, "AI_MEMORY_EXECUTION_PROVIDER_AMBIGUOUS");
    }

    try {
      return await this.runExecution(execution, context);
    } catch (error) {
      if (error instanceof AIJobExecutionError) throw error;
      const current = this.executions.getById(execution.id) ?? execution;
      if (current.providerInvoked || current.providerInvocationState !== "NOT_INVOKED") return this.reconcileAmbiguous(current, "AI_MEMORY_EXECUTION_PROVIDER_AMBIGUOUS");
      const now = this.safeNow();
      this.closeFinancial(current, "FAILED", false, now);
      const safeCode = safeExecutionCode(error, "AI_MEMORY_EXECUTION_FAILED");
      const terminal = safeCode === "AI_MEMORY_EXECUTION_INPUT_LOST"
        ? this.executions.inputLost({ id: current.id, safeFailureCode: safeCode, now })
        : this.executions.fail({ id: current.id, safeFailureCode: safeCode, now });
      return resultFromExecution(terminal, []);
    }
  }

  execute(executionId: string, context?: AIJobExecutionContext): Promise<AIMemoryExecutionRunResult> {
    return this.executeJob(executionId, context);
  }

  reconcile(job: AIJob, now: number): void {
    const execution = this.executions.getByJobId(job.id) ?? this.executions.getById(job.id);
    if (!execution || isTerminal(execution.status)) return;
    if (!matchesTerminalOwnership(execution, job)) return;
    if (execution.providerInvoked || execution.providerInvocationState !== "NOT_INVOKED") {
      this.reconcileAmbiguous(execution, "AI_MEMORY_EXECUTION_PROVIDER_AMBIGUOUS", now);
      return;
    }
    this.closeFinancial(execution, job.status === "CANCELLED" ? "CANCELLED" : "FAILED", false, now);
    if (job.status === "CANCELLED") this.executions.cancel({ id: execution.id, safeFailureCode: "AI_MEMORY_EXECUTION_JOB_CANCELLED", now });
    else this.executions.fail({ id: execution.id, safeFailureCode: "AI_MEMORY_EXECUTION_JOB_TERMINAL", now });
  }

  reconcilePending(input: { limit: number; now: number }): AIJobTerminalReconciliationResult {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory terminal reconciliation limit is invalid.");
    const rows = this.databaseRowsForTerminalRecovery(input.limit);
    let reconciled = 0;
    let skipped = 0;
    for (const row of rows) {
      try {
        const before = this.executions.getById(row.id);
        if (!before || isTerminal(before.status) || !matchesTerminalOwnership(before, row.job)) { skipped += 1; continue; }
        this.reconcile(row.job, input.now);
        reconciled += 1;
      } catch {
        skipped += 1;
      }
    }
    return { scanned: rows.length, reconciled, skipped };
  }

  private async runExecution(initial: AIMemoryExecution, context?: AIJobExecutionContext): Promise<AIMemoryExecutionRunResult> {
    let execution = initial;
    const config = this.requireConfig(execution);
    this.source.getSource(execution);
    const policy = execution.executionKind === "EXTRACTION" ? this.requireMemoryPolicy(execution) : null;
    const sourceMessages = execution.executionKind === "EXTRACTION"
      ? this.source.listMessages({ principalRef: execution.principalRef, conversationId: execution.conversationId, fromOrdinal: execution.requestOrdinal, toOrdinal: execution.assistantOrdinal })
      : this.compactionMessages(execution);
    const previousSummary = execution.executionKind === "COMPACTION" ? this.previousSummary(execution) : null;
    const maxOutputTokens = execution.executionKind === "EXTRACTION" ? config.extractionMaxOutputTokens : config.compactionMaxOutputTokens;
    const request = execution.executionKind === "EXTRACTION"
      ? buildExtractionGatewayRequest({ requestId: execution.id, subjectKey: execution.subjectKey, messages: sourceMessages, maxOutputTokens })
      : buildCompactionGatewayRequest({ requestId: execution.id, subjectKey: execution.subjectKey, previousSummary: previousSummary?.summaryText ?? null, messages: sourceMessages, maxOutputTokens });
    const inputTokenUpperBound = safeSum([
      Buffer.byteLength(request.instructions ?? "", "utf8"),
      ...request.messages.map((message) => Buffer.byteLength(message.content, "utf8")),
      1_024,
    ]);
    const model = this.requireModel(execution);
    if (model.contextWindowTokens !== null && (!Number.isSafeInteger(model.contextWindowTokens) || inputTokenUpperBound + maxOutputTokens > model.contextWindowTokens)) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_SOURCE_INVALID", "The bounded Memory execution source does not fit the pinned Model context window.");
    const estimate = this.dependencies.costEstimator.estimate({ model, providerConfigId: execution.generationProviderConfigId, providerConfigRevision: execution.generationProviderConfigRevision, inputTokenUpperBound, maxOutputTokens, at: execution.createdAt });
    let operation = this.ensureOperation(execution);
    execution = this.executions.getById(execution.id) ?? execution;
    const boundReservation = execution.budgetReservationId
      ? this.dependencies.admission.getReservation(execution.budgetReservationId)
      : null;
    const admission = boundReservation && ["RESERVED", "EXECUTING"].includes(boundReservation.status)
      ? { reservation: boundReservation }
      : boundReservation
        ? "TERMINAL" as const
        : await this.admit(execution, operation, estimate);
    if (admission === "RETRY") return this.retryResult(execution);
    if (admission === "TERMINAL") {
      const current = this.executions.getById(execution.id) ?? execution;
      const terminal = current.providerInvoked || current.providerInvocationState !== "NOT_INVOKED"
        ? this.executions.ambiguous({ id: current.id, safeFailureCode: "AI_MEMORY_EXECUTION_FINANCE_TERMINAL", now: this.safeNow() })
        : this.executions.fail({ id: current.id, safeFailureCode: "AI_MEMORY_EXECUTION_FINANCE_TERMINAL", now: this.safeNow() });
      return resultFromExecution(terminal, []);
    }
    const reservation = this.dependencies.admission.startExecution(admission.reservation.id, this.safeNow());
    execution = this.executions.bindReservation(execution.id, reservation.id, this.safeNow());
    execution = this.executions.markRunning(execution.id, this.safeNow());
    if (context) context.checkLease();
    if (context?.signal.aborted) return this.finishPreProviderCancellation(execution, operation.id, reservation.id);

    // Re-read the live C4 ownership immediately before the Gateway handoff;
    // deletion must fail closed without a Provider invocation.
    this.source.getSource(execution);
    execution = this.executions.markInvoking(execution.id, this.safeNow());
    const providerResult = await this.invokeProvider(execution, model, request, context?.signal);
    operation = this.dependencies.accounting.getOperation(operation.id) ?? operation;
    if (providerResult.invoked) {
      this.dependencies.accounting.recordAttempt({ operationId: operation.id, attempt: providerResult.attempt, normalizedUsage: providerResult.usage, capability: "GENERATION", providerModelId: model.providerModelId });
      execution = this.executions.markInvokedWithAccounting(execution.id, this.safeNow());
    }
    if (context) {
      try { context.checkLease(); } catch { return this.reconcileAmbiguous(execution, "AI_MEMORY_EXECUTION_PROVIDER_AMBIGUOUS"); }
    }
    if (providerResult.error || providerResult.cancelled) {
      const status = providerResult.cancelled ? "CANCELLED" : "FAILED";
      this.closeFinancial(execution, status, providerResult.invoked, this.safeNow());
      const terminal = providerResult.cancelled
        ? this.executions.cancel({ id: execution.id, safeFailureCode: "AI_MEMORY_EXECUTION_CANCELLED", now: this.safeNow() })
        : this.executions.fail({ id: execution.id, safeFailureCode: "AI_MEMORY_EXECUTION_PROVIDER_FAILED", resultSha256: providerResult.output ? hash(providerResult.output) : null, resultByteSize: providerResult.output ? Buffer.byteLength(providerResult.output, "utf8") : null, now: this.safeNow() });
      return resultFromExecution(terminal, []);
    }
    if (!providerResult.invoked) {
      this.closeFinancial(execution, "FAILED", false, this.safeNow());
      const terminal = this.executions.fail({ id: execution.id, safeFailureCode: "AI_MEMORY_EXECUTION_PROVIDER_NOT_INVOKED", now: this.safeNow() });
      return resultFromExecution(terminal, []);
    }

    const output = providerResult.output;
    try {
      this.source.getSource(execution);
      if (execution.executionKind === "EXTRACTION") {
        const parsed = parseAIMemoryExtractionOutput(output, Math.min(config.maxExtractionCandidates, 100));
        const memoryIds: string[] = [];
        for (const [index, candidate] of parsed.candidates.entries()) {
          const memory = this.memories.createCandidate({ principalRef: execution.principalRef, status: "ACTIVE" }, {
            id: this.idFactory(),
            conversationId: execution.conversationId,
            subjectKey: execution.subjectKey,
            memoryPolicyId: policy!.memoryPolicyId,
            memoryPolicyRevision: policy!.revision,
            kind: candidate.kind,
            text: candidate.text,
            confidenceUnits: candidate.confidenceUnits,
            sourceStartOrdinal: execution.requestOrdinal,
            sourceEndOrdinal: execution.assistantOrdinal,
            now: this.safeNow(),
          });
          if (!config.autoApprovalMinConfidenceUnits || candidate.confidenceUnits >= config.autoApprovalMinConfidenceUnits) {
            try {
              this.memories.approveAutomatically({ memoryId: memory.id, principalRef: execution.principalRef, subjectKey: execution.subjectKey, memoryPolicyId: policy!.memoryPolicyId, memoryPolicyRevision: policy!.revision, minimumConfidenceUnits: config.autoApprovalMinConfidenceUnits, now: this.safeNow() });
            } catch {
              // A failed automatic review leaves the safe CANDIDATE in place.
            }
          }
          this.executions.insertExtractionResultInTransaction({ executionId: execution.id, ordinal: index + 1, memoryId: memory.id });
          memoryIds.push(memory.id);
        }
        const completed = this.executions.complete({ id: execution.id, resultSha256: hash(output), resultByteSize: Buffer.byteLength(output, "utf8"), resultCount: parsed.candidates.length, now: this.safeNow() });
        this.closeFinancial(completed, "COMPLETED", true, this.safeNow());
        return resultFromExecution(completed, memoryIds);
      }
      const parsed = parseAIConversationCompactionOutput(output);
      const summary = this.createSummary(execution, parsed.summary);
      const completed = this.executions.complete({ id: execution.id, resultSha256: hash(output), resultByteSize: Buffer.byteLength(output, "utf8"), resultCount: 1, resultSummaryId: summary.id, resultSummaryRevision: summary.revision, now: this.safeNow() });
      this.closeFinancial(completed, "COMPLETED", true, this.safeNow());
      return resultFromExecution(completed, []);
    } catch (error) {
      this.closeFinancial(execution, "FAILED", true, this.safeNow());
      const failed = this.executions.fail({ id: execution.id, safeFailureCode: error instanceof AIMemoryExecutionError ? error.code : "AI_MEMORY_EXECUTION_RESULT_INVALID", resultSha256: hash(output), resultByteSize: Buffer.byteLength(output, "utf8"), now: this.safeNow() });
      return resultFromExecution(failed, []);
    }
  }

  private requireExecution(id: string): AIMemoryExecution {
    const execution = this.executions.getById(id);
    if (!execution) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_NOT_FOUND", "The Memory execution was not found.");
    return execution;
  }

  private requireConfig(execution: AIMemoryExecution): NonNullable<ReturnType<AIMemoryExecutionConfigRepository["getRevision"]>> {
    const config = this.configs.getRevision(execution.executionConfigId, execution.executionConfigRevision);
    const protocolMatches = execution.executionKind === "EXTRACTION"
      ? execution.protocolKey === "memory-extraction-v1" && execution.protocolRevision === 1
      : execution.protocolKey === "conversation-compaction-v1" && execution.protocolRevision === 1;
    if (!config || config.enabled !== true || config.executionConfigId !== execution.executionConfigId || !protocolMatches || fingerprintAIMemoryExecutionConfig({ ...config, executionConfigId: config.executionConfigId, revision: config.revision }) !== execution.executionConfigFingerprint) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_CONFIG_INVALID", "The pinned Memory Execution Config is unavailable.");
    return config;
  }

  private requireModel(execution: AIMemoryExecution) {
    const model = this.models.getById(execution.generationModelConfigId);
    const provider = this.providers.getById(execution.generationProviderConfigId);
    if (!model || model.revision !== execution.generationModelConfigRevision || model.capability !== "GENERATION" || !model.enabled || !model.supportsStreaming || !model.supportsStructuredOutput || model.providerConfigId !== execution.generationProviderConfigId || !provider || provider.revision !== execution.generationProviderConfigRevision || !provider.enabled || !provider.credentialRef) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_CONFIG_DEPENDENCY_INVALID", "The pinned Memory Generation Model or Provider is no longer executable.");
    return model;
  }

  private requireMemoryPolicy(execution: AIMemoryExecution) {
    if (!execution.memoryPolicyId || !execution.memoryPolicyRevision) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_CONFIG_INVALID", "The extraction execution is missing its pinned Memory Policy.");
    const policy = this.memoryPolicies.getRevision(execution.memoryPolicyId, execution.memoryPolicyRevision);
    if (!policy || !policy.enabled || policy.subjectKey !== execution.subjectKey) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_CONFIG_DEPENDENCY_INVALID", "The pinned Memory Policy is unavailable.");
    return policy;
  }

  private previousSummary(execution: AIMemoryExecution) {
    if (!execution.baseSummaryId || execution.baseSummaryRevision === null) return null;
    const summary = this.summaries.getRevision({ principalRef: execution.principalRef, conversationId: execution.conversationId, revision: execution.baseSummaryRevision });
    if (!summary || summary.id !== execution.baseSummaryId || summary.status !== "ACTIVE" || summary.summaryText === null || summary.coversThroughOrdinal !== execution.baseSummaryCoverage) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_SOURCE_INVALID", "The pinned Conversation Summary is no longer available.");
    return summary;
  }

  private compactionMessages(execution: AIMemoryExecution): AIMemoryExecutionSourceMessage[] {
    if (execution.targetCutoffOrdinal === null) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_SOURCE_INVALID", "The compaction execution has no cutoff.");
    const fromOrdinal = execution.baseSummaryCoverage === null ? 1 : execution.baseSummaryCoverage + 1;
    return this.source.listMessages({ principalRef: execution.principalRef, conversationId: execution.conversationId, fromOrdinal, toOrdinal: execution.targetCutoffOrdinal });
  }

  private ensureOperation(execution: AIMemoryExecution): AICostOperation {
    const expectedKey = `${OPERATION_PREFIX}:${execution.id}`;
    if (execution.costOperationId) {
      const existing = this.dependencies.accounting.getOperation(execution.costOperationId);
      if (!existing) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory Cost Operation is missing.");
      assertOperation(existing, execution, expectedKey);
      if (existing.status !== "OPEN") throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory Cost Operation is already terminal.");
      return existing;
    }
    let operation: AICostOperation;
    try {
      operation = this.dependencies.accounting.createOperation({
        costCenter: "STUDENT_GENERATION",
        idempotencyKey: null,
        opaquePrincipalRef: execution.principalRef,
        subjectKey: execution.subjectKey,
        conversationId: execution.conversationId,
        responseId: execution.responseId,
        jobId: execution.jobId,
        evalRunId: null,
        knowledgeRevision: null,
        status: "OPEN",
        startedAt: execution.createdAt,
        completedAt: null,
      }, execution.id);
    } catch {
      const existing = this.dependencies.accounting.getOperation(execution.id);
      if (!existing) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory Cost Operation could not be created safely.");
      operation = existing;
    }
    assertOperation(operation, execution, expectedKey);
    this.executions.bindCostOperation(execution.id, operation.id, this.safeNow());
    return operation;
  }

  private async admit(execution: AIMemoryExecution, operation: AICostOperation, estimate: ReturnType<AIMemoryGenerationCostEstimator["estimate"]>): Promise<{ reservation: AIBudgetReservation } | "RETRY" | "TERMINAL"> {
    const at = operation.startedAt;
    const period = await this.periodResolver.resolve({ principalRef: execution.principalRef, budgetPolicyId: execution.budgetPolicyId, budgetPolicyRevision: execution.budgetPolicyRevision, at });
    const base: Omit<AIAdmissionPlan, "requestFingerprint"> = {
      principalRef: execution.principalRef,
      budgetPolicyId: execution.budgetPolicyId,
      budgetPolicyRevision: execution.budgetPolicyRevision,
      rateLimitPolicyId: execution.rateLimitPolicyId,
      rateLimitPolicyRevision: execution.rateLimitPolicyRevision,
      budgetPeriod: period,
      costOperationId: operation.id,
      costEstimate: { currency: estimate.currency, maxCostNano: estimate.maxCostNano, estimateBasis: estimate.estimateBasis, modelConfigId: estimate.generation.modelConfigId, modelConfigRevision: estimate.generation.modelConfigRevision, rateCardId: estimate.generation.rateCardId, rateCardRevision: estimate.generation.rateCardRevision },
      idempotencyKey: `memory-admission:${execution.id}:${execution.admissionAttempt}`,
    };
    const plan: AIAdmissionPlan = { ...base, requestFingerprint: createAIAdmissionRequestFingerprint(base) };
    try {
      const result = this.dependencies.admission.admit(plan);
      this.executions.bindReservation(execution.id, result.reservation.id, this.safeNow());
      return { reservation: result.reservation };
    } catch (error) {
      if (error instanceof AIAdmissionError && (error.code === "AI_RATE_LIMITED" || error.code === "AI_ADMISSION_CONCURRENCY_LIMITED")) {
        if (execution.admissionAttempt >= MAX_ADMISSION_ATTEMPTS) {
          this.closeFinancial(execution, "FAILED", false, this.safeNow());
          this.executions.fail({ id: execution.id, safeFailureCode: "AI_MEMORY_EXECUTION_ADMISSION_RETRY_EXHAUSTED", now: this.safeNow() });
          return "TERMINAL";
        }
        this.executions.incrementAdmissionAttempt(execution.id, this.safeNow());
        this.executions.markAdmissionRetry(execution.id, "AI_MEMORY_EXECUTION_ADMISSION_RETRYABLE", this.safeNow());
        throw new AIJobExecutionError("AI_MEMORY_EXECUTION_ADMISSION_RETRYABLE", true);
      }
      this.closeFinancial(execution, "FAILED", false, this.safeNow());
      this.executions.fail({ id: execution.id, safeFailureCode: error instanceof AIAdmissionError ? error.code : "AI_MEMORY_EXECUTION_ADMISSION_DENIED", now: this.safeNow() });
      return "TERMINAL";
    }
  }

  private async invokeProvider(execution: AIMemoryExecution, model: ReturnType<AIMemoryExecutionService["requireModel"]>, request: Parameters<AIProviderGateway["generate"]>[1], signal?: AbortSignal): Promise<{ output: string; usage: { inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; cacheHitInputTokens: number | null; cacheMissInputTokens: number | null }; attempts: readonly AIProviderAttemptTrace[]; attempt: AIProviderAttemptTrace; invoked: boolean; cancelled: boolean; error: unknown }> {
    const usage = { inputTokens: null, outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null };
    let output = "";
    let stream: ReturnType<AIProviderGateway["generate"]> | null = null;
    let error: unknown = null;
    try {
      stream = this.dependencies.gateway.generate({ capability: "GENERATION", attempts: [model.id] }, request, { signal, timeoutMs: this.requireConfig(execution).timeoutMs, expectedIdentity: { modelConfigId: model.id, modelConfigRevision: model.revision, providerConfigId: model.providerConfigId, providerConfigRevision: execution.generationProviderConfigRevision, providerModelId: model.providerModelId, adapterKey: model.adapterKey } });
      for await (const event of stream.events) {
        if (event.type === "TEXT_DELTA") output += event.text;
        if (Buffer.byteLength(output, "utf8") > AI_MEMORY_EXECUTION_MAX_OUTPUT_BYTES) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_RESULT_INVALID", "The Memory Provider output exceeds its bounded result size.");
        if (event.type === "USAGE" || event.type === "COMPLETED") mergeUsage(usage, event);
      }
    } catch (caught) {
      error = caught;
    }
    const attempts = stream ? await stream.trace : [];
    const attempt = attempts.find((candidate) => candidate.providerInvoked) ?? attempts.at(-1);
    if (!attempt) return { output, usage, attempts, attempt: emptyAttempt(execution), invoked: false, cancelled: Boolean(signal?.aborted || (isAIProviderGatewayError(error) && error.code === "CANCELLED")), error };
    return { output, usage, attempts, attempt, invoked: attempt.providerInvoked, cancelled: Boolean(signal?.aborted || (isAIProviderGatewayError(error) && error.code === "CANCELLED") || attempt.status === "CANCELLED"), error };
  }

  private finishPreProviderCancellation(execution: AIMemoryExecution, operationId: string, reservationId: string): AIMemoryExecutionRunResult {
    this.closeFinancial(execution, "CANCELLED", false, this.safeNow());
    const cancelled = this.executions.cancel({ id: execution.id, safeFailureCode: "AI_MEMORY_EXECUTION_CANCELLED", now: this.safeNow() });
    return resultFromExecution(cancelled, []);
  }

  private reconcileAmbiguous(execution: AIMemoryExecution, code: string, now = this.safeNow()): AIMemoryExecutionRunResult {
    this.closeFinancial(execution, "FAILED", true, now);
    const ambiguous = this.executions.ambiguous({ id: execution.id, safeFailureCode: code, now });
    return resultFromExecution(ambiguous, []);
  }

  private closeFinancial(execution: AIMemoryExecution, status: "COMPLETED" | "FAILED" | "CANCELLED", providerInvoked: boolean, now: number): void {
    const operationCandidate = this.dependencies.accounting.getOperation(execution.costOperationId ?? execution.id);
    if (operationCandidate) {
      try { assertOperation(operationCandidate, execution, `${OPERATION_PREFIX}:${execution.id}`); } catch { return; }
    }
    const operation = operationCandidate;
    if (operation?.status === "OPEN") this.dependencies.accounting.completeOperation(operation.id, "OPEN", status, now);
    const reservation = execution.budgetReservationId
      ? this.dependencies.admission.getReservation(execution.budgetReservationId)
      : operation ? this.dependencies.admission.getReservationByOperationId(operation.id) : null;
    if (!reservation || ["SETTLED", "RELEASED"].includes(reservation.status)) return;
    if (reservation.status === "RESERVED") {
      this.dependencies.admission.releaseBeforeExecution(reservation.id, now, "PRE_EXECUTION_RELEASE");
    } else if (providerInvoked) {
      this.dependencies.admission.settle(reservation.id, now);
    } else {
      this.dependencies.admission.releaseUninvokedExecution(reservation.id, now, status === "CANCELLED" ? "CANCELLED_BEFORE_PROVIDER" : "PRE_PROVIDER_RELEASE");
    }
  }

  private createSummary(execution: AIMemoryExecution, summaryText: string) {
    const current = this.summaries.getCurrentForConversation({ principalRef: execution.principalRef, conversationId: execution.conversationId, subjectKey: execution.subjectKey });
    const expectedId = execution.baseSummaryId;
    const expectedRevision = execution.baseSummaryRevision;
    const expectedCoverage = execution.baseSummaryCoverage;
    if ((current?.id ?? null) !== expectedId || (current?.revision ?? null) !== expectedRevision || (current?.coversThroughOrdinal ?? null) !== expectedCoverage) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_SOURCE_INVALID", "The Conversation Summary advanced before compaction could commit.");
    if (execution.targetCutoffOrdinal === null) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_SOURCE_INVALID", "The compaction cutoff is missing.");
    const revision = (expectedRevision ?? 0) + 1;
    return this.summaries.insertRevision({ id: this.idFactory(), conversationId: execution.conversationId, principalRef: execution.principalRef, subjectKey: execution.subjectKey, revision, summaryText, coversThroughOrdinal: execution.targetCutoffOrdinal, sourceStartOrdinal: 1, sourceEndOrdinal: execution.targetCutoffOrdinal, sourceMessageCount: execution.targetCutoffOrdinal, createdAt: this.safeNow() });
  }

  private databaseRowsForTerminalRecovery(limit: number): Array<{ id: string; job: AIJob }> {
    const rows = this.dependencies.database.client.prepare(`
      SELECT execution.id AS execution_id, jobs.id AS job_id, jobs.kind, jobs.payload_version,
             jobs.payload_json, jobs.payload_hash, jobs.dedupe_key, jobs.cost_center,
             jobs.cost_operation_id, jobs.priority, jobs.status, jobs.attempt_count,
             jobs.max_attempts, jobs.timeout_ms, jobs.lease_duration_ms,
             jobs.backoff_base_ms, jobs.backoff_max_ms, jobs.scheduled_at,
             jobs.lease_owner, jobs.lease_token, jobs.lease_generation,
             jobs.lease_expires_at, jobs.last_heartbeat_at, jobs.last_error_code,
             jobs.cancellation_requested_at, jobs.created_at, jobs.updated_at,
             jobs.completed_at
      FROM ai_memory_executions execution
      JOIN ai_jobs jobs ON jobs.id = COALESCE(execution.job_id, execution.id)
      WHERE execution.status IN ('PENDING','RUNNING')
        AND jobs.status IN ('DEAD_LETTER','CANCELLED')
      ORDER BY execution.updated_at ASC, execution.id ASC
      LIMIT ?`).all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ id: String(row.execution_id), job: jobFromRow(row) }));
  }

  private retryResult(execution: AIMemoryExecution): AIMemoryExecutionRunResult {
    return resultFromExecution(this.executions.getById(execution.id) ?? execution, []);
  }

  private safeNow(): number {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory execution timestamp is invalid.");
    return value;
  }
}

export class DailyMemoryBudgetPeriodResolver implements AIMemoryBudgetPeriodResolver {
  resolve(input: { principalRef: string; budgetPolicyId: string; budgetPolicyRevision: number; at: number }): { startAt: number; endAt: number } {
    const day = new Date(input.at);
    const startAt = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    const endAt = startAt + 86_400_000;
    if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt) || startAt < 0) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory Budget period is invalid.");
    return { startAt, endAt };
  }
}

export function createAIMemoryExecutionJobHandlers(service: AIMemoryExecutionService): AIJobHandlerDefinition[] {
  return AI_MEMORY_EXECUTION_KINDS.map((executionKind) => ({
    kind: executionKind === "EXTRACTION" ? AI_MEMORY_EXTRACTION_JOB_KIND : AI_MEMORY_COMPACTION_JOB_KIND,
    payloadVersion: AI_MEMORY_EXECUTION_PAYLOAD_VERSION,
    validatePayload: validateExecutionPayload,
    execute: async (payload: Record<string, unknown>, context: AIJobExecutionContext) => {
      await service.executeJob(String(payload.executionId), context);
    },
  }));
}

export function validateAIMemoryExecutionPayload(value: unknown): Record<string, unknown> {
  return validateExecutionPayload(value);
}

function validateExecutionPayload(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.executionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.executionId)) throw new AIJobExecutionError("AI_MEMORY_EXECUTION_PAYLOAD_INVALID", false);
  return { executionId: value.executionId };
}

function resultFromExecution(execution: AIMemoryExecution, memoryIds: readonly string[]): AIMemoryExecutionRunResult {
  return { executionId: execution.id, status: execution.status, providerInvoked: execution.providerInvoked, costOperationId: execution.costOperationId, budgetReservationId: execution.budgetReservationId, memoryIds: Object.freeze([...memoryIds]), summaryId: execution.resultSummaryId };
}

function isTerminal(status: AIMemoryExecution["status"]): boolean {
  return ["COMPLETED", "FAILED", "CANCELLED", "AMBIGUOUS", "INPUT_LOST"].includes(status);
}

function matchesTerminalOwnership(execution: AIMemoryExecution, job: AIJob): boolean {
  const expectedKind = execution.executionKind === "EXTRACTION" ? "ai.memory.extraction" : "ai.memory.compaction";
  return (job.status === "DEAD_LETTER" || job.status === "CANCELLED")
    && job.kind === expectedKind
    && job.payloadVersion === 1
    && (execution.jobId === null || execution.jobId === job.id)
    && (job.costOperationId === null || job.costOperationId === execution.costOperationId);
}

function assertOperation(operation: AICostOperation, execution: AIMemoryExecution, expectedKey: string): void {
  if (operation.costCenter !== "STUDENT_GENERATION" || (operation.idempotencyKey !== null && operation.idempotencyKey !== expectedKey) || operation.opaquePrincipalRef !== execution.principalRef || operation.subjectKey !== execution.subjectKey || operation.conversationId !== execution.conversationId || operation.responseId !== execution.responseId || operation.evalRunId !== null || operation.knowledgeRevision !== null || (execution.jobId !== null && operation.jobId !== execution.jobId && operation.jobId !== null)) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory Cost Operation identity is inconsistent.");
}

function mergeUsage(target: { inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; cacheHitInputTokens: number | null; cacheMissInputTokens: number | null }, event: GatewayGenerationStreamEvent): void {
  if (event.type === "STARTED" || event.type === "TEXT_DELTA") return;
  for (const field of ["inputTokens", "outputTokens", "reasoningTokens", "cacheHitInputTokens", "cacheMissInputTokens"] as const) {
    const value = event.usage[field];
    if (value !== null && (target[field] === null || value > target[field]!)) target[field] = value;
  }
}

function emptyAttempt(execution: AIMemoryExecution): AIProviderAttemptTrace {
  return { gatewayRequestId: execution.id, capability: "GENERATION", attemptIndex: 0, modelConfigId: execution.generationModelConfigId, modelConfigRevision: execution.generationModelConfigRevision, providerConfigId: execution.generationProviderConfigId, providerConfigRevision: execution.generationProviderConfigRevision, adapterKey: null, providerModelId: null, startedAt: execution.createdAt, completedAt: execution.createdAt, latencyMs: 0, status: "SKIPPED", providerInvoked: false };
}

function safeExecutionCode(error: unknown, fallback: string): string {
  if (error instanceof AIMemoryExecutionError) return error.code;
  if (error instanceof AIConversationError && error.code === "AI_CONVERSATION_NOT_FOUND") return "AI_MEMORY_EXECUTION_INPUT_LOST";
  return fallback;
}

function safeSum(values: readonly number[]): number {
  const value = values.reduce((sum, current) => sum + current, 0);
  if (!Number.isSafeInteger(value) || value < 0) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_SOURCE_INVALID", "The Memory source size exceeds its safe bound.");
  return value;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function jobFromRow(row: Record<string, unknown>): AIJob {
  return {
    id: String(row.job_id), kind: String(row.kind), payloadVersion: Number(row.payload_version), payloadJson: String(row.payload_json), payloadHash: String(row.payload_hash), dedupeKey: String(row.dedupe_key), costCenter: row.cost_center as AIJob["costCenter"], costOperationId: row.cost_operation_id === null ? null : String(row.cost_operation_id), priority: row.priority as AIJob["priority"], status: row.status as AIJob["status"], attemptCount: Number(row.attempt_count), maxAttempts: Number(row.max_attempts), timeoutMs: Number(row.timeout_ms), leaseDurationMs: Number(row.lease_duration_ms), backoffBaseMs: Number(row.backoff_base_ms), backoffMaxMs: Number(row.backoff_max_ms), scheduledAt: Number(row.scheduled_at), leaseOwner: row.lease_owner === null ? null : String(row.lease_owner), leaseToken: row.lease_token === null ? null : String(row.lease_token), leaseGeneration: Number(row.lease_generation), leaseExpiresAt: row.lease_expires_at === null ? null : Number(row.lease_expires_at), lastHeartbeatAt: row.last_heartbeat_at === null ? null : Number(row.last_heartbeat_at), lastErrorCode: row.last_error_code === null ? null : String(row.last_error_code), cancellationRequestedAt: row.cancellation_requested_at === null ? null : Number(row.cancellation_requested_at), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), completedAt: row.completed_at === null ? null : Number(row.completed_at),
  };
}

export function createAIMemoryExecutionService(dependencies: AIMemoryExecutionServiceDependencies): AIMemoryExecutionService {
  return new AIMemoryExecutionService(dependencies);
}
