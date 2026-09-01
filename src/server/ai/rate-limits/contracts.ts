import type { AdminActor } from "../../admin-auth/contracts";

export const AI_RATE_LIMIT_POLICY_RESOURCE_TYPE = "ai.rate-limit-policy" as const;

export interface AIRateLimitPolicyContent {
  key: string;
  displayName: string;
  windowMs: number;
  maxRequests: number;
  maxConcurrentRequests: number;
  enabled: boolean;
}
export interface AIRateLimitPolicy extends AIRateLimitPolicyContent {
  id: string;
  currentRevision: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

export interface AIRateLimitPolicyRevision extends AIRateLimitPolicyContent {
  rateLimitPolicyId: string;
  revision: number;
  revisionId: string;
  createdAt: number;
  createdBy: string;
}

export interface AIRateLimitPolicyRepository {
  getById(id: string): AIRateLimitPolicy | null;
  getCurrentRevision(id: string): AIRateLimitPolicyRevision | null;
  getRevision(id: string, revision: number): AIRateLimitPolicyRevision | null;
  list(): AIRateLimitPolicy[];
  listRevisions(): AIRateLimitPolicyRevision[];
  create(input: {
    id: string;
    content: AIRateLimitPolicyContent;
    actor: AdminActor;
    now: number;
  }): AIRateLimitPolicyRevision;
  appendRevision(input: {
    id: string;
    expectedRevision: number;
    content: AIRateLimitPolicyContent;
    actor: AdminActor;
    now: number;
  }): AIRateLimitPolicyRevision;
}

export const AI_RATE_LIMIT_EVENT_OUTCOMES = [
  "ADMITTED",
  "BUDGET_EXCEEDED",
  "CONCURRENCY_LIMITED",
] as const;
export type AIRateLimitEventOutcome = (typeof AI_RATE_LIMIT_EVENT_OUTCOMES)[number];

export interface AIRateLimitEvent {
  id: string;
  principalRef: string;
  rateLimitPolicyId: string;
  rateLimitPolicyRevision: number;
  idempotencyKey: string;
  requestFingerprint: string;
  operationId: string;
  reservationId: string | null;
  outcome: AIRateLimitEventOutcome;
  occurredAt: number;
}
