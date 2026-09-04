import { v7 as uuidv7 } from "uuid";

import { assertActiveStudentPrincipal } from "../conversations/principal";
import { SQLiteAIConversationRepository } from "../conversations";
import type { AIStudentPrincipal } from "../conversations";
import type { AIOutboxEvent, AIOutboxRouterDefinition } from "../operations/outbox";
import { AIOutboxError } from "../operations/outbox";
import type {
  AIMemoryExecution,
  AIMemoryExecutionConfigRepository,
  AIMemoryExecutionRepository,
  AIMemoryScheduleResult,
} from "./execution-contracts";
import {
  AI_CONVERSATION_COMPACTION_PROTOCOL_KEY,
  AI_CONVERSATION_COMPACTION_PROTOCOL_REVISION,
  AI_MEMORY_EXECUTION_PAYLOAD_VERSION,
  AI_MEMORY_EXTRACTION_JOB_KIND,
  AI_MEMORY_EXTRACTION_OUTBOX_EVENT_TYPE,
  AI_MEMORY_COMPACTION_JOB_KIND,
  AI_MEMORY_COMPACTION_OUTBOX_EVENT_TYPE,
} from "./execution-contracts";
import { fingerprintAIMemoryExecutionConfig } from "./execution-config-validation";
import type { ContentDatabase } from "../../content/database";
import type { AIOutboxService } from "../operations/outbox";
import { SQLiteAIMemoryExecutionConfigRepository } from "./execution-config-repository";
import { SQLiteAIMemoryExecutionRepository } from "./execution-repository";
import { SQLiteAIConversationSummaryRepository } from "./summary-repository";
import { AIMemoryExecutionError } from "./execution-errors";
import type { AIMemoryPolicyRepository } from "./contracts";

export interface AIMemoryOrchestratorDependencies {
  database: ContentDatabase;
  outbox: AIOutboxService;
  executions?: AIMemoryExecutionRepository;
  configs?: AIMemoryExecutionConfigRepository;
  /** Deprecated extraction dependency; retained only for caller compatibility. */
  memoryPolicies?: AIMemoryPolicyRepository;
  conversations?: SQLiteAIConversationRepository;
  clock?: () => number;
  idFactory?: () => string;
}

export class AIMemoryOrchestrator {
  private readonly executions: AIMemoryExecutionRepository;
  private readonly configs: AIMemoryExecutionConfigRepository;
  private readonly conversations: SQLiteAIConversationRepository;
  private readonly summaries: SQLiteAIConversationSummaryRepository;
  private readonly clock: () => number;
  private readonly idFactory: () => string;

  constructor(private readonly dependencies: AIMemoryOrchestratorDependencies) {
    this.executions = dependencies.executions ?? new SQLiteAIMemoryExecutionRepository(dependencies.database);
    this.configs = dependencies.configs ?? new SQLiteAIMemoryExecutionConfigRepository(dependencies.database);
    this.conversations = dependencies.conversations ?? new SQLiteAIConversationRepository(dependencies.database);
    this.summaries = new SQLiteAIConversationSummaryRepository(dependencies.database);
    this.clock = dependencies.clock ?? Date.now;
    this.idFactory = dependencies.idFactory ?? uuidv7;
  }

  scheduleForCompletedResponse(principal: AIStudentPrincipal, responseId: string): AIMemoryScheduleResult {
    const activePrincipal = assertActiveStudentPrincipal(principal);
    const now = this.safeNow();
    return this.dependencies.database.client.transaction(() => {
      const source = this.requireCompletedTurn(activePrincipal.principalRef, responseId);
      const config = this.configs.getBySubjectKey(source.conversation.subjectKey);
      if (!config || !config.enabled) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_CONFIG_NOT_FOUND", "No enabled Memory Execution Config is published for this subject.");
      const configRevision = this.configs.getRevision(config.id, config.currentRevision);
      if (!configRevision || !configRevision.enabled) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_CONFIG_NOT_FOUND", "The current Memory Execution Config revision is unavailable.");
      const configFingerprint = fingerprintAIMemoryExecutionConfig({ ...configRevision, executionConfigId: config.id, revision: configRevision.revision });
      let compaction: { execution: AIMemoryExecution; outbox: AIOutboxEvent } | null = null;
      const currentSummary = this.summaries.getCurrentForConversation({ principalRef: activePrincipal.principalRef, conversationId: source.conversation.id, subjectKey: source.conversation.subjectKey });
      const baseCoverage = currentSummary?.coversThroughOrdinal ?? 0;
      const postSummaryMessages = this.conversations.listMessagesBefore({ principalRef: activePrincipal.principalRef, conversationId: source.conversation.id, beforeOrdinal: source.assistantMessage.ordinal + 1, afterOrdinal: baseCoverage, limit: 10_000, excludePartial: true }).sort((left, right) => left.ordinal - right.ordinal);
      if (postSummaryMessages.length >= configRevision.compactionTriggerMessageCount) {
        const cutoff = this.findCompactionCutoff(postSummaryMessages, configRevision.compactionRetainRecentMessageCount, baseCoverage);
        if (cutoff !== null) {
          compaction = this.createOrReuse({
            executionKind: "COMPACTION",
            scheduleKey: `memory-compaction:${source.conversation.id}:${currentSummary?.id ?? "none"}:${currentSummary?.revision ?? 0}:${cutoff}:${config.id}:${configRevision.revision}`,
            principalRef: activePrincipal.principalRef,
            subjectKey: source.conversation.subjectKey,
            conversationId: source.conversation.id,
            responseId: source.response.id,
            requestMessageId: source.requestMessage.id,
            requestOrdinal: source.requestMessage.ordinal,
            assistantMessageId: source.assistantMessage.id,
            assistantOrdinal: source.assistantMessage.ordinal,
            executionConfigId: config.id,
            executionConfigRevision: configRevision.revision,
            executionConfigFingerprint: configFingerprint,
            generationModelConfigId: configRevision.generationModelConfigId,
            generationModelConfigRevision: configRevision.generationModelConfigRevision,
            generationProviderConfigId: configRevision.generationProviderConfigId,
            generationProviderConfigRevision: configRevision.generationProviderConfigRevision,
            budgetPolicyId: configRevision.budgetPolicyId,
            budgetPolicyRevision: configRevision.budgetPolicyRevision,
            rateLimitPolicyId: configRevision.rateLimitPolicyId,
            rateLimitPolicyRevision: configRevision.rateLimitPolicyRevision,
            protocolKey: AI_CONVERSATION_COMPACTION_PROTOCOL_KEY,
            protocolRevision: AI_CONVERSATION_COMPACTION_PROTOCOL_REVISION,
            memoryPolicyId: null,
            memoryPolicyRevision: null,
            baseSummaryId: currentSummary?.id ?? null,
            baseSummaryRevision: currentSummary?.revision ?? null,
            baseSummaryCoverage: currentSummary?.coversThroughOrdinal ?? null,
            targetCutoffOrdinal: cutoff,
            now,
          }, AI_MEMORY_COMPACTION_OUTBOX_EVENT_TYPE);
        }
      }
      return {
        extractionExecutionId: null,
        compactionExecutionId: compaction?.execution.id ?? null,
        extractionOutboxId: null,
        compactionOutboxId: compaction?.outbox.id ?? null,
      };
    }).immediate();
  }

  scheduleForCompletedTurn(principal: AIStudentPrincipal, responseId: string): AIMemoryScheduleResult {
    return this.scheduleForCompletedResponse(principal, responseId);
  }

  private createOrReuse(input: {
    executionKind: "EXTRACTION" | "COMPACTION";
    scheduleKey: string;
    principalRef: string;
    subjectKey: string;
    conversationId: string;
    responseId: string;
    requestMessageId: string;
    requestOrdinal: number;
    assistantMessageId: string;
    assistantOrdinal: number;
    executionConfigId: string;
    executionConfigRevision: number;
    executionConfigFingerprint: string;
    generationModelConfigId: string;
    generationModelConfigRevision: number;
    generationProviderConfigId: string;
    generationProviderConfigRevision: number;
    budgetPolicyId: string;
    budgetPolicyRevision: number;
    rateLimitPolicyId: string;
    rateLimitPolicyRevision: number;
    protocolKey: string;
    protocolRevision: number;
    memoryPolicyId: string | null;
    memoryPolicyRevision: number | null;
    baseSummaryId: string | null;
    baseSummaryRevision: number | null;
    baseSummaryCoverage: number | null;
    targetCutoffOrdinal: number | null;
    now: number;
  }, eventType: string): { execution: AIMemoryExecution; outbox: AIOutboxEvent } {
    const existing = this.executions.getByScheduleKey(input.scheduleKey);
    const execution = existing ?? this.executions.create({
      ...input,
      id: this.idFactory(),
      jobId: null,
      costOperationId: null,
      budgetReservationId: null,
      admissionAttempt: 0,
      status: "PENDING",
      providerInvocationState: "NOT_INVOKED",
      providerInvoked: false,
      resultSha256: null,
      resultByteSize: null,
      resultCount: 0,
      resultSummaryId: null,
      resultSummaryRevision: null,
      safeFailureCode: null,
      createdAt: input.now,
      startedAt: null,
      completedAt: null,
      updatedAt: input.now,
    });
    if (execution.executionKind !== input.executionKind || execution.subjectKey !== input.subjectKey || execution.responseId !== input.responseId) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory execution schedule identity conflicts with existing work.");
    const outbox = this.dependencies.outbox.enqueueInTransaction({ eventType, payloadVersion: AI_MEMORY_EXECUTION_PAYLOAD_VERSION, payload: { executionId: execution.id }, dedupeKey: input.scheduleKey, scheduledAt: execution.createdAt }, input.now);
    return { execution, outbox };
  }

  private requireCompletedTurn(principalRef: string, responseId: string) {
    const response = this.conversations.getResponse(principalRef, this.requireId(responseId));
    const conversation = response ? this.conversations.getConversation(principalRef, response.conversationId) : null;
    const requestMessage = response?.requestMessageId ? this.conversations.getMessage(response.requestMessageId) : null;
    const assistantMessage = response?.assistantMessageId ? this.conversations.getMessage(response.assistantMessageId) : null;
    if (!conversation || !response || response.status !== "COMPLETED" || !requestMessage || !assistantMessage || requestMessage.conversationId !== conversation.id || assistantMessage.conversationId !== conversation.id || requestMessage.role !== "USER" || assistantMessage.role !== "ASSISTANT" || requestMessage.isPartial || assistantMessage.isPartial || assistantMessage.ordinal !== requestMessage.ordinal + 1 || !response.finishReason || ["FAILED", "CANCELLED"].includes(response.finishReason)) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_SOURCE_INVALID", "Only a complete non-partial Student Tutor turn can schedule Memory work.");
    return { conversation, response, requestMessage, assistantMessage };
  }

  private findCompactionCutoff(messages: readonly { role: string; ordinal: number }[], retainRecent: number, baseCoverage: number): number | null {
    let index = messages.length - retainRecent - 1;
    while (index >= 0 && messages[index]?.role !== "ASSISTANT") index -= 1;
    const cutoff = index >= 0 ? messages[index]!.ordinal : null;
    return cutoff !== null && cutoff > baseCoverage ? cutoff : null;
  }

  private requireId(value: string): string {
    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory execution identity is invalid.");
    return value;
  }

  private safeNow(): number {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_INVALID", "The Memory orchestration timestamp is invalid.");
    return value;
  }
}

export function createAIMemoryOrchestrator(dependencies: AIMemoryOrchestratorDependencies): AIMemoryOrchestrator {
  return new AIMemoryOrchestrator(dependencies);
}

export function createAIMemoryExecutionOutboxRouters(): AIOutboxRouterDefinition[] {
  return [
    outboxRoute(AI_MEMORY_EXTRACTION_OUTBOX_EVENT_TYPE, AI_MEMORY_EXTRACTION_JOB_KIND),
    outboxRoute(AI_MEMORY_COMPACTION_OUTBOX_EVENT_TYPE, AI_MEMORY_COMPACTION_JOB_KIND),
  ];
}

function outboxRoute(eventType: string, kind: string): AIOutboxRouterDefinition {
  return {
    eventType,
    payloadVersion: AI_MEMORY_EXECUTION_PAYLOAD_VERSION,
    validatePayload(value: unknown): Record<string, unknown> {
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1 || typeof (value as { executionId?: unknown }).executionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test((value as { executionId: string }).executionId)) throw new AIOutboxError("AI_OUTBOX_INVALID", "The Memory Outbox payload is invalid.");
      return { executionId: (value as { executionId: string }).executionId };
    },
    toJob(payload: Record<string, unknown>) {
      const executionId = String(payload.executionId);
      return {
        id: executionId,
        kind,
        payloadVersion: AI_MEMORY_EXECUTION_PAYLOAD_VERSION,
        payload: { executionId },
        dedupeKey: `memory-execution:${executionId}`,
        costCenter: "STUDENT_GENERATION" as const,
        maxAttempts: 5,
        timeoutMs: 120_000,
        leaseDurationMs: 120_000,
        backoffBaseMs: 1_000,
        backoffMaxMs: 60_000,
      };
    },
  };
}
