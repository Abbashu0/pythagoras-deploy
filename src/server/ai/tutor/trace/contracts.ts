export const AI_TUTOR_TRACE_STATUSES = [
  "PLANNED",
  "STREAMING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "BLOCKED",
] as const;
export type AITutorTraceStatus = (typeof AI_TUTOR_TRACE_STATUSES)[number];

export const AI_TUTOR_TRACE_PROJECTION_KINDS = ["M7A", "M7B"] as const;
export type AITutorTraceProjectionKind = (typeof AI_TUTOR_TRACE_PROJECTION_KINDS)[number];

export const AI_TUTOR_TRACE_ORIGIN_KINDS = ["KNOWLEDGE_PACKAGE", "QUESTION_PACKAGE"] as const;
export type AITutorTraceOriginKind = (typeof AI_TUTOR_TRACE_ORIGIN_KINDS)[number];

export const AI_TUTOR_TRACE_SAFE_ERROR_CODES = [
  "AI_TUTOR_TRACE_INVALID",
  "AI_TUTOR_TRACE_BLOCKED",
  "AI_TUTOR_TRACE_FAILED",
  "AI_TUTOR_TRACE_CANCELLED",
] as const;
export type AITutorTraceSafeErrorCode = (typeof AI_TUTOR_TRACE_SAFE_ERROR_CODES)[number];

export interface AITutorResponseTrace {
  id: string;
  responseId: string;
  conversationId: string;
  principalRef: string;
  subjectKey: string;
  tutorConfigId: string;
  tutorConfigRevision: number;
  contextSnapshotId: string;
  contextSnapshotFingerprint: string;
  retrievalConfigId: string;
  retrievalConfigRevision: number;
  fusionAlgorithmKey: string;
  fusionAlgorithmRevision: number;
  generationModelConfigId: string;
  generationModelConfigRevision: number;
  generationProviderConfigId: string;
  generationProviderConfigRevision: number;
  providerModelId: string;
  adapterKey: string;
  groundingProtocolKey: string;
  groundingProtocolRevision: number;
  citationProtocolKey: string;
  citationProtocolRevision: number;
  costOperationId: string;
  budgetReservationId: string;
  budgetPolicyId: string;
  budgetPolicyRevision: number;
  rateLimitPolicyId: string;
  rateLimitPolicyRevision: number;
  planFingerprint: string;
  status: AITutorTraceStatus;
  safeErrorCode: AITutorTraceSafeErrorCode | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface AITutorTraceProjectionRef {
  traceId: string;
  projectionKind: AITutorTraceProjectionKind;
  projectionRevisionId: string;
}

export type AITutorTraceProjectionRefCreate = Omit<AITutorTraceProjectionRef, "traceId">;

export interface AITutorTraceEvidenceRef {
  traceId: string;
  ordinal: number;
  citationLabel: string;
  chunkId: string;
  m7aProjectionRevisionId: string;
  m7bEmbeddingProjectionRevisionId: string | null;
  originKind: AITutorTraceOriginKind;
  originId: string;
  questionId: string | null;
  questionRevision: number | null;
}

export type AITutorTraceEvidenceRefCreate = Omit<AITutorTraceEvidenceRef, "traceId">;

export interface AITutorTraceCreateInput {
  trace: AITutorResponseTrace;
  projectionRefs: readonly AITutorTraceProjectionRefCreate[];
  evidenceRefs: readonly AITutorTraceEvidenceRefCreate[];
}

export interface AITutorResponseTraceRepository {
  create(input: AITutorTraceCreateInput): AITutorResponseTrace;
  getById(id: string): AITutorResponseTrace | null;
  getByResponse(responseId: string): AITutorResponseTrace | null;
  listProjectionRefs(traceId: string): AITutorTraceProjectionRef[];
  listEvidenceRefs(traceId: string): AITutorTraceEvidenceRef[];
  transition(input: { id: string; expectedStatus: AITutorTraceStatus; status: AITutorTraceStatus; updatedAt: number; completedAt: number | null; safeErrorCode: AITutorTraceSafeErrorCode | null }): AITutorResponseTrace;
}
