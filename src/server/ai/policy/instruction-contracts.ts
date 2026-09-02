import type { AdminActor } from "../../admin-auth/contracts";

export const AI_INSTRUCTION_POLICY_RESOURCE_TYPE = "ai.instruction-policy" as const;

export const AI_INSTRUCTION_POLICY_SCOPES = ["GLOBAL", "SUBJECT"] as const;
export type AIInstructionPolicyScope = (typeof AI_INSTRUCTION_POLICY_SCOPES)[number];

export const AI_INSTRUCTION_POLICY_MAX_BYTES = 32 * 1024;

export interface AIInstructionPolicyContent {
  key: string;
  scope: AIInstructionPolicyScope;
  subjectKey: string | null;
  displayName: string;
  instructions: string;
  enabled: boolean;
}

export interface AIInstructionPolicyRevision extends AIInstructionPolicyContent {
  policyId: string;
  revisionId: string;
  revision: number;
  createdAt: number;
  createdBy: string;
}

export interface AIInstructionPolicy extends AIInstructionPolicyContent {
  id: string;
  currentRevision: number;
  currentRevisionId: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

export interface AIInstructionPolicyRepository {
  getById(id: string): AIInstructionPolicy | null;
  getByScope(scope: AIInstructionPolicyScope, subjectKey: string | null): AIInstructionPolicy | null;
  getCurrentRevision(id: string): AIInstructionPolicyRevision | null;
  getRevision(id: string, revision: number): AIInstructionPolicyRevision | null;
  list(): AIInstructionPolicy[];
  create(input: { id: string; content: AIInstructionPolicyContent; actor: AdminActor; now: number }): AIInstructionPolicyRevision;
  appendRevision(input: { id: string; expectedRevision: number; content: AIInstructionPolicyContent; actor: AdminActor; now: number }): AIInstructionPolicyRevision;
}

export type SafeAIInstructionPolicyDTO = AIInstructionPolicy;
