import { AIAdmissionError, createAIAdmissionRequestFingerprint } from "../../admission";
import type { AIAdmissionPlan, AIAdmissionResult } from "../../admission";
import { AIConversationError, AI_CONVERSATION_MAX_CHUNK_BYTES, AI_CONVERSATION_MAX_RESPONSE_BYTES, hashConversationText, type AIConversationFinishReason, type AIConversationResponse, type AIConversationStatus } from "../../conversations";
import { AIContextError } from "../../context/errors";
import { AIPolicyError } from "../../policy/errors";
import { AIProviderGatewayError, isAIProviderGatewayError, type AIProviderAttemptTrace } from "../../gateway";
import { AIGenerationUsageAccumulator } from "../../economics";
import { AIAccountingError, type AICostOperation } from "../../economics";
import { AIHybridRetrievalError, type AIEvidencePack, type AIHybridRetrievalTrace } from "../../retrieval";
import { AITutorConfigError } from "../configuration/errors";
import { AI_TUTOR_CITATION_PROTOCOL_KEY, AI_TUTOR_CITATION_PROTOCOL_REVISION, AI_TUTOR_GROUNDING_PROTOCOL_KEY, AI_TUTOR_GROUNDING_PROTOCOL_REVISION } from "../configuration";
import { AITutorPlanningError } from "../planner/errors";
import { AITutorPreflightError } from "../preflight/errors";
import { createEmptyTraceIdentity } from "../trace";
import type { AITutorResponseTrace, AITutorTraceCreateInput, AITutorTraceEvidenceRefCreate, AITutorTraceProjectionRefCreate } from "../trace";
import { AITutorOutputValidator } from "../validation";
import type { AITutorGenerationPlan, AITutorPreflightPlan } from "../preflight/contracts";
import type {
  AITutorExecutionAdmissionContext,
  AITutorExecutionDependencies,
  AITutorExecutionInput,
  AITutorExecutionResult,
  AITutorExecutionSettlementStatus,
  AITutorExecutionStatus,
} from "./contracts";
import { AITutorExecutionError } from "./errors";
import { AIMemoryService } from "../../memory";
import { parseAIMemoryCommand, type AIMemoryCommand } from "../../memory/command";

const MAX_SAFE_TIMESTAMP = 8_640_000_000_000_000;
const OPERATION_IDEMPOTENCY_VERSION = 1;

/**
 * M8B/M8C own one server-side execution boundary. It never accepts a caller
 * supplied prompt, EvidencePack, model, Provider, policy, operation, or
 * reservation. All of those are resolved or created from the Response and
 * governed configuration inside this service.
 */
export class AITutorExecutionService {
  private readonly clock: () => number;
  private readonly outputValidator: Pick<AITutorOutputValidator, "validate">;
  private readonly memory: AIMemoryService;

  constructor(private readonly dependencies: AITutorExecutionDependencies) {
    this.clock = dependencies.clock ?? Date.now;
    this.outputValidator = dependencies.outputValidator ?? new AITutorOutputValidator();
    this.memory = dependencies.memory ?? new AIMemoryService(dependencies.database);
    validateEstimator(dependencies.estimator);
  }

  async execute(input: AITutorExecutionInput): Promise<AITutorExecutionResult> {
    validateExecutionInput(input);
    this.memory.recoverPendingMutationIntents({ limit: 100, now: this.safeNow() });
    const replay = this.replayExistingExecution(input);
    if (replay) return replay;
    const linked = createLinkedAbortController(input.signal);
    try {
      if (linked.signal.aborted) throw new AITutorExecutionError("AI_TUTOR_EXECUTION_CANCELLED", "The Tutor execution was cancelled.");

      const plan = this.buildPreflight(input);
      const operationContext = await this.openOperation(plan);
      const admissionContext = await this.admit(plan, operationContext.operation);

      // A replayed admission already has an operational owner. Re-running
      // the whole retrieval/Generation path could invoke a Provider twice;
      // M8B fails closed and leaves recovery to the durable operations layer.
      if (admissionContext.admission.replayed) {
        throw new AITutorExecutionError("AI_TUTOR_EXECUTION_OPERATION_CONFLICT", "The Tutor request is already executing.");
      }

      if (linked.signal.aborted) {
        return this.cancelBeforeExecution(plan, admissionContext);
      }

      let reservation: ReturnType<AITutorExecutionDependencies["admission"]["startExecution"]>;
      try {
        reservation = this.dependencies.admission.startExecution(admissionContext.admission.reservation.id, this.safeNow());
      } catch (error) {
        await this.failOperationWithoutProvider(operationContext.operation, admissionContext.admission.reservation.id);
        throw executionError("AI_TUTOR_EXECUTION_OPERATION_CONFLICT", "The Tutor Budget Reservation could not enter execution safely.", error);
      }

      let evidencePack: AIEvidencePack;
      try {
        evidencePack = await this.dependencies.retrieval.retrieve({
          requestId: plan.responseId,
          subjectKey: plan.subjectKey,
          query: plan.contextPlan.currentMessage.content,
          retrievalConfigId: plan.retrievalConfigId,
          retrievalConfigRevision: plan.retrievalConfigRevision,
          providerExecutionContext: {
            costOperationId: operationContext.operation.id,
            budgetReservationId: reservation.id,
            signal: linked.signal,
          },
        });
      } catch (error) {
        const cancelled = linked.signal.aborted || isCancelledError(error);
        const trace = this.createTrace(plan, operationContext.operation.id, reservation.id, [], [], this.safeNow());
        this.transitionTrace(trace, cancelled ? "CANCELLED" : "FAILED", this.safeNow());
        this.terminalizeConversation(plan.principal, plan.responseId, cancelled ? "CANCELLED" : "FAILED");
        const settlement = this.closeOperationAndSettle(operationContext.operation.id, reservation.id, cancelled ? "CANCELLED" : "FAILED");
        return this.result(plan, cancelled ? "CANCELLED" : "FAILED", cancelled ? "CANCELLED" : "FAILED", trace.id, operationContext.operation.id, reservation.id, settlement, plan.conversationId);
      }

      if (linked.signal.aborted) {
        return this.finishCancelledAfterAdmission(plan, operationContext.operation, reservation.id, evidencePack.trace);
      }

      if (evidencePack.status !== "SUFFICIENT" || !evidencePack.sufficient) {
        return this.finishBlocked(plan, operationContext.operation, reservation.id, evidencePack.trace);
      }

      let generationPlan: AITutorGenerationPlan;
      try {
        generationPlan = this.dependencies.planner.plan(plan, evidencePack);
      } catch (error) {
        const trace = this.createTrace(plan, operationContext.operation.id, reservation.id, projectionRefsFromRetrievalTrace(evidencePack.trace), [], this.safeNow());
        this.startAndCompleteEmpty(plan);
        this.transitionTrace(trace, "BLOCKED", this.safeNow());
        const settlement = this.closeOperationAndSettle(operationContext.operation.id, reservation.id, "COMPLETED");
        return this.result(plan, "BLOCKED", "OTHER", trace.id, operationContext.operation.id, reservation.id, settlement, plan.conversationId);
      }

      try {
        this.dependencies.retrieval.assertEvidencePackCurrent(evidencePack);
        this.assertRuntimePlanCurrent(plan, "PENDING");
      } catch (error) {
        return this.finishBlocked(plan, operationContext.operation, reservation.id, evidencePack.trace, "CONFIGURATION_CHANGED");
      }

      const trace = this.createTrace(
        plan,
        operationContext.operation.id,
        reservation.id,
        projectionRefsFromGenerationPlan(generationPlan),
        evidenceRefsFromGenerationPlan(generationPlan),
        this.safeNow(),
      );

      let activeTrace = trace;
      try {
        this.dependencies.conversations.startResponse(plan.principal, plan.responseId);
        activeTrace = this.dependencies.traces.transition({
          id: trace.id,
          expectedStatus: "PLANNED",
          status: "STREAMING",
          updatedAt: this.safeNow(),
          completedAt: null,
          safeErrorCode: null,
        });
        this.dependencies.retrieval.assertEvidencePackCurrent(evidencePack);
        this.assertRuntimePlanCurrent(plan, "STREAMING");
        this.assertOperationExecution(operationContext.operation.id, reservation.id);
      } catch (error) {
        const cancelled = linked.signal.aborted || isCancelledError(error);
        this.terminalizeConversation(plan.principal, plan.responseId, cancelled ? "CANCELLED" : "FAILED");
        this.transitionTrace(activeTrace, cancelled ? "CANCELLED" : "FAILED", this.safeNow());
        const settlement = this.closeOperationAndSettle(operationContext.operation.id, reservation.id, cancelled ? "CANCELLED" : "FAILED");
        return this.result(plan, cancelled ? "CANCELLED" : "FAILED", cancelled ? "CANCELLED" : "FAILED", trace.id, operationContext.operation.id, reservation.id, settlement, plan.conversationId);
      }

      const result = await this.runGeneration(plan, generationPlan, evidencePack, activeTrace, operationContext.operation, reservation.id, linked);
      return result;
    } catch (error) {
      if (error instanceof AITutorExecutionError) throw error;
      throw mapExecutionError(error);
    } finally {
      linked.cleanup();
    }
  }

  run(input: AITutorExecutionInput): Promise<AITutorExecutionResult> {
    return this.execute(input);
  }

  private replayExistingExecution(input: AITutorExecutionInput): AITutorExecutionResult | null {
    const operation = this.dependencies.accounting.getOperationByResponseId(input.responseId);
    if (!operation) return null;

    let response: AIConversationResponse;
    try {
      response = this.dependencies.conversations.getResponse(input.principal, input.responseId);
    } catch (error) {
      if (error instanceof AIConversationError) return null;
      throw error;
    }
    if (response.principalRef !== input.principal.principalRef) throw replayConflict();

    if (operation.status === "OPEN") throw replayConflict();
    if (!["COMPLETED", "FAILED", "CANCELLED"].includes(operation.status)) throw replayConflict();

    const conversation = this.requireReplayConversation(input.principal, response.conversationId);
    if (
      operation.costCenter !== "STUDENT_GENERATION"
      || operation.opaquePrincipalRef !== response.principalRef
      || operation.subjectKey !== conversation.subjectKey
      || operation.conversationId !== response.conversationId
      || operation.responseId !== response.id
      || typeof operation.idempotencyKey !== "string"
      || !operation.idempotencyKey.startsWith(`tutor-generation:${OPERATION_IDEMPOTENCY_VERSION}:${response.id}:`)
      || operation.jobId !== null
      || operation.evalRunId !== null
      || operation.knowledgeRevision !== null
    ) throw replayConflict();

    const trace = this.dependencies.traces.getByResponse(response.id);
    const reservation = this.dependencies.admission.getReservationByOperationId(operation.id);
    if (reservation && (
      reservation.operationId !== operation.id
      || reservation.principalRef !== response.principalRef
      || !["SETTLED", "RECONCILIATION_REQUIRED", "RELEASED"].includes(reservation.status)
    )) throw replayConflict();
    if (trace && (
      trace.responseId !== response.id
      || trace.conversationId !== response.conversationId
      || trace.principalRef !== response.principalRef
      || trace.subjectKey !== conversation.subjectKey
      || trace.tutorConfigId !== input.tutorConfigId
      || trace.costOperationId !== operation.id
      || !reservation
      || trace.budgetReservationId !== reservation.id
    )) throw replayConflict();

    if (response.status === "COMPLETED") {
      if (operation.status !== "COMPLETED" || !response.finishReason || ["FAILED", "CANCELLED"].includes(response.finishReason) || !trace || !["COMPLETED", "BLOCKED"].includes(trace.status) || !reservation || !["SETTLED", "RECONCILIATION_REQUIRED"].includes(reservation.status)) throw replayConflict();
      const status = trace.status === "BLOCKED" ? "BLOCKED" : "COMPLETED";
      return {
        responseId: response.id,
        status,
        conversationStatus: conversation.status,
        finishReason: response.finishReason,
        traceId: trace.id,
        costOperationId: operation.id,
        budgetReservationId: reservation.id,
        settlementStatus: reservation.status === "SETTLED" ? "SETTLED" : "RECONCILIATION_REQUIRED",
      };
    }
    if (response.status === "FAILED") {
      if (operation.status !== "FAILED" || response.finishReason !== "FAILED" || !trace || trace.status !== "FAILED" || !reservation || !["SETTLED", "RECONCILIATION_REQUIRED"].includes(reservation.status)) throw replayConflict();
      return {
        responseId: response.id,
        status: "FAILED",
        conversationStatus: conversation.status,
        finishReason: response.finishReason,
        traceId: trace.id,
        costOperationId: operation.id,
        budgetReservationId: reservation.id,
        settlementStatus: reservation.status === "SETTLED" ? "SETTLED" : "RECONCILIATION_REQUIRED",
      };
    }
    if (response.status === "CANCELLED") {
      if (operation.status !== "CANCELLED" || response.finishReason !== "CANCELLED" || (trace && trace.status !== "CANCELLED")) throw replayConflict();
      return {
        responseId: response.id,
        status: "CANCELLED",
        conversationStatus: conversation.status,
        finishReason: response.finishReason,
        traceId: trace?.id ?? null,
        costOperationId: operation.id,
        budgetReservationId: reservation?.id ?? null,
        settlementStatus: reservation?.status === "SETTLED" ? "SETTLED" : reservation?.status === "RECONCILIATION_REQUIRED" ? "RECONCILIATION_REQUIRED" : reservation?.status === "RELEASED" ? "RELEASED" : null,
      };
    }
    throw replayConflict();
  }

  private requireReplayConversation(principal: AITutorPreflightPlan["principal"], conversationId: string) {
    try {
      const conversation = this.dependencies.conversations.getConversation(principal, conversationId);
      if (conversation.status !== "ACTIVE") throw replayConflict();
      return conversation;
    } catch (error) {
      if (error instanceof AITutorExecutionError) throw error;
      throw replayConflict();
    }
  }

  private buildPreflight(input: AITutorExecutionInput): AITutorPreflightPlan {
    try {
      return this.dependencies.preflight.preflight({
        principal: input.principal,
        responseId: input.responseId,
        tutorConfigId: input.tutorConfigId,
        estimator: this.dependencies.estimator,
      });
    } catch (error) {
      throw executionError("AI_TUTOR_EXECUTION_PREFLIGHT_FAILED", "The Tutor preflight validation failed safely.", error);
    }
  }

  private async openOperation(plan: AITutorPreflightPlan): Promise<{ operation: AICostOperation; created: boolean }> {
    const now = this.safeNow();
    const idempotencyKey = operationIdempotencyKey(plan);
    return this.dependencies.database.client.transaction(() => {
      const existing = this.dependencies.accounting.getOperationByResponseId(plan.responseId);
      if (existing) {
        assertOperationMatchesPlan(existing, plan, idempotencyKey);
        if (existing.status !== "OPEN") {
          throw new AITutorExecutionError("AI_TUTOR_EXECUTION_OPERATION_CONFLICT", "The Tutor Cost Operation is already terminal.");
        }
        return { operation: existing, created: false };
      }
      const keyOwner = this.dependencies.accounting.getOperationByIdempotencyKey(idempotencyKey);
      if (keyOwner) {
        assertOperationMatchesPlan(keyOwner, plan, idempotencyKey);
        if (keyOwner.status !== "OPEN") throw new AITutorExecutionError("AI_TUTOR_EXECUTION_OPERATION_CONFLICT", "The Tutor idempotency identity is already terminal.");
        return { operation: keyOwner, created: false };
      }
      return {
        operation: this.dependencies.accounting.createOperation({
          costCenter: "STUDENT_GENERATION",
          idempotencyKey,
          opaquePrincipalRef: plan.principalRef,
          subjectKey: plan.subjectKey,
          conversationId: plan.conversationId,
          responseId: plan.responseId,
          jobId: null,
          evalRunId: null,
          knowledgeRevision: null,
          status: "OPEN",
          startedAt: now,
          completedAt: null,
        }),
        created: true,
      };
    }).immediate();
  }

  private async admit(plan: AITutorPreflightPlan, operation: AICostOperation): Promise<AITutorExecutionAdmissionContext> {
    // The billing period is resolved at the operation's server timestamp so a
    // period-boundary clock tick cannot make the operation fall outside its
    // own admission window.
    const at = operation.startedAt;
    let period: { startAt: number; endAt: number };
    try {
      period = await this.dependencies.budgetPeriodResolver.resolve({
        principalRef: plan.principalRef,
        budgetPolicyId: plan.budgetPolicyId,
        budgetPolicyRevision: plan.budgetPolicyRevision,
        at,
      });
      validatePeriod(period);
    } catch (error) {
      await this.failOpenOperation(operation);
      throw executionError("AI_TUTOR_EXECUTION_ADMISSION_DENIED", "The Tutor Budget period could not be resolved safely.", error);
    }
    const basePlan: Omit<AIAdmissionPlan, "requestFingerprint"> = {
      principalRef: plan.principalRef,
      budgetPolicyId: plan.budgetPolicyId,
      budgetPolicyRevision: plan.budgetPolicyRevision,
      rateLimitPolicyId: plan.rateLimitPolicyId,
      rateLimitPolicyRevision: plan.rateLimitPolicyRevision,
      budgetPeriod: period,
      costOperationId: operation.id,
      costEstimate: {
        currency: plan.costEstimate.currency,
        maxCostNano: plan.costEstimate.maxCostNano,
        estimateBasis: plan.costEstimate.estimateBasis,
        modelConfigId: plan.costEstimate.generation.modelConfigId,
        modelConfigRevision: plan.costEstimate.generation.modelConfigRevision,
        rateCardId: plan.costEstimate.generation.rateCardId,
        rateCardRevision: plan.costEstimate.generation.rateCardRevision,
      },
      idempotencyKey: operation.idempotencyKey ?? operationIdempotencyKey(plan),
    };
    const admissionPlan: AIAdmissionPlan = {
      ...basePlan,
      requestFingerprint: createAIAdmissionRequestFingerprint(basePlan),
    };
    try {
      const admission = this.dependencies.admission.admit(admissionPlan);
      return { operation, admission, period, requestFingerprint: admissionPlan.requestFingerprint };
    } catch (error) {
      await this.failOpenOperation(operation);
      if (error instanceof AIAdmissionError) {
        throw new AITutorExecutionError("AI_TUTOR_EXECUTION_ADMISSION_DENIED", "The Tutor request was not admitted for execution.", { admissionCode: error.code }, error);
      }
      throw executionError("AI_TUTOR_EXECUTION_ADMISSION_DENIED", "The Tutor request was not admitted for execution.", error);
    }
  }

  private async runGeneration(
    plan: AITutorPreflightPlan,
    generationPlan: AITutorGenerationPlan,
    evidencePack: AIEvidencePack,
    trace: AITutorResponseTrace,
    operation: AICostOperation,
    reservationId: string,
    linked: LinkedAbortController,
  ): Promise<AITutorExecutionResult> {
    const usage = new AIGenerationUsageAccumulator();
    let stream: ReturnType<AITutorExecutionDependencies["gateway"]["generate"]> | null = null;
    let attempts: readonly AIProviderAttemptTrace[] = [];
    let finishReason: AIConversationFinishReason | null = null;
    let overflow = false;
    let providerError: unknown = null;
    let memoryCommand: AIMemoryCommand | null = null;
    let responseBytes = this.safeResponseBytes(plan.principal, plan.responseId);
    let nextSequence = this.safeResponseSequence(plan.principal, plan.responseId);

    try {
      stream = this.dependencies.gateway.generate(
        generationPlan.modelSelectionPlan,
        generationPlan.request,
        {
          signal: linked.signal,
          expectedIdentity: {
            modelConfigId: plan.generationModelConfigId,
            modelConfigRevision: plan.generationModelConfigRevision,
            providerConfigId: plan.generationProviderConfigId,
            providerConfigRevision: plan.generationProviderConfigRevision,
            providerModelId: plan.providerModelId,
            adapterKey: plan.adapterKey,
          },
        },
      );
      for await (const event of stream.events) {
        if (linked.signal.aborted) throw new AITutorExecutionError("AI_TUTOR_EXECUTION_CANCELLED", "The Tutor execution was cancelled.");
        const responseState = this.readResponseExecutionState(plan);
        if (responseState === "CANCELLED" || responseState === "MISSING") {
          linked.controller.abort();
          throw new AITutorExecutionError("AI_TUTOR_EXECUTION_CANCELLED", "The Tutor execution was cancelled.");
        }
        if (responseState !== "STREAMING") throw new AITutorExecutionError("AI_TUTOR_EXECUTION_CONFIGURATION_CHANGED", "The Tutor Response changed during execution.");
        if (event.type === "USAGE") {
          usage.observe(event.usage);
        } else if (event.type === "MEMORY_COMMAND") {
          memoryCommand = parseAIMemoryCommand(event.command);
        } else if (event.type === "TEXT_DELTA") {
          for (const piece of splitUtf8(event.text, AI_CONVERSATION_MAX_CHUNK_BYTES)) {
            const pieceResponseState = this.readResponseExecutionState(plan);
            if (pieceResponseState === "CANCELLED" || pieceResponseState === "MISSING") {
              linked.controller.abort();
              throw new AITutorExecutionError("AI_TUTOR_EXECUTION_CANCELLED", "The Tutor execution was cancelled.");
            }
            if (pieceResponseState !== "STREAMING") throw new AITutorExecutionError("AI_TUTOR_EXECUTION_CONFIGURATION_CHANGED", "The Tutor Response changed during execution.");
            const bytes = Buffer.byteLength(piece, "utf8");
            if (responseBytes + bytes > AI_CONVERSATION_MAX_RESPONSE_BYTES) {
              overflow = true;
              linked.controller.abort();
              throw new AITutorExecutionError("AI_TUTOR_EXECUTION_RESPONSE_LIMIT", "The Tutor response exceeded its bounded output limit.");
            }
            const appended = this.dependencies.conversations.appendResponseChunk(plan.principal, plan.responseId, nextSequence, piece);
            responseBytes = appended.response.outputBytes;
            nextSequence = appended.response.nextChunkSequence;
          }
        } else if (event.type === "COMPLETED") {
          usage.observe(event.usage);
          finishReason = event.finishReason;
        }
      }
    } catch (error) {
      providerError = error;
    } finally {
      if (stream) {
        try {
          attempts = await stream.trace;
        } catch {
          attempts = [];
        }
      }
    }

    const invokedAttempts = attempts.filter((attempt) => attempt.providerInvoked);
    const providerInvoked = invokedAttempts.length > 0;
    if (providerInvoked) {
      try {
        for (const attempt of invokedAttempts) {
          this.dependencies.accounting.recordAttempt({
            operationId: operation.id,
            attempt,
            normalizedUsage: usage.snapshot(),
            capability: attempt.capability,
            providerModelId: attempt.providerModelId ?? plan.providerModelId,
            at: attempt.startedAt,
            latencyMs: attempt.latencyMs,
          });
        }
      } catch (error) {
        providerError = providerError ?? error;
      }
    }

    const responseStateAfterStream = this.readResponseExecutionState(plan);
    if (responseStateAfterStream === "CANCELLED" || responseStateAfterStream === "MISSING") linked.controller.abort();
    const cancelled = linked.signal.aborted && !overflow
      || isCancelledError(providerError)
      || responseStateAfterStream === "CANCELLED"
      || responseStateAfterStream === "MISSING";
    const successful = !providerError && !cancelled && finishReason !== null && providerInvoked && !overflow;
    if (successful) {
      try {
        this.dependencies.retrieval.assertEvidencePackCurrent(evidencePack);
        this.assertRuntimePlanCurrent(plan, "STREAMING");
        this.assertOperationExecution(operation.id, reservationId);
        const outputText = this.reconstructResponseOutput(plan);
        const validation = this.outputValidator.validate({
          outputText,
          citationMap: generationPlan.citationMap,
          finishReason: finishReason!,
          groundingProtocolKey: generationPlan.groundingProtocolKey,
          groundingProtocolRevision: generationPlan.groundingProtocolRevision,
          citationProtocolKey: generationPlan.citationProtocolKey,
          citationProtocolRevision: generationPlan.citationProtocolRevision,
        });
        if (validation.status !== "VALID") throw new AITutorExecutionError("AI_TUTOR_EXECUTION_OUTPUT_INVALID", "The Tutor output did not pass grounded response validation.");
        const mutationCommandId = memoryCommand ? this.prepareMemoryIntent(plan, memoryCommand) : null;
        try {
          this.dependencies.conversations.completeResponse(plan.principal, plan.responseId, finishReason!);
        } catch (error) {
          if (mutationCommandId) this.cancelMemoryIntent(mutationCommandId);
          throw error;
        }
        if (mutationCommandId) {
          try {
            this.memory.applyMutationIntent(mutationCommandId, this.safeNow());
          } catch {
            // The Tutor response remains canonical; invalid/stale Memory intent
            // is already scrubbed/terminalized by the mutation boundary.
          }
        }
        this.transitionTrace(trace, "COMPLETED", this.safeNow());
        const settlement = this.closeOperationAndSettle(operation.id, reservationId, "COMPLETED");
        return this.result(plan, "COMPLETED", finishReason, trace.id, operation.id, reservationId, settlement, plan.conversationId);
      } catch (error) {
        providerError = error;
      }
    }

    const responseStateBeforeTerminalization = this.readResponseExecutionState(plan);
    const terminalCancelled = cancelled
      || linked.signal.aborted && !overflow
      || responseStateBeforeTerminalization === "CANCELLED"
      || responseStateBeforeTerminalization === "MISSING";
    const status: AITutorExecutionStatus = terminalCancelled ? "CANCELLED" : "FAILED";
    this.terminalizeConversation(plan.principal, plan.responseId, status);
    this.transitionTrace(trace, status, this.safeNow());
    const settlement = this.closeOperationAndSettle(operation.id, reservationId, terminalCancelled ? "CANCELLED" : "FAILED");
    return this.result(plan, status, terminalCancelled ? "CANCELLED" : "FAILED", trace.id, operation.id, reservationId, settlement, plan.conversationId);
  }

  private finishBlocked(
    plan: AITutorPreflightPlan,
    operation: AICostOperation,
    reservationId: string,
    retrievalTrace: AIHybridRetrievalTrace,
    reason = "RETRIEVAL_INSUFFICIENT",
  ): AITutorExecutionResult {
    const trace = this.createTrace(plan, operation.id, reservationId, projectionRefsFromRetrievalTrace(retrievalTrace), [], this.safeNow());
    this.startAndCompleteEmpty(plan);
    this.transitionTrace(trace, "BLOCKED", this.safeNow());
    const settlement = this.closeOperationAndSettle(operation.id, reservationId, "COMPLETED");
    void reason;
    return this.result(plan, "BLOCKED", "OTHER", trace.id, operation.id, reservationId, settlement, plan.conversationId);
  }

  private prepareMemoryIntent(plan: AITutorPreflightPlan, command: AIMemoryCommand): string | null {
    if (command.action === "NOOP") return null;
    const commandId = `tutor-memory-command-v1:${plan.responseId}`;
    const existing = this.memory.getMutationIntent(commandId);
    if (existing) {
      if (existing.responseId !== plan.responseId || existing.conversationId !== plan.conversationId || existing.principalRef !== plan.principalRef) throw new AITutorExecutionError("AI_TUTOR_EXECUTION_OPERATION_CONFLICT", "The Tutor Memory command identity is inconsistent.");
      if (["FAILED", "CANCELLED"].includes(existing.status)) throw new AITutorExecutionError("AI_TUTOR_EXECUTION_OPERATION_CONFLICT", "The Tutor Memory command is already terminal.");
      return commandId;
    }
    const action = command.action === "ADD_EVIDENCE" || command.action === "ACTIVATE" ? "UPDATE" as const : command.action;
    const origin = command.action === "ACTIVATE" ? "INFERRED" as const : command.origin;
    this.memory.createMutationIntent({
      commandId,
      principal: plan.principal,
      responseId: plan.responseId,
      conversationId: plan.conversationId,
      scope: command.scope,
      subjectKey: command.subjectKey,
      action,
      memoryId: command.memoryId,
      expectedRevision: command.expectedRevision,
      kind: command.action === "ADD_EVIDENCE" || command.action === "ACTIVATE" ? null : command.kind,
      origin,
      confidenceUnits: command.action === "ADD_EVIDENCE" || command.action === "ACTIVATE" ? null : command.confidenceUnits,
      memoryText: command.action === "CREATE" || command.action === "UPDATE" ? command.memoryText : null,
      createdAt: this.safeNow(),
    });
    return commandId;
  }

  private cancelMemoryIntent(commandId: string): void {
    try { this.memory.cancelMutationIntent(commandId, this.safeNow()); } catch { /* preserve the response terminal truth */ }
  }

  private finishCancelledAfterAdmission(
    plan: AITutorPreflightPlan,
    operation: AICostOperation,
    reservationId: string,
    retrievalTrace: AIHybridRetrievalTrace,
  ): AITutorExecutionResult {
    const trace = this.createTrace(plan, operation.id, reservationId, projectionRefsFromRetrievalTrace(retrievalTrace), [], this.safeNow());
    this.terminalizeConversation(plan.principal, plan.responseId, "CANCELLED");
    this.transitionTrace(trace, "CANCELLED", this.safeNow());
    const settlement = this.closeOperationAndSettle(operation.id, reservationId, "CANCELLED");
    return this.result(plan, "CANCELLED", "CANCELLED", trace.id, operation.id, reservationId, settlement, plan.conversationId);
  }

  private cancelBeforeExecution(plan: AITutorPreflightPlan, context: AITutorExecutionAdmissionContext): AITutorExecutionResult {
    let reservation = context.admission.reservation;
    if (reservation.status === "RESERVED") {
      reservation = this.dependencies.admission.releaseBeforeExecution(reservation.id, this.safeNow());
    }
    this.terminalizeConversation(plan.principal, plan.responseId, "CANCELLED");
    this.failOpenOperationSync(context.operation, "CANCELLED");
    return this.result(plan, "CANCELLED", "CANCELLED", null, context.operation.id, reservation.id, "RELEASED", plan.conversationId);
  }

  private createTrace(
    plan: AITutorPreflightPlan,
    operationId: string,
    reservationId: string,
    projectionRefs: readonly AITutorTraceProjectionRefCreate[],
    evidenceRefs: readonly AITutorTraceEvidenceRefCreate[],
    now: number,
  ): AITutorResponseTrace {
    const trace: AITutorResponseTrace = {
      id: createEmptyTraceIdentity(),
      responseId: plan.responseId,
      conversationId: plan.conversationId,
      principalRef: plan.principalRef,
      subjectKey: plan.subjectKey,
      tutorConfigId: plan.tutorConfigId,
      tutorConfigRevision: plan.tutorConfigRevision,
      contextSnapshotId: plan.contextSnapshotId,
      contextSnapshotFingerprint: plan.contextSnapshotFingerprint,
      retrievalConfigId: plan.retrievalConfigId,
      retrievalConfigRevision: plan.retrievalConfigRevision,
      fusionAlgorithmKey: plan.retrievalConfig.fusionAlgorithmKey,
      fusionAlgorithmRevision: plan.retrievalConfig.fusionAlgorithmRevision,
      generationModelConfigId: plan.generationModelConfigId,
      generationModelConfigRevision: plan.generationModelConfigRevision,
      generationProviderConfigId: plan.generationProviderConfigId,
      generationProviderConfigRevision: plan.generationProviderConfigRevision,
      providerModelId: plan.providerModelId,
      adapterKey: plan.adapterKey,
      groundingProtocolKey: AI_TUTOR_GROUNDING_PROTOCOL_KEY,
      groundingProtocolRevision: AI_TUTOR_GROUNDING_PROTOCOL_REVISION,
      citationProtocolKey: AI_TUTOR_CITATION_PROTOCOL_KEY,
      citationProtocolRevision: AI_TUTOR_CITATION_PROTOCOL_REVISION,
      costOperationId: operationId,
      budgetReservationId: reservationId,
      budgetPolicyId: plan.budgetPolicyId,
      budgetPolicyRevision: plan.budgetPolicyRevision,
      rateLimitPolicyId: plan.rateLimitPolicyId,
      rateLimitPolicyRevision: plan.rateLimitPolicyRevision,
      planFingerprint: plan.planFingerprint,
      status: "PLANNED",
      safeErrorCode: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    const created = this.dependencies.traces.create({ trace, projectionRefs, evidenceRefs });
    return created;
  }

  private transitionTrace(trace: AITutorResponseTrace, status: "COMPLETED" | "FAILED" | "CANCELLED" | "BLOCKED", at: number): void {
    try {
      this.dependencies.traces.transition({
        id: trace.id,
        expectedStatus: trace.status,
        status,
        updatedAt: at,
        completedAt: at,
        safeErrorCode: status === "COMPLETED" ? null : status === "BLOCKED" ? "AI_TUTOR_TRACE_BLOCKED" : status === "CANCELLED" ? "AI_TUTOR_TRACE_CANCELLED" : "AI_TUTOR_TRACE_FAILED",
      });
      trace.status = status;
      trace.safeErrorCode = status === "COMPLETED" ? null : status === "BLOCKED" ? "AI_TUTOR_TRACE_BLOCKED" : status === "CANCELLED" ? "AI_TUTOR_TRACE_CANCELLED" : "AI_TUTOR_TRACE_FAILED";
      trace.completedAt = at;
      trace.updatedAt = at;
    } catch (error) {
      throw executionError("AI_TUTOR_EXECUTION_OPERATION_CONFLICT", "The Tutor Response Trace could not be terminalized safely.", error);
    }
  }

  private startAndCompleteEmpty(plan: AITutorPreflightPlan): void {
    try {
      this.dependencies.conversations.startResponse(plan.principal, plan.responseId);
      this.dependencies.conversations.completeResponse(plan.principal, plan.responseId, "OTHER");
    } catch (error) {
      // A concurrent terminalization/deletion is already the safe outcome for
      // a zero-output blocked path; do not leave its operation open merely
      // because M4 won the race.
      if (error instanceof AIConversationError && ["AI_CONVERSATION_RESPONSE_TERMINAL", "AI_CONVERSATION_NOT_FOUND"].includes(error.code)) return;
      throw error;
    }
  }

  private terminalizeConversation(principal: AITutorPreflightPlan["principal"], responseId: string, status: "FAILED" | "CANCELLED"): void {
    try {
      if (status === "CANCELLED") this.dependencies.conversations.cancelResponse(principal, responseId);
      else this.dependencies.conversations.failResponse(principal, responseId);
    } catch (error) {
      if (error instanceof AIConversationError && ["AI_CONVERSATION_RESPONSE_TERMINAL", "AI_CONVERSATION_NOT_FOUND"].includes(error.code)) return;
      throw executionError("AI_TUTOR_EXECUTION_OPERATION_CONFLICT", "The Tutor Conversation could not be terminalized safely.", error);
    }
  }

  private closeOperationAndSettle(
    operationId: string,
    reservationId: string,
    status: "COMPLETED" | "FAILED" | "CANCELLED",
  ): AITutorExecutionSettlementStatus {
    this.completeOperationSync(operationId, status);
    try {
      const settlement = this.dependencies.admission.settle(reservationId, this.safeNow());
      return settlement.status;
    } catch (error) {
      throw executionError("AI_TUTOR_EXECUTION_ACCOUNTING_FAILED", "The Tutor Budget Reservation could not be settled safely.", error);
    }
  }

  private completeOperationSync(operationId: string, status: "COMPLETED" | "FAILED" | "CANCELLED"): void {
    const operation = this.dependencies.accounting.getOperation(operationId);
    if (!operation || operation.status !== "OPEN") return;
    this.dependencies.accounting.completeOperation(operationId, "OPEN", status, this.safeNow());
  }

  private async failOpenOperation(operation: AICostOperation): Promise<void> {
    this.failOpenOperationSync(operation, "FAILED");
  }

  private failOpenOperationSync(operation: AICostOperation, status: "FAILED" | "CANCELLED"): void {
    if (operation.status !== "OPEN") return;
    this.dependencies.accounting.completeOperation(operation.id, "OPEN", status, this.safeNow());
  }

  private async failOperationWithoutProvider(operation: AICostOperation, reservationId: string): Promise<void> {
    this.completeOperationSync(operation.id, "FAILED");
    const reservation = this.dependencies.admission.getReservation(reservationId);
    if (reservation?.status === "RESERVED") this.dependencies.admission.releaseBeforeExecution(reservation.id, this.safeNow());
  }

  private assertOperationExecution(operationId: string, reservationId: string): void {
    const operation = this.dependencies.accounting.getOperation(operationId);
    const reservation = this.dependencies.admission.getReservation(reservationId);
    if (!operation || operation.status !== "OPEN" || !reservation || reservation.operationId !== operationId || reservation.status !== "EXECUTING") {
      throw new AITutorExecutionError("AI_TUTOR_EXECUTION_OPERATION_CONFLICT", "The Tutor Cost Operation and Budget Reservation are not executable.");
    }
  }

  private assertRuntimePlanCurrent(plan: AITutorPreflightPlan, expectedResponseStatus: "PENDING" | "STREAMING"): void {
    const response = safeGetResponse(this.dependencies.conversations, plan.principal, plan.responseId);
    const conversation = safeGetConversation(this.dependencies.conversations, plan.principal, plan.conversationId);
    if (response.conversationId !== plan.conversationId || response.principalRef !== plan.principalRef || response.status !== expectedResponseStatus || response.requestMessageId !== plan.currentMessageId || conversation.status !== "ACTIVE" || conversation.subjectKey !== plan.subjectKey) {
      throw new AITutorExecutionError("AI_TUTOR_EXECUTION_CONFIGURATION_CHANGED", "The Tutor Response changed before execution.");
    }

    const tutor = this.dependencies.tutorConfigs.getById(plan.tutorConfigId);
    if (!tutor || !tutor.enabled || tutor.currentRevision !== plan.tutorConfigRevision || tutor.subjectKey !== plan.subjectKey || tutor.generationModelConfigId !== plan.generationModelConfigId || tutor.contextPolicyId !== plan.contextPolicyId || tutor.retrievalConfigId !== plan.retrievalConfigId || tutor.budgetPolicyId !== plan.budgetPolicyId || tutor.rateLimitPolicyId !== plan.rateLimitPolicyId || tutor.maxOutputTokens !== plan.maxOutputTokens) throw new AITutorExecutionError("AI_TUTOR_EXECUTION_CONFIGURATION_CHANGED", "The Tutor Config changed before execution.");

    const snapshot = this.dependencies.context.getSnapshot(plan.principal, plan.responseId);
    if (snapshot.id !== plan.contextSnapshotId || snapshot.fingerprint !== plan.contextSnapshotFingerprint || snapshot.globalPolicyId !== plan.globalPolicyId || snapshot.globalPolicyRevision !== plan.globalPolicyRevision || snapshot.subjectPolicyId !== plan.subjectPolicyId || snapshot.subjectPolicyRevision !== plan.subjectPolicyRevision || snapshot.contextPolicyId !== plan.contextPolicyId || snapshot.contextPolicyRevision !== plan.contextPolicyRevision) throw new AITutorExecutionError("AI_TUTOR_EXECUTION_CONFIGURATION_CHANGED", "The Context Snapshot changed before execution.");

    const global = this.dependencies.instructionPolicies.getById(plan.globalPolicyId);
    const subject = this.dependencies.instructionPolicies.getById(plan.subjectPolicyId);
    const context = this.dependencies.contextPolicies.getById(plan.contextPolicyId);
    if (!global || !subject || !context || !global.enabled || !subject.enabled || !context.enabled || global.currentRevision !== plan.globalPolicyRevision || subject.currentRevision !== plan.subjectPolicyRevision || context.currentRevision !== plan.contextPolicyRevision) throw new AITutorExecutionError("AI_TUTOR_EXECUTION_CONFIGURATION_CHANGED", "The Tutor policy revisions changed before execution.");

    const retrieval = this.dependencies.retrievalConfigs.getById(plan.retrievalConfigId);
    const retrievalRevision = this.dependencies.retrievalConfigs.getRevision(plan.retrievalConfigId, plan.retrievalConfigRevision);
    if (!retrieval || !retrievalRevision || !retrieval.enabled || retrieval.currentRevision !== plan.retrievalConfigRevision || retrieval.subjectKey !== plan.subjectKey || !retrievalRevision.enabled || retrievalRevision.subjectKey !== plan.subjectKey) throw new AITutorExecutionError("AI_TUTOR_EXECUTION_CONFIGURATION_CHANGED", "The Retrieval Config changed before execution.");

    const budget = this.dependencies.budgetPolicies.getRevision(plan.budgetPolicyId, plan.budgetPolicyRevision);
    const rateLimit = this.dependencies.rateLimitPolicies.getRevision(plan.rateLimitPolicyId, plan.rateLimitPolicyRevision);
    if (!budget || !budget.enabled || budget.costCenter !== "STUDENT_GENERATION" || !rateLimit || !rateLimit.enabled) throw new AITutorExecutionError("AI_TUTOR_EXECUTION_CONFIGURATION_CHANGED", "The Tutor admission policies changed before execution.");

    const model = this.dependencies.models.getById(plan.generationModelConfigId);
    const provider = this.dependencies.providers.getById(plan.generationProviderConfigId);
    if (!model || !provider || !model.enabled || !provider.enabled || !provider.credentialRef || model.revision !== plan.generationModelConfigRevision || model.providerConfigId !== plan.generationProviderConfigId || model.providerModelId !== plan.providerModelId || model.adapterKey !== plan.adapterKey || model.capability !== "GENERATION" || !model.supportsStreaming || provider.revision !== plan.generationProviderConfigRevision) throw new AITutorExecutionError("AI_TUTOR_EXECUTION_CONFIGURATION_CHANGED", "The Tutor Generation Model or Provider changed before execution.");
  }

  private safeResponseBytes(principal: AITutorPreflightPlan["principal"], responseId: string): number {
    return safeGetResponse(this.dependencies.conversations, principal, responseId).outputBytes;
  }

  private safeResponseSequence(principal: AITutorPreflightPlan["principal"], responseId: string): number {
    return safeGetResponse(this.dependencies.conversations, principal, responseId).nextChunkSequence;
  }

  private reconstructResponseOutput(plan: AITutorPreflightPlan): string {
    const response = safeGetResponse(this.dependencies.conversations, plan.principal, plan.responseId);
    if (response.status !== "STREAMING") throw new AITutorExecutionError("AI_TUTOR_EXECUTION_CONFIGURATION_CHANGED", "The Tutor Response changed before output validation.");
    const chunks = this.dependencies.conversations.listResponseChunks(plan.principal, response.id);
    if (chunks.length !== response.nextChunkSequence) throw new AITutorExecutionError("AI_TUTOR_EXECUTION_OUTPUT_INVALID", "The Tutor Response stream is incomplete.");
    let outputBytes = 0;
    let output = "";
    for (const [index, chunk] of chunks.entries()) {
      const byteLength = Buffer.byteLength(chunk.text, "utf8");
      if (chunk.responseId !== response.id || chunk.sequence !== index || chunk.textHash !== hashConversationText(chunk.text) || chunk.byteLength !== byteLength) throw new AITutorExecutionError("AI_TUTOR_EXECUTION_OUTPUT_INVALID", "The Tutor Response stream is invalid.");
      outputBytes += byteLength;
      output += chunk.text;
    }
    if (outputBytes !== response.outputBytes || outputBytes > AI_CONVERSATION_MAX_RESPONSE_BYTES) throw new AITutorExecutionError("AI_TUTOR_EXECUTION_OUTPUT_INVALID", "The Tutor Response output size is invalid.");
    return output;
  }

  private readResponseExecutionState(plan: AITutorPreflightPlan): ResponseExecutionState {
    try {
      const response = this.dependencies.conversations.getResponse(plan.principal, plan.responseId);
      if (response.status === "STREAMING") return "STREAMING";
      if (response.status === "CANCELLED") return "CANCELLED";
      return "TERMINAL";
    } catch (error) {
      if (error instanceof AIConversationError && error.code === "AI_CONVERSATION_NOT_FOUND") return "MISSING";
      throw error;
    }
  }

  private result(
    plan: AITutorPreflightPlan,
    status: AITutorExecutionStatus,
    finishReason: AIConversationFinishReason | null,
    traceId: string | null,
    operationId: string,
    reservationId: string | null,
    settlementStatus: AITutorExecutionSettlementStatus | null,
    conversationId: string,
  ): AITutorExecutionResult {
    let conversationStatus: AIConversationStatus = "ACTIVE";
    try {
      conversationStatus = this.dependencies.conversations.getConversation(plan.principal, conversationId).status;
    } catch {
      conversationStatus = "DELETED";
    }
    return { responseId: plan.responseId, status, conversationStatus, finishReason, traceId, costOperationId: operationId, budgetReservationId: reservationId, settlementStatus };
  }

  private safeNow(): number {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_TIMESTAMP) throw new AITutorExecutionError("AI_TUTOR_EXECUTION_INVALID", "The Tutor execution timestamp is invalid.");
    return value;
  }
}

export function createAITutorExecutionService(dependencies: AITutorExecutionDependencies): AITutorExecutionService {
  return new AITutorExecutionService(dependencies);
}

function operationIdempotencyKey(plan: AITutorPreflightPlan): string {
  return `tutor-generation:${OPERATION_IDEMPOTENCY_VERSION}:${plan.responseId}:${plan.planFingerprint}`;
}

function assertOperationMatchesPlan(operation: AICostOperation, plan: AITutorPreflightPlan, idempotencyKey: string): void {
  if (operation.costCenter !== "STUDENT_GENERATION" || operation.idempotencyKey !== idempotencyKey || operation.opaquePrincipalRef !== plan.principalRef || operation.subjectKey !== plan.subjectKey || operation.conversationId !== plan.conversationId || operation.responseId !== plan.responseId || operation.jobId !== null || operation.evalRunId !== null || operation.knowledgeRevision !== null) throw new AITutorExecutionError("AI_TUTOR_EXECUTION_OPERATION_CONFLICT", "The Tutor Cost Operation identity is inconsistent.");
}

function projectionRefsFromRetrievalTrace(trace: AIHybridRetrievalTrace): AITutorTraceProjectionRefCreate[] {
  const refs: AITutorTraceProjectionRefCreate[] = [];
  const seen = new Set<string>();
  for (const id of trace.m7aProjectionRevisionIds) {
    const key = `M7A:${id}`;
    if (!seen.has(key)) { seen.add(key); refs.push({ projectionKind: "M7A", projectionRevisionId: id }); }
  }
  for (const id of trace.m7bEmbeddingProjectionRevisionIds) {
    const key = `M7B:${id}`;
    if (!seen.has(key)) { seen.add(key); refs.push({ projectionKind: "M7B", projectionRevisionId: id }); }
  }
  return refs;
}

function projectionRefsFromGenerationPlan(plan: AITutorGenerationPlan): AITutorTraceProjectionRefCreate[] {
  const refs: AITutorTraceProjectionRefCreate[] = [];
  const seen = new Set<string>();
  for (const item of plan.selectedEvidence) {
    for (const [projectionKind, projectionRevisionId] of [["M7A", item.m7aProjectionRevisionId] as const, ...(item.m7bEmbeddingProjectionRevisionId ? [["M7B", item.m7bEmbeddingProjectionRevisionId] as const] : [])]) {
      const key = `${projectionKind}:${projectionRevisionId}`;
      if (!seen.has(key)) { seen.add(key); refs.push({ projectionKind, projectionRevisionId }); }
    }
  }
  return refs;
}

function evidenceRefsFromGenerationPlan(plan: AITutorGenerationPlan): AITutorTraceEvidenceRefCreate[] {
  return plan.selectedEvidence.map((item) => ({
    ordinal: item.ordinal,
    citationLabel: item.label,
    chunkId: item.chunkId,
    m7aProjectionRevisionId: item.m7aProjectionRevisionId,
    m7bEmbeddingProjectionRevisionId: item.m7bEmbeddingProjectionRevisionId,
    originKind: item.originKind,
    originId: item.originId,
    questionId: item.questionId,
    questionRevision: item.questionRevision,
  }));
}

function splitUtf8(value: string, maxBytes: number): string[] {
  const pieces: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const codePoint of value) {
    const bytes = Buffer.byteLength(codePoint, "utf8");
    if (current && currentBytes + bytes > maxBytes) {
      pieces.push(current);
      current = "";
      currentBytes = 0;
    }
    current += codePoint;
    currentBytes += bytes;
  }
  if (current) pieces.push(current);
  return pieces;
}

function createLinkedAbortController(signal: AbortSignal | undefined): LinkedAbortController {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  return {
    controller,
    signal: controller.signal,
    cleanup: () => signal?.removeEventListener("abort", onAbort),
  };
}

interface LinkedAbortController {
  controller: AbortController;
  signal: AbortSignal;
  cleanup(): void;
}

type ResponseExecutionState = "STREAMING" | "CANCELLED" | "TERMINAL" | "MISSING";

function safeGetResponse(conversations: AITutorExecutionDependencies["conversations"], principal: AITutorPreflightPlan["principal"], responseId: string): AIConversationResponse {
  try {
    return conversations.getResponse(principal, responseId);
  } catch (error) {
    throw executionError("AI_TUTOR_EXECUTION_CONFIGURATION_CHANGED", "The Tutor Response is no longer active for execution.", error);
  }
}

function safeGetConversation(conversations: AITutorExecutionDependencies["conversations"], principal: AITutorPreflightPlan["principal"], conversationId: string) {
  try {
    return conversations.getConversation(principal, conversationId);
  } catch (error) {
    throw executionError("AI_TUTOR_EXECUTION_CONFIGURATION_CHANGED", "The Tutor Conversation is no longer active for execution.", error);
  }
}

function validateExecutionInput(input: AITutorExecutionInput): void {
  if (!input || typeof input !== "object" || !input.principal || typeof input.responseId !== "string" || typeof input.tutorConfigId !== "string") throw new AITutorExecutionError("AI_TUTOR_EXECUTION_INVALID", "The Tutor execution input is invalid.");
}

function validateEstimator(value: { estimatorKey: string; estimate(text: string): number }): void {
  if (!value || typeof value.estimatorKey !== "string" || typeof value.estimate !== "function") throw new AITutorExecutionError("AI_TUTOR_EXECUTION_INVALID", "The Tutor execution estimator is invalid.");
}

function replayConflict(): AITutorExecutionError {
  return new AITutorExecutionError("AI_TUTOR_EXECUTION_OPERATION_CONFLICT", "The Tutor request already has an active or terminal execution.");
}

function validatePeriod(value: unknown): asserts value is { startAt: number; endAt: number } {
  if (!value || typeof value !== "object" || !Number.isSafeInteger((value as { startAt?: unknown }).startAt) || !Number.isSafeInteger((value as { endAt?: unknown }).endAt) || (value as { startAt: number }).startAt < 0 || (value as { endAt: number }).endAt <= (value as { startAt: number }).startAt) throw new AITutorExecutionError("AI_TUTOR_EXECUTION_ADMISSION_DENIED", "The Tutor Budget period is invalid.");
}

function isCancelledError(error: unknown): boolean {
  return error instanceof AITutorExecutionError && error.code === "AI_TUTOR_EXECUTION_CANCELLED"
    || isAIProviderGatewayError(error) && error.code === "CANCELLED";
}

function executionError(code: ConstructorParameters<typeof AITutorExecutionError>[0], message: string, cause?: unknown): AITutorExecutionError {
  return new AITutorExecutionError(code, message, {}, cause);
}

function mapExecutionError(error: unknown): AITutorExecutionError {
  if (error instanceof AITutorExecutionError) return error;
  if (error instanceof AITutorPreflightError || error instanceof AITutorPlanningError || error instanceof AITutorConfigError || error instanceof AIContextError || error instanceof AIPolicyError) return executionError("AI_TUTOR_EXECUTION_PREFLIGHT_FAILED", "The Tutor request could not pass its governed planning boundary.", error);
  if (error instanceof AIAdmissionError) return new AITutorExecutionError("AI_TUTOR_EXECUTION_ADMISSION_DENIED", "The Tutor request was not admitted for execution.", { admissionCode: error.code }, error);
  if (error instanceof AIHybridRetrievalError) return executionError("AI_TUTOR_EXECUTION_RETRIEVAL_FAILED", "The Tutor retrieval operation failed safely.", error);
  if (error instanceof AIProviderGatewayError) return error.code === "CANCELLED" ? executionError("AI_TUTOR_EXECUTION_CANCELLED", "The Tutor execution was cancelled.", error) : executionError("AI_TUTOR_EXECUTION_PROVIDER_FAILED", "The Tutor Provider operation failed safely.", error);
  if (error instanceof AIAccountingError) return executionError("AI_TUTOR_EXECUTION_ACCOUNTING_FAILED", "The Tutor accounting operation failed safely.", error);
  return executionError("AI_TUTOR_EXECUTION_INVALID", "The Tutor execution failed safely.", error);
}
