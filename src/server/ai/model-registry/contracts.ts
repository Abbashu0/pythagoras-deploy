import type { AdminActor } from "../../admin-auth/contracts";

export const AI_MODEL_CONFIG_RESOURCE_TYPE = "ai.model-config" as const;

export const AI_MODEL_CAPABILITIES = [
  "GENERATION",
  "EMBEDDING",
  "RERANK",
] as const;

export type AIModelCapability = (typeof AI_MODEL_CAPABILITIES)[number];

/** Safe, governed model-routing fields. Credentials are owned by the Provider. */
export interface AIModelConfigContent {
  key: string;
  displayName: string;
  providerConfigId: string;
  providerModelId: string;
  capability: AIModelCapability;
  adapterKey: string;
  enabled: boolean;
  contextWindowTokens: number | null;
  maxOutputTokens: number | null;
  embeddingDimensions: number | null;
  supportsStreaming: boolean;
  supportsReasoning: boolean;
  supportsStructuredOutput: boolean;
}

export interface AIModelConfig extends AIModelConfigContent {
  id: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
  revision: number;
}

/** DTO boundary for future authenticated Admin reads. */
export type SafeAIModelConfigDTO = AIModelConfig;

export interface AIModelConfigRepository {
  getById(id: string): AIModelConfig | null;
  getByKey(key: string): AIModelConfig | null;
  list(): AIModelConfig[];
  create(input: {
    id: string;
    content: AIModelConfigContent;
    actor: AdminActor;
    now: number;
  }): AIModelConfig;
  update(input: {
    id: string;
    content: AIModelConfigContent;
    expectedRevision: number;
    actor: AdminActor;
    now: number;
  }): AIModelConfig;
}
