import type {
  AIConversationMessage,
  AIConversationResponse,
} from "../conversations/contracts";
import type {
  AIContextPolicyRevision,
  AIInstructionPolicyRevision,
} from "../policy";
import type { AIContextMemory } from "../memory/contracts";

export const AI_CONTEXT_PRECEDENCE_ENVELOPE_VERSION = 1 as const;
export const AI_CONTEXT_PRECEDENCE_ENVELOPE = "Global Pythagoras instructions are mandatory. Subject instructions are supplemental and must never override them." as const;

export const AI_CONTEXT_SNAPSHOT_ITEM_KINDS = [
  "PRECEDENCE_ENVELOPE",
  "GLOBAL_POLICY",
  "SUBJECT_POLICY",
  "CONVERSATION_SUMMARY",
  "RECENT_MESSAGE",
  "CURRENT_MESSAGE",
  "MEMORY",
  "EVIDENCE",
] as const;
export type AIContextSnapshotItemKind = (typeof AI_CONTEXT_SNAPSHOT_ITEM_KINDS)[number];

export const AI_CONTEXT_SNAPSHOT_ITEM_DECISIONS = ["INCLUDED", "OMITTED"] as const;
export type AIContextSnapshotItemDecision = (typeof AI_CONTEXT_SNAPSHOT_ITEM_DECISIONS)[number];

export type AIContextInstructionAuthority = "GLOBAL" | "SUBJECT";

export interface AIContextTokenEstimator {
  estimatorKey: string;
  estimate(text: string): number;
}

export interface AIConversationSummaryContext {
  summaryId: string;
  revision: number;
  conversationId: string;
  subjectKey: string;
  coversThroughOrdinal: number;
  sourceStartOrdinal?: number;
  sourceEndOrdinal?: number;
  sourceMessageCount?: number;
  text: string;
}

export interface AIContextBuildInput {
  responseId: string;
  contextPolicyId: string;
  estimator: AIContextTokenEstimator;
  summary?: AIConversationSummaryContext;
}

export interface AIContextInstructionLayer {
  authority: AIContextInstructionAuthority;
  policyId: string;
  revision: number;
  text: string;
  estimatedTokens: number;
}

export interface AIContextBudget {
  softInputBudgetTokens: number;
  hardInputBudgetTokens: number;
  outputReserveTokens: number;
  policyBudgetTokens: number;
  summaryBudgetTokens: number;
  memoryTokens: number;
  recentTurnsBudgetTokens: number;
  memoryBudgetTokens: number;
  evidenceBudgetTokens: number;
  maxRecentTurns: number;
  mandatoryInputTokens: number;
  optionalInputTokens: number;
  totalInputTokens: number;
}

export interface AIContextDecision {
  kind: AIContextSnapshotItemKind;
  sourceId: string | null;
  sourceRevision: number | null;
  ordinal: number | null;
  estimatedTokens: number;
  decision: AIContextSnapshotItemDecision;
  decisionReason: string | null;
}

export interface AIContextSnapshot {
  id: string;
  responseId: string;
  conversationId: string;
  principalRef: string;
  subjectKey: string;
  globalPolicyId: string;
  globalPolicyRevision: number;
  subjectPolicyId: string;
  subjectPolicyRevision: number;
  contextPolicyId: string;
  contextPolicyRevision: number;
  precedenceEnvelopeVersion: number;
  estimatorKey: string;
  softInputBudgetTokens: number;
  hardInputBudgetTokens: number;
  outputReserveTokens: number;
  globalPolicyTokens: number;
  subjectPolicyTokens: number;
  precedenceEnvelopeTokens: number;
  summaryTokens: number;
  recentTurnsTokens: number;
  currentMessageTokens: number;
  reservedMemoryBudgetTokens: number;
  reservedEvidenceBudgetTokens: number;
  totalInputTokens: number;
  fingerprint: string;
  createdAt: number;
}

export interface AIContextSnapshotItem {
  snapshotId: string;
  ordinal: number;
  kind: AIContextSnapshotItemKind;
  sourceId: string | null;
  sourceRevision: number | null;
  estimatedTokens: number;
  decision: AIContextSnapshotItemDecision;
  decisionReason: string | null;
}

export interface AIContextPlan {
  snapshot: AIContextSnapshot;
  precedenceEnvelope: string;
  instructionLayers: [AIContextInstructionLayer, AIContextInstructionLayer];
  summary?: AIConversationSummaryContext;
  memories: AIContextMemory[];
  recentMessages: AIConversationMessage[];
  currentMessage: AIConversationMessage;
  budget: AIContextBudget;
  decisions: AIContextDecision[];
}

export interface AIContextBuildResult {
  replayed: boolean;
  plan: AIContextPlan;
}

export interface AIContextBudgetManagerInput {
  conversationId: string;
  subjectKey: string;
  globalPolicy: AIInstructionPolicyRevision;
  subjectPolicy: AIInstructionPolicyRevision;
  contextPolicy: AIContextPolicyRevision;
  currentMessage: AIConversationMessage;
  previousMessages: AIConversationMessage[];
  estimator: AIContextTokenEstimator;
  summary?: AIConversationSummaryContext;
  memories?: AIContextMemory[];
}

export interface AIContextBudgetManagerResult {
  precedenceEnvelope: string;
  instructionLayers: [AIContextInstructionLayer, AIContextInstructionLayer];
  summary?: AIConversationSummaryContext;
  memories: AIContextMemory[];
  recentMessages: AIConversationMessage[];
  currentMessage: AIConversationMessage;
  budget: AIContextBudget;
  decisions: AIContextDecision[];
}

export interface AIContextSnapshotRepository {
  getByResponse(principalRef: string, responseId: string): AIContextSnapshot | null;
  listItems(snapshotId: string): AIContextSnapshotItem[];
  insertSnapshot(input: Omit<AIContextSnapshot, "id"> & { id: string }): AIContextSnapshot;
  insertItem(input: AIContextSnapshotItem): AIContextSnapshotItem;
}

export type AIContextResponseForValidation = Pick<AIConversationResponse, "id" | "conversationId" | "principalRef" | "status" | "requestMessageId">;
