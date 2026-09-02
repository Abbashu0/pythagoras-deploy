import type { AIContextPlan, AIContextTokenEstimator } from "../../context";
import type { AIStudentPrincipal } from "../../conversations";
import type { AIModelConfig, AIModelCapability } from "../../model-registry";
import type { AIProviderConfig } from "../../configuration";
import type { AIRetrievalConfigRevision } from "../../retrieval-config";
import type { AIModelSelectionPlan, GenerationGatewayRequest } from "../../gateway";

export interface AITutorCostEstimateComponent {
  capability: AIModelCapability;
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

export interface AITutorCostEstimate {
  currency: string;
  maxCostNano: number;
  estimateBasis: string;
  queryEmbedding: AITutorCostEstimateComponent;
  rerank: AITutorCostEstimateComponent | null;
  generation: AITutorCostEstimateComponent;
}

export interface AITutorPreflightInput {
  principal: AIStudentPrincipal;
  responseId: string;
  tutorConfigId: string;
  estimator: AIContextTokenEstimator;
}

export interface AITutorPreflightPlan {
  responseId: string;
  conversationId: string;
  principalRef: string;
  subjectKey: string;
  currentMessageId: string;
  tutorConfigId: string;
  tutorConfigRevision: number;
  contextSnapshotId: string;
  contextSnapshotFingerprint: string;
  globalPolicyId: string;
  globalPolicyRevision: number;
  subjectPolicyId: string;
  subjectPolicyRevision: number;
  contextPolicyId: string;
  contextPolicyRevision: number;
  precedenceEnvelopeVersion: number;
  estimatorKey: string;
  retrievalConfigId: string;
  retrievalConfigRevision: number;
  generationModelConfigId: string;
  generationModelConfigRevision: number;
  generationProviderConfigId: string;
  generationProviderConfigRevision: number;
  providerModelId: string;
  adapterKey: string;
  contextWindowTokens: number;
  modelMaxOutputTokens: number;
  budgetPolicyId: string;
  budgetPolicyRevision: number;
  rateLimitPolicyId: string;
  rateLimitPolicyRevision: number;
  groundingProtocolKey: string;
  groundingProtocolRevision: number;
  citationProtocolKey: string;
  citationProtocolRevision: number;
  maxOutputTokens: number;
  costEstimate: Readonly<AITutorCostEstimate>;
  planFingerprint: string;
  modelSelectionPlan: Readonly<AIModelSelectionPlan>;
  /** Runtime-only authorized Context Plan; never persisted as trace metadata. */
  contextPlan: Readonly<AIContextPlan>;
  /** Runtime-only estimator used by the subsequent planner. */
  estimator: Readonly<AIContextTokenEstimator>;
  /** Runtime-only safe revisions used for deterministic planning bounds. */
  retrievalConfig: Readonly<AIRetrievalConfigRevision>;
  generationModel: Readonly<AIModelConfig>;
  generationProvider: Readonly<Pick<AIProviderConfig, "id" | "revision">>;
  principal: Readonly<AIStudentPrincipal>;
}

export interface AITutorGenerationPlan {
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
  contextPolicyId: string;
  contextPolicyRevision: number;
  globalPolicyId: string;
  globalPolicyRevision: number;
  subjectPolicyId: string;
  subjectPolicyRevision: number;
  groundingProtocolKey: string;
  groundingProtocolRevision: number;
  citationProtocolKey: string;
  citationProtocolRevision: number;
  modelSelectionPlan: Readonly<AIModelSelectionPlan>;
  request: Readonly<GenerationGatewayRequest>;
  selectedEvidence: readonly AITutorSelectedEvidenceReference[];
  citationMap: readonly AITutorCitationMapItem[];
  selectedEvidenceTokenCount: number;
  finalEstimatedInputTokens: number;
  maxOutputTokens: number;
  costEstimate: Readonly<AITutorCostEstimate>;
  generationModelConfigId: string;
  generationModelConfigRevision: number;
  generationProviderConfigId: string;
  generationProviderConfigRevision: number;
  providerModelId: string;
  adapterKey: string;
  budgetPolicyId: string;
  budgetPolicyRevision: number;
  rateLimitPolicyId: string;
  rateLimitPolicyRevision: number;
  planFingerprint: string;
}

export interface AITutorSelectedEvidenceReference {
  label: string;
  ordinal: number;
  chunkId: string;
  m7aProjectionRevisionId: string;
  m7bEmbeddingProjectionRevisionId: string | null;
  originKind: "KNOWLEDGE_PACKAGE" | "QUESTION_PACKAGE";
  originId: string;
  questionId: string | null;
  questionRevision: number | null;
}

export type AITutorCitationMapItem = AITutorSelectedEvidenceReference;
