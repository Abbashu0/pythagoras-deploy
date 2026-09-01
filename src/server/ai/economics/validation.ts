import {
  AI_COST_CENTERS,
  AI_COST_BASES,
  AI_COST_COMPLETENESS,
  AI_COST_OPERATION_STATUSES,
  AI_RATE_CARD_PRICE_COMPONENTS,
  AI_RATE_CARD_PRICE_UNITS,
  type AIBillableUsage,
  type AICostCorrectionContent,
  type AICostOperationContent,
  type AIUsageCostRecordContent,
  type AIRateCardContent,
  type AIRateCardRevision,
  type AIRateCardPriceComponent,
  type AIRateCardPriceLineContent,
  type AIRateCardPriceUnit,
  type AITimeBandContent,
} from "./contracts";
import { AIAccountingError } from "./errors";
import { AI_MODEL_CAPABILITIES } from "../model-registry";
import { AI_PROVIDER_ATTEMPT_STATUSES } from "../gateway";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const REASON_PATTERN = /^[A-Z0-9_.-]+$/u;
const MAX_SAFE_NANO = Number.MAX_SAFE_INTEGER;
const MAX_RUNTIME_TIMESTAMP = 8_640_000_000_000_000;
const MAX_RATE_LINES = 6;
const MAX_TIME_BANDS = 32;

const PRICE_COMPONENT_ORDER = new Map<AIRateCardPriceComponent, number>(
  AI_RATE_CARD_PRICE_COMPONENTS.map((component, index) => [component, index]),
);

export function normalizeAIRateCardContent(value: unknown): AIRateCardContent {
  if (!isPlainObject(value)) invalidRate("Rate Card must be an object.");
  requireExactKeys(value, [
    "key",
    "displayName",
    "modelConfigId",
    "modelConfigRevision",
    "currency",
    "billingUsageNormalizerKey",
    "effectiveFrom",
    "effectiveTo",
    "enabled",
    "priceLines",
    "timeBands",
  ], invalidRate);

  const key = rateText(value.key, "key", 1, 120).toLowerCase();
  if (!KEY_PATTERN.test(key)) invalidRate("Rate Card key is invalid.");
  const displayName = rateText(value.displayName, "displayName", 1, 200);
  const modelConfigId = rateText(value.modelConfigId, "modelConfigId", 36, 36);
  if (!UUID_PATTERN.test(modelConfigId)) invalidRate("Model configuration identity is invalid.");
  const modelConfigRevision = ratePositiveInteger(
    value.modelConfigRevision,
    "modelConfigRevision",
  );
  const currency = rateText(value.currency, "currency", 3, 3).toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) invalidRate("Currency must be a three-letter uppercase code.");
  const billingUsageNormalizerKey = rateText(
    value.billingUsageNormalizerKey,
    "billingUsageNormalizerKey",
    1,
    120,
  ).toLowerCase();
  if (!KEY_PATTERN.test(billingUsageNormalizerKey)) {
    invalidRate("Billing usage normalizer key is invalid.");
  }
  const effectiveFrom = rateTimestamp(value.effectiveFrom, "effectiveFrom");
  const effectiveTo = value.effectiveTo === null
    ? null
    : rateTimestamp(value.effectiveTo, "effectiveTo");
  if (effectiveTo !== null && effectiveTo <= effectiveFrom) {
    invalidRate("Rate Card effectiveTo must be after effectiveFrom.");
  }
  const enabled = rateBoolean(value.enabled, "enabled");
  const priceLines = normalizePriceLines(value.priceLines, "priceLines");
  if (!Array.isArray(value.timeBands) || value.timeBands.length > MAX_TIME_BANDS) {
    invalidRate("timeBands must be a bounded array.");
  }
  const timeBands = (value.timeBands as unknown[]).map((band, index) =>
    normalizeTimeBand(band, `timeBands[${index}]`),
  );
  validateTimeBandSet(timeBands);

  return {
    key,
    displayName,
    modelConfigId,
    modelConfigRevision,
    currency,
    billingUsageNormalizerKey,
    effectiveFrom,
    effectiveTo,
    enabled,
    priceLines,
    timeBands,
  };
}

export function normalizeAIBillableUsage(value: unknown): AIBillableUsage {
  if (!isPlainObject(value)) invalidBilling("Billable usage must be an object.");
  requireExactKeys(value, [
    "standardInputTokens",
    "cacheHitInputTokens",
    "cacheMissInputTokens",
    "outputTokens",
    "reasoningTokens",
    "requestUnits",
  ], invalidBilling);
  return {
    standardInputTokens: nullableNonNegative(value.standardInputTokens, "standardInputTokens"),
    cacheHitInputTokens: nullableNonNegative(value.cacheHitInputTokens, "cacheHitInputTokens"),
    cacheMissInputTokens: nullableNonNegative(value.cacheMissInputTokens, "cacheMissInputTokens"),
    outputTokens: nullableNonNegative(value.outputTokens, "outputTokens"),
    reasoningTokens: nullableNonNegative(value.reasoningTokens, "reasoningTokens"),
    requestUnits: nonNegativeInteger(value.requestUnits, "requestUnits"),
  };
}

export function normalizeAICostOperationContent(value: unknown): AICostOperationContent {
  if (!isPlainObject(value)) invalidAccounting("Cost operation must be an object.");
  requireExactKeys(value, [
    "costCenter",
    "idempotencyKey",
    "opaquePrincipalRef",
    "subjectKey",
    "conversationId",
    "responseId",
    "jobId",
    "evalRunId",
    "knowledgeRevision",
    "status",
    "startedAt",
    "completedAt",
  ], invalidAccounting);
  if (typeof value.costCenter !== "string" || !AI_COST_CENTERS.includes(value.costCenter as never)) {
    invalidAccounting("Cost center is invalid.");
  }
  if (typeof value.status !== "string" || !AI_COST_OPERATION_STATUSES.includes(value.status as never)) {
    invalidAccounting("Cost operation status is invalid.");
  }
  const completedAt = value.completedAt === null
    ? null
    : accountingTimestamp(value.completedAt, "completedAt");
  const startedAt = accountingTimestamp(value.startedAt, "startedAt");
  if (completedAt !== null && completedAt < startedAt) {
    invalidAccounting("Cost operation timestamps are not ordered.");
  }
  return {
    costCenter: value.costCenter as AICostOperationContent["costCenter"],
    idempotencyKey: nullableText(value.idempotencyKey, "idempotencyKey", 200),
    opaquePrincipalRef: nullableText(value.opaquePrincipalRef, "opaquePrincipalRef", 200),
    subjectKey: nullableText(value.subjectKey, "subjectKey", 120),
    conversationId: nullableText(value.conversationId, "conversationId", 120),
    responseId: nullableText(value.responseId, "responseId", 120),
    jobId: nullableText(value.jobId, "jobId", 120),
    evalRunId: nullableText(value.evalRunId, "evalRunId", 120),
    knowledgeRevision: value.knowledgeRevision === null
      ? null
      : accountingPositiveInteger(value.knowledgeRevision, "knowledgeRevision"),
    status: value.status as AICostOperationContent["status"],
    startedAt,
    completedAt,
  };
}

export function normalizeAICostCorrectionContent(value: unknown): AICostCorrectionContent {
  if (!isPlainObject(value)) invalidAccounting("Cost correction must be an object.");
  requireExactKeys(value, [
    "originalRecordId",
    "currency",
    "deltaCostNano",
    "reasonCode",
    "actorType",
    "actorUserId",
    "createdAt",
  ], invalidAccounting);
  const originalRecordId = accountingText(value.originalRecordId, "originalRecordId", 1, 120);
  const currency = accountingText(value.currency, "currency", 3, 3).toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) invalidAccounting("Correction currency is invalid.");
  if (!Number.isSafeInteger(value.deltaCostNano) || Math.abs(value.deltaCostNano as number) > MAX_SAFE_NANO) {
    invalidAccounting("Correction amount is outside the safe nano-unit range.");
  }
  const reasonCode = accountingText(value.reasonCode, "reasonCode", 1, 120).toUpperCase();
  if (!REASON_PATTERN.test(reasonCode)) invalidAccounting("Correction reason code is invalid.");
  if (value.actorType !== "ADMIN" && value.actorType !== "SYSTEM") {
    invalidAccounting("Correction actor type is invalid.");
  }
  const actorUserId = nullableText(value.actorUserId, "actorUserId", 120);
  if (value.actorType === "ADMIN" && actorUserId === null) {
    invalidAccounting("Admin corrections require an actor user ID.");
  }
  if (value.actorType === "SYSTEM" && actorUserId !== null) {
    invalidAccounting("System corrections cannot contain an admin user ID.");
  }
  return {
    originalRecordId,
    currency,
    deltaCostNano: value.deltaCostNano as number,
    reasonCode,
    actorType: value.actorType,
    actorUserId,
    createdAt: accountingTimestamp(value.createdAt, "createdAt"),
  };
}

export function normalizeAIUsageCostRecordContent(value: unknown): AIUsageCostRecordContent {
  if (!isPlainObject(value)) invalidAccounting("Usage cost record must be an object.");
  requireExactKeys(value, [
    "operationId",
    "gatewayRequestId",
    "attemptIndex",
    "capability",
    "modelConfigId",
    "modelConfigRevision",
    "providerConfigId",
    "providerConfigRevision",
    "providerRequestId",
    "rateCardId",
    "rateCardRevision",
    "rateCardRevisionId",
    "resolvedPricingRule",
    "normalizedInputTokens",
    "normalizedCacheHitInputTokens",
    "normalizedCacheMissInputTokens",
    "normalizedOutputTokens",
    "normalizedReasoningTokens",
    "billableStandardInputTokens",
    "billableCacheHitInputTokens",
    "billableCacheMissInputTokens",
    "billableOutputTokens",
    "billableReasoningTokens",
    "requestUnits",
    "currency",
    "knownCostNano",
    "costCompleteness",
    "costBasis",
    "attemptStatus",
    "startedAt",
    "completedAt",
    "latencyMs",
  ], invalidAccounting);
  const operationId = accountingText(value.operationId, "operationId", 1, 120);
  const gatewayRequestId = nullableText(value.gatewayRequestId, "gatewayRequestId", 120);
  const attemptIndex = value.attemptIndex === null
    ? null
    : accountingNonNegativeInteger(value.attemptIndex, "attemptIndex");
  if (typeof value.capability !== "string" || !AI_MODEL_CAPABILITIES.includes(value.capability as never)) {
    invalidAccounting("Usage capability is invalid.");
  }
  const modelConfigId = accountingText(value.modelConfigId, "modelConfigId", 1, 120);
  const modelConfigRevision = accountingPositiveInteger(value.modelConfigRevision, "modelConfigRevision");
  const providerConfigId = accountingText(value.providerConfigId, "providerConfigId", 1, 120);
  const providerConfigRevision = accountingPositiveInteger(value.providerConfigRevision, "providerConfigRevision");
  const providerRequestId = nullableText(value.providerRequestId, "providerRequestId", 200);
  const rateCardId = accountingText(value.rateCardId, "rateCardId", 1, 120);
  const rateCardRevision = accountingPositiveInteger(value.rateCardRevision, "rateCardRevision");
  const rateCardRevisionId = accountingText(value.rateCardRevisionId, "rateCardRevisionId", 1, 120);
  const resolvedPricingRule = accountingText(value.resolvedPricingRule, "resolvedPricingRule", 1, 200);
  const normalizedInputTokens = nullableNonNegative(value.normalizedInputTokens, "normalizedInputTokens");
  const normalizedCacheHitInputTokens = nullableNonNegative(value.normalizedCacheHitInputTokens, "normalizedCacheHitInputTokens");
  const normalizedCacheMissInputTokens = nullableNonNegative(value.normalizedCacheMissInputTokens, "normalizedCacheMissInputTokens");
  const normalizedOutputTokens = nullableNonNegative(value.normalizedOutputTokens, "normalizedOutputTokens");
  const normalizedReasoningTokens = nullableNonNegative(value.normalizedReasoningTokens, "normalizedReasoningTokens");
  const billableStandardInputTokens = nullableNonNegative(value.billableStandardInputTokens, "billableStandardInputTokens");
  const billableCacheHitInputTokens = nullableNonNegative(value.billableCacheHitInputTokens, "billableCacheHitInputTokens");
  const billableCacheMissInputTokens = nullableNonNegative(value.billableCacheMissInputTokens, "billableCacheMissInputTokens");
  const billableOutputTokens = nullableNonNegative(value.billableOutputTokens, "billableOutputTokens");
  const billableReasoningTokens = nullableNonNegative(value.billableReasoningTokens, "billableReasoningTokens");
  const requestUnits = accountingNonNegativeInteger(value.requestUnits, "requestUnits");
  const currency = accountingText(value.currency, "currency", 3, 3).toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) invalidAccounting("Usage currency is invalid.");
  if (!Number.isSafeInteger(value.knownCostNano) || (value.knownCostNano as number) < 0 || (value.knownCostNano as number) > MAX_SAFE_NANO) {
    invalidAccounting("Usage cost is outside the safe nano-unit range.");
  }
  if (typeof value.costCompleteness !== "string" || !AI_COST_COMPLETENESS.includes(value.costCompleteness as never)) {
    invalidAccounting("Usage cost completeness is invalid.");
  }
  if (typeof value.costBasis !== "string" || !AI_COST_BASES.includes(value.costBasis as never)) {
    invalidAccounting("Usage cost basis is invalid.");
  }
  if (typeof value.attemptStatus !== "string" || !AI_PROVIDER_ATTEMPT_STATUSES.includes(value.attemptStatus as never)) {
    invalidAccounting("Usage attempt status is invalid.");
  }
  const startedAt = accountingTimestamp(value.startedAt, "startedAt");
  const completedAt = value.completedAt === null ? null : accountingTimestamp(value.completedAt, "completedAt");
  if (completedAt !== null && completedAt < startedAt) invalidAccounting("Usage timestamps are not ordered.");
  const latencyMs = value.latencyMs === null ? null : accountingNonNegativeInteger(value.latencyMs, "latencyMs");
  return {
    operationId,
    gatewayRequestId,
    attemptIndex,
    capability: value.capability as AIUsageCostRecordContent["capability"],
    modelConfigId,
    modelConfigRevision,
    providerConfigId,
    providerConfigRevision,
    providerRequestId,
    rateCardId,
    rateCardRevision,
    rateCardRevisionId,
    resolvedPricingRule,
    normalizedInputTokens,
    normalizedCacheHitInputTokens,
    normalizedCacheMissInputTokens,
    normalizedOutputTokens,
    normalizedReasoningTokens,
    billableStandardInputTokens,
    billableCacheHitInputTokens,
    billableCacheMissInputTokens,
    billableOutputTokens,
    billableReasoningTokens,
    requestUnits,
    currency,
    knownCostNano: value.knownCostNano as number,
    costCompleteness: value.costCompleteness as AIUsageCostRecordContent["costCompleteness"],
    costBasis: value.costBasis as AIUsageCostRecordContent["costBasis"],
    attemptStatus: value.attemptStatus as AIUsageCostRecordContent["attemptStatus"],
    startedAt,
    completedAt,
    latencyMs,
  };
}

export function assertNormalizedProviderUsage(value: unknown): void {
  if (!isPlainObject(value)) invalidBilling("Provider usage must be an object.");
  for (const field of [
    "inputTokens",
    "outputTokens",
    "reasoningTokens",
    "cacheHitInputTokens",
    "cacheMissInputTokens",
  ]) {
    nullableNonNegative(value[field], field);
  }
}

function normalizePriceLines(value: unknown, field: string): AIRateCardPriceLineContent[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_RATE_LINES) {
    invalidRate(`${field} must contain between one and six price lines.`);
  }
  const lines = value.map((line, index) => normalizePriceLine(line, `${field}[${index}]`));
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.component)) invalidRate(`${field} contains a duplicate component.`);
    seen.add(line.component);
  }
  return lines.sort((left, right) =>
    (PRICE_COMPONENT_ORDER.get(left.component) ?? 0) -
    (PRICE_COMPONENT_ORDER.get(right.component) ?? 0),
  );
}

function normalizePriceLine(value: unknown, field: string): AIRateCardPriceLineContent {
  if (!isPlainObject(value)) invalidRate(`${field} must be an object.`);
  requireExactKeys(value, ["component", "unit", "amountNano"], invalidRate);
  if (!AI_RATE_CARD_PRICE_COMPONENTS.includes(value.component as never)) {
    invalidRate(`${field}.component is invalid.`);
  }
  if (!AI_RATE_CARD_PRICE_UNITS.includes(value.unit as never)) {
    invalidRate(`${field}.unit is invalid.`);
  }
  const component = value.component as AIRateCardPriceComponent;
  const unit = value.unit as AIRateCardPriceUnit;
  const expectedUnit = component === "REQUEST" ? "PER_REQUEST" : "PER_MILLION_TOKENS";
  if (unit !== expectedUnit) invalidRate(`${field}.unit does not match its component.`);
  if (!Number.isSafeInteger(value.amountNano) || (value.amountNano as number) < 0 || (value.amountNano as number) > MAX_SAFE_NANO) {
    invalidRate(`${field}.amountNano is outside the safe non-negative nano-unit range.`);
  }
  return { component, unit, amountNano: value.amountNano as number };
}

function normalizeTimeBand(value: unknown, field: string): AITimeBandContent {
  if (!isPlainObject(value)) invalidRate(`${field} must be an object.`);
  requireExactKeys(value, ["timeZone", "daysOfWeekMask", "startMinute", "endMinute", "priceLines"], invalidRate);
  const timeZone = rateText(value.timeZone, `${field}.timeZone`, 1, 120);
  if (!isValidTimeZone(timeZone)) invalidRate(`${field}.timeZone is not a valid IANA timezone.`);
  const daysOfWeekMask = ratePositiveInteger(value.daysOfWeekMask, `${field}.daysOfWeekMask`);
  if (daysOfWeekMask > 127) invalidRate(`${field}.daysOfWeekMask is invalid.`);
  const startMinute = integerInRange(value.startMinute, `${field}.startMinute`, 0, 1439);
  const endMinute = integerInRange(value.endMinute, `${field}.endMinute`, 1, 1440);
  if (startMinute >= endMinute) {
    invalidRate(`${field} must use explicit non-cross-midnight minutes.`);
  }
  return {
    timeZone,
    daysOfWeekMask,
    startMinute,
    endMinute,
    priceLines: normalizePriceLines(value.priceLines, `${field}.priceLines`),
  };
}

function validateTimeBandSet(timeBands: readonly AITimeBandContent[]): void {
  if (!timeBands.length) return;
  const timeZone = timeBands[0].timeZone;
  if (timeBands.some((band) => band.timeZone !== timeZone)) {
    invalidRate("All time bands in one Rate Card revision must use the same IANA timezone.");
  }
  for (let leftIndex = 0; leftIndex < timeBands.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < timeBands.length; rightIndex += 1) {
      const left = timeBands[leftIndex];
      const right = timeBands[rightIndex];
      if ((left.daysOfWeekMask & right.daysOfWeekMask) === 0) continue;
      if (left.startMinute < right.endMinute && right.startMinute < left.endMinute) {
        invalidRate("Rate Card time bands overlap for at least one recurring day.");
      }
    }
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  fail: (message: string) => never,
): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("Accounting fields are invalid.");
  }
}

function rateText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") invalidRate(`${field} must be text.`);
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < min || normalized.length > max) {
    invalidRate(`${field} length is invalid.`);
  }
  return normalized;
}

function accountingText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") invalidAccounting(`${field} must be text.`);
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < min || normalized.length > max) {
    invalidAccounting(`${field} length is invalid.`);
  }
  return normalized;
}

function nullableText(value: unknown, field: string, max: number): string | null {
  if (value === null) return null;
  return accountingText(value, field, 1, max);
}

function rateTimestamp(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_RUNTIME_TIMESTAMP) invalidRate(`${field} must be a runtime-safe timestamp.`);
  return value as number;
}

function accountingTimestamp(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_RUNTIME_TIMESTAMP) invalidAccounting(`${field} must be a runtime-safe timestamp.`);
  return value as number;
}

function ratePositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalidRate(`${field} must be a positive integer.`);
  return value as number;
}

function accountingPositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalidAccounting(`${field} must be a positive integer.`);
  return value as number;
}

function accountingNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalidAccounting(`${field} must be a non-negative integer.`);
  return value as number;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalidBilling(`${field} must be a non-negative integer.`);
  return value as number;
}

function nullableNonNegative(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalidBilling(`${field} must be null or a non-negative integer.`);
  return value as number;
}

function rateBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalidRate(`${field} must be boolean.`);
  return value;
}

function integerInRange(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    invalidRate(`${field} is outside its valid minute range.`);
  }
  return value as number;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidRate(message: string): never {
  throw new AIAccountingError("AI_RATE_CARD_INVALID", message);
}

function invalidBilling(message: string): never {
  throw new AIAccountingError("AI_BILLING_USAGE_INVALID", message);
}

function invalidAccounting(message: string): never {
  throw new AIAccountingError("AI_ACCOUNTING_CONFLICT", message);
}

export function isCurrency(value: unknown): value is string {
  return typeof value === "string" && CURRENCY_PATTERN.test(value);
}

export function isRateCardKey(value: unknown): value is string {
  return typeof value === "string" && KEY_PATTERN.test(value);
}

export function assertNoRateCardEffectiveOverlaps(
  revisions: readonly AIRateCardRevision[],
): void {
  const byRateCard = new Map<string, AIRateCardRevision[]>();
  for (const revision of revisions) {
    const group = byRateCard.get(revision.rateCardId) ?? [];
    group.push(revision);
    byRateCard.set(revision.rateCardId, group);
  }
  const segments: Array<{
    rateCardId: string;
    modelConfigId: string;
    modelConfigRevision: number;
    currency: string;
    start: number;
    end: number;
  }> = [];
  for (const group of byRateCard.values()) {
    group.sort((left, right) => left.revision - right.revision);
    for (let index = 0; index < group.length; index += 1) {
      const revision = group[index];
      const start = Math.max(revision.createdAt, revision.effectiveFrom);
      const next = group[index + 1];
      const nextStart = next
        ? Math.max(next.createdAt, next.effectiveFrom)
        : Number.MAX_SAFE_INTEGER;
      const end = Math.min(
        revision.effectiveTo ?? Number.MAX_SAFE_INTEGER,
        nextStart,
      );
      if (!revision.enabled || start >= end) continue;
      segments.push({
        rateCardId: revision.rateCardId,
        modelConfigId: revision.modelConfigId,
        modelConfigRevision: revision.modelConfigRevision,
        currency: revision.currency,
        start,
        end,
      });
    }
  }
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      const left = segments[leftIndex];
      const right = segments[rightIndex];
      if (
        left.rateCardId === right.rateCardId ||
        left.modelConfigId !== right.modelConfigId ||
        left.modelConfigRevision !== right.modelConfigRevision ||
        left.currency !== right.currency
      ) continue;
      if (left.start < right.end && right.start < left.end) {
        invalidRate("Published Rate Card effective windows overlap for one pricing target.");
      }
    }
  }
}
