import { v7 as uuidv7 } from "uuid";

import type { AIProviderAttemptTrace } from "../gateway";
import type {
  AIBillableUsage,
  AICostAccountingServiceDependencies,
  AICostCalculation,
  AICostCorrection,
  AICostCorrectionContent,
  AICostOperation,
  AICostOperationContent,
  AIProviderAccountingObservation,
  AIUsageCostRecord,
  ResolvedAIRateCard,
} from "./contracts";
import { AIAccountingError } from "./errors";
import { normalizeAICostCorrectionContent, normalizeAICostOperationContent } from "./validation";

export class AICostAccountingService {
  constructor(private readonly dependencies: AICostAccountingServiceDependencies) {}

  createOperation(content: AICostOperationContent, id = uuidv7()): AICostOperation {
    return this.dependencies.accounting.createOperation({
      id,
      content: normalizeAICostOperationContent(content),
    });
  }

  completeOperation(
    id: string,
    expectedStatus: AICostOperation["status"],
    status: Exclude<AICostOperation["status"], "OPEN">,
    completedAt: number,
  ): AICostOperation {
    return this.dependencies.accounting.updateOperationStatus({
      id,
      expectedStatus,
      status,
      completedAt,
    });
  }

  recordAttempt(observation: AIProviderAccountingObservation): {
    record: AIUsageCostRecord;
    rateCard: ResolvedAIRateCard;
    billableUsage: AIBillableUsage;
    calculation: AICostCalculation;
  } {
    const attempt = observation.attempt;
    if (
      attempt.modelConfigRevision === null ||
      attempt.providerConfigId === null ||
      attempt.providerConfigRevision === null ||
      !this.dependencies.accounting.getOperation(observation.operationId)
    ) {
      throw new AIAccountingError(
        "AI_ACCOUNTING_CONFLICT",
        "The Gateway attempt does not contain enough canonical accounting identity.",
      );
    }
    if (attempt.capability !== observation.capability) {
      throw new AIAccountingError(
        "AI_ACCOUNTING_CONFLICT",
        "The accounting capability does not match the Gateway attempt.",
      );
    }
    if (attempt.providerModelId !== null && attempt.providerModelId !== observation.providerModelId) {
      throw new AIAccountingError(
        "AI_ACCOUNTING_CONFLICT",
        "The accounting provider model does not match the Gateway attempt.",
      );
    }
    const at = observation.at ?? attempt.startedAt;
    const rateCard = this.dependencies.rateCardResolver.resolve({
      modelConfigId: attempt.modelConfigId,
      modelConfigRevision: attempt.modelConfigRevision,
      at,
    });
    if (
      rateCard.modelConfigId !== attempt.modelConfigId ||
      rateCard.modelConfigRevision !== attempt.modelConfigRevision
    ) {
      throw new AIAccountingError(
        "AI_ACCOUNTING_CONFLICT",
        "The resolved Rate Card target does not match the Gateway attempt.",
      );
    }
    const context = {
      modelConfigId: attempt.modelConfigId,
      modelConfigRevision: attempt.modelConfigRevision,
      providerConfigId: attempt.providerConfigId,
      providerConfigRevision: attempt.providerConfigRevision,
      capability: observation.capability,
      providerModelId: observation.providerModelId,
    };
    const billableUsage = this.dependencies.billingNormalizers.normalize(
      rateCard.billingUsageNormalizerKey,
      observation.normalizedUsage,
      context,
    );
    const calculation = this.dependencies.costCalculator.calculate(rateCard, billableUsage);
    const record = this.dependencies.accounting.appendUsageCostRecord({
      id: uuidv7(),
      createdAt: at,
      content: {
        operationId: observation.operationId,
        gatewayRequestId: attempt.gatewayRequestId,
        attemptIndex: attempt.attemptIndex,
        capability: observation.capability,
        modelConfigId: attempt.modelConfigId,
        modelConfigRevision: attempt.modelConfigRevision,
        providerConfigId: attempt.providerConfigId,
        providerConfigRevision: attempt.providerConfigRevision,
        providerRequestId: attempt.providerRequestId ?? null,
        rateCardId: rateCard.rateCardId,
        rateCardRevision: rateCard.rateCardRevision,
        rateCardRevisionId: rateCard.rateCardRevisionId,
        resolvedPricingRule: rateCard.pricingRuleId,
        normalizedInputTokens: observation.normalizedUsage.inputTokens,
        normalizedCacheHitInputTokens: observation.normalizedUsage.cacheHitInputTokens,
        normalizedCacheMissInputTokens: observation.normalizedUsage.cacheMissInputTokens,
        normalizedOutputTokens: observation.normalizedUsage.outputTokens,
        normalizedReasoningTokens: observation.normalizedUsage.reasoningTokens,
        billableStandardInputTokens: billableUsage.standardInputTokens,
        billableCacheHitInputTokens: billableUsage.cacheHitInputTokens,
        billableCacheMissInputTokens: billableUsage.cacheMissInputTokens,
        billableOutputTokens: billableUsage.outputTokens,
        billableReasoningTokens: billableUsage.reasoningTokens,
        requestUnits: billableUsage.requestUnits,
        currency: calculation.currency,
        knownCostNano: calculation.knownCostNano,
        costCompleteness: calculation.completeness,
        costBasis: calculation.costBasis,
        attemptStatus: attempt.status,
        startedAt: attempt.startedAt,
        completedAt: attempt.completedAt,
        latencyMs: observation.latencyMs ?? attempt.latencyMs,
      },
    });
    return { record, rateCard, billableUsage, calculation };
  }

  appendCorrection(content: AICostCorrectionContent, id = uuidv7()): AICostCorrection {
    return this.dependencies.accounting.appendCorrection({
      id,
      content: normalizeAICostCorrectionContent(content),
    });
  }
}
