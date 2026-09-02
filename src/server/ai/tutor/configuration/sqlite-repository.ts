import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../../../admin-auth/contracts";
import type { ContentDatabase } from "../../../content/database";
import { aiTutorConfigRevisions, aiTutorConfigs, type AITutorConfigRevisionRow } from "../../../content/schema";
import type { AITutorConfig, AITutorConfigContent, AITutorConfigRepository, AITutorConfigRevision, SafeAITutorConfigDTO } from "./contracts";
import { AITutorConfigError } from "./errors";
import { normalizeAITutorConfigContent } from "./validation";
import { AI_TUTOR_CITATION_PROTOCOL_KEY, AI_TUTOR_CITATION_PROTOCOL_REVISION, AI_TUTOR_GROUNDING_PROTOCOL_KEY, AI_TUTOR_GROUNDING_PROTOCOL_REVISION } from "./contracts";

export class SQLiteAITutorConfigRepository implements AITutorConfigRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AITutorConfig | null {
    const row = this.database.db.select().from(aiTutorConfigs).where(eq(aiTutorConfigs.id, id)).get();
    if (!row) return null;
    const revision = this.getRevision(id, row.currentRevision);
    if (!revision) throw new AITutorConfigError("AI_TUTOR_CONFIG_INVALID", "The current Tutor Config revision is missing.");
    return { ...revision, id: row.id, currentRevision: row.currentRevision, currentRevisionId: revision.revisionId, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  }

  getByKey(key: string): AITutorConfig | null {
    const row = this.database.db.select({ id: aiTutorConfigs.id }).from(aiTutorConfigs).where(eq(aiTutorConfigs.key, key)).get();
    return row ? this.getById(row.id) : null;
  }

  getCurrentRevision(id: string): AITutorConfigRevision | null {
    const row = this.database.db.select({ currentRevision: aiTutorConfigs.currentRevision }).from(aiTutorConfigs).where(eq(aiTutorConfigs.id, id)).get();
    return row ? this.getRevision(id, row.currentRevision) : null;
  }

  getRevision(id: string, revision: number): AITutorConfigRevision | null {
    const row = this.database.db.select().from(aiTutorConfigRevisions).where(and(eq(aiTutorConfigRevisions.tutorConfigId, id), eq(aiTutorConfigRevisions.revision, revision))).get();
    return row ? this.revisionFromRow(row) : null;
  }

  list(): AITutorConfig[] {
    return this.database.db.select().from(aiTutorConfigs).orderBy(asc(aiTutorConfigs.key)).all()
      .map((row) => this.getById(row.id))
      .filter((config): config is AITutorConfig => config !== null);
  }

  create(input: { id: string; content: AITutorConfigContent; actor: AdminActor; now: number }): AITutorConfigRevision {
    const content = normalizeAITutorConfigContent(input.content);
    try {
      return this.runAtomic(() => {
        this.database.db.insert(aiTutorConfigs).values({
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
        if (!revision) throw new AITutorConfigError("AI_TUTOR_CONFIG_INVALID", "The Tutor Config revision could not be read.");
        return revision;
      });
    } catch (error) {
      if (error instanceof AITutorConfigError) throw error;
      throw new AITutorConfigError("AI_TUTOR_CONFIG_CONFLICT", "The Tutor Config could not be created.", {}, error);
    }
  }

  appendRevision(input: { id: string; expectedRevision: number; content: AITutorConfigContent; actor: AdminActor; now: number }): AITutorConfigRevision {
    const current = this.database.db.select({ currentRevision: aiTutorConfigs.currentRevision, key: aiTutorConfigs.key, subjectKey: aiTutorConfigs.subjectKey }).from(aiTutorConfigs).where(eq(aiTutorConfigs.id, input.id)).get();
    if (!current) throw new AITutorConfigError("AI_TUTOR_CONFIG_NOT_FOUND", "The Tutor Config was not found.");
    if (current.currentRevision !== input.expectedRevision) throw new AITutorConfigError("AI_TUTOR_CONFIG_CONFLICT", "The Tutor Config changed before publication.");
    const content = normalizeAITutorConfigContent(input.content);
    if (content.key !== current.key || content.subjectKey !== current.subjectKey) throw new AITutorConfigError("AI_TUTOR_CONFIG_CONFLICT", "Tutor Config key and subject are immutable after creation.");
    const nextRevision = input.expectedRevision + 1;
    try {
      return this.runAtomic(() => {
        this.insertRevision(input.id, nextRevision, content, input.actor, input.now);
        const updated = this.database.db.update(aiTutorConfigs).set({ currentRevision: nextRevision, updatedAt: input.now, updatedBy: input.actor.actorUserId })
          .where(and(eq(aiTutorConfigs.id, input.id), eq(aiTutorConfigs.currentRevision, input.expectedRevision))).returning({ currentRevision: aiTutorConfigs.currentRevision }).get();
        if (!updated) throw new AITutorConfigError("AI_TUTOR_CONFIG_CONFLICT", "The Tutor Config changed before publication.");
        const revision = this.getRevision(input.id, nextRevision);
        if (!revision) throw new AITutorConfigError("AI_TUTOR_CONFIG_INVALID", "The Tutor Config revision could not be read.");
        return revision;
      });
    } catch (error) {
      if (error instanceof AITutorConfigError) throw error;
      throw new AITutorConfigError("AI_TUTOR_CONFIG_CONFLICT", "The Tutor Config revision could not be appended.", {}, error);
    }
  }

  private insertRevision(id: string, revision: number, content: AITutorConfigContent, actor: AdminActor, now: number): void {
    this.database.db.insert(aiTutorConfigRevisions).values({
      id: uuidv7(),
      tutorConfigId: id,
      revision,
      displayName: content.displayName,
      enabled: content.enabled,
      generationModelConfigId: content.generationModelConfigId,
      contextPolicyId: content.contextPolicyId,
      retrievalConfigId: content.retrievalConfigId,
      budgetPolicyId: content.budgetPolicyId,
      rateLimitPolicyId: content.rateLimitPolicyId,
      maxOutputTokens: content.maxOutputTokens,
      groundingProtocolKey: AI_TUTOR_GROUNDING_PROTOCOL_KEY,
      groundingProtocolRevision: AI_TUTOR_GROUNDING_PROTOCOL_REVISION,
      citationProtocolKey: AI_TUTOR_CITATION_PROTOCOL_KEY,
      citationProtocolRevision: AI_TUTOR_CITATION_PROTOCOL_REVISION,
      createdAt: now,
      createdBy: actor.actorUserId,
    }).run();
  }

  private revisionFromRow(row: AITutorConfigRevisionRow): AITutorConfigRevision {
    const config = this.database.db.select({ key: aiTutorConfigs.key, subjectKey: aiTutorConfigs.subjectKey }).from(aiTutorConfigs).where(eq(aiTutorConfigs.id, row.tutorConfigId)).get();
    if (!config) throw new AITutorConfigError("AI_TUTOR_CONFIG_INVALID", "The Tutor Config identity is missing.");
    return {
      tutorConfigId: row.tutorConfigId,
      revisionId: row.id,
      revision: row.revision,
      key: config.key,
      subjectKey: config.subjectKey,
      displayName: row.displayName,
      enabled: row.enabled,
      generationModelConfigId: row.generationModelConfigId,
      contextPolicyId: row.contextPolicyId,
      retrievalConfigId: row.retrievalConfigId,
      budgetPolicyId: row.budgetPolicyId,
      rateLimitPolicyId: row.rateLimitPolicyId,
      maxOutputTokens: row.maxOutputTokens,
      groundingProtocolKey: row.groundingProtocolKey as typeof AI_TUTOR_GROUNDING_PROTOCOL_KEY,
      groundingProtocolRevision: row.groundingProtocolRevision as typeof AI_TUTOR_GROUNDING_PROTOCOL_REVISION,
      citationProtocolKey: row.citationProtocolKey as typeof AI_TUTOR_CITATION_PROTOCOL_KEY,
      citationProtocolRevision: row.citationProtocolRevision as typeof AI_TUTOR_CITATION_PROTOCOL_REVISION,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  }

  private runAtomic<T>(operation: () => T): T {
    if (this.database.client.inTransaction) return operation();
    return this.database.client.transaction(operation).immediate();
  }
}

export function toSafeAITutorConfigDTO(config: AITutorConfig): SafeAITutorConfigDTO {
  return structuredClone(config);
}
