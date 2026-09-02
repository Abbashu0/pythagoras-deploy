import type { AdminActor } from "../../admin-auth/contracts";
import type { AIKnowledgeTrustTier } from "../knowledge/contracts";

export const AI_RETRIEVAL_CONFIG_RESOURCE_TYPE = "ai.retrieval-config" as const;

export const AI_RETRIEVAL_SEMANTIC_FAILURE_BEHAVIORS = ["LEXICAL_ONLY", "FAIL_RETRIEVAL"] as const;
export type AIRetrievalSemanticFailureBehavior = (typeof AI_RETRIEVAL_SEMANTIC_FAILURE_BEHAVIORS)[number];

export const AI_RETRIEVAL_RERANKER_FAILURE_BEHAVIORS = ["USE_FUSION", "FAIL_RETRIEVAL"] as const;
export type AIRetrievalRerankerFailureBehavior = (typeof AI_RETRIEVAL_RERANKER_FAILURE_BEHAVIORS)[number];

export const AI_RETRIEVAL_FUSION_SCORE_SCALE = 1_000_000;
export const AI_RETRIEVAL_CONFIG_MAX_LEXICAL_CANDIDATES = 50;
export const AI_RETRIEVAL_CONFIG_MAX_SEMANTIC_CANDIDATES = 50;
export const AI_RETRIEVAL_CONFIG_MAX_FUSION_CANDIDATES = 100;
export const AI_RETRIEVAL_CONFIG_MAX_RERANK_CANDIDATES = 50;
export const AI_RETRIEVAL_CONFIG_MAX_EVIDENCE_ITEMS = 50;
export const AI_RETRIEVAL_CONFIG_MAX_EVIDENCE_BYTES = 65_536;
export const AI_RETRIEVAL_CONFIG_MAX_SOURCE_ITEM_CHUNKS = 20;

export interface AIRetrievalConfigContent {
  key: string;
  subjectKey: string;
  displayName: string;
  enabled: boolean;
  embeddingModelConfigId: string;
  rerankModelConfigId: string | null;
  lexicalCandidateLimit: number;
  semanticCandidateLimit: number;
  fusionCandidateLimit: number;
  rerankCandidateLimit: number;
  evidenceItemLimit: number;
  rrfConstant: number;
  lexicalWeightUnits: number;
  semanticWeightUnits: number;
  minimumFusedScoreUnits: number;
  minimumEvidenceItemCount: number;
  maximumEvidencePackBytes: number;
  maxEvidenceChunksPerSourceItem: number;
  allowedTrustTiers: AIKnowledgeTrustTier[];
  semanticFailureBehavior: AIRetrievalSemanticFailureBehavior;
  rerankerFailureBehavior: AIRetrievalRerankerFailureBehavior;
}

export interface AIRetrievalConfigRevision extends AIRetrievalConfigContent {
  retrievalConfigId: string;
  revisionId: string;
  revision: number;
  createdAt: number;
  createdBy: string;
}

export interface AIRetrievalConfig extends AIRetrievalConfigContent {
  id: string;
  currentRevision: number;
  currentRevisionId: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

export type SafeAIRetrievalConfigDTO = AIRetrievalConfig;

export interface AIRetrievalConfigRepository {
  getById(id: string): AIRetrievalConfig | null;
  getByKey(key: string): AIRetrievalConfig | null;
  getCurrentRevision(id: string): AIRetrievalConfigRevision | null;
  getRevision(id: string, revision: number): AIRetrievalConfigRevision | null;
  list(): AIRetrievalConfig[];
  create(input: { id: string; content: AIRetrievalConfigContent; actor: AdminActor; now: number }): AIRetrievalConfigRevision;
  appendRevision(input: { id: string; expectedRevision: number; content: AIRetrievalConfigContent; actor: AdminActor; now: number }): AIRetrievalConfigRevision;
}
