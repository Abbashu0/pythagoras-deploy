import type { AdminActor } from "../../admin-auth/contracts";

export const AI_CONTEXT_POLICY_RESOURCE_TYPE = "ai.context-policy" as const;

export const AI_CONTEXT_POLICY_MAX_BUDGET_TOKENS = 10_000_000;
export const AI_CONTEXT_POLICY_MAX_RECENT_TURNS = 100;

export interface AIContextPolicyContent {
  key: string;
  displayName: string;
  softInputBudgetTokens: number;
  hardInputBudgetTokens: number;
  outputReserveTokens: number;
  policyBudgetTokens: number;
  summaryBudgetTokens: number;
  recentTurnsBudgetTokens: number;
  memoryBudgetTokens: number;
  evidenceBudgetTokens: number;
  maxRecentTurns: number;
  enabled: boolean;
}

export interface AIContextPolicyRevision extends AIContextPolicyContent {
  contextPolicyId: string;
  revisionId: string;
  revision: number;
  createdAt: number;
  createdBy: string;
}

export interface AIContextPolicy extends AIContextPolicyContent {
  id: string;
  currentRevision: number;
  currentRevisionId: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

export interface AIContextPolicyRepository {
  getById(id: string): AIContextPolicy | null;
  getCurrentRevision(id: string): AIContextPolicyRevision | null;
  getRevision(id: string, revision: number): AIContextPolicyRevision | null;
  list(): AIContextPolicy[];
  create(input: { id: string; content: AIContextPolicyContent; actor: AdminActor; now: number }): AIContextPolicyRevision;
  appendRevision(input: { id: string; expectedRevision: number; content: AIContextPolicyContent; actor: AdminActor; now: number }): AIContextPolicyRevision;
}

export type SafeAIContextPolicyDTO = AIContextPolicy;
