import type { CanonicalRichDocument } from "../../questions/contracts";
import type { AIKnowledgeDocumentProvenance, AIKnowledgeTrustTier } from "../knowledge/contracts";

export const AI_RETRIEVAL_ORIGIN_KINDS = ["KNOWLEDGE_PACKAGE", "QUESTION_PACKAGE"] as const;
export type AIRetrievalOriginKind = (typeof AI_RETRIEVAL_ORIGIN_KINDS)[number];

export const AI_RETRIEVAL_PROJECTION_STATUSES = ["BUILDING", "READY", "FAILED"] as const;
export type AIRetrievalProjectionStatus = (typeof AI_RETRIEVAL_PROJECTION_STATUSES)[number];

export const AI_RETRIEVAL_PROJECTION_VIEW_STATUSES = ["MISSING", "BUILDING", "READY", "STALE", "FAILED", "INELIGIBLE"] as const;
export type AIRetrievalProjectionViewStatus = (typeof AI_RETRIEVAL_PROJECTION_VIEW_STATUSES)[number];

export const AI_RETRIEVAL_STRATEGY_KEY = "structured-rich-v1" as const;
export const AI_RETRIEVAL_STRATEGY_REVISION = 1 as const;
export const AI_RETRIEVAL_NORMALIZER_KEY = "retrieval-text-v1" as const;
export const AI_RETRIEVAL_NORMALIZER_REVISION = 1 as const;
export const AI_RETRIEVAL_TARGET_CHUNK_BYTES = 1_800;
export const AI_RETRIEVAL_MAX_CHUNK_BYTES = 4_096;
export const AI_RETRIEVAL_DEFAULT_BATCH_SIZE = 50;
export const AI_RETRIEVAL_MAX_BATCH_SIZE = 200;
export const AI_RETRIEVAL_DEFAULT_QUERY_LIMIT = 10;
export const AI_RETRIEVAL_MAX_QUERY_LIMIT = 50;
export const AI_RETRIEVAL_MAX_QUERY_BYTES = 2_000;
export const AI_RETRIEVAL_MAX_QUERY_TERMS = 20;

export interface AIRetrievalProjectionSet {
  id: string;
  subjectKey: string;
  originKind: AIRetrievalOriginKind;
  originId: string;
  strategyKey: string;
  normalizerKey: string;
  createdAt: number;
  updatedAt: number;
}

export interface AIRetrievalProjectionRevision {
  id: string;
  projectionSetId: string;
  revision: number;
  inputFingerprint: string;
  strategyKey: string;
  strategyRevision: number;
  normalizerKey: string;
  normalizerRevision: number;
  status: AIRetrievalProjectionStatus;
  isCurrent: boolean;
  sourceCursor: AIRetrievalSourceCursor | null;
  batchCount: number;
  chunkCount: number;
  startedAt: number;
  updatedAt: number;
  readyAt: number | null;
  failedAt: number | null;
  safeErrorCode: string | null;
}

export type AIRetrievalSourceCursor =
  | { kind: "START" }
  | { kind: "KNOWLEDGE_DOCUMENT"; order: number; id: string }
  | { kind: "QUESTION"; order: number; id: string }
  | { kind: "DONE" };

export interface AIRetrievalChunk {
  chunkId: string;
  projectionRevisionId: string;
  subjectKey: string;
  originKind: AIRetrievalOriginKind;
  originId: string;
  originRevision: number;
  originContentRevision: number;
  sourceId: string | null;
  sourceRevision: number | null;
  sourceType: string | null;
  trustTier: AIKnowledgeTrustTier;
  artifactSha256: string | null;
  sourceItemId: string;
  sourceItemOrder: number;
  questionId: string | null;
  questionRevision: number | null;
  variantId: string | null;
  variantRevision: number | null;
  chunkOrdinal: number;
  text: string;
  textHash: string;
  language: string;
  provenance: AIKnowledgeDocumentProvenance | null;
  originMetadata: Record<string, unknown>;
  strategyKey: string;
  strategyRevision: number;
  normalizerKey: string;
  normalizerRevision: number;
  createdAt: number;
}

export interface AIChunkSourceItem {
  subjectKey: string;
  language: string;
  originKind: AIRetrievalOriginKind;
  originId: string;
  originRevision: number;
  originContentRevision: number;
  sourceId: string | null;
  sourceRevision: number | null;
  sourceType: string | null;
  trustTier: AIKnowledgeTrustTier;
  artifactSha256: string | null;
  sourceItemId: string;
  sourceItemOrder: number;
  content: CanonicalRichDocument;
  provenance: AIKnowledgeDocumentProvenance | null;
  originMetadata: Record<string, unknown>;
  questionId: string | null;
  questionRevision: number | null;
  variantId: string | null;
  variantRevision: number | null;
}

export interface AIChunkDraft {
  text: string;
  sourceUnitIds: string[];
  sourceUnitParts: Array<{ unitId: string; part: number; totalParts: number }>;
}

export interface AIChunkingStrategy {
  key: string;
  revision: number;
  build(input: AIChunkSourceItem): AIChunkDraft[];
}

export interface AIChunkingStrategyRegistry {
  get(key: string, revision: number): AIChunkingStrategy;
  supported(): Array<{ key: string; revision: number }>;
}

export interface AIRetrievalOriginInput {
  originKind: AIRetrievalOriginKind;
  originId: string;
  subjectKey: string;
}

export interface AIRetrievalBuildOptions extends AIRetrievalOriginInput {
  batchSize?: number;
}

export interface AIRetrievalBuildResult {
  projectionSetId: string;
  projectionRevisionId: string;
  revision: number;
  status: AIRetrievalProjectionStatus;
  inputFingerprint: string;
  chunkCount: number;
  reused: boolean;
}

export interface AIRetrievalBatchResult {
  projectionRevisionId: string;
  processedItems: number;
  insertedChunks: number;
  done: boolean;
  cursor: AIRetrievalSourceCursor;
}

export interface AIRetrievalProjectionStatusView extends AIRetrievalOriginInput {
  status: AIRetrievalProjectionViewStatus;
  projectionSetId: string | null;
  projectionRevisionId: string | null;
  inputFingerprint: string | null;
  currentFingerprint: string | null;
  chunkCount: number;
}

export interface AILexicalRetrievalQuery {
  subjectKey: string;
  query: string;
  limit?: number;
}

export interface AILexicalCandidate {
  chunkId: string;
  projectionRevisionId: string;
  subjectKey: string;
  originKind: AIRetrievalOriginKind;
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
}

export interface AILexicalRetrievalAdapter {
  search(query: AILexicalRetrievalQuery): AILexicalCandidate[];
}

export interface AIRetrievalProjectionHealth {
  subjectKey: string;
  eligibleKnowledgeOrigins: number;
  eligibleQuestionOrigins: number;
  eligibleOrigins: number;
  readyCurrentOrigins: number;
  missingOrigins: number;
  staleOrigins: number;
  buildingRevisions: number;
  failedRevisions: number;
  currentChunkCount: number;
  currentFtsRowCount: number;
  ftsConsistent: boolean;
  orphanChunkCount: number;
}

export interface AIRetrievalProjectionRepository {
  getOrCreateSet(input: AIRetrievalOriginInput & { strategyKey: string; normalizerKey: string; now: number }): AIRetrievalProjectionSet;
  getSet(input: AIRetrievalOriginInput & { strategyKey: string; normalizerKey: string }): AIRetrievalProjectionSet | null;
  getSetById(id: string): AIRetrievalProjectionSet | null;
  getCurrentRevision(projectionSetId: string): AIRetrievalProjectionRevision | null;
  getCompatibleBuildingRevision(input: {
    projectionSetId: string;
    inputFingerprint: string;
    strategyKey: string;
    strategyRevision: number;
    normalizerKey: string;
    normalizerRevision: number;
  }): AIRetrievalProjectionRevision | null;
  getRevision(id: string): AIRetrievalProjectionRevision | null;
  listRevisions(projectionSetId: string): AIRetrievalProjectionRevision[];
  createRevision(input: { projectionSetId: string; revision: number; inputFingerprint: string; strategyKey: string; strategyRevision: number; normalizerKey: string; normalizerRevision: number; now: number }): AIRetrievalProjectionRevision;
  persistBatch(input: { revisionId: string; chunks: AIRetrievalChunk[]; cursor: AIRetrievalSourceCursor; batchCount: number; chunkCount: number; processedItems: number; now: number }): AIRetrievalBatchResult;
  markFailed(revisionId: string, safeErrorCode: string, now: number): void;
  finalizeReady(revisionId: string, now: number): AIRetrievalProjectionRevision;
  countChunks(revisionId: string): number;
  listChunksPage(input: {
    revisionId: string;
    after?: { chunkOrdinal: number; chunkId: string };
    limit: number;
  }): AIRetrievalChunk[];
  getChunkStats(revisionId: string): { chunkCount: number; totalBytes: number; originRevision: number | null };
  listChunks(revisionId: string): AIRetrievalChunk[];
}
