import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import { AIJobError, AIJobExecutionError } from "../operations/jobs";
import {
  AIBudgetAdmissionService,
  AI_EVALS_ADMISSION_PRINCIPAL_REF,
  createAIAdmissionRequestFingerprint,
  type AIAdmissionCostEstimate,
} from "../admission";
import {
  AICostAccountingService,
  AICostCalculator,
  AIGenerationUsageAccumulator,
  type AICostOperation,
  type AIRateCardResolver,
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
import type {
  AIEvalCaseResult,
  AIEvalCaseRevision,
  AIEvalDimension,
  AIEvalJudgeConfigRevision,
  AIEvalJudgeExecution,
  AIEvalJudgeExecutionRepository,
  AIEvalRun,
  AIEvalSuiteRevision,
} from "./contracts";
import {
  AI_EVAL_JUDGE_PROTOCOL_KEY,
  AI_EVAL_JUDGE_PROTOCOL_REVISION,
} from "./contracts";
import { AIEvalError } from "./errors";
import { SQLiteAIEvalJudgeConfigRepository, fingerprintAIEvalJudgeConfig } from "./judge-config";
import { SQLiteAIEvalJudgeExecutionRepository } from "./judge-executions";
import { formatAIEvalJudgePrompt, parseAIEvalJudgeResponse } from "./judge-protocol";
import { SQLiteAIEvalRunRepository } from "./runs";
import type { AIEvidencePack } from "../retrieval";
import type { AIEvalTargetBudgetPeriodResolver } from "./target-execution";

const MAX_OUTPUT_BYTES = 524_288;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

export interface AIEvalJudgeExecutionDependencies {
  database: ContentDatabase;
  runs?: SQLiteAIEvalRunRepository;
  judgeConfigs?: SQLiteAIEvalJudgeConfigRepository;
  judgeExecutions?: AIEvalJudgeExecutionRepository;
  gateway: Pick<AIProviderGateway, "generate">;
  accounting: AICostAccountingService;
  admission: AIBudgetAdmissionService;
  models?: AIModelConfigRepository;
  providers?: AIProviderConfigRepository;
  rateCards: AIRateCardResolver;
  calculator?: AICostCalculator;
  budgetPeriodResolver?: AIEvalTargetBudgetPeriodResolver;
  clock?: () => number;
}

function isAIJobExecutionInterruption(error: unknown): error is AIJobExecutionError {
  return error instanceof AIJobExecutionError && (error.safeErrorCode === "AI_JOB_TIMEOUT" || error.safeErrorCode === "AI_JOB_CANCELLED");
}

export interface AIEvalJudgeExecutionInput {
  run: AIEvalRun;
  suite: AIEvalSuiteRevision;
  caseRevision: AIEvalCaseRevision;
  caseResult: AIEvalCaseResult;
  outputText: string;
  evidencePack: AIEvidencePack;
  finishReason: AIEvalCaseResult["finishReason"];
  signal?: AbortSignal;
  checkLease?: () => void;
}

/** Supplementary LLM Judge execution service for qualitative evaluation. */
export class AIEvalJudgeExecutionService {
  private readonly runs: SQLiteAIEvalRunRepository;
  private readonly judgeConfigs: SQLiteAIEvalJudgeConfigRepository;
  private readonly judgeExecutions: AIEvalJudgeExecutionRepository;
  private readonly gateway: Pick<AIProviderGateway, "generate">;
  private readonly accounting: AICostAccountingService;
  private readonly admission: AIBudgetAdmissionService;
  private readonly models: AIModelConfigRepository;
  private readonly providers: AIProviderConfigRepository;
  private readonly rateCards: AIRateCardResolver;
  private readonly calculator: AICostCalculator;
  private readonly budgetPeriodResolver: AIEvalTargetBudgetPeriodResolver;
  private readonly clock: () => number;

  constructor(private readonly dependencies: AIEvalJudgeExecutionDependencies) {
    this.runs = dependencies.runs ?? new SQLiteAIEvalRunRepository(dependencies.database);
    this.judgeConfigs = dependencies.judgeConfigs ?? new SQLiteAIEvalJudgeConfigRepository(dependencies.database);
    this.judgeExecutions = dependencies.judgeExecutions ?? new SQLiteAIEvalJudgeExecutionRepository(dependencies.database);
    this.gateway = dependencies.gateway;
    this.accounting = dependencies.accounting;
    this.admission = dependencies.admission;
    this.models = dependencies.models ?? new SQLiteAIModelConfigRepository(dependencies.database);
    this.providers = dependencies.providers ?? new SQLiteAIProviderConfigRepository(dependencies.database);
    this.rateCards = dependencies.rateCards;
    this.calculator = dependencies.calculator ?? new AICostCalculator();
    this.budgetPeriodResolver = dependencies.budgetPeriodResolver ?? {
      resolve: ({ at }) => ({
        startAt: Math.floor(at / 86_400_000) * 86_400_000,
        endAt: (Math.floor(at / 86_400_000) + 1) * 86_400_000,
      }),
    };
    this.clock = dependencies.clock ?? Date.now;
  }

  async executeJudgeForCase(input: AIEvalJudgeExecutionInput): Promise<AIEvalJudgeExecution | null> {
    const { run, suite, caseRevision, caseResult, outputText, evidencePack, finishReason, signal, checkLease } = input;
    const judgeRequiredDimensions = suite.requiredDimensions
      .filter((d) => d.mode === "JUDGE_REQUIRED")
      .map((d) => d.dimension as AIEvalDimension);

    if (judgeRequiredDimensions.length === 0) {
      return null;
    }

    if (!suite.supplementaryJudgeConfig) {
      throw new AIEvalError("AI_EVAL_JUDGE_CONFIG_INVALID", "Suite with JUDGE_REQUIRED dimensions is missing supplementaryJudgeConfig.");
    }

    const now = this.safeNow();
    let execution = this.judgeExecutions.getByTarget({
      runId: run.id,
      caseId: caseRevision.caseId,
      caseRevision: caseRevision.revision,
    });

    if (execution && ["COMPLETED", "FAILED", "CANCELLED", "AMBIGUOUS", "INPUT_LOST"].includes(execution.status)) {
      return execution;
    }

    if (execution) {
      // Existing nonterminal Judge Execution encountered at function entry.
      // Implement conservative durable recovery semantics:
      const hasUsage = execution.judgeCostOperationId
        ? this.accounting.listUsageCostRecords(execution.judgeCostOperationId).length > 0
        : false;
      const impliesInvocation =
        execution.providerInvocationState === "INVOKING" ||
        execution.providerInvocationState === "INVOKED_WITH_ACCOUNTING" ||
        execution.providerInvoked ||
        hasUsage;

      if (impliesInvocation) {
        if (execution.judgeCostOperationId) {
          this.completeOperation(execution.judgeCostOperationId, "FAILED", now);
        }
        this.settle(execution.budgetReservationId, now);
        return this.judgeExecutions.ambiguous({
          id: execution.id,
          safeFailureCode: "EVAL_JUDGE_PROVIDER_AMBIGUOUS",
          now,
        });
      }

      // Existing nonterminal execution that did not invoke Provider.
      // Original runtime-only target output from interrupted process is no longer safely owned.
      // Fail closed as INPUT_LOST rather than pretending raw target answer can be reconstructed.
      if (execution.judgeCostOperationId) {
        this.completeOperation(execution.judgeCostOperationId, "FAILED", now);
      }
      this.settle(execution.budgetReservationId, now);
      return this.judgeExecutions.inputLost({
        id: execution.id,
        safeFailureCode: "EVAL_JUDGE_INPUT_LOST",
        now,
      });
    }

    const judgeConfig = this.judgeConfigs.getRevisionByKey(
      suite.supplementaryJudgeConfig.referenceKey,
      suite.supplementaryJudgeConfig.revision,
    );

    const fingerprint = judgeConfig ? fingerprintAIEvalJudgeConfig(judgeConfig) : "0".repeat(64);

    execution = this.judgeExecutions.create({
      runId: run.id,
      caseId: caseRevision.caseId,
      caseRevision: caseRevision.revision,
      ordinal: caseResult.ordinal,
      subjectKey: suite.subjectKey,
      judgeConfigId: judgeConfig?.judgeConfigId ?? "00000000-0000-0000-0000-000000000000",
      judgeConfigRevision: judgeConfig?.revision ?? 1,
      judgeConfigFingerprint: fingerprint,
      protocolKey: judgeConfig?.protocolKey ?? AI_EVAL_JUDGE_PROTOCOL_KEY,
      protocolRevision: judgeConfig?.protocolRevision ?? AI_EVAL_JUDGE_PROTOCOL_REVISION,
      judgeModelConfigId: judgeConfig?.modelConfigId ?? "00000000-0000-0000-0000-000000000000",
      judgeModelConfigRevision: judgeConfig?.modelConfigRevision ?? 1,
      judgeProviderConfigId: judgeConfig?.providerConfigId ?? "00000000-0000-0000-0000-000000000000",
      judgeProviderConfigRevision: judgeConfig?.providerConfigRevision ?? 1,
      judgeCostOperationId: null,
      budgetReservationId: null,
      status: "PENDING",
      providerInvocationState: "NOT_INVOKED",
      providerInvoked: false,
      judgeOutputSha256: null,
      judgeOutputByteSize: null,
      safeFailureCode: null,
      latencyMs: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
    });

    if (signal?.aborted) return this.finishSignalAbort(execution, null, null, signal, false);

    try {
      checkLease?.();
    } catch (error) {
      if ((signal?.aborted || isAIJobExecutionInterruption(error)) && !(error instanceof AIJobError && error.code === "AI_JOB_LEASE_LOST")) return this.finishSignalAbort(execution, null, null, signal, false, error);
      if (error instanceof AIJobError && error.code === "AI_JOB_LEASE_LOST") {
        this.judgeExecutions.fail({
          id: execution.id,
          providerInvoked: false,
          safeFailureCode: "EVAL_JUDGE_LEASE_LOST",
          now: this.safeNow(),
        });
        throw error;
      }
      throw error;
    }

    // 1. Config validation
    if (!judgeConfig || !judgeConfig.enabled || judgeConfig.subjectKey !== suite.subjectKey) {
      return this.judgeExecutions.fail({
        id: execution.id,
        providerInvoked: false,
        safeFailureCode: "EVAL_JUDGE_CONFIG_UNAVAILABLE",
        now: this.safeNow(),
      });
    }

    if (judgeConfig.protocolKey !== AI_EVAL_JUDGE_PROTOCOL_KEY || judgeConfig.protocolRevision !== AI_EVAL_JUDGE_PROTOCOL_REVISION) {
      return this.judgeExecutions.fail({
        id: execution.id,
        providerInvoked: false,
        safeFailureCode: "EVAL_JUDGE_PROTOCOL_UNSUPPORTED",
        now: this.safeNow(),
      });
    }

    // 2. Self-judge prevention: Judge model identity != Candidate generation model identity
    if (
      judgeConfig.modelConfigId === run.candidateSnapshot.generationModel.id &&
      judgeConfig.modelConfigRevision === run.candidateSnapshot.generationModel.revision
    ) {
      return this.judgeExecutions.fail({
        id: execution.id,
        providerInvoked: false,
        safeFailureCode: "EVAL_JUDGE_SELF_JUDGE_FORBIDDEN",
        now: this.safeNow(),
      });
    }

    // 3. Currentness check of Judge Model & Provider
    const model = this.models.getById(judgeConfig.modelConfigId);
    const provider = this.providers.getById(judgeConfig.providerConfigId);
    if (!model || model.revision !== judgeConfig.modelConfigRevision || !model.enabled || model.capability !== "GENERATION" || model.providerConfigId !== judgeConfig.providerConfigId) {
      return this.judgeExecutions.fail({
        id: execution.id,
        providerInvoked: false,
        safeFailureCode: "EVAL_JUDGE_MODEL_STALE",
        now: this.safeNow(),
      });
    }

    if (!provider || provider.revision !== judgeConfig.providerConfigRevision || !provider.enabled || !provider.credentialRef) {
      return this.judgeExecutions.fail({
        id: execution.id,
        providerInvoked: false,
        safeFailureCode: "EVAL_JUDGE_PROVIDER_STALE",
        now: this.safeNow(),
      });
    }

    // 4. Create separate EVALS Cost Operation for Judge
    let operation: AICostOperation | null = execution.judgeCostOperationId
      ? this.accounting.getOperation(execution.judgeCostOperationId)
      : null;

    if (!operation) {
      operation = this.accounting.createOperation({
        costCenter: "EVALS",
        idempotencyKey: null,
        opaquePrincipalRef: null,
        subjectKey: suite.subjectKey,
        conversationId: null,
        responseId: null,
        jobId: null,
        evalRunId: run.id,
        knowledgeRevision: null,
        status: "OPEN",
        startedAt: now,
        completedAt: null,
      });
      execution = this.judgeExecutions.bindOperation(execution.id, operation.id, this.safeNow());
    }

    if (signal?.aborted) return this.finishSignalAbort(execution, operation, null, signal, false);

    try {
      checkLease?.();
    } catch (error) {
      if ((signal?.aborted || isAIJobExecutionInterruption(error)) && !(error instanceof AIJobError && error.code === "AI_JOB_LEASE_LOST")) return this.finishSignalAbort(execution, operation, null, signal, false, error);
      if (error instanceof AIJobError && error.code === "AI_JOB_LEASE_LOST") {
        this.completeOperation(operation.id, "FAILED", this.safeNow());
        this.judgeExecutions.fail({
          id: execution.id,
          providerInvoked: false,
          safeFailureCode: "EVAL_JUDGE_LEASE_LOST",
          now: this.safeNow(),
        });
        throw error;
      }
      throw error;
    }

    // 5. Format prompt envelope
    const prompt = formatAIEvalJudgePrompt({
      subjectKey: suite.subjectKey,
      caseInput: caseRevision.inputText,
      targetOutput: outputText,
      targetStatus: caseResult.observedStatus,
      finishReason,
      evidencePack,
      judgeRequiredDimensions,
    });

    const promptBytes = Buffer.byteLength(prompt.systemPrompt, "utf8") + Buffer.byteLength(prompt.userPrompt, "utf8");

    // 6. Preflight cost estimation
    let calculation;
    try {
      const rateCard = this.rateCards.resolve({
        modelConfigId: judgeConfig.modelConfigId,
        modelConfigRevision: judgeConfig.modelConfigRevision,
        at: this.safeNow(),
      });
      const inputTokens = Math.max(1, Math.ceil(promptBytes / 1));
      calculation = this.calculator.calculate(rateCard, {
        standardInputTokens: inputTokens,
        cacheHitInputTokens: 0,
        cacheMissInputTokens: 0,
        outputTokens: judgeConfig.maxOutputTokens,
        reasoningTokens: 0,
        requestUnits: 1,
      });
      if (calculation.completeness !== "COMPLETE") {
        throw new AIEvalError("AI_EVAL_JUDGE_COST_UNKNOWN", "Judge Rate Card calculation is incomplete.");
      }
    } catch {
      this.completeOperation(operation.id, "FAILED", this.safeNow());
      return this.judgeExecutions.fail({
        id: execution.id,
        providerInvoked: false,
        safeFailureCode: "EVAL_JUDGE_COST_UNKNOWN",
        now: this.safeNow(),
      });
    }

    // 7. Request Admission
    let reservationId = execution.budgetReservationId;
    if (!reservationId) {
      try {
        const period = await this.budgetPeriodResolver.resolve({
          principalRef: AI_EVALS_ADMISSION_PRINCIPAL_REF,
          budgetPolicyId: judgeConfig.budgetPolicyId,
          budgetPolicyRevision: judgeConfig.budgetPolicyRevision,
          at: this.safeNow(),
        });
        const estimate: AIAdmissionCostEstimate = {
          currency: calculation.currency,
          maxCostNano: calculation.knownCostNano,
          estimateBasis: `eval-judge:conservative-byte-upper-bound;model-rev-${judgeConfig.modelConfigRevision}`,
          modelConfigId: judgeConfig.modelConfigId,
          modelConfigRevision: judgeConfig.modelConfigRevision,
          rateCardId: calculation.rateCardId,
          rateCardRevision: calculation.rateCardRevision,
        };
        const base = {
          principalRef: AI_EVALS_ADMISSION_PRINCIPAL_REF,
          budgetPolicyId: judgeConfig.budgetPolicyId,
          budgetPolicyRevision: judgeConfig.budgetPolicyRevision,
          rateLimitPolicyId: judgeConfig.rateLimitPolicyId,
          rateLimitPolicyRevision: judgeConfig.rateLimitPolicyRevision,
          budgetPeriod: period,
          costOperationId: operation.id,
          costEstimate: estimate,
          idempotencyKey: `eval-judge:${run.id}:${caseRevision.caseId}:${caseRevision.revision}`,
        };
        const admission = this.admission.admit({
          ...base,
          requestFingerprint: createAIAdmissionRequestFingerprint(base),
        });
        reservationId = admission.reservation.id;
        execution = this.judgeExecutions.bindAdmission(execution.id, { judgeCostOperationId: operation.id, budgetReservationId: reservationId }, this.safeNow());
        this.admission.startExecution(reservationId, this.safeNow());
      } catch {
        this.completeOperation(operation.id, "FAILED", this.safeNow());
        return this.judgeExecutions.fail({
          id: execution.id,
          providerInvoked: false,
          safeFailureCode: "EVAL_JUDGE_ADMISSION_DENIED",
          now: this.safeNow(),
        });
      }
    }

    if (signal?.aborted) return this.finishSignalAbort(execution, operation, reservationId, signal, false);

    try {
      checkLease?.();
    } catch (error) {
      if ((signal?.aborted || isAIJobExecutionInterruption(error)) && !(error instanceof AIJobError && error.code === "AI_JOB_LEASE_LOST")) return this.finishSignalAbort(execution, operation, reservationId, signal, false, error);
      if (error instanceof AIJobError && error.code === "AI_JOB_LEASE_LOST") {
        this.completeOperation(operation.id, "FAILED", this.safeNow());
        this.settle(reservationId, this.safeNow());
        this.judgeExecutions.fail({
          id: execution.id,
          providerInvoked: false,
          safeFailureCode: "EVAL_JUDGE_LEASE_LOST",
          now: this.safeNow(),
        });
        throw error;
      }
      throw error;
    }

    // 8. Mark Running & Invoking
    execution = this.judgeExecutions.markRunning(execution.id, this.safeNow());
    execution = this.judgeExecutions.markInvoking(execution.id, this.safeNow());

    if (signal?.aborted) return this.finishSignalAbort(execution, operation, reservationId, signal, false);
    try {
      checkLease?.();
    } catch (error) {
      if ((signal?.aborted || isAIJobExecutionInterruption(error)) && !(error instanceof AIJobError && error.code === "AI_JOB_LEASE_LOST")) return this.finishSignalAbort(execution, operation, reservationId, signal, false, error);
      if (error instanceof AIJobError && error.code === "AI_JOB_LEASE_LOST") {
        this.completeOperation(operation.id, "FAILED", this.safeNow());
        this.settle(reservationId, this.safeNow());
        this.judgeExecutions.fail({
          id: execution.id,
          providerInvoked: false,
          safeFailureCode: "EVAL_JUDGE_LEASE_LOST",
          now: this.safeNow(),
        });
        throw error;
      }
      throw error;
    }

    // 9. Call Provider Gateway
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    let judgeOutput = "";
    const usage = new AIGenerationUsageAccumulator();
    let stream: ReturnType<AIProviderGateway["generate"]> | null = null;
    let gatewayError: unknown = null;

    try {
      const modelSelectionPlan = {
        capability: "GENERATION" as const,
        attempts: [judgeConfig.modelConfigId],
      };
      const request = {
        requestId: uuidv7(),
        instructions: prompt.systemPrompt,
        messages: [{ role: "user" as const, content: prompt.userPrompt }],
        maxOutputTokens: judgeConfig.maxOutputTokens,
        stream: true,
      };
      stream = this.gateway.generate(modelSelectionPlan, request, {
        signal: controller.signal,
        timeoutMs: judgeConfig.timeoutMs,
        expectedIdentity: {
          modelConfigId: judgeConfig.modelConfigId,
          modelConfigRevision: judgeConfig.modelConfigRevision,
          providerConfigId: judgeConfig.providerConfigId,
          providerConfigRevision: judgeConfig.providerConfigRevision,
          providerModelId: model.providerModelId,
          adapterKey: model.adapterKey,
        },
      });
      for await (const event of stream.events) {
        if (event.type === "TEXT_DELTA") {
          const next = judgeOutput + event.text;
          if (Buffer.byteLength(next, "utf8") > MAX_OUTPUT_BYTES) {
            controller.abort();
            throw new AIEvalError("AI_EVAL_JUDGE_INVALID", "The Eval judge output exceeded its bounded limit.");
          }
          judgeOutput = next;
        } else if (event.type === "USAGE") {
          usage.observe(event.usage);
        } else if (event.type === "COMPLETED" && (event as any).usage) {
          usage.observe((event as any).usage);
        }
      }
    } catch (error) {
      gatewayError = error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }

    const attempts = stream ? await stream.trace : [];
    const invoked = attempts.filter((attempt) => attempt.providerInvoked);
    const providerInvoked = invoked.length > 0;
    if (providerInvoked) {
      this.recordAttempts(operation.id, invoked, usage.snapshot());
      execution = this.judgeExecutions.markInvokedWithAccounting(execution.id, this.safeNow());
    }

    if (signal?.aborted) return this.finishSignalAbort(execution, operation, reservationId, signal, providerInvoked);
    let leaseLostAfterGateway = false;
    try {
      checkLease?.();
    } catch (error) {
      if ((signal?.aborted || isAIJobExecutionInterruption(error)) && !(error instanceof AIJobError && error.code === "AI_JOB_LEASE_LOST")) return this.finishSignalAbort(execution, operation, reservationId, signal, providerInvoked, error);
      if (error instanceof AIJobError && error.code === "AI_JOB_LEASE_LOST") {
        leaseLostAfterGateway = true;
      } else {
        throw error;
      }
    }

    if (leaseLostAfterGateway) {
      this.completeOperation(operation.id, "FAILED", this.safeNow());
      this.settle(reservationId, this.safeNow());
      if (providerInvoked) {
        this.judgeExecutions.ambiguous({
          id: execution.id,
          safeFailureCode: "EVAL_JUDGE_PROVIDER_AMBIGUOUS",
          now: this.safeNow(),
        });
      } else {
        this.judgeExecutions.fail({
          id: execution.id,
          providerInvoked: false,
          safeFailureCode: "EVAL_JUDGE_LEASE_LOST",
          now: this.safeNow(),
        });
      }
      throw new AIJobError("AI_JOB_LEASE_LOST", "The Job lease was lost during Judge execution.");
    }

    const outputSha256 = judgeOutput ? createHash("sha256").update(judgeOutput, "utf8").digest("hex") : null;
    const outputByteSize = judgeOutput ? Buffer.byteLength(judgeOutput, "utf8") : null;

    // 10. Handle Worker interruption before accepting any Judge output.
    if (signal?.aborted) return this.finishSignalAbort(execution, operation, reservationId, signal, providerInvoked);
    if (isAIProviderGatewayError(gatewayError) && gatewayError.code === "CANCELLED") {
      this.completeOperation(operation.id, "CANCELLED", this.safeNow());
      this.settle(reservationId, this.safeNow());
      return this.judgeExecutions.cancel({
        id: execution.id,
        providerInvoked,
        safeFailureCode: "EVAL_JUDGE_CANCELLED",
        now: this.safeNow(),
      });
    }

    if (gatewayError) {
      this.completeOperation(operation.id, "FAILED", this.safeNow());
      this.settle(reservationId, this.safeNow());
      const isAmbiguous = isAIProviderGatewayError(gatewayError) && providerInvoked && (gatewayError.code === "TIMEOUT" || gatewayError.code === "UNKNOWN");
      if (isAmbiguous) {
        return this.judgeExecutions.ambiguous({
          id: execution.id,
          safeFailureCode: "EVAL_JUDGE_PROVIDER_AMBIGUOUS",
          now: this.safeNow(),
        });
      }
      return this.judgeExecutions.fail({
        id: execution.id,
        providerInvoked,
        judgeOutputSha256: outputSha256,
        judgeOutputByteSize: outputByteSize,
        safeFailureCode: "EVAL_JUDGE_GATEWAY_ERROR",
        now: this.safeNow(),
      });
    }

    // 10.5. Proven Provider Invocation check (Finding 2)
    if (!providerInvoked || execution.providerInvocationState !== "INVOKED_WITH_ACCOUNTING" || !execution.judgeCostOperationId) {
      this.completeOperation(operation.id, "FAILED", this.safeNow());
      this.settle(reservationId, this.safeNow());
      return this.judgeExecutions.fail({
        id: execution.id,
        providerInvoked: false,
        judgeOutputSha256: outputSha256,
        judgeOutputByteSize: outputByteSize,
        safeFailureCode: "EVAL_JUDGE_PROVIDER_NOT_INVOKED",
        now: this.safeNow(),
      });
    }

    // 11. Parse strictly structured JSON output
    let parsedResponse;
    try {
      parsedResponse = parseAIEvalJudgeResponse(judgeOutput, judgeRequiredDimensions);
    } catch {
      this.completeOperation(operation.id, "FAILED", this.safeNow());
      this.settle(reservationId, this.safeNow());
      return this.judgeExecutions.fail({
        id: execution.id,
        providerInvoked,
        judgeOutputSha256: outputSha256,
        judgeOutputByteSize: outputByteSize,
        safeFailureCode: "EVAL_JUDGE_OUTPUT_MALFORMED",
        now: this.safeNow(),
      });
    }

    // 12. Insert structured Judge Results
    const completedNow = this.safeNow();
    try {
      for (const score of parsedResponse.scores) {
        this.runs.insertJudgeResult({
          judgeExecutionId: execution.id,
          caseResultId: caseResult.id,
          runId: run.id,
          caseId: caseRevision.caseId,
          caseRevision: caseRevision.revision,
          dimension: score.dimension,
          judgeConfigId: judgeConfig.judgeConfigId,
          judgeConfigRevision: judgeConfig.revision,
          protocolKey: judgeConfig.protocolKey,
          protocolRevision: judgeConfig.protocolRevision,
          judgeModelConfigId: judgeConfig.modelConfigId,
          judgeModelConfigRevision: judgeConfig.modelConfigRevision,
          judgeProviderConfigId: judgeConfig.providerConfigId,
          judgeProviderConfigRevision: judgeConfig.providerConfigRevision,
          scoreUnits: score.scoreUnits,
          rubricBand: score.rubricBand,
          safeReasonCode: "JUDGE_EVALUATED",
          createdAt: completedNow,
        });
      }
    } catch {
      this.completeOperation(operation.id, "FAILED", completedNow);
      this.settle(reservationId, completedNow);
      return this.judgeExecutions.fail({
        id: execution.id,
        providerInvoked,
        judgeOutputSha256: outputSha256,
        judgeOutputByteSize: outputByteSize,
        safeFailureCode: "EVAL_JUDGE_RESULT_INSERT_FAILED",
        now: completedNow,
      });
    }

    this.completeOperation(operation.id, "COMPLETED", completedNow);
    this.settle(reservationId, completedNow);
    const latencyMs = execution.startedAt ? completedNow - execution.startedAt : 0;
    return this.judgeExecutions.complete({
      id: execution.id,
      providerInvoked,
      judgeOutputSha256: outputSha256 ?? createHash("sha256").update("", "utf8").digest("hex"),
      judgeOutputByteSize: outputByteSize ?? 0,
      latencyMs,
      now: completedNow,
    });
  }

  private finishSignalAbort(
    execution: AIEvalJudgeExecution,
    operation: AICostOperation | null,
    reservationId: string | null,
    signal: AbortSignal | undefined,
    providerMayHaveInvoked: boolean,
    interruption?: unknown,
  ): AIEvalJudgeExecution {
    const now = this.safeNow();
    const providerInvoked = providerMayHaveInvoked
      || execution.providerInvoked
      || execution.providerInvocationState === "INVOKED_WITH_ACCOUNTING"
      || Boolean(operation && this.accounting.listUsageCostRecords(operation.id).length > 0);
    const reason = signal?.reason;
    const leaseLost = reason === "AI_JOB_LEASE_LOST";
    const timedOut = reason === "AI_JOB_TIMEOUT" || (interruption instanceof AIJobExecutionError && interruption.safeErrorCode === "AI_JOB_TIMEOUT");

    if (operation) this.completeOperation(operation.id, providerInvoked || timedOut || leaseLost ? "FAILED" : "CANCELLED", now);
    this.settle(reservationId, now);

    if (providerInvoked) {
      const result = this.judgeExecutions.ambiguous({
        id: execution.id,
        safeFailureCode: "EVAL_JUDGE_PROVIDER_AMBIGUOUS",
        now,
      });
      if (leaseLost) throw new AIJobError("AI_JOB_LEASE_LOST", "The Job lease was lost during Judge execution.");
      return result;
    }

    if (leaseLost) {
      this.judgeExecutions.fail({
        id: execution.id,
        providerInvoked: false,
        safeFailureCode: "EVAL_JUDGE_LEASE_LOST",
        now,
      });
      throw new AIJobError("AI_JOB_LEASE_LOST", "The Job lease was lost before Judge Provider execution.");
    }

    if (timedOut) {
      return this.judgeExecutions.fail({
        id: execution.id,
        providerInvoked: false,
        safeFailureCode: "EVAL_JUDGE_TIMEOUT",
        now,
      });
    }

    return this.judgeExecutions.cancel({
      id: execution.id,
      providerInvoked: false,
      safeFailureCode: "EVAL_JUDGE_CANCELLED",
      now,
    });
  }

  private recordAttempts(operationId: string, attempts: readonly AIProviderAttemptTrace[], usage: NormalizedProviderUsage): void {
    for (const attempt of attempts) {
      this.accounting.recordAttempt({
        operationId,
        attempt,
        normalizedUsage: usage,
        capability: attempt.capability,
        providerModelId: attempt.providerModelId ?? "unknown",
        at: attempt.startedAt,
        latencyMs: attempt.latencyMs,
      });
    }
  }

  private completeOperation(id: string, status: "COMPLETED" | "FAILED" | "CANCELLED", at = this.safeNow()): void {
    const current = this.accounting.getOperation(id);
    if (current?.status === "OPEN") {
      this.accounting.completeOperation(id, "OPEN", status, at);
    }
  }

  private settle(id: string | null, at = this.safeNow()): "SETTLED" | "RECONCILIATION_REQUIRED" | "RELEASED" | null {
    if (!id) return null;
    const reservation = this.admission.getReservation(id);
    if (!reservation) return null;
    if (reservation.status === "RESERVED") {
      this.admission.releaseBeforeExecution(id, at);
      return "RELEASED";
    }
    return this.admission.settle(id, at).status;
  }

  private safeNow(): number {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) {
      throw new AIEvalError("AI_EVAL_JUDGE_INVALID", "The Eval judge timestamp is invalid.");
    }
    return value;
  }
}
