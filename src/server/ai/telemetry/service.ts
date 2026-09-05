import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import {
  aiConversationResponses,
  aiConversations,
  aiTutorResponseTraces,
} from "../../content/schema";
import type { AIMemoryExecution } from "../memory/execution-contracts";
import type { AIEvidencePack } from "../retrieval";
import type { AIStudentPrincipal } from "../conversations";
import type {
  AIFeedbackEvent,
  AIFeedbackInput,
  AIAnalyticsPrincipal,
  AIRetrievalTrace,
  AIRetrievalTraceDetails,
  AIRetrievalTraceInput,
  AITelemetryEvent,
  AITelemetryEventInput,
  AITelemetryFailureCode,
  AITelemetryMemoryAction,
  AITelemetryMemoryKind,
  AITelemetryMemoryOrigin,
  AITelemetryMemoryScope,
  AITelemetryTerminalStatus,
} from "./contracts";
import { AITelemetryError } from "./errors";
import {
  type AIRetrievalTraceItemRowInput,
  type AIRetrievalTraceOriginRowInput,
  type AIRetrievalTraceProjectionRowInput,
  type AIRetrievalTraceRowInput,
  type AITutorResponseDiagnosticsRowInput,
  SQLiteAIIntelligenceTelemetryRepository,
} from "./sqlite-repository";
import { validateFeedbackInput, validateTelemetryEventInput } from "./validation";
import { SQLiteAIAccountingRepository } from "../economics/accounting-repository";

const MAX_TIMESTAMP = 8_640_000_000_000_000;
const MAX_SCORE_UNITS = 1_000_000;

export interface AIIntelligenceTelemetryDependencies {
  repository?: SQLiteAIIntelligenceTelemetryRepository;
  accounting?: SQLiteAIAccountingRepository;
  clock?: () => number;
  idFactory?: () => string;
}

export interface AITutorTelemetryOutcomeInput {
  principalRef: string;
  responseId: string;
  status: AITelemetryTerminalStatus;
  occurredAt: number;
  startedAt?: number;
  costOperationId?: string | null;
  responseTraceId?: string | null;
  failureCode?: AITelemetryFailureCode | null;
}

export interface AIMemoryTelemetryInput {
  principalRef: string;
  responseId: string;
  conversationId: string;
  subjectKey: string | null;
  status: "APPLIED" | "REJECTED";
  action: AITelemetryMemoryAction;
  scope: AITelemetryMemoryScope;
  kind: AITelemetryMemoryKind | null;
  origin: AITelemetryMemoryOrigin | null;
  memoryId?: string | null;
  memoryRevision?: number | null;
  memoryPolicyId?: string | null;
  memoryPolicyRevision?: number | null;
  occurredAt: number;
  failureCode?: AITelemetryFailureCode | null;
}

export class AIIntelligenceTelemetryService {
  private readonly repository: SQLiteAIIntelligenceTelemetryRepository;
  private readonly accounting: SQLiteAIAccountingRepository;
  private readonly clock: () => number;
  private readonly idFactory: () => string;

  constructor(private readonly database: ContentDatabase, dependencies: AIIntelligenceTelemetryDependencies = {}) {
    this.repository = dependencies.repository ?? new SQLiteAIIntelligenceTelemetryRepository(database);
    this.accounting = dependencies.accounting ?? new SQLiteAIAccountingRepository(database);
    this.clock = dependencies.clock ?? Date.now;
    this.idFactory = dependencies.idFactory ?? uuidv7;
  }

  static forDatabase(database: ContentDatabase): AIIntelligenceTelemetryService {
    return new AIIntelligenceTelemetryService(database);
  }

  ensureAnalyticsPrincipal(principalRef: string, now = this.safeNow()): AIAnalyticsPrincipal {
    try {
      return this.atomic(() => this.repository.ensurePrincipal(principalRef, this.idFactory(), now));
    } catch (error) {
      throw this.wrap("AI_TELEMETRY_CORRELATION_INVALID", "The analytics principal could not be resolved safely.", error);
    }
  }

  recordEvent(input: AITelemetryEventInput): AITelemetryEvent {
    try {
      const validated = validateTelemetryEventInput(input);
      return this.atomic(() => {
        const principal = validated.principalRef ? this.repository.ensurePrincipal(validated.principalRef, this.idFactory(), validated.occurredAt) : null;
        this.assertCorrelationOwner(validated, principal);
        const existing = this.repository.getEventByDedupeKey(validated.dedupeKey);
        if (existing) {
          if (existing.eventType !== validated.eventType || existing.responseId !== (validated.responseId ?? null) || existing.subjectKey !== (validated.subjectKey ?? null) || existing.analyticsPrincipalId !== (principal?.id ?? null)) throw new AITelemetryError("AI_TELEMETRY_CONFLICT", "The telemetry dedupe identity is bound to different metadata.");
          return existing;
        }
        const event = this.repository.insertEvent({ ...validated, id: validated.id ?? this.idFactory(), analyticsPrincipalId: principal?.id ?? null });
        if (event.eventType !== validated.eventType || event.responseId !== (validated.responseId ?? null) || event.subjectKey !== (validated.subjectKey ?? null) || event.analyticsPrincipalId !== (principal?.id ?? null)) throw new AITelemetryError("AI_TELEMETRY_CONFLICT", "The telemetry dedupe identity is bound to different metadata.");
        return event;
      });
    } catch (error) {
      if (error instanceof AITelemetryError) throw error;
      throw this.wrap("AI_TELEMETRY_INVALID", "The AI telemetry event could not be recorded safely.", error);
    }
  }

  recordTutorStarted(input: { principalRef: string; responseId: string; occurredAt?: number }): AITelemetryEvent | null {
    const at = input.occurredAt ?? this.safeNow();
    const response = this.database.db.select().from(aiConversationResponses).where(and(eq(aiConversationResponses.id, input.responseId), eq(aiConversationResponses.principalRef, input.principalRef))).get();
    if (!response) return null;
    const conversation = this.database.db.select().from(aiConversations).where(and(eq(aiConversations.id, response.conversationId), eq(aiConversations.principalRef, input.principalRef))).get();
    if (!conversation) return null;
    return this.recordEvent({ dedupeKey: `tutor-started:${response.id}`, eventType: "TUTOR_REQUEST_STARTED", principalRef: input.principalRef, subjectKey: conversation.subjectKey, conversationId: conversation.id, responseId: response.id, occurredAt: at });
  }

  recordTutorOutcome(input: AITutorTelemetryOutcomeInput): { event: AITelemetryEvent; diagnostics: AITutorResponseDiagnosticsRowInput | null } | null {
    const response = this.database.db.select().from(aiConversationResponses).where(and(eq(aiConversationResponses.id, input.responseId), eq(aiConversationResponses.principalRef, input.principalRef))).get();
    if (!response) return null;
    const conversation = this.database.db.select().from(aiConversations).where(and(eq(aiConversations.id, response.conversationId), eq(aiConversations.principalRef, input.principalRef))).get();
    if (!conversation) return null;
    const trace = this.database.db.select().from(aiTutorResponseTraces).where(and(eq(aiTutorResponseTraces.responseId, response.id), eq(aiTutorResponseTraces.principalRef, input.principalRef))).get();
    const retrieval = this.repository.getRetrievalTraceByRequestId(response.id);
    const operationId = input.costOperationId ?? trace?.costOperationId ?? null;
    const usage = operationId ? this.operationUsage(operationId) : emptyUsageSummary();
    const startedAt = input.startedAt ?? trace?.createdAt ?? (operationId ? this.accounting.getOperation(operationId)?.startedAt : null) ?? input.occurredAt;
    const failureCode = input.failureCode ?? failureForTutor(input.status, retrieval?.status ?? null);
    const event = this.recordEvent({
      dedupeKey: `tutor-terminal:${response.id}`,
      eventType: input.status === "COMPLETED" ? "TUTOR_REQUEST_COMPLETED" : "TUTOR_REQUEST_FAILED",
      principalRef: input.principalRef,
      subjectKey: conversation.subjectKey,
      conversationId: conversation.id,
      responseId: response.id,
      responseTraceId: trace?.id ?? input.responseTraceId ?? null,
      retrievalTraceId: retrieval?.id ?? null,
      costOperationId: operationId,
      modelConfigId: trace?.generationModelConfigId ?? null,
      modelConfigRevision: trace?.generationModelConfigRevision ?? null,
      providerConfigId: trace?.generationProviderConfigId ?? null,
      providerConfigRevision: trace?.generationProviderConfigRevision ?? null,
      tutorConfigId: trace?.tutorConfigId ?? null,
      tutorConfigRevision: trace?.tutorConfigRevision ?? null,
      contextPolicyId: null,
      contextPolicyRevision: null,
      retrievalConfigId: trace?.retrievalConfigId ?? null,
      retrievalConfigRevision: trace?.retrievalConfigRevision ?? null,
      failureCode,
      durationMs: boundedDuration(startedAt, input.occurredAt),
      providerLatencyMs: usage.providerLatencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      knownCostNano: usage.knownCostNano,
      occurredAt: input.occurredAt,
    });
    if (input.status === "COMPLETED") {
      this.recordEvent({ dedupeKey: `grounding-passed:${response.id}`, eventType: "GROUNDING_VALIDATION_PASSED", principalRef: input.principalRef, subjectKey: conversation.subjectKey, conversationId: conversation.id, responseId: response.id, responseTraceId: trace?.id ?? null, occurredAt: input.occurredAt });
    } else if (failureCode === "GROUNDING_INVALID" || failureCode === "CITATION_INVALID") {
      this.recordEvent({ dedupeKey: `grounding-failed:${response.id}`, eventType: "GROUNDING_VALIDATION_FAILED", principalRef: input.principalRef, subjectKey: conversation.subjectKey, conversationId: conversation.id, responseId: response.id, responseTraceId: trace?.id ?? null, failureCode, occurredAt: input.occurredAt });
    }
    if (!trace) return { event, diagnostics: null };
    const principal = this.repository.getPrincipalByRef(input.principalRef);
    if (!principal) return { event, diagnostics: null };
    const diagnostics: AITutorResponseDiagnosticsRowInput = {
      id: this.idFactory(),
      responseTraceId: trace.id,
      responseId: response.id,
      conversationId: conversation.id,
      analyticsPrincipalId: principal.id,
      subjectKey: conversation.subjectKey,
      retrievalTraceId: retrieval?.id ?? null,
      costOperationId: operationId ?? trace.costOperationId,
      terminalStatus: input.status,
      groundingValidationStatus: input.status === "COMPLETED" ? "PASSED" : "NOT_RUN",
      citationValidationStatus: input.status === "COMPLETED" ? "PASSED" : "NOT_RUN",
      startedAt,
      completedAt: input.occurredAt,
      overallLatencyMs: boundedDuration(startedAt, input.occurredAt),
      providerLatencyMs: usage.providerLatencyMs,
      firstTokenLatencyMs: null,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      knownCostNano: usage.knownCostNano,
      usageRecordCount: usage.recordCount,
      createdAt: input.occurredAt,
    };
    try {
      this.atomic(() => this.repository.insertDiagnostics(diagnostics));
    } catch (error) {
      throw this.wrap("AI_TELEMETRY_INVALID", "Tutor diagnostics could not be recorded safely.", error);
    }
    return { event, diagnostics };
  }

  recordRetrievalStarted(input: { principalRef?: string | null; subjectKey: string; requestId: string; responseId?: string | null; conversationId?: string | null; costOperationId?: string | null; occurredAt?: number }): AITelemetryEvent {
    return this.recordEvent({ dedupeKey: `retrieval-started:${input.requestId}`, eventType: "RETRIEVAL_STARTED", principalRef: input.principalRef ?? null, subjectKey: input.subjectKey, responseId: input.responseId ?? null, conversationId: input.conversationId ?? null, costOperationId: input.costOperationId ?? null, occurredAt: input.occurredAt ?? this.safeNow() });
  }

  recordRetrieval(input: AIRetrievalTraceInput): AIRetrievalTrace {
    try {
      const persisted = this.atomic(() => this.persistRetrievalTrace(input));
      const failureCode = persisted.trace.sufficient ? null : retrievalFailure(persisted.trace.safeReason);
      this.recordEvent({
        dedupeKey: `retrieval-terminal:${input.retrievalRequestId}`,
        eventType: persisted.trace.sufficient ? "RETRIEVAL_COMPLETED" : "RETRIEVAL_INSUFFICIENT",
        principalRef: input.principalRef ?? null,
        subjectKey: input.subjectKey,
        conversationId: input.conversationId ?? null,
        responseId: input.responseId ?? null,
        retrievalTraceId: persisted.trace.id,
        costOperationId: input.costOperationId ?? null,
        retrievalConfigId: persisted.trace.retrievalConfigId,
        retrievalConfigRevision: persisted.trace.retrievalConfigRevision,
        failureCode,
        durationMs: persisted.trace.retrievalLatencyMs,
        retrievalCandidateCount: persisted.trace.candidateCounts.fused,
        retrievalSelectedEvidenceCount: persisted.trace.candidateCounts.evidence,
        retrievalRerankerUsed: persisted.trace.rerankerUsed,
        occurredAt: input.completedAt,
      });
      return persisted.trace;
    } catch (error) {
      throw this.wrap("AI_TELEMETRY_INVALID", "The Retrieval Trace could not be recorded safely.", error);
    }
  }

  recordMemoryMutation(input: AIMemoryTelemetryInput): AITelemetryEvent {
    return this.recordEvent({
      dedupeKey: `memory-mutation:${input.responseId}`,
      eventType: input.status === "APPLIED" ? "MEMORY_MUTATION_APPLIED" : "MEMORY_MUTATION_REJECTED",
      principalRef: input.principalRef,
      subjectKey: input.subjectKey,
      conversationId: input.conversationId,
      responseId: input.responseId,
      memoryPolicyId: input.memoryPolicyId ?? null,
      memoryPolicyRevision: input.memoryPolicyRevision ?? null,
      memoryId: input.memoryId ?? null,
      memoryRevision: input.memoryRevision ?? null,
      memoryScope: input.scope,
      memoryKind: input.kind,
      memoryOrigin: input.origin,
      memoryAction: input.action,
      failureCode: input.failureCode ?? (input.status === "REJECTED" ? "MEMORY_CONFLICT" : null),
      occurredAt: input.occurredAt,
    });
  }

  recordCompactionScheduled(execution: AIMemoryExecution, occurredAt = this.safeNow()): AITelemetryEvent {
    return this.recordEvent({ dedupeKey: `compaction-scheduled:${execution.id}`, eventType: "COMPACTION_SCHEDULED", principalRef: execution.principalRef, subjectKey: execution.subjectKey, conversationId: execution.conversationId, responseId: execution.responseId, costOperationId: execution.costOperationId, modelConfigId: execution.generationModelConfigId, modelConfigRevision: execution.generationModelConfigRevision, providerConfigId: execution.generationProviderConfigId, providerConfigRevision: execution.generationProviderConfigRevision, occurredAt });
  }

  recordCompactionOutcome(execution: AIMemoryExecution, occurredAt = execution.completedAt ?? this.safeNow()): AITelemetryEvent | null {
    if (execution.executionKind !== "COMPACTION" || !["COMPLETED", "FAILED", "CANCELLED", "INPUT_LOST", "AMBIGUOUS"].includes(execution.status)) return null;
    const status = execution.status === "COMPLETED" ? "COMPLETED" : execution.status === "CANCELLED" ? "CANCELLED" : "FAILED";
    const usage = execution.costOperationId ? this.operationUsage(execution.costOperationId) : emptyUsageSummary();
    return this.recordEvent({ dedupeKey: `compaction-terminal:${execution.id}`, eventType: status === "COMPLETED" ? "COMPACTION_COMPLETED" : "COMPACTION_FAILED", principalRef: execution.principalRef, subjectKey: execution.subjectKey, conversationId: execution.conversationId, responseId: execution.responseId, costOperationId: execution.costOperationId, modelConfigId: execution.generationModelConfigId, modelConfigRevision: execution.generationModelConfigRevision, providerConfigId: execution.generationProviderConfigId, providerConfigRevision: execution.generationProviderConfigRevision, failureCode: status === "COMPLETED" ? null : compactionFailure(execution.safeFailureCode), durationMs: execution.completedAt === null ? null : boundedDuration(execution.createdAt, occurredAt), providerLatencyMs: usage.providerLatencyMs, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, knownCostNano: usage.knownCostNano, occurredAt });
  }

  recordFeedback(input: AIFeedbackInput): AIFeedbackEvent {
    try {
      validateFeedbackInput(input);
      return this.atomic(() => {
        const response = this.database.db.select().from(aiConversationResponses).where(and(eq(aiConversationResponses.id, input.responseId), eq(aiConversationResponses.principalRef, input.principalRef))).get();
        if (!response || response.status !== "COMPLETED") throw new AITelemetryError("AI_TELEMETRY_FEEDBACK_INVALID", "Feedback requires the same principal's completed Response.");
        const conversation = this.database.db.select().from(aiConversations).where(and(eq(aiConversations.id, response.conversationId), eq(aiConversations.principalRef, input.principalRef))).get();
        if (!conversation || conversation.status !== "ACTIVE" || conversation.origin !== "STUDENT") throw new AITelemetryError("AI_TELEMETRY_FEEDBACK_INVALID", "Feedback Conversation ownership is invalid.");
        const trace = this.database.db.select({ id: aiTutorResponseTraces.id }).from(aiTutorResponseTraces).where(eq(aiTutorResponseTraces.responseId, response.id)).get();
        const principal = this.repository.ensurePrincipal(input.principalRef, this.idFactory(), input.occurredAt);
        const feedback = this.repository.insertFeedback({ id: input.id ?? this.idFactory(), dedupeKey: input.dedupeKey, feedbackType: input.feedbackType, reasonCode: input.reasonCode ?? null, sourceSurface: input.sourceSurface ?? "TUTOR", responseId: response.id, conversationId: conversation.id, responseTraceId: trace?.id ?? null, analyticsPrincipalId: principal.id, subjectKey: conversation.subjectKey, occurredAt: input.occurredAt });
        if (feedback.responseId !== response.id || feedback.feedbackType !== input.feedbackType || feedback.analyticsPrincipalId !== principal.id) throw new AITelemetryError("AI_TELEMETRY_CONFLICT", "The feedback dedupe identity is bound to different metadata.");
        this.recordEvent({ dedupeKey: `feedback:${feedback.dedupeKey}`, eventType: input.feedbackType === "POSITIVE" ? "FEEDBACK_POSITIVE" : input.feedbackType === "NEGATIVE" ? "FEEDBACK_NEGATIVE" : "FEEDBACK_REPORTED", principalRef: input.principalRef, subjectKey: conversation.subjectKey, conversationId: conversation.id, responseId: response.id, responseTraceId: trace?.id ?? null, occurredAt: input.occurredAt });
        return feedback;
      });
    } catch (error) {
      if (error instanceof AITelemetryError) throw error;
      throw this.wrap("AI_TELEMETRY_FEEDBACK_INVALID", "The feedback event could not be recorded safely.", error);
    }
  }

  getRetrievalTraceByRequestId(requestId: string): AIRetrievalTrace | null {
    return this.repository.getRetrievalTraceByRequestId(requestId);
  }

  getRetrievalTraceDetailsByRequestId(requestId: string): AIRetrievalTraceDetails | null {
    return this.repository.getRetrievalTraceDetailsByRequestId(requestId);
  }

  getTutorDiagnostics(responseId: string) {
    return this.repository.getDiagnosticsByResponseId(responseId);
  }

  purgePrincipal(principal: AIStudentPrincipal | string): number {
    const principalRef = typeof principal === "string" ? principal : principal.principalRef;
    try { return this.repository.purgePrincipal(principalRef); } catch (error) { throw this.wrap("AI_TELEMETRY_PRIVACY_INVALID", "The principal telemetry purge could not complete safely.", error); }
  }

  private persistRetrievalTrace(input: AIRetrievalTraceInput): { trace: AIRetrievalTrace; inserted: boolean } {
    const analyticsPrincipalId = input.principalRef ? this.repository.ensurePrincipal(input.principalRef, this.idFactory(), input.completedAt).id : null;
    const trace = input.pack.trace;
    const durationMs = boundedDuration(input.startedAt, input.completedAt);
    const row: AIRetrievalTraceRowInput = {
      id: this.idFactory(),
      retrievalRequestId: input.retrievalRequestId,
      analyticsPrincipalId,
      subjectKey: input.subjectKey,
      conversationId: input.conversationId ?? null,
      responseId: input.responseId ?? null,
      responseTraceId: input.responseTraceId ?? null,
      costOperationId: input.costOperationId ?? null,
      retrievalConfigId: input.pack.retrievalConfigId,
      retrievalConfigRevision: input.pack.retrievalConfigRevision,
      fusionAlgorithmKey: input.pack.fusionAlgorithmKey,
      fusionAlgorithmRevision: input.pack.fusionAlgorithmRevision,
      embeddingModelConfigId: input.pack.embeddingModelConfigId,
      embeddingModelConfigRevision: input.pack.embeddingModelConfigRevision,
      embeddingProviderConfigId: input.pack.embeddingProviderConfigId,
      embeddingProviderConfigRevision: input.pack.embeddingProviderConfigRevision,
      rerankModelConfigId: input.pack.rerankModelConfigId,
      rerankModelConfigRevision: input.pack.rerankModelConfigRevision,
      rerankProviderConfigId: input.pack.rerankProviderConfigId,
      rerankProviderConfigRevision: input.pack.rerankProviderConfigRevision,
      mode: input.pack.mode,
      degraded: input.pack.degraded,
      sufficient: input.pack.sufficient,
      status: input.pack.status,
      safeReason: input.pack.trace.safeReason,
      lexicalCandidateCount: input.pack.candidateCounts.lexical,
      semanticCandidateCount: input.pack.candidateCounts.semantic,
      fusedCandidateCount: input.pack.candidateCounts.fused,
      rerankedCandidateCount: input.pack.candidateCounts.reranked,
      evidenceItemCount: input.pack.candidateCounts.evidence,
      eligibleOriginCount: trace.eligibleOriginIdentities.length,
      retrievalLatencyMs: durationMs,
      queryEmbeddingLatencyMs: input.queryEmbeddingLatencyMs ?? null,
      rerankLatencyMs: input.rerankLatencyMs ?? null,
      rerankerUsed: trace.rerankModelConfigId !== null || trace.rankedSignals.some((candidate) => candidate.rerankRank !== null),
      fingerprint: retrievalFingerprint(input),
      createdAt: input.startedAt,
      completedAt: input.completedAt,
    };
    const result = this.repository.insertRetrievalTrace(row);
    if (!result.inserted) {
      if (result.trace.fingerprint !== row.fingerprint || result.trace.subjectKey !== row.subjectKey || result.trace.analyticsPrincipalId !== analyticsPrincipalId) throw new AITelemetryError("AI_TELEMETRY_CONFLICT", "The Retrieval Trace request identity is bound to different metadata.");
      return result;
    }
    const projectionByOrigin = new Map(trace.m7aProjectionRefs.map((ref) => [`${ref.originKind}\u0000${ref.originId}`, ref]));
    const origins = [...trace.eligibleOriginIdentities].sort(compareOrigin);
    origins.forEach((origin, index) => {
      const projection = projectionByOrigin.get(`${origin.originKind}\u0000${origin.originId}`);
      const originRow: AIRetrievalTraceOriginRowInput = { traceId: result.trace.id, ordinal: index + 1, originKind: origin.originKind, originId: origin.originId, subjectKey: origin.subjectKey, projectionSetId: projection?.projectionSetId ?? null, projectionRevisionId: projection?.projectionRevisionId ?? null };
      this.repository.insertRetrievalTraceOrigin(originRow);
    });
    trace.m7aProjectionRefs.forEach((ref, index) => this.repository.insertRetrievalTraceProjection({ traceId: result.trace.id, projectionKind: "M7A", ordinal: index + 1, projectionRevisionId: ref.projectionRevisionId, projectionSetId: ref.projectionSetId, originKind: ref.originKind, originId: ref.originId } satisfies AIRetrievalTraceProjectionRowInput));
    trace.m7bEmbeddingProjectionRevisionIds.forEach((id, index) => this.repository.insertRetrievalTraceProjection({ traceId: result.trace.id, projectionKind: "M7B", ordinal: index + 1, projectionRevisionId: id, projectionSetId: null, originKind: null, originId: null } satisfies AIRetrievalTraceProjectionRowInput));
    const ranked = new Map(trace.rankedSignals.map((candidate) => [candidate.chunkId, candidate]));
    input.pack.items.forEach((item) => {
      const signal = ranked.get(item.chunkId);
      if (!signal) return;
      this.repository.insertRetrievalTraceItem({ traceId: result.trace.id, ordinal: item.ordinal, chunkId: item.chunkId, originKind: item.originKind, originId: item.originId, m7aProjectionRevisionId: item.m7aProjectionRevisionId, m7bEmbeddingProjectionRevisionId: item.m7bEmbeddingProjectionRevisionId, lexicalRank: signal.lexicalRank, semanticRank: signal.semanticRank, cosineSimilarityUnits: scoreUnits(signal.cosineSimilarity), fusionScoreUnits: signal.fusionScoreUnits, rerankRank: signal.rerankRank, rerankScoreUnits: scoreUnits(signal.rerankScore) } satisfies AIRetrievalTraceItemRowInput);
    });
    return result;
  }

  private operationUsage(operationId: string): { recordCount: number; inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; providerLatencyMs: number | null; knownCostNano: number | null } {
    const records = this.accounting.listUsageCostRecords(operationId);
    const known = (field: "normalizedInputTokens" | "normalizedOutputTokens" | "normalizedReasoningTokens") => records.length > 0 && records.every((record) => record[field] !== null) ? safeSum(records.map((record) => record[field]!)) : null;
    let knownCostNano: number | null = null;
    if (records.length > 0 && records.every((record) => record.costCompleteness === "COMPLETE")) {
      const totals = this.accounting.getOperationCostSummary(operationId).totals;
      if (totals.length === 1 && totals[0]!.totalNano >= 0) knownCostNano = totals[0]!.totalNano;
    }
    const generation = records.filter((record) => record.capability === "GENERATION");
    return { recordCount: records.length, inputTokens: known("normalizedInputTokens"), outputTokens: known("normalizedOutputTokens"), reasoningTokens: known("normalizedReasoningTokens"), providerLatencyMs: generation.length && generation.every((record) => record.latencyMs !== null) ? Math.max(...generation.map((record) => record.latencyMs!)) : null, knownCostNano };
  }

  private assertCorrelationOwner(input: AITelemetryEventInput, principal: AIAnalyticsPrincipal | null): void {
    if (!input.principalRef) return;
    if (!principal || principal.state !== "ACTIVE") throw new AITelemetryError("AI_TELEMETRY_CORRELATION_INVALID", "The analytics principal is unavailable.");
    if (input.conversationId) {
      const conversation = this.database.db.select({ principalRef: aiConversations.principalRef, subjectKey: aiConversations.subjectKey }).from(aiConversations).where(eq(aiConversations.id, input.conversationId)).get();
      if (!conversation || conversation.principalRef !== input.principalRef || input.subjectKey !== undefined && input.subjectKey !== null && conversation.subjectKey !== input.subjectKey) throw new AITelemetryError("AI_TELEMETRY_CORRELATION_INVALID", "Telemetry Conversation ownership is invalid.");
    }
    if (input.responseId) {
      const response = this.database.db.select({ principalRef: aiConversationResponses.principalRef, conversationId: aiConversationResponses.conversationId }).from(aiConversationResponses).where(eq(aiConversationResponses.id, input.responseId)).get();
      if (!response || response.principalRef !== input.principalRef || input.conversationId !== undefined && input.conversationId !== null && response.conversationId !== input.conversationId) throw new AITelemetryError("AI_TELEMETRY_CORRELATION_INVALID", "Telemetry Response ownership is invalid.");
    }
    if (input.responseTraceId) {
      const trace = this.database.db.select({ principalRef: aiTutorResponseTraces.principalRef, responseId: aiTutorResponseTraces.responseId }).from(aiTutorResponseTraces).where(eq(aiTutorResponseTraces.id, input.responseTraceId)).get();
      if (!trace || trace.principalRef !== input.principalRef || input.responseId !== undefined && input.responseId !== null && trace.responseId !== input.responseId) throw new AITelemetryError("AI_TELEMETRY_CORRELATION_INVALID", "Telemetry Response Trace ownership is invalid.");
    }
  }

  private atomic<T>(operation: () => T): T {
    return this.database.client.inTransaction ? operation() : this.database.client.transaction(operation).immediate();
  }

  private safeNow(): number {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) throw new AITelemetryError("AI_TELEMETRY_INVALID", "Telemetry time is invalid.");
    return value;
  }

  private wrap(code: "AI_TELEMETRY_INVALID" | "AI_TELEMETRY_CORRELATION_INVALID" | "AI_TELEMETRY_PRIVACY_INVALID" | "AI_TELEMETRY_FEEDBACK_INVALID", message: string, cause: unknown): AITelemetryError {
    return new AITelemetryError(code, message, {}, cause);
  }
}

function emptyUsageSummary() {
  return { recordCount: 0, inputTokens: null, outputTokens: null, reasoningTokens: null, providerLatencyMs: null, knownCostNano: null };
}

function boundedDuration(startedAt: number, completedAt: number): number {
  if (!Number.isSafeInteger(startedAt) || !Number.isSafeInteger(completedAt) || startedAt < 0 || completedAt < startedAt || completedAt - startedAt > 8_640_000_000_000) throw new AITelemetryError("AI_TELEMETRY_INVALID", "Telemetry duration is invalid.");
  return completedAt - startedAt;
}

function safeSum(values: readonly number[]): number | null {
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

function failureForTutor(status: AITelemetryTerminalStatus, retrievalStatus: string | null): AITelemetryFailureCode | null {
  if (status === "COMPLETED") return null;
  if (status === "BLOCKED" || retrievalStatus === "INSUFFICIENT") return "RETRIEVAL_INSUFFICIENT";
  if (status === "CANCELLED") return "CANCELLED";
  return "INTERNAL_ERROR";
}

function retrievalFailure(reason: string | null): AITelemetryFailureCode {
  if (reason === "NO_CANDIDATES" || reason === "BELOW_MINIMUM_EVIDENCE") return "RETRIEVAL_INSUFFICIENT";
  if (reason === "QUERY_EMBEDDING_FAILED" || reason === "RERANK_FAILED") return "RETRIEVAL_FAILED";
  return "RETRIEVAL_FAILED";
}

function compactionFailure(code: string | null): AITelemetryFailureCode {
  if (code?.includes("INPUT_LOST")) return "INPUT_LOST";
  if (code?.includes("CANCEL")) return "CANCELLED";
  if (code?.includes("SOURCE")) return "COMPACTION_SOURCE_INVALID";
  return "INTERNAL_ERROR";
}

function scoreUnits(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < -1 || value > 1) return null;
  const result = Math.round(value * MAX_SCORE_UNITS);
  return Number.isSafeInteger(result) ? result : null;
}

function compareOrigin(left: { originKind: string; originId: string; subjectKey: string }, right: { originKind: string; originId: string; subjectKey: string }): number {
  return left.originKind.localeCompare(right.originKind) || left.originId.localeCompare(right.originId) || left.subjectKey.localeCompare(right.subjectKey);
}

function retrievalFingerprint(input: AIRetrievalTraceInput): string {
  const trace = input.pack.trace;
  const canonical = {
    request: input.retrievalRequestId,
    subject: input.subjectKey,
    retrievalConfigId: input.pack.retrievalConfigId,
    retrievalConfigRevision: input.pack.retrievalConfigRevision,
    fusionAlgorithmKey: input.pack.fusionAlgorithmKey,
    fusionAlgorithmRevision: input.pack.fusionAlgorithmRevision,
    mode: input.pack.mode,
    degraded: input.pack.degraded,
    sufficient: input.pack.sufficient,
    safeReason: trace.safeReason,
    candidateCounts: input.pack.candidateCounts,
    origins: [...trace.eligibleOriginIdentities].sort(compareOrigin),
    m7a: [...trace.m7aProjectionRefs].sort((left, right) => left.projectionRevisionId.localeCompare(right.projectionRevisionId)),
    m7b: [...trace.m7bEmbeddingProjectionRevisionIds].sort(),
    ranked: trace.rankedSignals,
    selected: input.pack.items.map((item) => ({ ordinal: item.ordinal, chunkId: item.chunkId, originKind: item.originKind, originId: item.originId })),
  };
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}
