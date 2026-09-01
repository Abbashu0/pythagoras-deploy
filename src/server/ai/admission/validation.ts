import { createHash } from "node:crypto";

import type {
  AIAdmissionPlan,
  AIAdmissionRequestFingerprintInput,
} from "./contracts";
import { AIAdmissionError } from "./errors";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MAX_RUNTIME_TIMESTAMP = 8_640_000_000_000_000;

export function normalizeAIAdmissionPlan(value: unknown): AIAdmissionPlan {
  if (!isPlainObject(value)) invalid("Admission Plan must be an object.");
  requireExactKeys(value, [
    "principalRef",
    "budgetPolicyId",
    "budgetPolicyRevision",
    "rateLimitPolicyId",
    "rateLimitPolicyRevision",
    "budgetPeriod",
    "costOperationId",
    "costEstimate",
    "idempotencyKey",
    "requestFingerprint",
  ]);
  const budgetPeriod = normalizePeriod(value.budgetPeriod);
  const costEstimate = normalizeCostEstimate(value.costEstimate);
  const plan: AIAdmissionPlan = {
    principalRef: opaqueText(value.principalRef, "principalRef", 200),
    budgetPolicyId: identity(value.budgetPolicyId, "budgetPolicyId"),
    budgetPolicyRevision: positiveInteger(value.budgetPolicyRevision, "budgetPolicyRevision"),
    rateLimitPolicyId: identity(value.rateLimitPolicyId, "rateLimitPolicyId"),
    rateLimitPolicyRevision: positiveInteger(value.rateLimitPolicyRevision, "rateLimitPolicyRevision"),
    budgetPeriod,
    costOperationId: opaqueText(value.costOperationId, "costOperationId", 120),
    costEstimate,
    idempotencyKey: opaqueText(value.idempotencyKey, "idempotencyKey", 200),
    requestFingerprint: fingerprint(value.requestFingerprint),
  };
  if (createAIAdmissionRequestFingerprint(plan) !== plan.requestFingerprint) {
    invalid("Admission request fingerprint does not match its server-owned metadata.");
  }
  return plan;
}
export function createAIAdmissionRequestFingerprint(
  input: AIAdmissionRequestFingerprintInput,
): string {
  const canonical = JSON.stringify({
    version: 1,
    principalRef: input.principalRef,
    budgetPolicyId: input.budgetPolicyId,
    budgetPolicyRevision: input.budgetPolicyRevision,
    rateLimitPolicyId: input.rateLimitPolicyId,
    rateLimitPolicyRevision: input.rateLimitPolicyRevision,
    budgetPeriod: {
      startAt: input.budgetPeriod.startAt,
      endAt: input.budgetPeriod.endAt,
    },
    costOperationId: input.costOperationId,
    costEstimate: {
      currency: input.costEstimate.currency,
      maxCostNano: input.costEstimate.maxCostNano,
      estimateBasis: input.costEstimate.estimateBasis,
      modelConfigId: input.costEstimate.modelConfigId ?? null,
      modelConfigRevision: input.costEstimate.modelConfigRevision ?? null,
      rateCardId: input.costEstimate.rateCardId ?? null,
      rateCardRevision: input.costEstimate.rateCardRevision ?? null,
    },
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function normalizePeriod(value: unknown): AIAdmissionPlan["budgetPeriod"] {
  if (!isPlainObject(value)) invalid("budgetPeriod must be an object.");
  requireExactKeys(value, ["startAt", "endAt"]);
  const startAt = timestamp(value.startAt, "budgetPeriod.startAt");
  const endAt = timestamp(value.endAt, "budgetPeriod.endAt");
  if (startAt >= endAt) invalid("The budget period must have startAt before endAt.");
  return { startAt, endAt };
}

function normalizeCostEstimate(value: unknown): AIAdmissionPlan["costEstimate"] {
  if (!isPlainObject(value)) invalid("costEstimate must be an object.");
  const allowed = new Set([
    "currency",
    "maxCostNano",
    "estimateBasis",
    "modelConfigId",
    "modelConfigRevision",
    "rateCardId",
    "rateCardRevision",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) invalid("costEstimate fields are invalid.");
  const result: AIAdmissionPlan["costEstimate"] = {
    currency: opaqueText(value.currency, "costEstimate.currency", 3).toUpperCase(),
    maxCostNano: nonNegativeSafeInteger(value.maxCostNano, "costEstimate.maxCostNano"),
    estimateBasis: opaqueText(value.estimateBasis, "costEstimate.estimateBasis", 120),
  };
  if (value.modelConfigId !== undefined) result.modelConfigId = nullableIdentity(value.modelConfigId, "costEstimate.modelConfigId");
  if (value.modelConfigRevision !== undefined) result.modelConfigRevision = nullablePositiveInteger(value.modelConfigRevision, "costEstimate.modelConfigRevision");
  if (value.rateCardId !== undefined) result.rateCardId = nullableIdentity(value.rateCardId, "costEstimate.rateCardId");
  if (value.rateCardRevision !== undefined) result.rateCardRevision = nullablePositiveInteger(value.rateCardRevision, "costEstimate.rateCardRevision");
  if (!/^[A-Z]{3}$/u.test(result.currency)) invalid("costEstimate.currency must be a three-letter currency code.");
  return result;
}

function identity(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid(`${field} must be a stable UUID.`);
  return value;
}

function nullableIdentity(value: unknown, field: string): string | null {
  return value === null ? null : identity(value, field);
}

function fingerprint(value: unknown): string {
  if (typeof value !== "string" || !FINGERPRINT_PATTERN.test(value)) invalid("requestFingerprint must be a SHA-256 hexadecimal digest.");
  return value;
}

function opaqueText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") invalid(`${field} must be text.`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > max) invalid(`${field} length is invalid.`);
  return normalized;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid(`${field} must be a positive integer.`);
  return value as number;
}

function nullablePositiveInteger(value: unknown, field: string): number | null {
  return value === null ? null : positiveInteger(value, field);
}

function nonNegativeSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_SAFE) invalid(`${field} must be a safe non-negative integer.`);
  return value as number;
}

function timestamp(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_RUNTIME_TIMESTAMP) invalid(`${field} must be a runtime-safe timestamp.`);
  return value as number;
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid("Admission Plan fields are invalid.");
}

function invalid(message: string): never {
  throw new AIAdmissionError("AI_ADMISSION_INVALID", message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
