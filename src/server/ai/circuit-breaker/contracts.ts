import type { AdminActor } from "../../admin-auth/contracts";
import type { AIModelCapability } from "../model-registry";

export const AI_CIRCUIT_BREAKER_POLICY_RESOURCE_TYPE = "ai.circuit-breaker-policy" as const;

export const AI_CIRCUIT_STATES = ["CLOSED", "OPEN", "HALF_OPEN"] as const;
export type AICircuitStateName = (typeof AI_CIRCUIT_STATES)[number];

export const AI_CIRCUIT_EVENT_TYPES = [
  "FAILURE_COUNTED",
  "OPENED",
  "AUTHENTICATION_OPENED",
  "HALF_OPEN_PROBE_GRANTED",
  "HALF_OPEN_PROBE_RECLAIMED",
  "HALF_OPEN_PROBE_RELEASED",
  "CLOSED",
] as const;
export type AICircuitEventType = (typeof AI_CIRCUIT_EVENT_TYPES)[number];

export interface AICircuitBreakerPolicyContent {
  key: string;
  displayName: string;
  failureThreshold: number;
  openDurationMs: number;
  halfOpenProbeLeaseMs: number;
  enabled: boolean;
}

export interface AICircuitBreakerPolicy extends AICircuitBreakerPolicyContent {
  id: string;
  currentRevision: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

export interface AICircuitBreakerPolicyRevision extends AICircuitBreakerPolicyContent {
  circuitPolicyId: string;
  revision: number;
  revisionId: string;
  createdAt: number;
  createdBy: string;
}

export interface SafeAICircuitBreakerPolicyDTO {
  id: string;
  key: string;
  displayName: string;
  failureThreshold: number;
  openDurationMs: number;
  halfOpenProbeLeaseMs: number;
  enabled: boolean;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface AICircuitBreakerPolicyRepository {
  getById(id: string): AICircuitBreakerPolicy | null;
  getCurrentRevision(id: string): AICircuitBreakerPolicyRevision | null;
  getRevision(id: string, revision: number): AICircuitBreakerPolicyRevision | null;
  list(): AICircuitBreakerPolicy[];
  listRevisions(): AICircuitBreakerPolicyRevision[];
  create(input: {
    id: string;
    content: AICircuitBreakerPolicyContent;
    actor: AdminActor;
    now: number;
  }): AICircuitBreakerPolicyRevision;
  appendRevision(input: {
    id: string;
    expectedRevision: number;
    content: AICircuitBreakerPolicyContent;
    actor: AdminActor;
    now: number;
  }): AICircuitBreakerPolicyRevision;
}

/** Exact operational route identity. It intentionally contains no credential value. */
export interface AICircuitTarget {
  policyId: string;
  policyRevision: number;
  modelConfigId: string;
  modelConfigRevision: number;
  providerConfigId: string;
  providerConfigRevision: number;
  capability: AIModelCapability;
  adapterKey: string;
  secretVersion: number;
}

export type AICircuitCountedFailureCode =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "BAD_RESPONSE"
  | "UNKNOWN"
  | "AUTHENTICATION";

export type AICircuitProviderOutcomeClass = "COUNTED" | "AUTHENTICATION" | "NEUTRAL";

export function classifyAICircuitProviderOutcome(code: string): AICircuitProviderOutcomeClass {
  if (code === "AUTHENTICATION") return "AUTHENTICATION";
  if (["RATE_LIMITED", "TIMEOUT", "UNAVAILABLE", "BAD_RESPONSE", "UNKNOWN"].includes(code)) return "COUNTED";
  return "NEUTRAL";
}

export interface AICircuitAttemptPermit {
  targetHash: string;
  stateGeneration: number;
  mode: "NORMAL" | "PROBE";
  enforced: boolean;
  probeOwner?: string;
  probeToken?: string;
}

export type AICircuitPermitDecision =
  | { kind: "GRANTED"; permit: AICircuitAttemptPermit }
  | {
      kind: "DENIED";
      reason: "OPEN" | "HALF_OPEN_BUSY";
      targetHash: string;
      stateGeneration: number;
    };

export type AICircuitOutcomeResult = "APPLIED" | "STALE_OUTCOME_IGNORED" | "BYPASSED";

export interface AICircuitBreaker {
  acquirePermit(input: { target: AICircuitTarget; at?: number }): AICircuitPermitDecision;
  recordSuccess(permit: AICircuitAttemptPermit, at?: number): AICircuitOutcomeResult;
  recordFailure(input: {
    permit: AICircuitAttemptPermit;
    errorCode: AICircuitCountedFailureCode;
    at?: number;
  }): AICircuitOutcomeResult;
  recordNeutral(permit: AICircuitAttemptPermit, at?: number): AICircuitOutcomeResult;
}

/** Internal state includes probe ownership; callers should expose only the safe snapshot. */
export interface AICircuitState {
  id: string;
  targetHash: string;
  policyId: string;
  policyRevision: number;
  modelConfigId: string;
  modelConfigRevision: number;
  providerConfigId: string;
  providerConfigRevision: number;
  capability: AIModelCapability;
  adapterKey: string;
  secretVersion: number;
  state: AICircuitStateName;
  stateGeneration: number;
  consecutiveFailures: number;
  openedAt: number | null;
  openUntil: number | null;
  probeOwner: string | null;
  probeToken: string | null;
  probeExpiresAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastErrorCode: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AICircuitHealthSnapshot {
  id: string;
  targetHash: string;
  policyId: string;
  policyRevision: number;
  modelConfigId: string;
  modelConfigRevision: number;
  providerConfigId: string;
  providerConfigRevision: number;
  capability: AIModelCapability;
  adapterKey: string;
  secretVersion: number;
  state: AICircuitStateName;
  stateGeneration: number;
  consecutiveFailures: number;
  openedAt: number | null;
  openUntil: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastErrorCode: string | null;
  probeActive: boolean;
  probeExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AICircuitHealthQuery {
  state?: AICircuitStateName;
  providerConfigId?: string;
  modelConfigId?: string;
  limit?: number;
}

export interface AICircuitBreakerEvent {
  id: string;
  targetHash: string;
  stateGeneration: number;
  eventType: AICircuitEventType;
  errorCode: string | null;
  createdAt: number;
}

export interface AICircuitStatePatch {
  state?: AICircuitStateName;
  stateGeneration?: number;
  consecutiveFailures?: number;
  openedAt?: number | null;
  openUntil?: number | null;
  probeOwner?: string | null;
  probeToken?: string | null;
  probeExpiresAt?: number | null;
  lastSuccessAt?: number | null;
  lastFailureAt?: number | null;
  lastErrorCode?: string | null;
  updatedAt: number;
}
