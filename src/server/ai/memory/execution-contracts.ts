import type { AdminActor } from "../../admin-auth/contracts";
import type { AIBudgetReservation } from "../budget";
import type { AIConversationMessage, AIConversationResponse } from "../conversations";
import type { AICostOperation } from "../economics";
import type { AIModelConfig } from "../model-registry";
import type { AIProviderConfig } from "../configuration";
import type { AIRateLimitPolicyRevision } from "../rate-limits";
import type { AIMemory, AIMemoryKind, AIMemoryPolicyRevision, AIMemoryPolicyRepository, AIMemoryRepository } from "./contracts";
import type { AIConversationSummary, AIConversationSummaryRepository } from "./summary-contracts";

export const AI_MEMORY_EXECUTION_CONFIG_RESOURCE_TYPE = "ai.memory-execution-config" as const;

export const AI_MEMORY_EXTRACTION_PROTOCOL_KEY = "memory-extraction-v1" as const;
export const AI_MEMORY_EXTRACTION_PROTOCOL_REVISION = 1 as const;
export const AI_CONVERSATION_COMPACTION_PROTOCOL_KEY = "conversation-compaction-v1" as const;
export const AI_CONVERSATION_COMPACTION_PROTOCOL_REVISION = 1 as const;

export const AI_MEMORY_EXTRACTION_OUTBOX_EVENT_TYPE = "ai.memory.extraction.requested" as const;
export const AI_MEMORY_COMPACTION_OUTBOX_EVENT_TYPE = "ai.memory.compaction.requested" as const;
export const AI_MEMORY_EXTRACTION_JOB_KIND = "ai.memory.extraction" as const;
export const AI_MEMORY_COMPACTION_JOB_KIND = "ai.memory.compaction" as const;
export const AI_MEMORY_EXECUTION_PAYLOAD_VERSION = 1 as const;
export const AI_MEMORY_EXTRACTION_RESULT_MAX_CANDIDATES = 100;
export const AI_MEMORY_EXECUTION_MAX_PROMPT_BYTES = 256 * 1024;
export const AI_MEMORY_EXECUTION_MAX_OUTPUT_BYTES = 256 * 1024;
export const AI_MEMORY_EXECUTION_MAX_SOURCE_MESSAGES = 10_000;
export const AI_MEMORY_EXECUTION_MAX_SCHEDULE_KEY_LENGTH = 500;

export const AI_MEMORY_EXECUTION_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "AMBIGUOUS",
  "INPUT_LOST",
] as const;
export type AIMemoryExecutionStatus = (typeof AI_MEMORY_EXECUTION_STATUSES)[number];

export const AI_MEMORY_EXECUTION_KINDS = ["EXTRACTION", "COMPACTION"] as const;
export type AIMemoryExecutionKind = (typeof AI_MEMORY_EXECUTION_KINDS)[number];

export const AI_MEMORY_PROVIDER_INVOCATION_STATES = [
  "NOT_INVOKED",
  "INVOKING",
  "INVOKED_WITH_ACCOUNTING",
  "AMBIGUOUS",
] as const;
export type AIMemoryProviderInvocationState = (typeof AI_MEMORY_PROVIDER_INVOCATION_STATES)[number];
export type AIMemoryExecutionProviderInvocationState = AIMemoryProviderInvocationState;

export interface AIMemoryExecutionConfigContent {
  key: string;
  subjectKey: string;
  displayName: string;
  enabled: boolean;
  generationModelConfigId: string;
  generationModelConfigRevision: number;
  generationProviderConfigId: string;
  generationProviderConfigRevision: number;
  budgetPolicyId: string;
  budgetPolicyRevision: number;
  rateLimitPolicyId: string;
  rateLimitPolicyRevision: number;
  timeoutMs: number;
  extractionMaxOutputTokens: number;
  compactionMaxOutputTokens: number;
  maxExtractionCandidates: number;
  autoApprovalMinConfidenceUnits: number;
  compactionTriggerMessageCount: number;
  compactionRetainRecentMessageCount: number;
}

export interface AIMemoryExecutionConfigRevision extends AIMemoryExecutionConfigContent {
  executionConfigId: string;
  revisionId: string;
  revision: number;
  extractionProtocolKey: typeof AI_MEMORY_EXTRACTION_PROTOCOL_KEY;
  extractionProtocolRevision: typeof AI_MEMORY_EXTRACTION_PROTOCOL_REVISION;
  compactionProtocolKey: typeof AI_CONVERSATION_COMPACTION_PROTOCOL_KEY;
  compactionProtocolRevision: typeof AI_CONVERSATION_COMPACTION_PROTOCOL_REVISION;
  createdAt: number;
  createdBy: string;
}

export interface AIMemoryExecutionConfig extends AIMemoryExecutionConfigRevision {
  id: string;
  currentRevision: number;
  currentRevisionId: string;
  updatedAt: number;
  updatedBy: string;
}

export interface AIMemoryGenerationCostEstimateComponent {
  capability: "GENERATION";
  modelConfigId: string;
  modelConfigRevision: number;
  providerConfigId: string;
  providerConfigRevision: number;
  providerModelId: string;
  rateCardId: string;
  rateCardRevision: number;
  inputTokenUpperBound: number;
  outputTokenUpperBound: number;
  reasoningTokenUpperBound: number;
  requestUnits: number;
  costNano: number;
}

export interface AIMemoryGenerationCostEstimate {
  currency: string;
  maxCostNano: number;
  estimateBasis: string;
  generation: AIMemoryGenerationCostEstimateComponent;
}

export interface AIMemoryExecutionConfigRepository {
  getById(id: string): AIMemoryExecutionConfig | null;
  getByKey(key: string): AIMemoryExecutionConfig | null;
  getBySubjectKey(subjectKey: string): AIMemoryExecutionConfig | null;
  getCurrentRevision(id: string): AIMemoryExecutionConfigRevision | null;
  getRevision(id: string, revision: number): AIMemoryExecutionConfigRevision | null;
  list(): AIMemoryExecutionConfig[];
  create(input: { id: string; content: AIMemoryExecutionConfigContent; actor: AdminActor; now: number }): AIMemoryExecutionConfigRevision;
  appendRevision(input: { id: string; expectedRevision: number; content: AIMemoryExecutionConfigContent; actor: AdminActor; now: number }): AIMemoryExecutionConfigRevision;
}

export interface AIMemoryExecution {
  id: string;
  executionKind: AIMemoryExecutionKind;
  scheduleKey: string;
  principalRef: string;
  subjectKey: string;
  conversationId: string;
  responseId: string;
  requestMessageId: string;
  requestOrdinal: number;
  assistantMessageId: string;
  assistantOrdinal: number;
  executionConfigId: string;
  executionConfigRevision: number;
  executionConfigFingerprint: string;
  generationModelConfigId: string;
  generationModelConfigRevision: number;
  generationProviderConfigId: string;
  generationProviderConfigRevision: number;
  budgetPolicyId: string;
  budgetPolicyRevision: number;
  rateLimitPolicyId: string;
  rateLimitPolicyRevision: number;
  protocolKey: string;
  protocolRevision: number;
  memoryPolicyId: string | null;
  memoryPolicyRevision: number | null;
  baseSummaryId: string | null;
  baseSummaryRevision: number | null;
  baseSummaryCoverage: number | null;
  targetCutoffOrdinal: number | null;
  jobId: string | null;
  costOperationId: string | null;
  budgetReservationId: string | null;
  admissionAttempt: number;
  status: AIMemoryExecutionStatus;
  providerInvocationState: AIMemoryProviderInvocationState;
  providerInvoked: boolean;
  resultSha256: string | null;
  resultByteSize: number | null;
  resultCount: number;
  resultSummaryId: string | null;
  resultSummaryRevision: number | null;
  safeFailureCode: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface AIMemoryExtractionResultLink {
  executionId: string;
  ordinal: number;
  memoryId: string;
}

export interface AIMemoryExecutionSourceMessage {
  role: "USER" | "ASSISTANT";
  ordinal: number;
  content: string;
}

export interface AIMemoryExecutionRepository {
  getById(id: string): AIMemoryExecution | null;
  getByScheduleKey(scheduleKey: string): AIMemoryExecution | null;
  getByJobId(jobId: string): AIMemoryExecution | null;
  listPendingTerminal(limit: number): AIMemoryExecution[];
  create(input: Omit<AIMemoryExecution, "id"> & { id?: string }): AIMemoryExecution;
  bindJob(id: string, jobId: string, now: number): AIMemoryExecution;
  bindCostOperation(id: string, costOperationId: string, now: number): AIMemoryExecution;
  bindReservation(id: string, budgetReservationId: string, now: number): AIMemoryExecution;
  incrementAdmissionAttempt(id: string, now: number): AIMemoryExecution;
  markAdmissionRetry(id: string, safeFailureCode: string, now: number): AIMemoryExecution;
  markRunning(id: string, now: number): AIMemoryExecution;
  markInvoking(id: string, now: number): AIMemoryExecution;
  markInvokedWithAccounting(id: string, now: number): AIMemoryExecution;
  complete(input: { id: string; resultSha256: string; resultByteSize: number; resultCount: number; resultSummaryId?: string | null; resultSummaryRevision?: number | null; now: number }): AIMemoryExecution;
  fail(input: { id: string; safeFailureCode: string; resultSha256?: string | null; resultByteSize?: number | null; now: number }): AIMemoryExecution;
  cancel(input: { id: string; safeFailureCode: string; now: number }): AIMemoryExecution;
  ambiguous(input: { id: string; safeFailureCode: string; now: number }): AIMemoryExecution;
  inputLost(input: { id: string; safeFailureCode: string; now: number }): AIMemoryExecution;
  insertExtractionResultInTransaction(input: AIMemoryExtractionResultLink): AIMemoryExtractionResultLink;
  listExtractionResults(executionId: string): AIMemoryExtractionResultLink[];
}

export interface AIMemoryExecutionSourceReader {
  getSource(input: {
    principalRef: string;
    subjectKey: string;
    conversationId: string;
    responseId: string;
    requestMessageId: string;
    assistantMessageId: string;
  }): AIMemoryExecutionSource | null;
  listMessages(input: { conversationId: string; fromOrdinal: number; toOrdinal: number }): AIMemoryExecutionSourceMessage[];
}

export interface AIMemoryExecutionRunResult {
  executionId: string;
  status: AIMemoryExecutionStatus;
  providerInvoked: boolean;
  costOperationId: string | null;
  budgetReservationId: string | null;
  memoryIds: readonly string[];
  summaryId: string | null;
}

export interface AIMemoryScheduleResult {
  extractionExecutionId: string | null;
  compactionExecutionId: string | null;
  extractionOutboxId: string | null;
  compactionOutboxId: string | null;
}

/** Narrow dependency bundle used by the canonical result/provenance boundary. */
export interface AIMemoryExecutionDomainDependencies {
  memoryPolicies: AIMemoryPolicyRepository;
  memories: AIMemoryRepository;
  summaries: AIConversationSummaryRepository;
}

export type AIMemoryExecutionModel = Pick<AIModelConfig, "id" | "revision" | "providerConfigId" | "providerModelId" | "adapterKey" | "capability" | "enabled" | "supportsStreaming" | "supportsStructuredOutput" | "supportsReasoning" | "maxOutputTokens">;
export type AIMemoryExecutionProvider = Pick<AIProviderConfig, "id" | "revision" | "enabled" | "credentialRef">;
export type AIMemoryExecutionAdmission = { operation: AICostOperation; reservation: AIBudgetReservation; rateLimitPolicy: AIRateLimitPolicyRevision };
export type AIMemoryExecutionSource = { response: AIConversationResponse; requestMessage: AIConversationMessage; assistantMessage: AIConversationMessage };
export type AIMemoryExecutionCandidate = Pick<AIMemory, "id" | "kind" | "status" | "principalRef" | "subjectKey" | "sourceConversationId" | "sourceStartOrdinal" | "sourceEndOrdinal" | "memoryText" | "confidenceUnits" | "memoryPolicyId" | "memoryPolicyRevision">;
export type AIMemoryExecutionEducationalKind = AIMemoryKind;
