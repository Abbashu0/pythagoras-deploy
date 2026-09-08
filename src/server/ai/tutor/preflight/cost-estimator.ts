import type { AIContextPlan } from "../../context";
import type { AIModelConfig } from "../../model-registry";
import type { AIProviderConfigRepository } from "../../configuration";
import { AI_RETRIEVAL_MAX_CHUNK_BYTES } from "../../retrieval";
import type { AIRetrievalConfigRevision } from "../../retrieval-config";
import type { AIRateCardResolver, AICostCalculator, AIBillableUsage, ResolvedAIRateCard } from "../../economics";
import type { AITutorCostEstimate, AITutorCostEstimateComponent } from "./contracts";

/** Fixed bound for the small structured reranker request envelope. */
export const AI_TUTOR_RERANK_PROTOCOL_OVERHEAD_BYTES = 256;
/** Fixed bound for labels/separators around the grounded Generation request. */
export const AI_TUTOR_GENERATION_PROTOCOL_OVERHEAD_BYTES = 1_024;

export interface AITutorCostEstimatorInput {
  currentMessageText: string;
  contextPlan: AIContextPlan;
  retrievalConfig: AIRetrievalConfigRevision;
  embeddingModel: AIModelConfig;
  rerankModel: AIModelConfig | null;
  generationModel: AIModelConfig;
  generationFallbackModels?: readonly AIModelConfig[];
  maxOutputTokens: number;
  at: number;
}

export interface AITutorCostEstimator {
  estimate(input: AITutorCostEstimatorInput): AITutorCostEstimate;
}

export const AI_TUTOR_COST_ESTIMATION_ERROR_CODES = [
  "AI_TUTOR_COST_RATE_CARD_UNAVAILABLE",
  "AI_TUTOR_COST_INCOMPLETE",
  "AI_TUTOR_COST_CURRENCY_MISMATCH",
  "AI_TUTOR_COST_INVALID",
] as const;
export type AITutorCostEstimationErrorCode = (typeof AI_TUTOR_COST_ESTIMATION_ERROR_CODES)[number];

export class AITutorCostEstimationError extends Error {
  constructor(readonly code: AITutorCostEstimationErrorCode, message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AITutorCostEstimationError";
  }
}

export class AIBoundedTutorCostEstimator implements AITutorCostEstimator {
  constructor(
    private readonly rateCards: AIRateCardResolver,
    private readonly providers: AIProviderConfigRepository,
    private readonly calculator: AICostCalculator,
  ) {}

  estimate(input: AITutorCostEstimatorInput): AITutorCostEstimate {
    const queryEmbeddingInput = byteLength(input.currentMessageText);
    const generationInput = generationInputUpperBound(input);
    const queryEmbedding = this.component(input.embeddingModel, "EMBEDDING", queryEmbeddingInput, input.at);
    const rerank = input.rerankModel
      ? this.component(
          input.rerankModel,
          "RERANK",
          rerankInputUpperBound(input),
          input.at,
        )
      : null;
    const generation = this.component(input.generationModel, "GENERATION", generationInput, input.at, input.maxOutputTokens);
    const generationFallbacks = (input.generationFallbackModels ?? []).map((model) => this.component(model, "GENERATION", generationInput, input.at, input.maxOutputTokens));
    const components = [queryEmbedding, ...(rerank ? [rerank] : []), generation, ...generationFallbacks];
    const currency = components[0]!.currency;
    if (components.some((component) => component.currency !== currency)) {
      throw new AITutorCostEstimationError("AI_TUTOR_COST_CURRENCY_MISMATCH", "Tutor cost components do not use one budget currency.");
    }
    const maxCostNano = components.reduce((total, component) => {
      const next = total + BigInt(component.costNano);
      if (next > BigInt(Number.MAX_SAFE_INTEGER)) throw new AITutorCostEstimationError("AI_TUTOR_COST_INVALID", "The Tutor cost estimate exceeds the safe integer range.");
      return next;
    }, BigInt(0));
    return {
      currency,
      maxCostNano: Number(maxCostNano),
      estimateBasis: "provider-neutral-max-v2: QUERY+rerank+ordered-Generation-attempts; reasoning=output-ceiling",
      queryEmbedding: toPublicComponent(queryEmbedding),
      rerank: rerank ? toPublicComponent(rerank) : null,
      generation: toPublicComponent(generation),
      ...(generationFallbacks.length ? { generationFallbacks: generationFallbacks.map(toPublicComponent) } : {}),
    };
  }

  private component(
    model: AIModelConfig,
    capability: "EMBEDDING" | "RERANK" | "GENERATION",
    inputTokenUpperBound: number,
    at: number,
    outputTokenUpperBound = 0,
  ): InternalCostComponent {
    const provider = this.providers.getById(model.providerConfigId);
    if (!provider) throw new AITutorCostEstimationError("AI_TUTOR_COST_INVALID", "The Tutor cost model Provider is missing.");
    let rateCard: ResolvedAIRateCard;
    try {
      rateCard = this.rateCards.resolve({ modelConfigId: model.id, modelConfigRevision: model.revision, at });
    } catch (error) {
      throw new AITutorCostEstimationError("AI_TUTOR_COST_RATE_CARD_UNAVAILABLE", "A complete Tutor Rate Card could not be resolved.", error);
    }
    const reasoningTokenUpperBound = capability === "GENERATION" && model.supportsReasoning ? outputTokenUpperBound : 0;
    const usageCandidates = inputUsageCandidates(inputTokenUpperBound, outputTokenUpperBound, reasoningTokenUpperBound);
    let selected: { usage: AIBillableUsage; costNano: number } | null = null;
    for (const usage of usageCandidates) {
      try {
        const calculation = this.calculator.calculate(rateCard, usage);
        if (calculation.completeness !== "COMPLETE") continue;
        if (!selected || calculation.knownCostNano > selected.costNano) selected = { usage, costNano: calculation.knownCostNano };
      } catch {
        // A card may define only one of standard/cache input modes; try the next safe mode.
      }
    }
    if (!selected) throw new AITutorCostEstimationError("AI_TUTOR_COST_INCOMPLETE", "The Tutor Rate Card cannot price the complete bounded request.");
    return {
      capability,
      modelConfigId: model.id,
      modelConfigRevision: model.revision,
      providerConfigId: provider.id,
      providerConfigRevision: provider.revision,
      providerModelId: model.providerModelId,
      adapterKey: model.adapterKey,
      rateCardId: rateCard.rateCardId,
      rateCardRevision: rateCard.rateCardRevision,
      currency: rateCard.currency,
      inputTokenUpperBound,
      outputTokenUpperBound,
      reasoningTokenUpperBound,
      requestUnits: selected.usage.requestUnits,
      costNano: selected.costNano,
    };
  }
}

interface InternalCostComponent extends AITutorCostEstimateComponent {
  currency: string;
}

function toPublicComponent(component: InternalCostComponent): AITutorCostEstimateComponent {
  const { currency: _currency, ...publicComponent } = component;
  return publicComponent;
}

function inputUsageCandidates(inputTokens: number, outputTokens: number, reasoningTokens: number): AIBillableUsage[] {
  const base = { cacheHitInputTokens: 0, cacheMissInputTokens: 0, outputTokens, reasoningTokens, requestUnits: 1 };
  return [
    { ...base, standardInputTokens: inputTokens },
    { ...base, standardInputTokens: 0, cacheHitInputTokens: inputTokens },
    { ...base, standardInputTokens: 0, cacheMissInputTokens: inputTokens },
  ];
}

function generationInputUpperBound(input: AITutorCostEstimatorInput): number {
  const contextTexts = [
    input.contextPlan.precedenceEnvelope,
    ...input.contextPlan.instructionLayers.map((layer) => layer.text),
    ...(input.contextPlan.summary ? [input.contextPlan.summary.text] : []),
    ...input.contextPlan.memories.map((memory) => memory.text),
    ...input.contextPlan.recentMessages.map((message) => message.content),
    input.contextPlan.currentMessage.content,
  ];
  return safeSum([
    ...contextTexts.map(byteLength),
    AI_TUTOR_GENERATION_PROTOCOL_OVERHEAD_BYTES,
    input.retrievalConfig.maximumEvidencePackBytes,
  ]);
}

function rerankInputUpperBound(input: AITutorCostEstimatorInput): number {
  return safeSum([
    byteLength(input.currentMessageText),
    safeProduct(input.retrievalConfig.rerankCandidateLimit, AI_RETRIEVAL_MAX_CHUNK_BYTES),
    AI_TUTOR_RERANK_PROTOCOL_OVERHEAD_BYTES,
  ]);
}

function byteLength(value: string): number {
  const result = Buffer.byteLength(value, "utf8");
  if (!Number.isSafeInteger(result)) throw new AITutorCostEstimationError("AI_TUTOR_COST_INVALID", "Tutor cost input size is invalid.");
  return result;
}

function safeProduct(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) throw new AITutorCostEstimationError("AI_TUTOR_COST_INVALID", "Tutor cost input size exceeds the safe range.");
  return result;
}

function safeSum(values: readonly number[]): number {
  const result = values.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(result)) throw new AITutorCostEstimationError("AI_TUTOR_COST_INVALID", "Tutor cost input size exceeds the safe range.");
  return result;
}
