import type { AIAdmissionCostEstimate, AIAdmissionPlan } from "../admission";
import type { AIProviderConfig } from "../configuration";
import type { AIProviderAttemptTrace } from "../gateway";
import type { AIModelConfig } from "../model-registry";
import type { AIRetrievalChunk } from "../retrieval";
import type { AIKnowledgeDocumentProvenance, AIKnowledgeTrustTier } from "../knowledge";

export const AI_EMBEDDING_PROJECTION_STATUSES = ["BUILDING", "READY", "FAILED"] as const;
export type AIEmbeddingProjectionStatus = (typeof AI_EMBEDDING_PROJECTION_STATUSES)[number];

export const AI_EMBEDDING_PROJECTION_VIEW_STATUSES = ["MISSING", "BUILDING", "READY", "STALE", "FAILED", "INELIGIBLE"] as const;
export type AIEmbeddingProjectionViewStatus = (typeof AI_EMBEDDING_PROJECTION_VIEW_STATUSES)[number];

export const AI_EMBEDDING_VECTOR_CODEC_KEY = "float32-le-v1" as const;
export type AIEmbeddingVectorCodecKey = typeof AI_EMBEDDING_VECTOR_CODEC_KEY;
export const AI_EMBEDDING_VECTOR_CODEC_REVISION = 1 as const;
export const AI_EMBEDDING_VECTOR_INDEX_ADAPTER_KEY = "sqlite-exact-cosine-v1" as const;
export const AI_EMBEDDING_VECTOR_INDEX_ADAPTER_REVISION = 1 as const;
export const AI_EMBEDDING_MAX_DIMENSIONS = 16_384;
export const AI_EMBEDDING_MAX_VECTOR_BYTES = AI_EMBEDDING_MAX_DIMENSIONS * 4;
export const AI_EMBEDDING_DEFAULT_BATCH_SIZE = 32;
export const AI_EMBEDDING_MAX_BATCH_SIZE = 64;
export const AI_EMBEDDING_MAX_BATCH_BYTES = AI_EMBEDDING_MAX_BATCH_SIZE * 4_096;
export const AI_EMBEDDING_DEFAULT_QUERY_LIMIT = 10;
export const AI_EMBEDDING_MAX_QUERY_LIMIT = 50;
export const AI_EMBEDDING_JOB_KIND = "ai.retrieval.embedding-build" as const;
export const AI_EMBEDDING_JOB_PAYLOAD_VERSION = 1 as const;
export const AI_EMBEDDING_SYSTEM_PRINCIPAL = "system:knowledge-indexing" as const;

export interface AIEmbeddingProjectionSet {
  id: string;
  subjectKey: string;
  chunkProjectionSetId: string;
  modelConfigId: string;
  vectorCodecKey: AIEmbeddingVectorCodecKey;
  vectorCodecRevision: number;
  vectorIndexAdapterKey: string;
  createdAt: number;
  updatedAt: number;
}

export type AIEmbeddingSourceCursor =
  | { kind: "START" }
  | { kind: "CHUNK"; chunkOrdinal: number; chunkId: string }
  | { kind: "DONE" };

export interface AIEmbeddingProjectionRevision {
  id: string;
  embeddingProjectionSetId: string;
  revision: number;
  subjectKey: string;
  chunkProjectionSetId: string;
  chunkProjectionRevisionId: string;
  chunkProjectionInputFingerprint: string;
  chunkCount: number;
  modelConfigId: string;
  modelConfigRevision: number;
  providerConfigId: string;
  providerConfigRevision: number;
  providerModelId: string;
  embeddingAdapterKey: string;
  dimensions: number;
  vectorCodecKey: AIEmbeddingVectorCodecKey;
  vectorCodecRevision: number;
  vectorIndexAdapterKey: string;
  inputFingerprint: string;
  status: AIEmbeddingProjectionStatus;
  isCurrent: boolean;
  sourceCursor: AIEmbeddingSourceCursor | null;
  batchCount: number;
  vectorCount: number;
  jobId: string;
  costOperationId: string;
  startedAt: number;
  updatedAt: number;
  readyAt: number | null;
  failedAt: number | null;
  safeErrorCode: string | null;
}

export interface AIEmbeddingVector {
  embeddingProjectionRevisionId: string;
  chunkProjectionRevisionId: string;
  chunkId: string;
  subjectKey: string;
  dimensions: number;
  vectorBlob: Buffer;
  vectorHash: string;
  norm: number;
  createdAt: number;
}

export interface AIEmbeddingVectorCoverage {
  chunkCount: number;
  vectorCount: number;
  missingVectorCount: number;
  orphanVectorCount: number;
  complete: boolean;
}

export interface AIEmbeddingVectorCandidate {
  chunkId: string;
  embeddingProjectionRevisionId: string;
  chunkProjectionRevisionId: string;
  subjectKey: string;
  originKind: AIRetrievalChunk["originKind"];
  originId: string;
  originRevision: number;
  originContentRevision: number;
  sourceId: string | null;
  sourceRevision: number | null;
  sourceType: string | null;
  trustTier: AIKnowledgeTrustTier;
  sourceItemId: string;
  sourceItemOrder: number;
  questionId: string | null;
  questionRevision: number | null;
  variantId: string | null;
  variantRevision: number | null;
  text: string;
  language: string;
  provenance: AIKnowledgeDocumentProvenance | null;
  originMetadata: Record<string, unknown>;
  rank: number;
  cosineSimilarity: number;
}

export interface AIEmbeddingVectorSearchQuery {
  subjectKey: string;
  embeddingProjectionRevisionId: string;
  queryVector: readonly number[];
  limit?: number;
}

export interface AIEmbeddingVectorIndexAdapter {
  persistBatch(input: { projectionRevisionId: string; vectors: readonly AIEmbeddingVector[] }): { insertedVectors: number };
  getVector(input: { projectionRevisionId: string; chunkProjectionRevisionId: string; chunkId: string }): AIEmbeddingVector | null;
  getCoverage(input: { projectionRevisionId: string; chunkProjectionRevisionId: string; chunkCount: number }): AIEmbeddingVectorCoverage;
  search(input: AIEmbeddingVectorSearchQuery): AIEmbeddingVectorCandidate[];
}

export interface AIEmbeddingProjectionRepository {
  getOrCreateSet(input: {
    subjectKey: string;
    chunkProjectionSetId: string;
    modelConfigId: string;
    vectorCodecKey: AIEmbeddingVectorCodecKey;
    vectorCodecRevision: number;
    vectorIndexAdapterKey: string;
    now: number;
  }): AIEmbeddingProjectionSet;
  getSet(input: {
    subjectKey: string;
    chunkProjectionSetId: string;
    modelConfigId: string;
    vectorCodecKey: AIEmbeddingVectorCodecKey;
    vectorCodecRevision: number;
    vectorIndexAdapterKey: string;
  }): AIEmbeddingProjectionSet | null;
  getSetById(id: string): AIEmbeddingProjectionSet | null;
  getCurrentRevision(projectionSetId: string): AIEmbeddingProjectionRevision | null;
  getCompatibleBuildingRevision(input: {
    projectionSetId: string;
    inputFingerprint: string;
  }): AIEmbeddingProjectionRevision | null;
  getRevision(id: string): AIEmbeddingProjectionRevision | null;
  listRevisions(projectionSetId: string): AIEmbeddingProjectionRevision[];
  createRevision(input: {
    id: string;
    embeddingProjectionSetId: string;
    revision: number;
    subjectKey: string;
    chunkProjectionSetId: string;
    chunkProjectionRevisionId: string;
    chunkProjectionInputFingerprint: string;
    chunkCount: number;
    modelConfigId: string;
    modelConfigRevision: number;
    providerConfigId: string;
    providerConfigRevision: number;
    providerModelId: string;
    embeddingAdapterKey: string;
    dimensions: number;
    vectorCodecKey: AIEmbeddingVectorCodecKey;
    vectorCodecRevision: number;
    vectorIndexAdapterKey: string;
    inputFingerprint: string;
    jobId: string;
    costOperationId: string;
    now: number;
  }): AIEmbeddingProjectionRevision;
  advanceBatch(input: {
    revisionId: string;
    sourceCursor: AIEmbeddingSourceCursor;
    batchCount: number;
    vectorCount: number;
    now: number;
  }): AIEmbeddingProjectionRevision;
  markFailed(revisionId: string, safeErrorCode: string, now: number): void;
  finalizeReady(revisionId: string, now: number): AIEmbeddingProjectionRevision;
}

export interface AIEmbeddingModelSelection {
  modelConfigId: string;
}

export interface AIEmbeddingBuildInput {
  subjectKey: string;
  chunkProjectionSetId: string;
  modelConfigId: string;
  budgetPolicyId: string;
  budgetPolicyRevision: number;
  rateLimitPolicyId: string;
  rateLimitPolicyRevision: number;
  budgetPeriod: { startAt: number; endAt: number };
  batchSize?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  leaseDurationMs?: number;
  circuitPolicy?: { policyId: string; policyRevision: number };
}

export interface AIEmbeddingBuildResult {
  embeddingProjectionSetId: string;
  embeddingProjectionRevisionId: string;
  revision: number;
  status: AIEmbeddingProjectionStatus;
  chunkProjectionRevisionId: string;
  modelConfigId: string;
  modelConfigRevision: number;
  providerConfigId: string;
  providerConfigRevision: number;
  dimensions: number;
  vectorCount: number;
  jobId: string | null;
  costOperationId: string | null;
  reused: boolean;
}

export interface AIEmbeddingJobPayload {
  embeddingProjectionRevisionId: string;
  chunkProjectionRevisionId: string;
  chunkProjectionInputFingerprint: string;
  chunkCount: number;
  modelConfigId: string;
  modelConfigRevision: number;
  providerConfigId: string;
  providerConfigRevision: number;
  providerModelId: string;
  embeddingAdapterKey: string;
  dimensions: number;
  vectorCodecKey: AIEmbeddingVectorCodecKey;
  vectorCodecRevision: number;
  vectorIndexAdapterKey: string;
  batchSize: number;
  budgetPolicyId: string;
  budgetPolicyRevision: number;
  rateLimitPolicyId: string;
  rateLimitPolicyRevision: number;
  budgetPeriodStart: number;
  budgetPeriodEnd: number;
  costOperationId: string;
  admissionIdempotencyKey: string;
  admissionRequestFingerprint: string;
  costEstimate: AIAdmissionPlan["costEstimate"];
  circuitPolicyId: string | null;
  circuitPolicyRevision: number | null;
}

export interface AIEmbeddingCostEstimator {
  estimate(input: {
    model: AIModelConfig;
    provider: AIProviderConfig;
    chunkCount: number;
    chunkBytes: number;
    batchSize: number;
    maxAttempts: number;
    at: number;
  }): AIAdmissionCostEstimate;
}

export interface AIEmbeddingProjectionHealth {
  subjectKey: string;
  embeddingProjectionSetId: string | null;
  embeddingProjectionRevisionId: string | null;
  chunkProjectionRevisionId: string | null;
  modelConfigId: string | null;
  modelConfigRevision: number | null;
  providerConfigId: string | null;
  providerConfigRevision: number | null;
  dimensions: number | null;
  chunkCount: number;
  vectorCount: number;
  missingVectorCount: number;
  orphanVectorCount: number;
  coverage: number;
  jobId: string | null;
  jobStatus: string | null;
  status: AIEmbeddingProjectionViewStatus;
}

export type AIEmbeddingProviderAttempts = readonly AIProviderAttemptTrace[];
