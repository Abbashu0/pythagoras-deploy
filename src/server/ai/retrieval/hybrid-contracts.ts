import type { AIKnowledgeDocumentProvenance, AIKnowledgeTrustTier } from "../knowledge/contracts";
import type { AILexicalCandidate } from "./contracts";

export const AI_HYBRID_RETRIEVAL_MODES = ["HYBRID", "LEXICAL_ONLY"] as const;
export type AIHybridRetrievalMode = (typeof AI_HYBRID_RETRIEVAL_MODES)[number];

export const AI_HYBRID_SAFE_REASONS = [
  "NO_CANDIDATES",
  "PROJECTION_NOT_READY",
  "SEMANTIC_COVERAGE_INCOMPLETE",
  "QUERY_EMBEDDING_FAILED",
  "RERANK_FAILED",
  "BELOW_MINIMUM_EVIDENCE",
  "RETRIEVAL_CONFIG_CHANGED",
  "SOURCE_INELIGIBLE",
  "PROJECTION_CHANGED",
  "MODEL_SPACE_CHANGED",
  "EXECUTION_CONTEXT_INVALID",
] as const;
export type AIHybridSafeReason = (typeof AI_HYBRID_SAFE_REASONS)[number];

export interface AIHybridProviderExecutionContext {
  costOperationId: string;
  budgetReservationId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  circuitPolicy?: { policyId: string; policyRevision: number };
}

export interface AIHybridRetrievalRequest {
  requestId: string;
  subjectKey: string;
  query: string;
  retrievalConfigId: string;
  retrievalConfigRevision: number;
  providerExecutionContext: AIHybridProviderExecutionContext;
}

export interface AIHybridLexicalScopedAdapter {
  searchExact(input: {
    subjectKey: string;
    query: string;
    projectionRevisionIds: readonly string[];
    limit: number;
  }): AILexicalCandidate[];
}

export interface AIHybridChunkCandidate {
  chunkId: string;
  m7aProjectionRevisionId: string;
  m7bEmbeddingProjectionRevisionId: string | null;
  subjectKey: string;
  originKind: AILexicalCandidate["originKind"];
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
}

export interface AIHybridFusedCandidate extends AIHybridChunkCandidate {
  lexicalRank: number | null;
  semanticRank: number | null;
  cosineSimilarity: number | null;
  fusionScoreUnits: number;
  retrievalSignals: readonly ("LEXICAL" | "SEMANTIC" | "BOTH")[];
  rerankRank: number | null;
  rerankScore: number | null;
}

export interface AIHybridEvidenceItem extends AIHybridFusedCandidate {
  ordinal: number;
  inclusionSignals: readonly string[];
}

export interface AIHybridRetrievalTrace {
  retrievalConfigId: string;
  retrievalConfigRevision: number;
  m7aProjectionRevisionIds: readonly string[];
  m7bEmbeddingProjectionRevisionIds: readonly string[];
  embeddingModelConfigId: string | null;
  embeddingModelConfigRevision: number | null;
  embeddingProviderConfigId: string | null;
  embeddingProviderConfigRevision: number | null;
  rerankModelConfigId: string | null;
  rerankModelConfigRevision: number | null;
  rerankProviderConfigId: string | null;
  rerankProviderConfigRevision: number | null;
  candidateCounts: {
    lexical: number;
    semantic: number;
    fused: number;
    reranked: number;
    evidence: number;
  };
  selectedChunkIds: readonly string[];
  rankedSignals: readonly {
    chunkId: string;
    lexicalRank: number | null;
    semanticRank: number | null;
    cosineSimilarity: number | null;
    fusionScoreUnits: number;
    rerankRank: number | null;
    rerankScore: number | null;
  }[];
  degraded: boolean;
  safeReason: AIHybridSafeReason | null;
}

export interface AIEvidencePack {
  evidencePackId: string;
  requestId: string;
  subjectKey: string;
  retrievalConfigId: string;
  retrievalConfigRevision: number;
  mode: AIHybridRetrievalMode;
  degraded: boolean;
  safeReason: AIHybridSafeReason | null;
  embeddingModelConfigId: string | null;
  embeddingModelConfigRevision: number | null;
  embeddingProviderConfigId: string | null;
  embeddingProviderConfigRevision: number | null;
  rerankModelConfigId: string | null;
  rerankModelConfigRevision: number | null;
  rerankProviderConfigId: string | null;
  rerankProviderConfigRevision: number | null;
  candidateCounts: AIHybridRetrievalTrace["candidateCounts"];
  evidenceByteCount: number;
  sufficient: boolean;
  status: "SUFFICIENT" | "INSUFFICIENT";
  items: readonly AIHybridEvidenceItem[];
  trace: AIHybridRetrievalTrace;
}
