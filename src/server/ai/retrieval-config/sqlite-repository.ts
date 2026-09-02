import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import {
  aiRetrievalConfigRevisions,
  aiRetrievalConfigs,
  type AIRetrievalConfigRevisionRow,
} from "../../content/schema";
import type {
  AIRetrievalConfig,
  AIRetrievalConfigContent,
  AIRetrievalConfigRepository,
  AIRetrievalConfigRevision,
} from "./contracts";
import { AIRetrievalConfigError } from "./errors";
import { normalizeAIRetrievalConfigContent } from "./validation";

export class SQLiteAIRetrievalConfigRepository implements AIRetrievalConfigRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIRetrievalConfig | null {
    const row = this.database.db.select().from(aiRetrievalConfigs).where(eq(aiRetrievalConfigs.id, id)).get();
    if (!row) return null;
    const revision = this.getRevision(id, row.currentRevision);
    if (!revision) throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_INVALID", "The current Retrieval Config revision is missing.");
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

  getByKey(key: string): AIRetrievalConfig | null {
    const row = this.database.db.select().from(aiRetrievalConfigs).where(eq(aiRetrievalConfigs.key, key)).get();
    return row ? this.getById(row.id) : null;
  }

  getCurrentRevision(id: string): AIRetrievalConfigRevision | null {
    const row = this.database.db.select({ currentRevision: aiRetrievalConfigs.currentRevision })
      .from(aiRetrievalConfigs).where(eq(aiRetrievalConfigs.id, id)).get();
    return row ? this.getRevision(id, row.currentRevision) : null;
  }

  getRevision(id: string, revision: number): AIRetrievalConfigRevision | null {
    const row = this.database.db.select().from(aiRetrievalConfigRevisions).where(and(
      eq(aiRetrievalConfigRevisions.retrievalConfigId, id),
      eq(aiRetrievalConfigRevisions.revision, revision),
    )).get();
    return row ? this.revisionFromRow(row) : null;
  }

  list(): AIRetrievalConfig[] {
    return this.database.db.select().from(aiRetrievalConfigs).orderBy(asc(aiRetrievalConfigs.key)).all()
      .map((row) => this.getById(row.id))
      .filter((config): config is AIRetrievalConfig => config !== null);
  }

  create(input: { id: string; content: AIRetrievalConfigContent; actor: AdminActor; now: number }): AIRetrievalConfigRevision {
    const content = normalizeAIRetrievalConfigContent(input.content);
    try {
      return this.runAtomic(() => {
        this.database.db.insert(aiRetrievalConfigs).values({
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
        if (!revision) throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_INVALID", "The new Retrieval Config revision could not be read.");
        return revision;
      });
    } catch (error) {
      if (error instanceof AIRetrievalConfigError) throw error;
      throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_CONFLICT", "The Retrieval Config could not be created.", {}, { cause: error });
    }
  }

  appendRevision(input: { id: string; expectedRevision: number; content: AIRetrievalConfigContent; actor: AdminActor; now: number }): AIRetrievalConfigRevision {
    const current = this.database.db.select({ currentRevision: aiRetrievalConfigs.currentRevision })
      .from(aiRetrievalConfigs).where(eq(aiRetrievalConfigs.id, input.id)).get();
    if (!current) throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_NOT_FOUND", "The Retrieval Config was not found.");
    if (current.currentRevision !== input.expectedRevision) throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_CONFLICT", "The Retrieval Config changed before publication.");
    const content = normalizeAIRetrievalConfigContent(input.content);
    const identity = this.getById(input.id);
    if (!identity || identity.key !== content.key || identity.subjectKey !== content.subjectKey) throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_CONFLICT", "Retrieval Config key and subject are immutable after creation.");
    const nextRevision = input.expectedRevision + 1;
    try {
      return this.runAtomic(() => {
        this.insertRevision(input.id, nextRevision, content, input.actor, input.now);
        const updated = this.database.db.update(aiRetrievalConfigs).set({
          currentRevision: nextRevision,
          updatedAt: input.now,
          updatedBy: input.actor.actorUserId,
        }).where(and(
          eq(aiRetrievalConfigs.id, input.id),
          eq(aiRetrievalConfigs.currentRevision, input.expectedRevision),
        )).returning({ currentRevision: aiRetrievalConfigs.currentRevision }).get();
        if (!updated) throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_CONFLICT", "The Retrieval Config changed before publication.");
        const revision = this.getRevision(input.id, nextRevision);
        if (!revision) throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_INVALID", "The new Retrieval Config revision could not be read.");
        return revision;
      });
    } catch (error) {
      if (error instanceof AIRetrievalConfigError) throw error;
      throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_CONFLICT", "The Retrieval Config revision could not be appended.", {}, { cause: error });
    }
  }

  private insertRevision(id: string, revision: number, content: AIRetrievalConfigContent, actor: AdminActor, now: number): void {
    this.database.db.insert(aiRetrievalConfigRevisions).values({
      id: uuidv7(),
      retrievalConfigId: id,
      revision,
      displayName: content.displayName,
      enabled: content.enabled,
      embeddingModelConfigId: content.embeddingModelConfigId,
      rerankModelConfigId: content.rerankModelConfigId,
      lexicalCandidateLimit: content.lexicalCandidateLimit,
      semanticCandidateLimit: content.semanticCandidateLimit,
      fusionCandidateLimit: content.fusionCandidateLimit,
      rerankCandidateLimit: content.rerankCandidateLimit,
      evidenceItemLimit: content.evidenceItemLimit,
      rrfConstant: content.rrfConstant,
      lexicalWeightUnits: content.lexicalWeightUnits,
      semanticWeightUnits: content.semanticWeightUnits,
      minimumFusedScoreUnits: content.minimumFusedScoreUnits,
      minimumEvidenceItemCount: content.minimumEvidenceItemCount,
      maximumEvidencePackBytes: content.maximumEvidencePackBytes,
      maxEvidenceChunksPerSourceItem: content.maxEvidenceChunksPerSourceItem,
      allowedTrustTiers: content.allowedTrustTiers,
      semanticFailureBehavior: content.semanticFailureBehavior,
      rerankerFailureBehavior: content.rerankerFailureBehavior,
      createdAt: now,
      createdBy: actor.actorUserId,
    }).run();
  }

  private revisionFromRow(row: AIRetrievalConfigRevisionRow): AIRetrievalConfigRevision {
    const config = this.database.db.select({ key: aiRetrievalConfigs.key, subjectKey: aiRetrievalConfigs.subjectKey })
      .from(aiRetrievalConfigs).where(eq(aiRetrievalConfigs.id, row.retrievalConfigId)).get();
    if (!config) throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_INVALID", "The Retrieval Config identity is missing.");
    return {
      retrievalConfigId: row.retrievalConfigId,
      revisionId: row.id,
      revision: row.revision,
      key: config.key,
      subjectKey: config.subjectKey,
      displayName: row.displayName,
      enabled: row.enabled,
      embeddingModelConfigId: row.embeddingModelConfigId,
      rerankModelConfigId: row.rerankModelConfigId,
      lexicalCandidateLimit: row.lexicalCandidateLimit,
      semanticCandidateLimit: row.semanticCandidateLimit,
      fusionCandidateLimit: row.fusionCandidateLimit,
      rerankCandidateLimit: row.rerankCandidateLimit,
      evidenceItemLimit: row.evidenceItemLimit,
      rrfConstant: row.rrfConstant,
      lexicalWeightUnits: row.lexicalWeightUnits,
      semanticWeightUnits: row.semanticWeightUnits,
      minimumFusedScoreUnits: row.minimumFusedScoreUnits,
      minimumEvidenceItemCount: row.minimumEvidenceItemCount,
      maximumEvidencePackBytes: row.maximumEvidencePackBytes,
      maxEvidenceChunksPerSourceItem: row.maxEvidenceChunksPerSourceItem,
      allowedTrustTiers: [...row.allowedTrustTiers],
      semanticFailureBehavior: row.semanticFailureBehavior,
      rerankerFailureBehavior: row.rerankerFailureBehavior,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  }

  private runAtomic<T>(operation: () => T): T {
    if (this.database.client.inTransaction) return operation();
    return this.database.client.transaction(operation).immediate();
  }
}

export function toSafeAIRetrievalConfigDTO(config: AIRetrievalConfig): AIRetrievalConfig {
  return structuredClone(config);
}
