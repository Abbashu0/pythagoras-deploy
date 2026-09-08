import { and, asc, eq, sql } from "drizzle-orm";

import type { AdminActor } from "../../admin-auth/contracts";
import type { ContentDatabase } from "../../content/database";
import { aiProviderConfigs, type AIProviderConfigRow } from "../../content/schema";
import type {
  AIProviderConfig,
  AIProviderConfigContent,
  AIProviderConfigRepository,
  AIProviderCredentialStatus,
  SafeAIProviderConfigDTO,
} from "./contracts";
import { AIProviderConfigError } from "./errors";

export class SQLiteAIProviderConfigRepository
  implements AIProviderConfigRepository
{
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIProviderConfig | null {
    const row = this.database.db
      .select()
      .from(aiProviderConfigs)
      .where(eq(aiProviderConfigs.id, id))
      .get();
    return row ? providerConfigFromRow(row) : null;
  }

  getByKey(key: string): AIProviderConfig | null {
    const row = this.database.db
      .select()
      .from(aiProviderConfigs)
      .where(eq(aiProviderConfigs.key, key))
      .get();
    return row ? providerConfigFromRow(row) : null;
  }

  list(): AIProviderConfig[] {
    return this.database.db
      .select()
      .from(aiProviderConfigs)
      .orderBy(asc(aiProviderConfigs.key))
      .all()
      .map(providerConfigFromRow);
  }

  create(input: {
    id: string;
    content: AIProviderConfigContent;
    actor: AdminActor;
    now: number;
  }): AIProviderConfig {
    try {
      const row = this.database.db
        .insert(aiProviderConfigs)
        .values({
          id: input.id,
          key: input.content.key,
          displayName: input.content.displayName,
          baseUrl: input.content.baseUrl,
          credentialRef: input.content.credentialRef,
          enabled: input.content.enabled,
          retentionPolicy: input.content.retentionPolicy,
          trainingPolicy: input.content.trainingPolicy,
          zdrSupported: input.content.zdrSupported,
          zdrRequired: input.content.zdrRequired,
          createdAt: input.now,
          updatedAt: input.now,
          createdBy: input.actor.actorUserId,
          updatedBy: input.actor.actorUserId,
          revision: 1,
        })
        .returning()
        .get();
      return providerConfigFromRow(row);
    } catch (error) {
      throw new AIProviderConfigError(
        "AI_PROVIDER_CONFIG_CONFLICT",
        "The AI Provider configuration could not be created.",
        error,
      );
    }
  }

  update(input: {
    id: string;
    content: AIProviderConfigContent;
    expectedRevision: number;
    actor: AdminActor;
    now: number;
  }): AIProviderConfig {
    const row = this.database.db
      .update(aiProviderConfigs)
      .set({
        key: input.content.key,
        displayName: input.content.displayName,
        baseUrl: input.content.baseUrl,
        credentialRef: input.content.credentialRef,
        enabled: input.content.enabled,
        retentionPolicy: input.content.retentionPolicy,
        trainingPolicy: input.content.trainingPolicy,
        zdrSupported: input.content.zdrSupported,
        zdrRequired: input.content.zdrRequired,
        updatedAt: input.now,
        updatedBy: input.actor.actorUserId,
        revision: sql`${aiProviderConfigs.revision} + 1`,
      })
      .where(
        and(
          eq(aiProviderConfigs.id, input.id),
          eq(aiProviderConfigs.revision, input.expectedRevision),
        ),
      )
      .returning()
      .get();
    if (!row) {
      throw new AIProviderConfigError(
        "AI_PROVIDER_CONFIG_CONFLICT",
        "The AI Provider configuration changed before publication.",
      );
    }
    if (row.revision !== input.expectedRevision + 1) {
      throw new AIProviderConfigError(
        "AI_PROVIDER_CONFIG_CONFLICT",
        "The AI Provider configuration changed before publication.",
      );
    }
    return providerConfigFromRow(row);
  }

  remove(input: { id: string; expectedRevision: number }): AIProviderConfig {
    try {
      const row = this.database.db
        .delete(aiProviderConfigs)
        .where(
          and(
            eq(aiProviderConfigs.id, input.id),
            eq(aiProviderConfigs.revision, input.expectedRevision),
          ),
        )
        .returning()
        .get();
      if (!row) {
        throw new AIProviderConfigError(
          "AI_PROVIDER_CONFIG_CONFLICT",
          "The AI Provider configuration changed before removal completed.",
        );
      }
      return providerConfigFromRow(row);
    } catch (error) {
      if (error instanceof AIProviderConfigError) throw error;
      throw new AIProviderConfigError(
        "AI_PROVIDER_CONFIG_CONFLICT",
        "The AI Provider configuration cannot be removed while it is referenced by another AI record.",
        error,
      );
    }
  }
}

export function toSafeAIProviderConfigDTO(
  config: AIProviderConfig,
  credentialStatus?: AIProviderCredentialStatus,
): SafeAIProviderConfigDTO {
  const status = config.credentialRef
    ? credentialStatus ?? "MISSING"
    : "NOT_CONFIGURED";
  return {
    id: config.id,
    key: config.key,
    displayName: config.displayName,
    baseUrl: config.baseUrl,
    enabled: config.enabled,
    credentialConfigured: status === "ACTIVE",
    credentialStatus: status,
    retentionPolicy: config.retentionPolicy,
    trainingPolicy: config.trainingPolicy,
    zdrSupported: config.zdrSupported,
    zdrRequired: config.zdrRequired,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    revision: config.revision,
  };
}

function providerConfigFromRow(row: AIProviderConfigRow): AIProviderConfig {
  return {
    id: row.id,
    key: row.key,
    displayName: row.displayName,
    baseUrl: row.baseUrl,
    credentialRef: row.credentialRef,
    enabled: row.enabled,
    retentionPolicy: row.retentionPolicy,
    trainingPolicy: row.trainingPolicy,
    zdrSupported: row.zdrSupported,
    zdrRequired: row.zdrRequired,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    revision: row.revision,
  };
}
