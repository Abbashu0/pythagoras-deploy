import type { AdminActor } from "../../admin-auth/contracts";
import type { AIModelCapability } from "../model-registry";

export type AIAgent1RuntimeReadiness =
  | "INCOMPATIBLE_CAPABILITY"
  | "READY"
  | "MODEL_DISABLED"
  | "PROVIDER_DISABLED"
  | "CREDENTIAL_UNAVAILABLE"
  | "ADAPTER_UNAVAILABLE";

export interface AIAgent1RuntimeModel {
  id: string;
  displayName: string;
  providerName: string;
  providerModelId: string;
  capability: AIModelCapability;
  contextWindowTokens: number | null;
  revision: number;
  enabled: boolean;
  providerEnabled: boolean;
  credentialStatus: "NOT_CONFIGURED" | "ACTIVE" | "REVOKED" | "MISSING";
  readiness: AIAgent1RuntimeReadiness;
  readinessLabel: string;
  readinessReason: string | null;
  ready: boolean;
}

export interface AIAgent1RuntimeSnapshot {
  config: {
    enabled: boolean;
    primaryModelConfigId: string | null;
    fallbackModelConfigIds: string[];
    revision: number;
    createdAt: number | null;
    updatedAt: number | null;
  };
  primary: AIAgent1RuntimeModel | null;
  fallbacks: AIAgent1RuntimeModel[];
  models: AIAgent1RuntimeModel[];
  canEnable: boolean;
  state: "STOPPED" | "READY" | "NEEDS_ATTENTION";
  execution: {
    connected: false;
    reason: "AGENT_1_STUDENT_EXECUTION_NOT_CONNECTED";
  };
}

export interface AIAgent1RuntimeMutation {
  expectedRevision: number;
  actor: AdminActor;
}

export interface AIAgent1RuntimeRouteUpdate extends AIAgent1RuntimeMutation {
  primaryModelConfigId: string | null;
  fallbackModelConfigIds: readonly string[];
}

export interface AIAgent1RuntimeEnabledUpdate extends AIAgent1RuntimeMutation {
  enabled: boolean;
}
