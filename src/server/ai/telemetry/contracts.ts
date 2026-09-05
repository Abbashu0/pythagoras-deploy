import type { AIEvidencePack, AIHybridRetrievalTrace } from "../retrieval";

export const AI_TELEMETRY_EVENT_VERSION = 1 as const;

export const AI_TELEMETRY_EVENT_TYPES = [
  "TUTOR_REQUEST_STARTED",
  "TUTOR_REQUEST_COMPLETED",
  "TUTOR_REQUEST_FAILED",
  "RETRIEVAL_STARTED",
  "RETRIEVAL_COMPLETED",
  "RETRIEVAL_INSUFFICIENT",
  "RETRIEVAL_FAILED",
  "GROUNDING_VALIDATION_PASSED",
  "GROUNDING_VALIDATION_FAILED",
  "MEMORY_MUTATION_APPLIED",
  "MEMORY_MUTATION_REJECTED",
  "COMPACTION_SCHEDULED",
  "COMPACTION_COMPLETED",
  "COMPACTION_FAILED",
  "FEEDBACK_POSITIVE",
  "FEEDBACK_NEGATIVE",
  "FEEDBACK_REPORTED",
] as const;
export type AITelemetryEventType = (typeof AI_TELEMETRY_EVENT_TYPES)[number];

export const AI_TELEMETRY_PRIVACY_CLASSES = ["DEIDENTIFIED_METADATA"] as const;
export type AITelemetryPrivacyClass = (typeof AI_TELEMETRY_PRIVACY_CLASSES)[number];

export const AI_TELEMETRY_FAILURE_CODES = [
  "ADMISSION_REJECTED",
  "RATE_LIMITED",
  "BUDGET_REJECTED",
  "CONCURRENCY_LIMITED",
  "CIRCUIT_OPEN",
  "RETRIEVAL_INSUFFICIENT",
  "RETRIEVAL_FAILED",
  "PROVIDER_ERROR",
  "PROVIDER_TIMEOUT",
  "GROUNDING_INVALID",
  "CITATION_INVALID",
  "INPUT_LOST",
  "CANCELLED",
  "CONFIGURATION_CHANGED",
  "MEMORY_CONFLICT",
  "MEMORY_POLICY_DISABLED",
  "COMPACTION_SOURCE_INVALID",
  "INTERNAL_ERROR",
] as const;
export type AITelemetryFailureCode = (typeof AI_TELEMETRY_FAILURE_CODES)[number];

export const AI_TELEMETRY_MEMORY_ACTIONS = ["NOOP", "CREATE", "UPDATE", "ADD_EVIDENCE", "ACTIVATE", "RESOLVE", "DELETE"] as const;
export type AITelemetryMemoryAction = (typeof AI_TELEMETRY_MEMORY_ACTIONS)[number];

export const AI_TELEMETRY_MEMORY_SCOPES = ["GLOBAL", "SUBJECT"] as const;
export type AITelemetryMemoryScope = (typeof AI_TELEMETRY_MEMORY_SCOPES)[number];

export const AI_TELEMETRY_MEMORY_ORIGINS = ["EXPLICIT", "INFERRED", "LEGACY_SUBJECT"] as const;
export type AITelemetryMemoryOrigin = (typeof AI_TELEMETRY_MEMORY_ORIGINS)[number];

export const AI_TELEMETRY_MEMORY_KINDS = [
  "LEARNING_PREFERENCE",
  "EXPLANATION_PREFERENCE",
  "RESPONSE_DEPTH_PREFERENCE",
  "FORM_OF_ADDRESS",
  "PREFERRED_NAME",
  "LEARNING_DIFFICULTY",
  "STUDY_GOAL",
  "STUDY_PROGRESS",
  "LEARNING_STRATEGY_PREFERENCE",
] as const;
export type AITelemetryMemoryKind = (typeof AI_TELEMETRY_MEMORY_KINDS)[number];

export const AI_TELEMETRY_TERMINAL_STATUSES = ["COMPLETED", "BLOCKED", "FAILED", "CANCELLED"] as const;
export type AITelemetryTerminalStatus = (typeof AI_TELEMETRY_TERMINAL_STATUSES)[number];

export const AI_TELEMETRY_VALIDATION_STATUSES = ["PASSED", "FAILED", "NOT_RUN"] as const;
export type AITelemetryValidationStatus = (typeof AI_TELEMETRY_VALIDATION_STATUSES)[number];

export const AI_TELEMETRY_FEEDBACK_TYPES = ["POSITIVE", "NEGATIVE", "REPORT"] as const;
export type AITelemetryFeedbackType = (typeof AI_TELEMETRY_FEEDBACK_TYPES)[number];

export const AI_TELEMETRY_FEEDBACK_REASON_CODES = [
  "HELPFUL",
  "NOT_HELPFUL",
  "INCORRECT",
  "MISSING_EVIDENCE",
  "UNSAFE",
  "OTHER",
] as const;
export type AITelemetryFeedbackReasonCode = (typeof AI_TELEMETRY_FEEDBACK_REASON_CODES)[number];

export const AI_TELEMETRY_FEEDBACK_SURFACES = ["TUTOR", "INTERNAL"] as const;
export type AITelemetryFeedbackSurface = (typeof AI_TELEMETRY_FEEDBACK_SURFACES)[number];

export const AI_TELEMETRY_PRINCIPAL_STATES = ["ACTIVE", "PURGING"] as const;
export type AITelemetryPrincipalState = (typeof AI_TELEMETRY_PRINCIPAL_STATES)[number];

export interface AIAnalyticsPrincipal {
  id: string;
  state: AITelemetryPrincipalState;
  createdAt: number;
  updatedAt: number;
}

export interface AITelemetryCorrelation {
  principalRef?: string | null;
  subjectKey?: string | null;
  conversationId?: string | null;
  responseId?: string | null;
  responseTraceId?: string | null;
  retrievalTraceId?: string | null;
  costOperationId?: string | null;
  modelConfigId?: string | null;
  modelConfigRevision?: number | null;
  providerConfigId?: string | null;
  providerConfigRevision?: number | null;
  tutorConfigId?: string | null;
  tutorConfigRevision?: number | null;
  contextPolicyId?: string | null;
  contextPolicyRevision?: number | null;
  retrievalConfigId?: string | null;
  retrievalConfigRevision?: number | null;
  memoryPolicyId?: string | null;
  memoryPolicyRevision?: number | null;
  memoryId?: string | null;
  memoryRevision?: number | null;
}

export interface AITelemetryEventInput extends AITelemetryCorrelation {
  id?: string;
  dedupeKey: string;
  eventType: AITelemetryEventType;
  eventVersion?: number;
  privacyClass?: AITelemetryPrivacyClass;
  failureCode?: AITelemetryFailureCode | null;
  durationMs?: number | null;
  providerLatencyMs?: number | null;
  firstTokenLatencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  knownCostNano?: number | null;
  retrievalCandidateCount?: number | null;
  retrievalSelectedEvidenceCount?: number | null;
  retrievalRerankerUsed?: boolean | null;
  memoryScope?: AITelemetryMemoryScope | null;
  memoryKind?: AITelemetryMemoryKind | null;
  memoryOrigin?: AITelemetryMemoryOrigin | null;
  memoryAction?: AITelemetryMemoryAction | null;
  occurredAt: number;
}

export interface AITelemetryEvent extends Omit<AITelemetryEventInput, "principalRef"> {
  id: string;
  analyticsPrincipalId: string | null;
  principalRef?: never;
  eventVersion: number;
  privacyClass: AITelemetryPrivacyClass;
  utcDay: string;
  utcWeek: string;
  utcMonth: string;
}

export interface AIRetrievalTraceInput {
  retrievalRequestId: string;
  principalRef?: string | null;
  subjectKey: string;
  conversationId?: string | null;
  responseId?: string | null;
  responseTraceId?: string | null;
  costOperationId?: string | null;
  pack: AIEvidencePack;
  startedAt: number;
  completedAt: number;
  queryEmbeddingLatencyMs?: number | null;
  rerankLatencyMs?: number | null;
}

export interface AIRetrievalTrace extends Omit<AIRetrievalTraceInput, "principalRef" | "pack" | "startedAt" | "completedAt"> {
  id: string;
  analyticsPrincipalId: string | null;
  retrievalConfigId: string;
  retrievalConfigRevision: number;
  fusionAlgorithmKey: string;
  fusionAlgorithmRevision: number;
  mode: "HYBRID" | "LEXICAL_ONLY";
  degraded: boolean;
  sufficient: boolean;
  status: "SUFFICIENT" | "INSUFFICIENT";
  safeReason: string | null;
  candidateCounts: { lexical: number; semantic: number; fused: number; reranked: number; evidence: number };
  eligibleOriginCount: number;
  retrievalLatencyMs: number;
  queryEmbeddingLatencyMs: number | null;
  rerankLatencyMs: number | null;
  embeddingModelConfigId: string | null;
  embeddingModelConfigRevision: number | null;
  embeddingProviderConfigId: string | null;
  embeddingProviderConfigRevision: number | null;
  rerankModelConfigId: string | null;
  rerankModelConfigRevision: number | null;
  rerankProviderConfigId: string | null;
  rerankProviderConfigRevision: number | null;
  rerankerUsed: boolean;
  fingerprint: string;
  createdAt: number;
  completedAt: number;
}

export interface AIRetrievalTraceOrigin {
  ordinal: number;
  originKind: "KNOWLEDGE_PACKAGE" | "QUESTION_PACKAGE";
  originId: string;
  subjectKey: string;
  projectionSetId: string | null;
  projectionRevisionId: string | null;
}

export interface AIRetrievalTraceProjection {
  projectionKind: "M7A" | "M7B";
  ordinal: number;
  projectionRevisionId: string;
  projectionSetId: string | null;
  originKind: "KNOWLEDGE_PACKAGE" | "QUESTION_PACKAGE" | null;
  originId: string | null;
}

export interface AIRetrievalTraceItem {
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

export interface AIRetrievalTraceDetails extends AIRetrievalTrace {
  origins: readonly AIRetrievalTraceOrigin[];
  projections: readonly AIRetrievalTraceProjection[];
  items: readonly AIRetrievalTraceItem[];
}

export interface AITutorResponseDiagnostics {
  id: string;
  responseTraceId: string;
  responseId: string;
  conversationId: string;
  analyticsPrincipalId: string;
  subjectKey: string;
  retrievalTraceId: string | null;
  costOperationId: string;
  terminalStatus: AITelemetryTerminalStatus;
  groundingValidationStatus: AITelemetryValidationStatus;
  citationValidationStatus: AITelemetryValidationStatus;
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

export interface AIFeedbackInput {
  id?: string;
  dedupeKey: string;
  principalRef: string;
  responseId: string;
  feedbackType: AITelemetryFeedbackType;
  reasonCode?: AITelemetryFeedbackReasonCode | null;
  sourceSurface?: AITelemetryFeedbackSurface;
  occurredAt: number;
}

export interface AIFeedbackEvent extends Omit<AIFeedbackInput, "principalRef"> {
  id: string;
  analyticsPrincipalId: string;
  conversationId: string;
  responseTraceId: string | null;
  subjectKey: string;
  privacyClass: AITelemetryPrivacyClass;
}

export interface AITelemetryOverview {
  from: number;
  to: number;
  tutorRequests: { started: number; completed: number; failed: number; successRateUnits: number };
  activeUsers: { dau: number; wau: number; mau: number; requestsPerActiveUser: number };
  usage: { inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; knownCostNano: number | null; costKnownEventCount: number };
  latency: { count: number; averageMs: number | null; p95ReadyValuesMs: number[] };
  retrieval: { sufficient: number; insufficient: number; failed: number; rerankerUsed: number; selectedEvidenceCount: number | null };
  grounding: { passed: number; failed: number };
  memory: { applied: number; rejected: number; noop: number };
  compaction: { scheduled: number; completed: number; failed: number };
  feedback: { positive: number; negative: number; reports: number };
}

export interface AITelemetryTimeSeriesPoint {
  bucket: string;
  tutorStarted: number;
  tutorCompleted: number;
  tutorFailed: number;
  retrievalInsufficient: number;
  groundingFailed: number;
  memoryApplied: number;
  compactionCompleted: number;
  positiveFeedback: number;
  negativeFeedback: number;
  reports: number;
}

export interface AITelemetryBreakdownRow {
  dimension: string;
  count: number;
  failed: number;
  completed: number;
}

export interface AITelemetryReadRange {
  from: number;
  to: number;
  subjectKey?: string;
}

export interface AITelemetryAnalyticsRepository {
  listEvents(input: { from: number; to: number; subjectKey?: string }): AITelemetryEvent[];
  listFeedback(input: { from: number; to: number; subjectKey?: string }): AIFeedbackEvent[];
}

export type AITelemetryRetrievalTraceSource = Pick<AIHybridRetrievalTrace, "candidateCounts" | "selectedChunkIds" | "rankedSignals">;
