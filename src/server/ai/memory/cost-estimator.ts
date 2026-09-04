import type { AIProviderConfigRepository } from "../configuration";
import type { AIModelConfig } from "../model-registry";
import type { AIBillableUsage, AICostCalculator, AIRateCardResolver, ResolvedAIRateCard } from "../economics";
import type { AIMemoryGenerationCostEstimate, AIMemoryGenerationCostEstimateComponent } from "./execution-contracts";
import { AIMemoryExecutionError } from "./execution-errors";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export interface AIMemoryGenerationCostEstimator {
  estimate(input: { model: AIModelConfig; providerConfigId: string; providerConfigRevision: number; inputTokenUpperBound: number; maxOutputTokens: number; at: number }): AIMemoryGenerationCostEstimate;
}

export class AIBoundedMemoryGenerationCostEstimator implements AIMemoryGenerationCostEstimator {
  constructor(
    private readonly rateCards: AIRateCardResolver,
    private readonly providers: AIProviderConfigRepository,
    private readonly calculator: AICostCalculator,
  ) {}

  estimate(input: { model: AIModelConfig; providerConfigId: string; providerConfigRevision: number; inputTokenUpperBound: number; maxOutputTokens: number; at: number }): AIMemoryGenerationCostEstimate {
    if (!Number.isSafeInteger(input.inputTokenUpperBound) || input.inputTokenUpperBound < 0 || !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_RESULT_INVALID", "The Memory cost estimate bounds are invalid.");
    const provider = this.providers.getById(input.model.providerConfigId);
    if (!provider || provider.id !== input.providerConfigId || provider.revision !== input.providerConfigRevision) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_CONFIG_DEPENDENCY_INVALID", "The pinned Memory Generation Provider is unavailable.");
    let rateCard: ResolvedAIRateCard;
    try {
      rateCard = this.rateCards.resolve({ modelConfigId: input.model.id, modelConfigRevision: input.model.revision, at: input.at });
    } catch (error) {
      throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_CONFIG_DEPENDENCY_INVALID", "A complete Memory Generation Rate Card could not be resolved.", {}, error);
    }
    const reasoning = input.model.supportsReasoning ? input.maxOutputTokens : 0;
    const usageCandidates: AIBillableUsage[] = [
      { standardInputTokens: input.inputTokenUpperBound, cacheHitInputTokens: 0, cacheMissInputTokens: 0, outputTokens: input.maxOutputTokens, reasoningTokens: reasoning, requestUnits: 1 },
      { standardInputTokens: 0, cacheHitInputTokens: input.inputTokenUpperBound, cacheMissInputTokens: 0, outputTokens: input.maxOutputTokens, reasoningTokens: reasoning, requestUnits: 1 },
      { standardInputTokens: 0, cacheHitInputTokens: 0, cacheMissInputTokens: input.inputTokenUpperBound, outputTokens: input.maxOutputTokens, reasoningTokens: reasoning, requestUnits: 1 },
    ];
    let selected: { usage: AIBillableUsage; costNano: number } | null = null;
    for (const usage of usageCandidates) {
      try {
        const calculation = this.calculator.calculate(rateCard, usage);
        if (calculation.completeness === "COMPLETE" && (!selected || calculation.knownCostNano > selected.costNano)) selected = { usage, costNano: calculation.knownCostNano };
      } catch {
        // A Rate Card may support only one input pricing mode; the candidates are bounded.
      }
    }
    if (!selected) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_CONFIG_DEPENDENCY_INVALID", "The Memory Generation Rate Card cannot price the complete bounded request.");
    const component: AIMemoryGenerationCostEstimateComponent = {
      capability: "GENERATION",
      modelConfigId: input.model.id,
      modelConfigRevision: input.model.revision,
      providerConfigId: provider.id,
      providerConfigRevision: provider.revision,
      providerModelId: input.model.providerModelId,
      rateCardId: rateCard.rateCardId,
      rateCardRevision: rateCard.rateCardRevision,
      inputTokenUpperBound: input.inputTokenUpperBound,
      outputTokenUpperBound: input.maxOutputTokens,
      reasoningTokenUpperBound: reasoning,
      requestUnits: selected.usage.requestUnits,
      costNano: selected.costNano,
    };
    if (!Number.isSafeInteger(component.costNano) || BigInt(component.costNano) > MAX_SAFE) throw new AIMemoryExecutionError("AI_MEMORY_EXECUTION_RESULT_INVALID", "The Memory cost estimate exceeds the safe range.");
    return Object.freeze({
      currency: rateCard.currency,
      maxCostNano: component.costNano,
      estimateBasis: "provider-neutral-memory-generation-max-v1: bounded-source+output; reasoning=output-ceiling",
      generation: Object.freeze(component),
    });
  }
}
