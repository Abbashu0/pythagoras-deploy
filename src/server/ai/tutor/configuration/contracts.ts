import type { AdminActor } from "../../../admin-auth/contracts";

export const AI_TUTOR_CONFIG_RESOURCE_TYPE = "ai.tutor-config" as const;

/** Server-owned grounding behavior; it is not an Admin/client selection. */
export const AI_TUTOR_GROUNDING_PROTOCOL_KEY = "evidence-grounded-v1" as const;
export const AI_TUTOR_GROUNDING_PROTOCOL_REVISION = 1 as const;

/** Server-owned deterministic citation labels. */
export const AI_TUTOR_CITATION_PROTOCOL_KEY = "evidence-ref-v1" as const;
export const AI_TUTOR_CITATION_PROTOCOL_REVISION = 1 as const;

/** Hard provider-neutral Product bound; a provider context window is not a target. */
export const AI_TUTOR_MAX_OUTPUT_TOKENS = 1_000_000;

export interface AITutorConfigContent {
  key: string;
  subjectKey: string;
  displayName: string;
  enabled: boolean;
  generationModelConfigId: string;
  contextPolicyId: string;
  retrievalConfigId: string;
  budgetPolicyId: string;
  rateLimitPolicyId: string;
  maxOutputTokens: number;
}

export interface AITutorConfigRevision extends AITutorConfigContent {
  tutorConfigId: string;
  revisionId: string;
  revision: number;
  groundingProtocolKey: typeof AI_TUTOR_GROUNDING_PROTOCOL_KEY;
  groundingProtocolRevision: typeof AI_TUTOR_GROUNDING_PROTOCOL_REVISION;
  citationProtocolKey: typeof AI_TUTOR_CITATION_PROTOCOL_KEY;
  citationProtocolRevision: typeof AI_TUTOR_CITATION_PROTOCOL_REVISION;
  createdAt: number;
  createdBy: string;
}

export interface AITutorConfig extends AITutorConfigRevision {
  id: string;
  currentRevision: number;
  currentRevisionId: string;
  updatedAt: number;
  updatedBy: string;
}

export type SafeAITutorConfigDTO = AITutorConfig;

export interface AITutorConfigRepository {
  getById(id: string): AITutorConfig | null;
  getByKey(key: string): AITutorConfig | null;
  getCurrentRevision(id: string): AITutorConfigRevision | null;
  getRevision(id: string, revision: number): AITutorConfigRevision | null;
  list(): AITutorConfig[];
  create(input: { id: string; content: AITutorConfigContent; actor: AdminActor; now: number }): AITutorConfigRevision;
  appendRevision(input: { id: string; expectedRevision: number; content: AITutorConfigContent; actor: AdminActor; now: number }): AITutorConfigRevision;
}

export interface AITutorConfigSnapshot extends AITutorConfigContent {
  groundingProtocolKey: typeof AI_TUTOR_GROUNDING_PROTOCOL_KEY;
  groundingProtocolRevision: typeof AI_TUTOR_GROUNDING_PROTOCOL_REVISION;
  citationProtocolKey: typeof AI_TUTOR_CITATION_PROTOCOL_KEY;
  citationProtocolRevision: typeof AI_TUTOR_CITATION_PROTOCOL_REVISION;
}
