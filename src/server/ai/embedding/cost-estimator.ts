import type { AIAdmissionCostEstimate } from "../admission";
import type { AIProviderConfig } from "../configuration";
import { AICostCalculator, type AIRateCardResolver } from "../economics";
import type { AIModelConfig } from "../model-registry";
import type { AIEmbeddingCostEstimator } from "./contracts";
import { AIEmbeddingError } from "./errors";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Conservative provider-neutral estimator: one input byte is reserved as at most one token. */
export class SQLiteAIEmbeddingCostEstimator implements AIEmbeddingCostEstimator {
  constructor(
    private readonly rateCards: AIRateCardResolver,
    private readonly calculator: AICostCalculator = new AICostCalculator(),
  ) {}

  estimate(input: {
    model: AIModelConfig;
    provider: AIProviderConfig;
    chunkCount: number;
    chunkBytes: number;
    batchSize: number;
    maxAttempts: number;
    at: number;
  }): AIAdmissionCostEstimate {
    if (!Number.isSafeInteger(input.chunkCount) || input.chunkCount < 0 || !Number.isSafeInteger(input.chunkBytes) || input.chunkBytes < 0 || !Number.isSafeInteger(input.batchSize) || input.batchSize < 1 || !Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1) {
      throw new AIEmbeddingError("AI_EMBEDDING_COST_INVALID", "The embedding cost estimate inputs are invalid.");
    }
    const batches = Math.ceil(input.chunkCount / input.batchSize);
    const inputTokens = safeProduct(input.chunkBytes, input.maxAttempts);
    const requestUnits = safeProduct(batches, input.maxAttempts);
    const rateCard = this.rateCards.resolve({
      modelConfigId: input.model.id,
      modelConfigRevision: input.model.revision,
      at: input.at,
    });
    if (rateCard.modelConfigId !== input.model.id || rateCard.modelConfigRevision !== input.model.revision || rateCard.currency.length !== 3) {
      throw new AIEmbeddingError("AI_EMBEDDING_COST_INVALID", "The resolved embedding Rate Card does not match the selected Model configuration.");
    }
    const calculation = this.calculator.calculate(rateCard, {
      standardInputTokens: inputTokens,
      cacheHitInputTokens: 0,
      cacheMissInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      requestUnits,
    });
    if (calculation.completeness !== "COMPLETE") {
      throw new AIEmbeddingError("AI_EMBEDDING_COST_INVALID", "The embedding Rate Card is incomplete for a conservative reservation.");
    }
    return {
      currency: calculation.currency,
      maxCostNano: calculation.knownCostNano,
      estimateBasis: `M7B_BYTE_UPPER_BOUND_PER_TOKEN;provider-revision-${input.provider.revision}`,
      modelConfigId: input.model.id,
      modelConfigRevision: input.model.revision,
      rateCardId: rateCard.rateCardId,
      rateCardRevision: rateCard.rateCardRevision,
    };
  }
}

export function createSQLiteAIEmbeddingCostEstimator(rateCards: AIRateCardResolver, calculator?: AICostCalculator): AIEmbeddingCostEstimator {
  return new SQLiteAIEmbeddingCostEstimator(rateCards, calculator);
}

function safeProduct(left: number, right: number): number {
  const value = BigInt(left) * BigInt(right);
  if (value > MAX_SAFE) throw new AIEmbeddingError("AI_EMBEDDING_COST_INVALID", "The embedding cost estimate exceeds the safe integer range.");
  return Number(value);
}
