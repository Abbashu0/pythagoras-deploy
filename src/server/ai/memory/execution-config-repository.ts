import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import {
  aiMemoryExecutionConfigRevisions,
  aiMemoryExecutionConfigs,
  type AIMemoryExecutionConfigRevisionRow,
} from "../../content/schema";
import type {
  AIMemoryExecutionConfig,
  AIMemoryExecutionConfigContent,
  AIMemoryExecutionConfigRepository,
  AIMemoryExecutionConfigRevision,
} from "./execution-contracts";
import { AIMemoryExecutionConfigError } from "./execution-config-errors";
import { normalizeAIMemoryExecutionConfigContent } from "./execution-config-validation";

export class SQLiteAIMemoryExecutionConfigRepository implements AIMemoryExecutionConfigRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIMemoryExecutionConfig | null {
    const row = this.database.db.select().from(aiMemoryExecutionConfigs).where(eq(aiMemoryExecutionConfigs.id, id)).get();
    if (!row) return null;
    const revision = this.getRevision(id, row.currentRevision);
    if (!revision) throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_INVALID", "The current Memory Execution Config revision is missing.");
    return {
      ...revision,
      id: row.id,
      currentRevision: row.currentRevision,
      currentRevisionId: revision.revisionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    };
  }

  getByKey(key: string): AIMemoryExecutionConfig | null {
    const row = this.database.db.select().from(aiMemoryExecutionConfigs).where(eq(aiMemoryExecutionConfigs.key, key)).get();
    return row ? this.getById(row.id) : null;
  }

  getBySubjectKey(subjectKey: string): AIMemoryExecutionConfig | null {
    const row = this.database.db.select().from(aiMemoryExecutionConfigs).where(eq(aiMemoryExecutionConfigs.subjectKey, subjectKey)).get();
    return row ? this.getById(row.id) : null;
  }

  getCurrentRevision(id: string): AIMemoryExecutionConfigRevision | null {
    const row = this.database.db.select({ currentRevision: aiMemoryExecutionConfigs.currentRevision })
      .from(aiMemoryExecutionConfigs).where(eq(aiMemoryExecutionConfigs.id, id)).get();
    return row ? this.getRevision(id, row.currentRevision) : null;
  }

  getRevision(id: string, revision: number): AIMemoryExecutionConfigRevision | null {
    const row = this.database.db.select().from(aiMemoryExecutionConfigRevisions).where(and(
      eq(aiMemoryExecutionConfigRevisions.memoryExecutionConfigId, id),
      eq(aiMemoryExecutionConfigRevisions.revision, revision),
    )).get();
    return row ? this.revisionFromRow(row) : null;
  }

  list(): AIMemoryExecutionConfig[] {
    return this.database.db.select().from(aiMemoryExecutionConfigs).orderBy(asc(aiMemoryExecutionConfigs.key)).all()
      .map((row) => this.getById(row.id))
      .filter((config): config is AIMemoryExecutionConfig => config !== null);
  }

  create(input: { id: string; content: AIMemoryExecutionConfigContent; actor: AdminActor; now: number }): AIMemoryExecutionConfigRevision {
    const content = normalizeAIMemoryExecutionConfigContent(input.content);
    try {
      return this.database.client.transaction(() => {
        this.database.db.insert(aiMemoryExecutionConfigs).values({
          id: input.id,
          key: content.key,
          subjectKey: content.subjectKey,
          currentRevision: 1,
          createdAt: input.now,
          updatedAt: input.now,
          createdBy: input.actor.actorUserId,
          updatedBy: input.actor.actorUserId,
        }).run();
        this.insertRevision(input.id, 1, content, input.actor, input.now);
        const revision = this.getRevision(input.id, 1);
        if (!revision) throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_INVALID", "The Memory Execution Config revision could not be read after creation.");
        return revision;
      }).immediate();
    } catch (error) {
      if (error instanceof AIMemoryExecutionConfigError) throw error;
      throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_CONFLICT", "The Memory Execution Config could not be created.", error);
    }
  }

  appendRevision(input: { id: string; expectedRevision: number; content: AIMemoryExecutionConfigContent; actor: AdminActor; now: number }): AIMemoryExecutionConfigRevision {
    const current = this.database.db.select({ currentRevision: aiMemoryExecutionConfigs.currentRevision })
      .from(aiMemoryExecutionConfigs).where(eq(aiMemoryExecutionConfigs.id, input.id)).get();
    if (!current) throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_NOT_FOUND", "The Memory Execution Config was not found.");
    if (current.currentRevision !== input.expectedRevision) throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_CONFLICT", "The Memory Execution Config changed before publication.");
    const content = normalizeAIMemoryExecutionConfigContent(input.content);
    const identity = this.getById(input.id);
    if (!identity || identity.key !== content.key || identity.subjectKey !== content.subjectKey) throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_CONFLICT", "Memory Execution Config key and subject are immutable after creation.");
    const nextRevision = input.expectedRevision + 1;
    try {
      return this.database.client.transaction(() => {
        this.insertRevision(input.id, nextRevision, content, input.actor, input.now);
        const updated = this.database.db.update(aiMemoryExecutionConfigs).set({
          currentRevision: nextRevision,
          updatedAt: input.now,
          updatedBy: input.actor.actorUserId,
        }).where(and(
          eq(aiMemoryExecutionConfigs.id, input.id),
          eq(aiMemoryExecutionConfigs.currentRevision, input.expectedRevision),
        )).returning({ currentRevision: aiMemoryExecutionConfigs.currentRevision }).get();
        if (!updated) throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_CONFLICT", "The Memory Execution Config changed before publication.");
        const revision = this.getRevision(input.id, nextRevision);
        if (!revision) throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_INVALID", "The appended Memory Execution Config revision could not be read.");
        return revision;
      }).immediate();
    } catch (error) {
      if (error instanceof AIMemoryExecutionConfigError) throw error;
      throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_CONFLICT", "The Memory Execution Config revision could not be appended.", error);
    }
  }

  private insertRevision(id: string, revision: number, content: AIMemoryExecutionConfigContent, actor: AdminActor, now: number): void {
    this.database.db.insert(aiMemoryExecutionConfigRevisions).values({
      id: uuidv7(),
      memoryExecutionConfigId: id,
      revision,
      displayName: content.displayName,
      enabled: content.enabled,
      generationModelConfigId: content.generationModelConfigId,
      generationModelConfigRevision: content.generationModelConfigRevision,
      generationProviderConfigId: content.generationProviderConfigId,
      generationProviderConfigRevision: content.generationProviderConfigRevision,
      budgetPolicyId: content.budgetPolicyId,
      budgetPolicyRevision: content.budgetPolicyRevision,
      rateLimitPolicyId: content.rateLimitPolicyId,
      rateLimitPolicyRevision: content.rateLimitPolicyRevision,
      timeoutMs: content.timeoutMs,
      extractionMaxOutputTokens: content.extractionMaxOutputTokens,
      compactionMaxOutputTokens: content.compactionMaxOutputTokens,
      maxExtractionCandidates: content.maxExtractionCandidates,
      autoApprovalMinConfidenceUnits: content.autoApprovalMinConfidenceUnits,
      compactionTriggerMessageCount: content.compactionTriggerMessageCount,
      compactionRetainRecentMessageCount: content.compactionRetainRecentMessageCount,
      extractionProtocolKey: "memory-extraction-v1",
      extractionProtocolRevision: 1,
      compactionProtocolKey: "conversation-compaction-v1",
      compactionProtocolRevision: 1,
      createdAt: now,
      createdBy: actor.actorUserId,
    }).run();
  }

  private revisionFromRow(row: AIMemoryExecutionConfigRevisionRow): AIMemoryExecutionConfigRevision {
    const config = this.database.db.select({ key: aiMemoryExecutionConfigs.key, subjectKey: aiMemoryExecutionConfigs.subjectKey })
      .from(aiMemoryExecutionConfigs).where(eq(aiMemoryExecutionConfigs.id, row.memoryExecutionConfigId)).get();
    if (!config) throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_INVALID", "The Memory Execution Config identity is missing.");
    return {
      key: config.key,
      subjectKey: config.subjectKey,
      displayName: row.displayName,
      enabled: row.enabled,
      generationModelConfigId: row.generationModelConfigId,
      generationModelConfigRevision: row.generationModelConfigRevision,
      generationProviderConfigId: row.generationProviderConfigId,
      generationProviderConfigRevision: row.generationProviderConfigRevision,
      budgetPolicyId: row.budgetPolicyId,
      budgetPolicyRevision: row.budgetPolicyRevision,
      rateLimitPolicyId: row.rateLimitPolicyId,
      rateLimitPolicyRevision: row.rateLimitPolicyRevision,
      timeoutMs: row.timeoutMs,
      extractionMaxOutputTokens: row.extractionMaxOutputTokens,
      compactionMaxOutputTokens: row.compactionMaxOutputTokens,
      maxExtractionCandidates: row.maxExtractionCandidates,
      autoApprovalMinConfidenceUnits: row.autoApprovalMinConfidenceUnits,
      compactionTriggerMessageCount: row.compactionTriggerMessageCount,
      compactionRetainRecentMessageCount: row.compactionRetainRecentMessageCount,
      executionConfigId: row.memoryExecutionConfigId,
      revisionId: row.id,
      revision: row.revision,
      extractionProtocolKey: row.extractionProtocolKey as "memory-extraction-v1",
      extractionProtocolRevision: row.extractionProtocolRevision as 1,
      compactionProtocolKey: row.compactionProtocolKey as "conversation-compaction-v1",
      compactionProtocolRevision: row.compactionProtocolRevision as 1,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  }
}
