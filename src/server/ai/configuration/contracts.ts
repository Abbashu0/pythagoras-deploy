import type { AdminActor } from "../../admin-auth/contracts";

export const AI_PROVIDER_CONFIG_RESOURCE_TYPE = "ai.provider-config" as const;

export const AI_PROVIDER_RETENTION_POLICIES = [
  "UNKNOWN",
  "ZERO_RETENTION",
  "BOUNDED_RETENTION",
  "PROVIDER_DEFINED",
] as const;

export type AIProviderRetentionPolicy =
  (typeof AI_PROVIDER_RETENTION_POLICIES)[number];

export const AI_PROVIDER_TRAINING_POLICIES = [
  "UNKNOWN",
  "NOT_USED_FOR_TRAINING",
  "MAY_BE_USED",
  "PROVIDER_DEFINED",
] as const;

export type AIProviderTrainingPolicy =
  (typeof AI_PROVIDER_TRAINING_POLICIES)[number];

/** Safe, governed Product fields. Secret bytes are never part of this type. */
export interface AIProviderConfigContent {
  key: string;
  displayName: string;
  baseUrl: string;
  credentialRef: string | null;
  enabled: boolean;
  retentionPolicy: AIProviderRetentionPolicy;
  trainingPolicy: AIProviderTrainingPolicy;
  zdrSupported: boolean;
  zdrRequired: boolean;
}

export interface AIProviderConfig extends AIProviderConfigContent {
  id: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
  revision: number;
}

export type AIProviderCredentialStatus =
  | "NOT_CONFIGURED"
  | "ACTIVE"
  | "REVOKED"
  | "MISSING";

/** DTO boundary suitable for a future authenticated Admin read. */
export interface SafeAIProviderConfigDTO {
  id: string;
  key: string;
  displayName: string;
  baseUrl: string;
  enabled: boolean;
  credentialConfigured: boolean;
  credentialStatus: AIProviderCredentialStatus;
  retentionPolicy: AIProviderRetentionPolicy;
  trainingPolicy: AIProviderTrainingPolicy;
  zdrSupported: boolean;
  zdrRequired: boolean;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export interface AIProviderConfigRepository {
  getById(id: string): AIProviderConfig | null;
  getByKey(key: string): AIProviderConfig | null;
  list(): AIProviderConfig[];
  create(input: {
    id: string;
    content: AIProviderConfigContent;
    actor: AdminActor;
    now: number;
  }): AIProviderConfig;
  update(input: {
    id: string;
    content: AIProviderConfigContent;
    expectedRevision: number;
    actor: AdminActor;
    now: number;
  }): AIProviderConfig;
  remove(input: {
    id: string;
    expectedRevision: number;
  }): AIProviderConfig;
}
