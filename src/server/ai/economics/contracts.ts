import type { AdminActor } from "../../admin-auth/contracts";
import type {
  AIModelCapability,
  AIModelConfigContent,
} from "../model-registry";
import type {
  AIProviderAttemptStatus,
  AIProviderAttemptTrace,
  NormalizedProviderUsage,
} from "../gateway";

export const AI_RATE_CARD_RESOURCE_TYPE = "ai.rate-card" as const;

export const AI_COST_CENTERS = [
  "STUDENT_GENERATION",
  "KNOWLEDGE_INDEXING",
  "AGENT_2",
  "EVALS",
  "EXPERIMENTS",
] as const;
export type AICostCenter = (typeof AI_COST_CENTERS)[number];

export const AI_RATE_CARD_PRICE_COMPONENTS = [
  "STANDARD_INPUT",
  "CACHE_HIT_INPUT",
  "CACHE_MISS_INPUT",
  "OUTPUT",
  "REASONING",
  "REQUEST",
] as const;
export type AIRateCardPriceComponent =
  (typeof AI_RATE_CARD_PRICE_COMPONENTS)[number];

export const AI_RATE_CARD_PRICE_UNITS = [
  "PER_MILLION_TOKENS",
  "PER_REQUEST",
] as const;
export type AIRateCardPriceUnit = (typeof AI_RATE_CARD_PRICE_UNITS)[number];

export const AI_COST_COMPLETENESS = ["COMPLETE", "PARTIAL"] as const;
export type AICostCompleteness = (typeof AI_COST_COMPLETENESS)[number];

export const AI_COST_BASES = ["RATE_CARD", "PROVIDER_REPORTED"] as const;
export type AICostBasis = (typeof AI_COST_BASES)[number];

export const AI_COST_OPERATION_STATUSES = [
  "OPEN",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type AICostOperationStatus =
  (typeof AI_COST_OPERATION_STATUSES)[number];

export const AI_ACCOUNTING_ACTOR_TYPES = ["ADMIN", "SYSTEM"] as const;
export type AIAccountingActorType =
  (typeof AI_ACCOUNTING_ACTOR_TYPES)[number];

export interface AIRateCardPriceLineContent {
  component: AIRateCardPriceComponent;
  unit: AIRateCardPriceUnit;
  /** Fixed-point nano-currency amount; never a floating-point dollar value. */
  amountNano: number;
}

export interface AITimeBandContent {
  timeZone: string;
  /** Monday is bit 0; Sunday is bit 6. */
  daysOfWeekMask: number;
  startMinute: number;
  endMinute: number;
  priceLines: readonly AIRateCardPriceLineContent[];
}

export interface AIRateCardContent {
  key: string;
  displayName: string;
  modelConfigId: string;
  modelConfigRevision: number;
  currency: string;
  billingUsageNormalizerKey: string;
  effectiveFrom: number;
  effectiveTo: number | null;
  enabled: boolean;
  priceLines: readonly AIRateCardPriceLineContent[];
  timeBands: readonly AITimeBandContent[];
}

export interface AIRateCard extends AIRateCardContent {
  id: string;
  currentRevision: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

export interface AIRateCardStoredTimeBand extends AITimeBandContent {
  id: string;
}

export interface AIRateCardRevision extends AIRateCardContent {
  rateCardId: string;
  revision: number;
  revisionId: string;
  createdAt: number;
  createdBy: string;
  timeBands: readonly AIRateCardStoredTimeBand[];
}

export interface AIRateCardRepository {
  getById(id: string): AIRateCard | null;
  getCurrentRevision(id: string): AIRateCardRevision | null;
  getRevision(id: string, revision: number): AIRateCardRevision | null;
  listRevisions(): AIRateCardRevision[];
  listResolutionRevisions(input: {
    modelConfigId: string;
    modelConfigRevision: number;
    at: number;
  }): AIRateCardRevision[];
  create(input: {
    id: string;
    content: AIRateCardContent;
    actor: AdminActor;
    now: number;
  }): AIRateCardRevision;
  appendRevision(input: {
    id: string;
    expectedRevision: number;
    content: AIRateCardContent;
    actor: AdminActor;
    now: number;
  }): AIRateCardRevision;
}

export interface AIRateCardModelRevisionRepository {
  get(modelConfigId: string, revision: number): AIModelConfigContent | null;
}

export interface ResolvedAIRateCard {
  rateCardId: string;
  rateCardRevision: number;
  rateCardRevisionId: string;
  modelConfigId: string;
  modelConfigRevision: number;
  currency: string;
  billingUsageNormalizerKey: string;
  effectiveFrom: number;
  effectiveTo: number | null;
  pricingRuleId: string;
  pricingRuleKind: "DEFAULT" | "TIME_BAND";
  timeZone: string | null;
  priceLines: readonly AIRateCardPriceLineContent[];
}

export interface AIBillableUsage {
  standardInputTokens: number | null;
  cacheHitInputTokens: number | null;
  cacheMissInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  /** Known request count; zero is a valid known value. */
  requestUnits: number;
}

export interface AIBillingUsageNormalizationContext {
  modelConfigId: string;
  modelConfigRevision: number;
  providerConfigId: string;
  providerConfigRevision: number;
  capability: AIModelCapability;
  providerModelId: string;
}

export interface AIBillingUsageNormalizer {
  readonly key: string;
  normalize(
    usage: NormalizedProviderUsage,
    context: AIBillingUsageNormalizationContext,
  ): AIBillableUsage;
}

export interface AICostBreakdownItem {
  component: AIRateCardPriceComponent;
  quantity: number;
  unit: AIRateCardPriceUnit;
  rateAmountNano: number;
  costNano: number;
}

export interface AICostCalculation {
  currency: string;
  knownCostNano: number;
  completeness: AICostCompleteness;
  missingComponents: readonly AIRateCardPriceComponent[];
  breakdown: readonly AICostBreakdownItem[];
  costBasis: "RATE_CARD";
}

export interface AICostOperationContent {
  costCenter: AICostCenter;
  idempotencyKey: string | null;
  opaquePrincipalRef: string | null;
  subjectKey: string | null;
  conversationId: string | null;
  responseId: string | null;
  jobId: string | null;
  evalRunId: string | null;
  knowledgeRevision: number | null;
  status: AICostOperationStatus;
  startedAt: number;
  completedAt: number | null;
}

export interface AICostOperation extends AICostOperationContent {
  id: string;
}

export interface AIUsageCostRecordContent {
  operationId: string;
  gatewayRequestId: string | null;
  attemptIndex: number | null;
  capability: AIModelCapability;
  modelConfigId: string;
  modelConfigRevision: number;
  providerConfigId: string;
  providerConfigRevision: number;
  providerRequestId: string | null;
  rateCardId: string;
  rateCardRevision: number;
  rateCardRevisionId: string;
  resolvedPricingRule: string;
  normalizedInputTokens: number | null;
  normalizedCacheHitInputTokens: number | null;
  normalizedCacheMissInputTokens: number | null;
  normalizedOutputTokens: number | null;
  normalizedReasoningTokens: number | null;
  billableStandardInputTokens: number | null;
  billableCacheHitInputTokens: number | null;
  billableCacheMissInputTokens: number | null;
  billableOutputTokens: number | null;
  billableReasoningTokens: number | null;
  requestUnits: number;
  currency: string;
  knownCostNano: number;
  costCompleteness: AICostCompleteness;
  costBasis: AICostBasis;
  attemptStatus: AIProviderAttemptStatus;
  startedAt: number;
  completedAt: number | null;
  latencyMs: number | null;
}

export interface AIUsageCostRecord extends AIUsageCostRecordContent {
  id: string;
  createdAt: number;
}

export interface AICostCorrectionContent {
  originalRecordId: string;
  currency: string;
  deltaCostNano: number;
  reasonCode: string;
  actorType: AIAccountingActorType;
  actorUserId: string | null;
  createdAt: number;
}

export interface AICostCorrection extends AICostCorrectionContent {
  id: string;
}

export interface AIOperationCurrencyTotal {
  currency: string;
  totalNano: number;
}

export interface AIOperationCostSummary {
  operationId: string;
  totals: readonly AIOperationCurrencyTotal[];
}

export interface AIAccountingRepository {
  createOperation(input: {
    id: string;
    content: AICostOperationContent;
  }): AICostOperation;
  getOperation(id: string): AICostOperation | null;
  updateOperationStatus(input: {
    id: string;
    expectedStatus: AICostOperationStatus;
    status: AICostOperationStatus;
    completedAt: number | null;
  }): AICostOperation;
  appendUsageCostRecord(input: {
    id: string;
    content: AIUsageCostRecordContent;
    createdAt: number;
  }): AIUsageCostRecord;
  getUsageCostRecord(id: string): AIUsageCostRecord | null;
  listUsageCostRecords(operationId: string): AIUsageCostRecord[];
  appendCorrection(input: {
    id: string;
    content: AICostCorrectionContent;
  }): AICostCorrection;
  listCorrections(originalRecordId: string): AICostCorrection[];
  getOperationCostSummary(operationId: string): AIOperationCostSummary;
  listTotalsByPeriod(input: {
    from: number;
    to: number;
    dimension: "costCenter" | "model" | "provider" | "subject";
  }): Array<{
    dimensionValue: string | null;
    currency: string;
    totalNano: number;
  }>;
}

export interface AICostAccountingServiceDependencies {
  rateCardResolver: {
    resolve(input: {
      modelConfigId: string;
      modelConfigRevision: number;
      at: number;
    }): ResolvedAIRateCard;
  };
  billingNormalizers: {
    normalize(
      key: string,
      usage: NormalizedProviderUsage,
      context: AIBillingUsageNormalizationContext,
    ): AIBillableUsage;
  };
  costCalculator: {
    calculate(rateCard: ResolvedAIRateCard, usage: AIBillableUsage): AICostCalculation;
  };
  accounting: AIAccountingRepository;
}

export interface AIProviderAccountingObservation {
  operationId: string;
  attempt: AIProviderAttemptTrace;
  normalizedUsage: NormalizedProviderUsage;
  capability: AIModelCapability;
  providerModelId: string;
  at?: number;
  latencyMs?: number | null;
}

/** Backward-compatible descriptive alias; the observation path supports all M2 capabilities. */
export type AIGenerationAccountingObservation = AIProviderAccountingObservation;

export interface AIGenerationUsageSnapshot {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheHitInputTokens: number | null;
  cacheMissInputTokens: number | null;
}
