import { and, asc, eq, sql } from "drizzle-orm";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import { aiModelConfigs, type AIModelConfigRow } from "../../content/schema";
import type {
  AIModelConfig,
  AIModelConfigContent,
  AIModelConfigRepository,
  SafeAIModelConfigDTO,
} from "./contracts";
import { AIModelConfigError } from "./errors";

export class SQLiteAIModelConfigRepository implements AIModelConfigRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIModelConfig | null {
    const row = this.database.db
      .select()
      .from(aiModelConfigs)
      .where(eq(aiModelConfigs.id, id))
      .get();
    return row ? modelConfigFromRow(row) : null;
  }

  getByKey(key: string): AIModelConfig | null {
    const row = this.database.db
      .select()
      .from(aiModelConfigs)
      .where(eq(aiModelConfigs.key, key))
      .get();
    return row ? modelConfigFromRow(row) : null;
  }

  list(): AIModelConfig[] {
    return this.database.db
      .select()
      .from(aiModelConfigs)
      .orderBy(asc(aiModelConfigs.key))
      .all()
      .map(modelConfigFromRow);
  }

  create(input: {
    id: string;
    content: AIModelConfigContent;
    actor: AdminActor;
    now: number;
  }): AIModelConfig {
    try {
      const row = this.database.db
        .insert(aiModelConfigs)
        .values({
          id: input.id,
          key: input.content.key,
          displayName: input.content.displayName,
          providerConfigId: input.content.providerConfigId,
          providerModelId: input.content.providerModelId,
          capability: input.content.capability,
          adapterKey: input.content.adapterKey,
          enabled: input.content.enabled,
          contextWindowTokens: input.content.contextWindowTokens,
          maxOutputTokens: input.content.maxOutputTokens,
          embeddingDimensions: input.content.embeddingDimensions,
          supportsStreaming: input.content.supportsStreaming,
          supportsReasoning: input.content.supportsReasoning,
          supportsStructuredOutput: input.content.supportsStructuredOutput,
          inputModalities: input.content.inputModalities ?? ["TEXT"],
          outputModalities: input.content.outputModalities ?? ["TEXT"],
          createdAt: input.now,
          updatedAt: input.now,
          createdBy: input.actor.actorUserId,
          updatedBy: input.actor.actorUserId,
          revision: 1,
        })
        .returning()
        .get();
      return modelConfigFromRow(row);
    } catch (error) {
      throw new AIModelConfigError(
        "AI_MODEL_CONFIG_CONFLICT",
        "The AI Model configuration could not be created.",
        error,
      );
    }
  }

  update(input: {
    id: string;
    content: AIModelConfigContent;
    expectedRevision: number;
    actor: AdminActor;
    now: number;
  }): AIModelConfig {
    const row = this.database.db
      .update(aiModelConfigs)
      .set({
        key: input.content.key,
        displayName: input.content.displayName,
        providerConfigId: input.content.providerConfigId,
        providerModelId: input.content.providerModelId,
        capability: input.content.capability,
        adapterKey: input.content.adapterKey,
        enabled: input.content.enabled,
        contextWindowTokens: input.content.contextWindowTokens,
        maxOutputTokens: input.content.maxOutputTokens,
        embeddingDimensions: input.content.embeddingDimensions,
        supportsStreaming: input.content.supportsStreaming,
        supportsReasoning: input.content.supportsReasoning,
        supportsStructuredOutput: input.content.supportsStructuredOutput,
        inputModalities: input.content.inputModalities ?? ["TEXT"],
        outputModalities: input.content.outputModalities ?? ["TEXT"],
        updatedAt: input.now,
        updatedBy: input.actor.actorUserId,
        revision: sql`${aiModelConfigs.revision} + 1`,
      })
      .where(
        and(
          eq(aiModelConfigs.id, input.id),
          eq(aiModelConfigs.revision, input.expectedRevision),
        ),
      )
      .returning()
      .get();
    if (!row || row.revision !== input.expectedRevision + 1) {
      throw new AIModelConfigError(
        "AI_MODEL_CONFIG_CONFLICT",
        "The AI Model configuration changed before publication.",
      );
    }
    return modelConfigFromRow(row);
  }

  remove(input: { id: string; expectedRevision: number }): AIModelConfig {
    try {
      const row = this.database.db
        .delete(aiModelConfigs)
        .where(
          and(
            eq(aiModelConfigs.id, input.id),
            eq(aiModelConfigs.revision, input.expectedRevision),
          ),
        )
        .returning()
        .get();
      if (!row) {
        throw new AIModelConfigError(
          "AI_MODEL_CONFIG_CONFLICT",
          "The AI Model configuration changed before removal completed.",
        );
      }
      return modelConfigFromRow(row);
    } catch (error) {
      if (error instanceof AIModelConfigError) throw error;
      throw new AIModelConfigError(
        "AI_MODEL_CONFIG_CONFLICT",
        "The AI Model configuration cannot be removed while it is referenced by another AI record.",
        error,
      );
    }
  }
}

export function toSafeAIModelConfigDTO(config: AIModelConfig): SafeAIModelConfigDTO {
  return { ...config };
}

function modelConfigFromRow(row: AIModelConfigRow): AIModelConfig {
  return {
    id: row.id,
    key: row.key,
    displayName: row.displayName,
    providerConfigId: row.providerConfigId,
    providerModelId: row.providerModelId,
    capability: row.capability,
    adapterKey: row.adapterKey,
    enabled: row.enabled,
    contextWindowTokens: row.contextWindowTokens,
    maxOutputTokens: row.maxOutputTokens,
    embeddingDimensions: row.embeddingDimensions,
    supportsStreaming: row.supportsStreaming,
    supportsReasoning: row.supportsReasoning,
    supportsStructuredOutput: row.supportsStructuredOutput,
    inputModalities: Array.isArray(row.inputModalities) ? row.inputModalities : ["TEXT"],
    outputModalities: Array.isArray(row.outputModalities) ? row.outputModalities : ["TEXT"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    revision: row.revision,
  };
}
