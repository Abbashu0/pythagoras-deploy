import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import { assertActiveStudentPrincipal } from "../conversations/principal";
import type {
  AIConversation,
  AIStudentPrincipal,
} from "../conversations/contracts";
import { SQLiteAIConversationRepository } from "../conversations/sqlite-repository";
import { AIPolicyError } from "../policy/errors";
import { SQLiteAIContextPolicyRepository } from "../policy/context-policy-repository";
import { SQLiteAIInstructionPolicyRepository } from "../policy/instruction-repository";
import { SQLiteAIMemoryPolicyRepository } from "../memory/policy-repository";
import { SQLiteAIMemoryRepository } from "../memory/repository";
import { SQLiteAIConversationSummaryRepository } from "../memory/summary-repository";
import type { AIMemoryPolicyRepository } from "../memory/contracts";
import type { AIConversationSummary } from "../memory/summary-contracts";
import type {
  AIContextBuildInput,
  AIContextBuildResult,
  AIContextBudgetManagerResult,
  AIContextDecision,
  AIContextPlan,
  AIContextSnapshot,
  AIContextSnapshotItem,
  AIContextTokenEstimator,
} from "./contracts";
import { AI_CONTEXT_PRECEDENCE_ENVELOPE_VERSION } from "./contracts";
import { ContextBudgetManager } from "./budget-manager";
import { AIContextError } from "./errors";
import { SQLiteAIContextSnapshotRepository } from "./sqlite-snapshot-repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface AIContextServiceDependencies {
  conversations?: SQLiteAIConversationRepository;
  instructionPolicies?: SQLiteAIInstructionPolicyRepository;
  contextPolicies?: SQLiteAIContextPolicyRepository;
  memoryPolicies?: AIMemoryPolicyRepository;
  memories?: SQLiteAIMemoryRepository;
  summaries?: SQLiteAIConversationSummaryRepository;
  snapshots?: SQLiteAIContextSnapshotRepository;
  manager?: ContextBudgetManager;
  clock?: () => number;
  idFactory?: () => string;
}

export class AIContextService {
  private readonly conversations: SQLiteAIConversationRepository;
  private readonly instructionPolicies: SQLiteAIInstructionPolicyRepository;
  private readonly contextPolicies: SQLiteAIContextPolicyRepository;
  private readonly memoryPolicies: AIMemoryPolicyRepository;
  private readonly memories: SQLiteAIMemoryRepository;
  private readonly summaries: SQLiteAIConversationSummaryRepository;
  private readonly snapshots: SQLiteAIContextSnapshotRepository;
  private readonly memoryDomainAvailable: boolean;
  private readonly manager: ContextBudgetManager;
  private readonly clock: () => number;
  private readonly idFactory: () => string;

  constructor(
    private readonly database: ContentDatabase,
    dependencies: AIContextServiceDependencies = {},
  ) {
    this.conversations = dependencies.conversations ?? new SQLiteAIConversationRepository(database);
    this.instructionPolicies = dependencies.instructionPolicies ?? new SQLiteAIInstructionPolicyRepository(database);
    this.contextPolicies = dependencies.contextPolicies ?? new SQLiteAIContextPolicyRepository(database);
    this.memoryPolicies = dependencies.memoryPolicies ?? new SQLiteAIMemoryPolicyRepository(database);
    this.memories = dependencies.memories ?? new SQLiteAIMemoryRepository(database);
    this.summaries = dependencies.summaries ?? new SQLiteAIConversationSummaryRepository(database);
    this.memoryDomainAvailable = this.hasMemoryDomainTables();
    this.snapshots = dependencies.snapshots ?? new SQLiteAIContextSnapshotRepository(database);
    this.manager = dependencies.manager ?? new ContextBudgetManager();
    this.clock = dependencies.clock ?? Date.now;
    this.idFactory = dependencies.idFactory ?? uuidv7;
  }

  build(principal: AIStudentPrincipal, input: AIContextBuildInput): AIContextBuildResult {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const responseId = normalizeUuid(input.responseId, "AI_CONTEXT_RESPONSE_INVALID", "The Context Response identity is invalid.");
    const contextPolicyId = normalizeUuid(input.contextPolicyId, "AI_CONTEXT_POLICY_INVALID", "The Context Policy identity is invalid.");
    validateEstimatorContract(input.estimator);
    return this.database.client.transaction(() => {
      const response = this.conversations.getResponse(activePrincipal.principalRef, responseId);
      if (!response || response.status !== "PENDING" || !response.requestMessageId) throw new AIContextError("AI_CONTEXT_RESPONSE_INVALID", "The Context Response is not eligible for planning.");
      const conversation = this.conversations.getConversation(activePrincipal.principalRef, response.conversationId);
      if (!conversation || conversation.status !== "ACTIVE") throw new AIContextError("AI_CONTEXT_RESPONSE_INVALID", "The Context Conversation is not active.");
      const currentMessage = this.conversations.getMessageForConversation(activePrincipal.principalRef, conversation.id, response.requestMessageId);
      if (!currentMessage || currentMessage.role !== "USER") throw new AIContextError("AI_CONTEXT_RESPONSE_INVALID", "The Context current message is invalid.");
      const globalPolicy = this.instructionPolicies.getByScope("GLOBAL", null);
      if (!globalPolicy) throw new AIPolicyError("AI_POLICY_NOT_FOUND", "No Global Instruction Policy is published.");
      if (!globalPolicy.enabled) throw new AIPolicyError("AI_POLICY_DISABLED", "The Global Instruction Policy is disabled.");
      const subjectPolicy = this.instructionPolicies.getByScope("SUBJECT", conversation.subjectKey);
      if (!subjectPolicy) throw new AIPolicyError("AI_POLICY_NOT_FOUND", "No Subject Instruction Policy is published for this Conversation subject.");
      if (!subjectPolicy.enabled) throw new AIPolicyError("AI_POLICY_DISABLED", "The Subject Instruction Policy is disabled.");
      const contextPolicy = this.contextPolicies.getById(contextPolicyId);
      if (!contextPolicy) throw new AIContextError("AI_CONTEXT_POLICY_NOT_FOUND", "The Context Policy was not found.");
      if (!contextPolicy.enabled) throw new AIContextError("AI_CONTEXT_POLICY_DISABLED", "The Context Policy is disabled.");
      const globalRevision = this.instructionPolicies.getCurrentRevision(globalPolicy.id);
      const subjectRevision = this.instructionPolicies.getCurrentRevision(subjectPolicy.id);
      const contextRevision = this.contextPolicies.getCurrentRevision(contextPolicy.id);
      if (!globalRevision || !subjectRevision || !contextRevision) throw new AIContextError("AI_CONTEXT_RESPONSE_INVALID", "A current Context Policy revision is missing.");
      const currentSummaryRecord = this.memoryDomainAvailable
        ? this.summaries.getCurrentForConversation({ principalRef: activePrincipal.principalRef, conversationId: conversation.id, subjectKey: conversation.subjectKey })
        : null;
      if (input.summary && (!currentSummaryRecord || input.summary.summaryId !== currentSummaryRecord.id || input.summary.revision !== currentSummaryRecord.revision)) {
        throw new AIContextError("AI_CONTEXT_SUMMARY_INVALID", "Context Summary text must come from the canonical current Summary revision.");
      }
      const summary = currentSummaryRecord ? summaryContext(currentSummaryRecord) : undefined;
      const memoryPolicy = this.memoryDomainAvailable ? this.memoryPolicies.getBySubjectKey(conversation.subjectKey) : null;
      const memories = memoryPolicy?.enabled
        ? this.memories.listEligible({ principalRef: activePrincipal.principalRef, subjectKey: conversation.subjectKey, at: this.safeNow(), limit: memoryPolicy.maxSelectedMemories })
        : [];
      const previousMessages = this.conversations.listMessagesBefore({
        principalRef: activePrincipal.principalRef,
        conversationId: conversation.id,
        beforeOrdinal: currentMessage.ordinal,
        afterOrdinal: summary?.coversThroughOrdinal ?? 0,
        limit: contextPolicy.maxRecentTurns * 2 + 1,
        excludePartial: true,
      });
      const computation = this.manager.build({
        conversationId: conversation.id,
        subjectKey: conversation.subjectKey,
        globalPolicy: globalRevision,
        subjectPolicy: subjectRevision,
        contextPolicy: contextRevision,
        currentMessage,
        previousMessages,
        estimator: input.estimator,
        summary,
        memories,
      });
      const fingerprint = createContextFingerprint({
        responseId: response.id,
        conversation,
        globalPolicyId: globalRevision.policyId,
        globalPolicyRevision: globalRevision.revision,
        subjectPolicyId: subjectRevision.policyId,
        subjectPolicyRevision: subjectRevision.revision,
        contextPolicyId: contextRevision.contextPolicyId,
        contextPolicyRevision: contextRevision.revision,
        estimatorKey: input.estimator.estimatorKey,
        currentMessageId: currentMessage.id,
        decisions: computation.decisions,
        summary,
        budget: computation.budget,
      });
      const existing = this.snapshots.getByResponse(activePrincipal.principalRef, response.id);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new AIContextError("AI_CONTEXT_SNAPSHOT_CONFLICT", "The Response already has a different immutable Context Snapshot.");
        return { replayed: true, plan: this.toPlan(existing, computation) };
      }
      const snapshot = this.snapshots.insertSnapshot({
        id: this.idFactory(),
        responseId: response.id,
        conversationId: conversation.id,
        principalRef: activePrincipal.principalRef,
        subjectKey: conversation.subjectKey,
        globalPolicyId: globalRevision.policyId,
        globalPolicyRevision: globalRevision.revision,
        subjectPolicyId: subjectRevision.policyId,
        subjectPolicyRevision: subjectRevision.revision,
        contextPolicyId: contextRevision.contextPolicyId,
        contextPolicyRevision: contextRevision.revision,
        precedenceEnvelopeVersion: AI_CONTEXT_PRECEDENCE_ENVELOPE_VERSION,
        estimatorKey: input.estimator.estimatorKey,
        softInputBudgetTokens: contextRevision.softInputBudgetTokens,
        hardInputBudgetTokens: contextRevision.hardInputBudgetTokens,
        outputReserveTokens: contextRevision.outputReserveTokens,
        globalPolicyTokens: tokenCount(computation, "GLOBAL_POLICY"),
        subjectPolicyTokens: tokenCount(computation, "SUBJECT_POLICY"),
        precedenceEnvelopeTokens: tokenCount(computation, "PRECEDENCE_ENVELOPE"),
        summaryTokens: tokenCount(computation, "CONVERSATION_SUMMARY"),
        recentTurnsTokens: tokenCount(computation, "RECENT_MESSAGE"),
        currentMessageTokens: tokenCount(computation, "CURRENT_MESSAGE"),
        reservedMemoryBudgetTokens: contextRevision.memoryBudgetTokens,
        reservedEvidenceBudgetTokens: contextRevision.evidenceBudgetTokens,
        totalInputTokens: computation.budget.totalInputTokens,
        fingerprint,
        createdAt: this.safeNow(),
      });
      computation.decisions.forEach((decision, index) => this.snapshots.insertItem({
        snapshotId: snapshot.id,
        ordinal: index + 1,
        kind: decision.kind,
        sourceId: decision.sourceId,
        sourceRevision: decision.sourceRevision,
        estimatedTokens: decision.estimatedTokens,
        decision: decision.decision,
        decisionReason: decision.decisionReason,
      }));
      return { replayed: false, plan: this.toPlan(snapshot, computation) };
    }).immediate();
  }

  getSnapshot(principal: AIStudentPrincipal, responseId: string): AIContextSnapshot {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const normalizedResponseId = normalizeUuid(responseId, "AI_CONTEXT_RESPONSE_INVALID", "The Context Response identity is invalid.");
    const response = this.conversations.getResponse(activePrincipal.principalRef, normalizedResponseId);
    if (!response) throw new AIContextError("AI_CONTEXT_RESPONSE_INVALID", "The Context Response was not found.");
    const snapshot = this.snapshots.getByResponse(activePrincipal.principalRef, normalizedResponseId);
    if (!snapshot) throw new AIContextError("AI_CONTEXT_SNAPSHOT_CONFLICT", "The Context Snapshot was not found.");
    return snapshot;
  }

  listSnapshotItems(principal: AIStudentPrincipal, responseId: string): AIContextSnapshotItem[] {
    return this.snapshots.listItems(this.getSnapshot(principal, responseId).id);
  }

  private toPlan(snapshot: AIContextSnapshot, computation: AIContextBudgetManagerResult): AIContextPlan {
    return {
      snapshot,
      precedenceEnvelope: computation.precedenceEnvelope,
      instructionLayers: computation.instructionLayers,
      ...(computation.summary ? { summary: computation.summary } : {}),
      memories: computation.memories,
      recentMessages: computation.recentMessages,
      currentMessage: computation.currentMessage,
      budget: computation.budget,
      decisions: computation.decisions,
    };
  }

  private safeNow(): number {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0) throw new AIContextError("AI_CONTEXT_RESPONSE_INVALID", "Context time is invalid.");
    return value;
  }

  private hasMemoryDomainTables(): boolean {
    const rows = this.database.client.prepare("select name from sqlite_master where type='table' and name in ('ai_memories','ai_memory_policies','ai_memory_policy_revisions','ai_conversation_summary_revisions')").all() as Array<{ name: string }>;
    return rows.length === 4;
  }
}

function summaryContext(summary: AIConversationSummary): NonNullable<AIContextBuildInput["summary"]> {
  if (summary.summaryText === null || summary.status !== "ACTIVE") throw new AIContextError("AI_CONTEXT_SUMMARY_INVALID", "The canonical Conversation Summary is not active.");
  return {
    summaryId: summary.id,
    revision: summary.revision,
    conversationId: summary.conversationId,
    subjectKey: summary.subjectKey,
    coversThroughOrdinal: summary.coversThroughOrdinal,
    sourceStartOrdinal: summary.sourceStartOrdinal,
    sourceEndOrdinal: summary.sourceEndOrdinal,
    sourceMessageCount: summary.sourceMessageCount,
    text: summary.summaryText,
  };
}

function validateEstimatorContract(estimator: AIContextTokenEstimator): void {
  if (!estimator || typeof estimator !== "object" || typeof estimator.estimatorKey !== "string" || typeof estimator.estimate !== "function") throw new AIContextError("AI_CONTEXT_ESTIMATOR_INVALID", "A valid Context token estimator is required.");
}

function normalizeUuid(value: unknown, code: "AI_CONTEXT_RESPONSE_INVALID" | "AI_CONTEXT_POLICY_INVALID", message: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new AIContextError(code, message);
  return value;
}

function tokenCount(computation: AIContextBudgetManagerResult, kind: AIContextDecision["kind"]): number {
  return computation.decisions.filter((decision) => decision.kind === kind && decision.decision === "INCLUDED")
    .reduce((total, decision) => total + decision.estimatedTokens, 0);
}

function createContextFingerprint(input: {
  responseId: string;
  conversation: AIConversation;
  globalPolicyId: string;
  globalPolicyRevision: number;
  subjectPolicyId: string;
  subjectPolicyRevision: number;
  contextPolicyId: string;
  contextPolicyRevision: number;
  estimatorKey: string;
  currentMessageId: string;
  decisions: AIContextBudgetManagerResult["decisions"];
  summary?: AIContextBuildInput["summary"];
  budget: AIContextBudgetManagerResult["budget"];
}): string {
  const metadata = {
    version: 1,
    responseId: input.responseId,
    conversationId: input.conversation.id,
    principalRef: input.conversation.principalRef,
    subjectKey: input.conversation.subjectKey,
    globalPolicyId: input.globalPolicyId,
    globalPolicyRevision: input.globalPolicyRevision,
    subjectPolicyId: input.subjectPolicyId,
    subjectPolicyRevision: input.subjectPolicyRevision,
    contextPolicyId: input.contextPolicyId,
    contextPolicyRevision: input.contextPolicyRevision,
    precedenceEnvelopeVersion: AI_CONTEXT_PRECEDENCE_ENVELOPE_VERSION,
    estimatorKey: input.estimatorKey,
    currentMessageId: input.currentMessageId,
    decisions: input.decisions.map((decision) => ({ kind: decision.kind, sourceId: decision.sourceId, sourceRevision: decision.sourceRevision, ordinal: decision.ordinal, estimatedTokens: decision.estimatedTokens, decision: decision.decision, decisionReason: decision.decisionReason })),
    summary: input.summary ? { summaryId: input.summary.summaryId, revision: input.summary.revision, conversationId: input.summary.conversationId, subjectKey: input.summary.subjectKey, coversThroughOrdinal: input.summary.coversThroughOrdinal } : null,
    budget: input.budget,
  };
  return createHash("sha256").update(JSON.stringify(metadata), "utf8").digest("hex");
}
