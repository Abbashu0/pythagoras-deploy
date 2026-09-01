import { and, desc, eq } from "drizzle-orm";

import { AI_MODEL_CONFIG_RESOURCE_TYPE, normalizeAIModelConfigContent } from "../model-registry";
import type { AIModelConfigContent } from "../model-registry";
import type { ContentDatabase } from "../../content/database";
import { publicationItems } from "../../content/schema";
import { SQLiteAIModelConfigRepository } from "../model-registry";
import type { AIRateCardModelRevisionRepository } from "./contracts";

/** Resolves exact published Model revisions without inventing history. */
export class SQLiteAIRateCardModelRevisionRepository
  implements AIRateCardModelRevisionRepository
{
  constructor(private readonly database: ContentDatabase) {}

  get(modelConfigId: string, revision: number): AIModelConfigContent | null {
    const current = new SQLiteAIModelConfigRepository(this.database).getById(modelConfigId);
    if (current?.revision === revision) return modelContent(current);

    const row = this.database.db
      .select({ afterSnapshot: publicationItems.afterSnapshot })
      .from(publicationItems)
      .where(
        and(
          eq(publicationItems.resourceType, AI_MODEL_CONFIG_RESOURCE_TYPE),
          eq(publicationItems.resourceId, modelConfigId),
          eq(publicationItems.resultingResourceRevision, revision),
        ),
      )
      .orderBy(desc(publicationItems.id))
      .get();
    if (!row) return null;
    try {
      return normalizeAIModelConfigContent(row.afterSnapshot);
    } catch {
      return null;
    }
  }
}

function modelContent(value: AIModelConfigContent & { id?: string }): AIModelConfigContent {
  return {
    key: value.key,
    displayName: value.displayName,
    providerConfigId: value.providerConfigId,
    providerModelId: value.providerModelId,
    capability: value.capability,
    adapterKey: value.adapterKey,
    enabled: value.enabled,
    contextWindowTokens: value.contextWindowTokens,
    maxOutputTokens: value.maxOutputTokens,
    embeddingDimensions: value.embeddingDimensions,
    supportsStreaming: value.supportsStreaming,
    supportsReasoning: value.supportsReasoning,
    supportsStructuredOutput: value.supportsStructuredOutput,
  };
}
