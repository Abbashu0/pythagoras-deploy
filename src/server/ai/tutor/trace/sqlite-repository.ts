import { and, asc, eq } from "drizzle-orm";

import type { ContentDatabase } from "../../../content/database";
import { aiTutorResponseTraces, aiTutorTraceEvidenceRefs, aiTutorTraceProjectionRefs, type AITutorResponseTraceRow, type AITutorTraceEvidenceRefRow, type AITutorTraceProjectionRefRow } from "../../../content/schema";
import type { AITutorResponseTrace, AITutorResponseTraceRepository, AITutorTraceCreateInput, AITutorTraceEvidenceRef, AITutorTraceProjectionRef, AITutorTraceSafeErrorCode, AITutorTraceStatus } from "./contracts";
import { AITutorTraceError } from "./errors";
import { validateTraceCreateInput } from "./validation";

export class SQLiteAITutorResponseTraceRepository implements AITutorResponseTraceRepository {
  constructor(private readonly database: ContentDatabase) {}

  create(input: AITutorTraceCreateInput): AITutorResponseTrace {
    validateTraceCreateInput(input);
    try {
      return this.database.client.transaction(() => {
        const row = this.database.db.insert(aiTutorResponseTraces).values({
          id: input.trace.id,
          responseId: input.trace.responseId,
          conversationId: input.trace.conversationId,
          principalRef: input.trace.principalRef,
          subjectKey: input.trace.subjectKey,
          tutorConfigId: input.trace.tutorConfigId,
          tutorConfigRevision: input.trace.tutorConfigRevision,
          contextSnapshotId: input.trace.contextSnapshotId,
          contextSnapshotFingerprint: input.trace.contextSnapshotFingerprint,
          retrievalConfigId: input.trace.retrievalConfigId,
          retrievalConfigRevision: input.trace.retrievalConfigRevision,
          fusionAlgorithmKey: input.trace.fusionAlgorithmKey,
          fusionAlgorithmRevision: input.trace.fusionAlgorithmRevision,
          generationModelConfigId: input.trace.generationModelConfigId,
          generationModelConfigRevision: input.trace.generationModelConfigRevision,
          generationProviderConfigId: input.trace.generationProviderConfigId,
          generationProviderConfigRevision: input.trace.generationProviderConfigRevision,
          providerModelId: input.trace.providerModelId,
          adapterKey: input.trace.adapterKey,
          groundingProtocolKey: input.trace.groundingProtocolKey,
          groundingProtocolRevision: input.trace.groundingProtocolRevision,
          citationProtocolKey: input.trace.citationProtocolKey,
          citationProtocolRevision: input.trace.citationProtocolRevision,
          costOperationId: input.trace.costOperationId,
          budgetReservationId: input.trace.budgetReservationId,
          budgetPolicyId: input.trace.budgetPolicyId,
          budgetPolicyRevision: input.trace.budgetPolicyRevision,
          rateLimitPolicyId: input.trace.rateLimitPolicyId,
          rateLimitPolicyRevision: input.trace.rateLimitPolicyRevision,
          planFingerprint: input.trace.planFingerprint,
          status: input.trace.status,
          safeErrorCode: input.trace.safeErrorCode,
          createdAt: input.trace.createdAt,
          updatedAt: input.trace.updatedAt,
          completedAt: input.trace.completedAt,
        }).returning().get();
        for (const ref of input.projectionRefs) this.database.db.insert(aiTutorTraceProjectionRefs).values(ref).run();
        for (const ref of input.evidenceRefs) this.database.db.insert(aiTutorTraceEvidenceRefs).values(ref).run();
        return traceFromRow(row);
      }).immediate();
    } catch (error) {
      if (error instanceof AITutorTraceError) throw error;
      throw new AITutorTraceError("AI_TUTOR_TRACE_CONFLICT", "The Tutor Response Trace could not be created safely.", {}, error);
    }
  }

  getById(id: string): AITutorResponseTrace | null {
    const row = this.database.db.select().from(aiTutorResponseTraces).where(eq(aiTutorResponseTraces.id, id)).get();
    return row ? traceFromRow(row) : null;
  }

  getByResponse(responseId: string): AITutorResponseTrace | null {
    const row = this.database.db.select().from(aiTutorResponseTraces).where(eq(aiTutorResponseTraces.responseId, responseId)).get();
    return row ? traceFromRow(row) : null;
  }

  listProjectionRefs(traceId: string): AITutorTraceProjectionRef[] {
    return this.database.db.select().from(aiTutorTraceProjectionRefs).where(eq(aiTutorTraceProjectionRefs.traceId, traceId)).orderBy(asc(aiTutorTraceProjectionRefs.projectionKind), asc(aiTutorTraceProjectionRefs.projectionRevisionId)).all().map(projectionRefFromRow);
  }

  listEvidenceRefs(traceId: string): AITutorTraceEvidenceRef[] {
    return this.database.db.select().from(aiTutorTraceEvidenceRefs).where(eq(aiTutorTraceEvidenceRefs.traceId, traceId)).orderBy(asc(aiTutorTraceEvidenceRefs.ordinal)).all().map(evidenceRefFromRow);
  }

  transition(input: { id: string; expectedStatus: AITutorTraceStatus; status: AITutorTraceStatus; updatedAt: number; completedAt: number | null; safeErrorCode: AITutorTraceSafeErrorCode | null }): AITutorResponseTrace {
    const row = this.database.db.update(aiTutorResponseTraces).set({ status: input.status, updatedAt: input.updatedAt, completedAt: input.completedAt, safeErrorCode: input.safeErrorCode }).where(and(eq(aiTutorResponseTraces.id, input.id), eq(aiTutorResponseTraces.status, input.expectedStatus))).returning().get();
    if (!row) throw new AITutorTraceError("AI_TUTOR_TRACE_LIFECYCLE_INVALID", "The Tutor Response Trace changed before its lifecycle transition.");
    return traceFromRow(row);
  }
}

function traceFromRow(row: AITutorResponseTraceRow): AITutorResponseTrace {
  return {
    id: row.id,
    responseId: row.responseId,
    conversationId: row.conversationId,
    principalRef: row.principalRef,
    subjectKey: row.subjectKey,
    tutorConfigId: row.tutorConfigId,
    tutorConfigRevision: row.tutorConfigRevision,
    contextSnapshotId: row.contextSnapshotId,
    contextSnapshotFingerprint: row.contextSnapshotFingerprint,
    retrievalConfigId: row.retrievalConfigId,
    retrievalConfigRevision: row.retrievalConfigRevision,
    fusionAlgorithmKey: row.fusionAlgorithmKey,
    fusionAlgorithmRevision: row.fusionAlgorithmRevision,
    generationModelConfigId: row.generationModelConfigId,
    generationModelConfigRevision: row.generationModelConfigRevision,
    generationProviderConfigId: row.generationProviderConfigId,
    generationProviderConfigRevision: row.generationProviderConfigRevision,
    providerModelId: row.providerModelId,
    adapterKey: row.adapterKey,
    groundingProtocolKey: row.groundingProtocolKey,
    groundingProtocolRevision: row.groundingProtocolRevision,
    citationProtocolKey: row.citationProtocolKey,
    citationProtocolRevision: row.citationProtocolRevision,
    costOperationId: row.costOperationId,
    budgetReservationId: row.budgetReservationId,
    budgetPolicyId: row.budgetPolicyId,
    budgetPolicyRevision: row.budgetPolicyRevision,
    rateLimitPolicyId: row.rateLimitPolicyId,
    rateLimitPolicyRevision: row.rateLimitPolicyRevision,
    planFingerprint: row.planFingerprint,
    status: row.status,
    safeErrorCode: row.safeErrorCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

function projectionRefFromRow(row: AITutorTraceProjectionRefRow): AITutorTraceProjectionRef {
  return { traceId: row.traceId, projectionKind: row.projectionKind, projectionRevisionId: row.projectionRevisionId };
}

function evidenceRefFromRow(row: AITutorTraceEvidenceRefRow): AITutorTraceEvidenceRef {
  return { traceId: row.traceId, ordinal: row.ordinal, citationLabel: row.citationLabel, chunkId: row.chunkId, m7aProjectionRevisionId: row.m7aProjectionRevisionId, m7bEmbeddingProjectionRevisionId: row.m7bEmbeddingProjectionRevisionId, originKind: row.originKind, originId: row.originId, questionId: row.questionId, questionRevision: row.questionRevision };
}
