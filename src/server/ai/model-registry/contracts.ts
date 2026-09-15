import type { AdminActor } from "../../admin-auth/contracts";
import {
  AI_MODEL_INPUT_MODALITIES,
  AI_MODEL_OUTPUT_MODALITIES,
  type AIModelInputModality,
  type AIModelOutputModality,
} from "@/lib/ai-model-modalities";

export const AI_MODEL_CONFIG_RESOURCE_TYPE = "ai.model-config" as const;

export const AI_MODEL_CAPABILITIES = [
  "GENERATION",
  "EMBEDDING",
  "RERANK",
] as const;

export type AIModelCapability = (typeof AI_MODEL_CAPABILITIES)[number];

export { AI_MODEL_INPUT_MODALITIES, AI_MODEL_OUTPUT_MODALITIES };
export type { AIModelInputModality, AIModelOutputModality };

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
  /** Optional for historical Change Set snapshots; storage defaults to TEXT. */
  inputModalities?: AIModelInputModality[];
  /** Optional for historical Change Set snapshots; output is TEXT-only in M11. */
  outputModalities?: AIModelOutputModality[];
}

export interface AIModelConfig extends AIModelConfigContent {
  inputModalities: AIModelInputModality[];
  outputModalities: AIModelOutputModality[];
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
