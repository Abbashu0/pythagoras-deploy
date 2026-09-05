import { and, asc, eq, gte, lt } from "drizzle-orm";

import type { ContentDatabase } from "../../content/database";
import {
  aiAnalyticsPrincipals,
  aiFeedbackEvents,
  aiRetrievalTraceItems,
  aiRetrievalTraceOrigins,
  aiRetrievalTraceProjections,
  aiRetrievalTraces,
  aiTelemetryEvents,
  aiTutorResponseDiagnostics,
  type AIAnalyticsPrincipalRow,
  type AIFeedbackEventRow,
  type AIRetrievalTraceItemRow,
  type AIRetrievalTraceOriginRow,
  type AIRetrievalTraceProjectionRow,
  type AIRetrievalTraceRow,
  type AITelemetryEventRow,
  type AITutorResponseDiagnosticsRow,
} from "../../content/schema";
import type {
  AIFeedbackEvent,
  AIFeedbackInput,
  AIAnalyticsPrincipal,
  AIRetrievalTrace,
  AIRetrievalTraceDetails,
  AIRetrievalTraceItem,
  AIRetrievalTraceOrigin,
  AIRetrievalTraceProjection,
  AITelemetryEvent,
  AITelemetryEventInput,
  AITutorResponseDiagnostics,
} from "./contracts";
import { utcBuckets, validateFeedbackInput, validateTelemetryEventInput } from "./validation";

export interface AIRetrievalTraceRowInput {
  id: string;
  retrievalRequestId: string;
  analyticsPrincipalId: string | null;
  subjectKey: string;
  conversationId: string | null;
  responseId: string | null;
  responseTraceId: string | null;
  costOperationId: string | null;
  retrievalConfigId: string;
  retrievalConfigRevision: number;
  fusionAlgorithmKey: string;
  fusionAlgorithmRevision: number;
  embeddingModelConfigId: string | null;
  embeddingModelConfigRevision: number | null;
  embeddingProviderConfigId: string | null;
  embeddingProviderConfigRevision: number | null;
  rerankModelConfigId: string | null;
  rerankModelConfigRevision: number | null;
  rerankProviderConfigId: string | null;
  rerankProviderConfigRevision: number | null;
  mode: "HYBRID" | "LEXICAL_ONLY";
  degraded: boolean;
  sufficient: boolean;
  status: "SUFFICIENT" | "INSUFFICIENT";
  safeReason: string | null;
  lexicalCandidateCount: number;
  semanticCandidateCount: number;
  fusedCandidateCount: number;
  rerankedCandidateCount: number;
  evidenceItemCount: number;
  eligibleOriginCount: number;
  retrievalLatencyMs: number;
  queryEmbeddingLatencyMs: number | null;
  rerankLatencyMs: number | null;
  rerankerUsed: boolean;
  fingerprint: string;
  createdAt: number;
  completedAt: number;
}

export interface AIRetrievalTraceOriginRowInput {
  traceId: string;
  ordinal: number;
  originKind: "KNOWLEDGE_PACKAGE" | "QUESTION_PACKAGE";
  originId: string;
  subjectKey: string;
  projectionSetId: string | null;
  projectionRevisionId: string | null;
}

export interface AIRetrievalTraceProjectionRowInput {
  traceId: string;
  projectionKind: "M7A" | "M7B";
  ordinal: number;
  projectionRevisionId: string;
  projectionSetId: string | null;
  originKind: "KNOWLEDGE_PACKAGE" | "QUESTION_PACKAGE" | null;
  originId: string | null;
}

export interface AIRetrievalTraceItemRowInput {
  traceId: string;
  ordinal: number;
  chunkId: string;
  originKind: "KNOWLEDGE_PACKAGE" | "QUESTION_PACKAGE";
  originId: string;
  m7aProjectionRevisionId: string;
  m7bEmbeddingProjectionRevisionId: string | null;
  lexicalRank: number | null;
  semanticRank: number | null;
  cosineSimilarityUnits: number | null;
  fusionScoreUnits: number;
  rerankRank: number | null;
  rerankScoreUnits: number | null;
}

export interface AITutorResponseDiagnosticsRowInput {
  id: string;
  responseTraceId: string;
  responseId: string;
  conversationId: string;
  analyticsPrincipalId: string;
  subjectKey: string;
  retrievalTraceId: string | null;
  costOperationId: string;
  terminalStatus: AITutorResponseDiagnostics["terminalStatus"];
  groundingValidationStatus: AITutorResponseDiagnostics["groundingValidationStatus"];
  citationValidationStatus: AITutorResponseDiagnostics["citationValidationStatus"];
  startedAt: number;
  completedAt: number;
  overallLatencyMs: number;
  providerLatencyMs: number | null;
  firstTokenLatencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  knownCostNano: number | null;
  usageRecordCount: number;
  createdAt: number;
}

export interface AIFeedbackRowInput {
  id: string;
  dedupeKey: string;
  feedbackType: AIFeedbackInput["feedbackType"];
  reasonCode: AIFeedbackInput["reasonCode"];
  sourceSurface: NonNullable<AIFeedbackInput["sourceSurface"]>;
  responseId: string;
  conversationId: string;
  responseTraceId: string | null;
  analyticsPrincipalId: string;
  subjectKey: string;
  occurredAt: number;
}

export class SQLiteAIIntelligenceTelemetryRepository {
  constructor(private readonly database: ContentDatabase) {}

  getPrincipalByRef(principalRef: string): AIAnalyticsPrincipal | null {
    const row = this.database.db.select().from(aiAnalyticsPrincipals).where(eq(aiAnalyticsPrincipals.principalRef, principalRef)).get();
    return row ? principalFromRow(row) : null;
  }

  getPrincipal(id: string): AIAnalyticsPrincipal | null {
    const row = this.database.db.select().from(aiAnalyticsPrincipals).where(eq(aiAnalyticsPrincipals.id, id)).get();
    return row ? principalFromRow(row) : null;
  }

  ensurePrincipal(principalRef: string, id: string, now: number): AIAnalyticsPrincipal {
    const existing = this.getPrincipalByRef(principalRef);
    if (existing) {
      if (existing.state !== "ACTIVE") throw new Error("The analytics principal is being purged.");
      return existing;
    }
    try {
      const row = this.database.db.insert(aiAnalyticsPrincipals).values({ id, principalRef, state: "ACTIVE", createdAt: now, updatedAt: now }).returning().get();
      return principalFromRow(row);
    } catch (error) {
      const raced = this.getPrincipalByRef(principalRef);
      if (raced?.state === "ACTIVE") return raced;
      throw error;
    }
  }

  insertEvent(input: AITelemetryEventInput & { analyticsPrincipalId: string | null }): AITelemetryEvent {
    const validated = validateTelemetryEventInput(input);
    const existing = this.getEventByDedupeKey(validated.dedupeKey);
    if (existing) return existing;
    const buckets = utcBuckets(validated.occurredAt);
    try {
      const row = this.database.db.insert(aiTelemetryEvents).values({
        id: validated.id!,
        dedupeKey: validated.dedupeKey,
        eventType: validated.eventType,
        eventVersion: validated.eventVersion,
        privacyClass: validated.privacyClass,
        analyticsPrincipalId: input.analyticsPrincipalId,
        subjectKey: validated.subjectKey ?? null,
        conversationId: validated.conversationId ?? null,
        responseId: validated.responseId ?? null,
        responseTraceId: validated.responseTraceId ?? null,
        retrievalTraceId: validated.retrievalTraceId ?? null,
        costOperationId: validated.costOperationId ?? null,
        modelConfigId: validated.modelConfigId ?? null,
        modelConfigRevision: validated.modelConfigRevision ?? null,
        providerConfigId: validated.providerConfigId ?? null,
        providerConfigRevision: validated.providerConfigRevision ?? null,
        tutorConfigId: validated.tutorConfigId ?? null,
        tutorConfigRevision: validated.tutorConfigRevision ?? null,
        contextPolicyId: validated.contextPolicyId ?? null,
        contextPolicyRevision: validated.contextPolicyRevision ?? null,
        retrievalConfigId: validated.retrievalConfigId ?? null,
        retrievalConfigRevision: validated.retrievalConfigRevision ?? null,
        memoryPolicyId: validated.memoryPolicyId ?? null,
        memoryPolicyRevision: validated.memoryPolicyRevision ?? null,
        memoryId: validated.memoryId ?? null,
        memoryRevision: validated.memoryRevision ?? null,
        failureCode: validated.failureCode ?? null,
        durationMs: validated.durationMs ?? null,
        providerLatencyMs: validated.providerLatencyMs ?? null,
        firstTokenLatencyMs: validated.firstTokenLatencyMs ?? null,
        inputTokens: validated.inputTokens ?? null,
        outputTokens: validated.outputTokens ?? null,
        reasoningTokens: validated.reasoningTokens ?? null,
        knownCostNano: validated.knownCostNano ?? null,
        retrievalCandidateCount: validated.retrievalCandidateCount ?? null,
        retrievalSelectedEvidenceCount: validated.retrievalSelectedEvidenceCount ?? null,
        retrievalRerankerUsed: validated.retrievalRerankerUsed ?? null,
        memoryScope: validated.memoryScope ?? null,
        memoryKind: validated.memoryKind ?? null,
        memoryOrigin: validated.memoryOrigin ?? null,
        memoryAction: validated.memoryAction ?? null,
        occurredAt: validated.occurredAt,
        utcDay: buckets.day,
        utcWeek: buckets.week,
        utcMonth: buckets.month,
      }).returning().get();
      return eventFromRow(row);
    } catch (error) {
      const raced = this.getEventByDedupeKey(validated.dedupeKey);
      if (raced) return raced;
      throw error;
    }
  }

  getEventByDedupeKey(dedupeKey: string): AITelemetryEvent | null {
    const row = this.database.db.select().from(aiTelemetryEvents).where(eq(aiTelemetryEvents.dedupeKey, dedupeKey)).get();
    return row ? eventFromRow(row) : null;
  }

  listEvents(input: { from: number; to: number; subjectKey?: string }): AITelemetryEvent[] {
    return this.database.db.select().from(aiTelemetryEvents).where(and(
      gte(aiTelemetryEvents.occurredAt, input.from),
      lt(aiTelemetryEvents.occurredAt, input.to),
      input.subjectKey === undefined ? undefined : eq(aiTelemetryEvents.subjectKey, input.subjectKey),
    )).orderBy(asc(aiTelemetryEvents.occurredAt), asc(aiTelemetryEvents.id)).all().map(eventFromRow);
  }

  insertRetrievalTrace(input: AIRetrievalTraceRowInput): { trace: AIRetrievalTrace; inserted: boolean } {
    const existing = this.getRetrievalTraceByRequestId(input.retrievalRequestId);
    if (existing) return { trace: existing, inserted: false };
    try {
      const row = this.database.db.insert(aiRetrievalTraces).values(input).returning().get();
      return { trace: retrievalTraceFromRow(row), inserted: true };
    } catch (error) {
      const raced = this.getRetrievalTraceByRequestId(input.retrievalRequestId);
      if (raced) return { trace: raced, inserted: false };
      throw error;
    }
  }

  getRetrievalTraceByRequestId(requestId: string): AIRetrievalTrace | null {
    const row = this.database.db.select().from(aiRetrievalTraces).where(eq(aiRetrievalTraces.retrievalRequestId, requestId)).get();
    return row ? retrievalTraceFromRow(row) : null;
  }

  getRetrievalTraceDetailsByRequestId(requestId: string): AIRetrievalTraceDetails | null {
    const trace = this.getRetrievalTraceByRequestId(requestId);
    if (!trace) return null;
    const origins = this.database.db.select().from(aiRetrievalTraceOrigins).where(eq(aiRetrievalTraceOrigins.traceId, trace.id)).orderBy(asc(aiRetrievalTraceOrigins.ordinal)).all().map(originFromRow);
    const projections = this.database.db.select().from(aiRetrievalTraceProjections).where(eq(aiRetrievalTraceProjections.traceId, trace.id)).orderBy(asc(aiRetrievalTraceProjections.projectionKind), asc(aiRetrievalTraceProjections.ordinal)).all().map(projectionFromRow);
    const items = this.database.db.select().from(aiRetrievalTraceItems).where(eq(aiRetrievalTraceItems.traceId, trace.id)).orderBy(asc(aiRetrievalTraceItems.ordinal)).all().map(itemFromRow);
    return { ...trace, origins, projections, items };
  }

  insertRetrievalTraceOrigin(input: AIRetrievalTraceOriginRowInput): void {
    this.database.db.insert(aiRetrievalTraceOrigins).values(input).onConflictDoNothing().run();
  }

  insertRetrievalTraceProjection(input: AIRetrievalTraceProjectionRowInput): void {
    this.database.db.insert(aiRetrievalTraceProjections).values(input).onConflictDoNothing().run();
  }

  insertRetrievalTraceItem(input: AIRetrievalTraceItemRowInput): void {
    this.database.db.insert(aiRetrievalTraceItems).values(input).onConflictDoNothing().run();
  }

  insertDiagnostics(input: AITutorResponseDiagnosticsRowInput): AITutorResponseDiagnostics {
    const existing = this.getDiagnosticsByResponseId(input.responseId);
    if (existing) return existing;
    const row = this.database.db.insert(aiTutorResponseDiagnostics).values(input).returning().get();
    return diagnosticsFromRow(row);
  }

  getDiagnosticsByResponseId(responseId: string): AITutorResponseDiagnostics | null {
    const row = this.database.db.select().from(aiTutorResponseDiagnostics).where(eq(aiTutorResponseDiagnostics.responseId, responseId)).get();
    return row ? diagnosticsFromRow(row) : null;
  }

  insertFeedback(input: AIFeedbackRowInput): AIFeedbackEvent {
    validateFeedbackInput({ dedupeKey: input.dedupeKey, principalRef: "telemetry", responseId: input.responseId, feedbackType: input.feedbackType, reasonCode: input.reasonCode, sourceSurface: input.sourceSurface, occurredAt: input.occurredAt });
    const existing = this.database.db.select().from(aiFeedbackEvents).where(eq(aiFeedbackEvents.dedupeKey, input.dedupeKey)).get();
    if (existing) return feedbackFromRow(existing);
    const row = this.database.db.insert(aiFeedbackEvents).values({ ...input, privacyClass: "DEIDENTIFIED_METADATA" }).returning().get();
    return feedbackFromRow(row);
  }

  listFeedback(input: { from: number; to: number; subjectKey?: string }): AIFeedbackEvent[] {
    return this.database.db.select().from(aiFeedbackEvents).where(and(
      gte(aiFeedbackEvents.occurredAt, input.from),
      lt(aiFeedbackEvents.occurredAt, input.to),
      input.subjectKey === undefined ? undefined : eq(aiFeedbackEvents.subjectKey, input.subjectKey),
    )).orderBy(asc(aiFeedbackEvents.occurredAt), asc(aiFeedbackEvents.id)).all().map(feedbackFromRow);
  }

  purgePrincipal(principalRef: string): number {
    const principal = this.getPrincipalByRef(principalRef);
    if (!principal) return 0;
    return this.database.client.inTransaction
      ? this.purgePrincipalInTransaction(principal.id, principalRef)
      : this.database.client.transaction(() => this.purgePrincipalInTransaction(principal.id, principalRef)).immediate();
  }

  private purgePrincipalInTransaction(principalId: string, principalRef: string): number {
    const current = this.getPrincipal(principalId);
    if (!current) return 0;
    if (current.state === "ACTIVE") {
      this.database.db.update(aiAnalyticsPrincipals).set({ state: "PURGING", updatedAt: current.updatedAt }).where(and(eq(aiAnalyticsPrincipals.id, principalId), eq(aiAnalyticsPrincipals.state, "ACTIVE"))).run();
    }
    let removed = 0;
    removed += this.database.db.delete(aiTelemetryEvents).where(eq(aiTelemetryEvents.analyticsPrincipalId, principalId)).run().changes;
    removed += this.database.db.delete(aiFeedbackEvents).where(eq(aiFeedbackEvents.analyticsPrincipalId, principalId)).run().changes;
    removed += this.database.db.delete(aiTutorResponseDiagnostics).where(eq(aiTutorResponseDiagnostics.analyticsPrincipalId, principalId)).run().changes;
    const traceRows = this.database.db.select({ id: aiRetrievalTraces.id }).from(aiRetrievalTraces).where(eq(aiRetrievalTraces.analyticsPrincipalId, principalId)).all();
    for (const trace of traceRows) {
      removed += this.database.db.delete(aiRetrievalTraceItems).where(eq(aiRetrievalTraceItems.traceId, trace.id)).run().changes;
      removed += this.database.db.delete(aiRetrievalTraceProjections).where(eq(aiRetrievalTraceProjections.traceId, trace.id)).run().changes;
      removed += this.database.db.delete(aiRetrievalTraceOrigins).where(eq(aiRetrievalTraceOrigins.traceId, trace.id)).run().changes;
      removed += this.database.db.delete(aiRetrievalTraces).where(eq(aiRetrievalTraces.id, trace.id)).run().changes;
    }
    this.database.db.delete(aiAnalyticsPrincipals).where(and(eq(aiAnalyticsPrincipals.id, principalId), eq(aiAnalyticsPrincipals.principalRef, principalRef), eq(aiAnalyticsPrincipals.state, "PURGING"))).run();
    return removed;
  }
}

function principalFromRow(row: AIAnalyticsPrincipalRow): AIAnalyticsPrincipal {
  return { id: row.id, state: row.state, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function eventFromRow(row: AITelemetryEventRow): AITelemetryEvent {
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    eventType: row.eventType,
    eventVersion: row.eventVersion,
    privacyClass: row.privacyClass,
    analyticsPrincipalId: row.analyticsPrincipalId,
    subjectKey: row.subjectKey,
    conversationId: row.conversationId,
    responseId: row.responseId,
    responseTraceId: row.responseTraceId,
    retrievalTraceId: row.retrievalTraceId,
    costOperationId: row.costOperationId,
    modelConfigId: row.modelConfigId,
    modelConfigRevision: row.modelConfigRevision,
    providerConfigId: row.providerConfigId,
    providerConfigRevision: row.providerConfigRevision,
    tutorConfigId: row.tutorConfigId,
    tutorConfigRevision: row.tutorConfigRevision,
    contextPolicyId: row.contextPolicyId,
    contextPolicyRevision: row.contextPolicyRevision,
    retrievalConfigId: row.retrievalConfigId,
    retrievalConfigRevision: row.retrievalConfigRevision,
    memoryPolicyId: row.memoryPolicyId,
    memoryPolicyRevision: row.memoryPolicyRevision,
    memoryId: row.memoryId,
    memoryRevision: row.memoryRevision,
    failureCode: row.failureCode,
    durationMs: row.durationMs,
    providerLatencyMs: row.providerLatencyMs,
    firstTokenLatencyMs: row.firstTokenLatencyMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    reasoningTokens: row.reasoningTokens,
    knownCostNano: row.knownCostNano,
    retrievalCandidateCount: row.retrievalCandidateCount,
    retrievalSelectedEvidenceCount: row.retrievalSelectedEvidenceCount,
    retrievalRerankerUsed: row.retrievalRerankerUsed,
    memoryScope: row.memoryScope,
    memoryKind: row.memoryKind,
    memoryOrigin: row.memoryOrigin,
    memoryAction: row.memoryAction,
    occurredAt: row.occurredAt,
    utcDay: row.utcDay,
    utcWeek: row.utcWeek,
    utcMonth: row.utcMonth,
  };
}

function retrievalTraceFromRow(row: AIRetrievalTraceRow): AIRetrievalTrace {
  return {
    id: row.id,
    retrievalRequestId: row.retrievalRequestId,
    analyticsPrincipalId: row.analyticsPrincipalId,
    subjectKey: row.subjectKey,
    conversationId: row.conversationId,
    responseId: row.responseId,
    responseTraceId: row.responseTraceId,
    costOperationId: row.costOperationId,
    retrievalConfigId: row.retrievalConfigId,
    retrievalConfigRevision: row.retrievalConfigRevision,
    fusionAlgorithmKey: row.fusionAlgorithmKey,
    fusionAlgorithmRevision: row.fusionAlgorithmRevision,
    mode: row.mode as AIRetrievalTrace["mode"],
    degraded: row.degraded,
    sufficient: row.sufficient,
    status: row.status as AIRetrievalTrace["status"],
    safeReason: row.safeReason,
    candidateCounts: { lexical: row.lexicalCandidateCount, semantic: row.semanticCandidateCount, fused: row.fusedCandidateCount, reranked: row.rerankedCandidateCount, evidence: row.evidenceItemCount },
    eligibleOriginCount: row.eligibleOriginCount,
    retrievalLatencyMs: row.retrievalLatencyMs,
    queryEmbeddingLatencyMs: row.queryEmbeddingLatencyMs,
    rerankLatencyMs: row.rerankLatencyMs,
    embeddingModelConfigId: row.embeddingModelConfigId,
    embeddingModelConfigRevision: row.embeddingModelConfigRevision,
    embeddingProviderConfigId: row.embeddingProviderConfigId,
    embeddingProviderConfigRevision: row.embeddingProviderConfigRevision,
    rerankModelConfigId: row.rerankModelConfigId,
    rerankModelConfigRevision: row.rerankModelConfigRevision,
    rerankProviderConfigId: row.rerankProviderConfigId,
    rerankProviderConfigRevision: row.rerankProviderConfigRevision,
    rerankerUsed: row.rerankerUsed,
    fingerprint: row.fingerprint,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

function originFromRow(row: AIRetrievalTraceOriginRow): AIRetrievalTraceOrigin {
  return { ordinal: row.ordinal, originKind: row.originKind, originId: row.originId, subjectKey: row.subjectKey, projectionSetId: row.projectionSetId, projectionRevisionId: row.projectionRevisionId };
}

function projectionFromRow(row: AIRetrievalTraceProjectionRow): AIRetrievalTraceProjection {
  return { projectionKind: row.projectionKind as AIRetrievalTraceProjection["projectionKind"], ordinal: row.ordinal, projectionRevisionId: row.projectionRevisionId, projectionSetId: row.projectionSetId, originKind: row.originKind, originId: row.originId };
}

function itemFromRow(row: AIRetrievalTraceItemRow): AIRetrievalTraceItem {
  return { ordinal: row.ordinal, chunkId: row.chunkId, originKind: row.originKind, originId: row.originId, m7aProjectionRevisionId: row.m7aProjectionRevisionId, m7bEmbeddingProjectionRevisionId: row.m7bEmbeddingProjectionRevisionId, lexicalRank: row.lexicalRank, semanticRank: row.semanticRank, cosineSimilarityUnits: row.cosineSimilarityUnits, fusionScoreUnits: row.fusionScoreUnits, rerankRank: row.rerankRank, rerankScoreUnits: row.rerankScoreUnits };
}

function diagnosticsFromRow(row: AITutorResponseDiagnosticsRow): AITutorResponseDiagnostics {
  return {
    id: row.id,
    responseTraceId: row.responseTraceId,
    responseId: row.responseId,
    conversationId: row.conversationId,
    analyticsPrincipalId: row.analyticsPrincipalId,
    subjectKey: row.subjectKey,
    retrievalTraceId: row.retrievalTraceId,
    costOperationId: row.costOperationId,
    terminalStatus: row.terminalStatus,
    groundingValidationStatus: row.groundingValidationStatus,
    citationValidationStatus: row.citationValidationStatus,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    overallLatencyMs: row.overallLatencyMs,
    providerLatencyMs: row.providerLatencyMs,
    firstTokenLatencyMs: row.firstTokenLatencyMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    reasoningTokens: row.reasoningTokens,
    knownCostNano: row.knownCostNano,
    usageRecordCount: row.usageRecordCount,
    createdAt: row.createdAt,
  };
}

function feedbackFromRow(row: AIFeedbackEventRow): AIFeedbackEvent {
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    feedbackType: row.feedbackType,
    reasonCode: row.reasonCode,
    sourceSurface: row.sourceSurface,
    responseId: row.responseId,
    conversationId: row.conversationId,
    responseTraceId: row.responseTraceId,
    analyticsPrincipalId: row.analyticsPrincipalId,
    subjectKey: row.subjectKey,
    privacyClass: row.privacyClass,
    occurredAt: row.occurredAt,
  };
}
