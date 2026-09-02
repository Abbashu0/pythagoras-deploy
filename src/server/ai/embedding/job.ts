import type { AIJobExecutionContext, AIJobHandlerDefinition } from "../operations/jobs";
import { AIJobError } from "../operations/jobs";
import {
  AI_EMBEDDING_DEFAULT_BATCH_SIZE,
  AI_EMBEDDING_JOB_KIND,
  AI_EMBEDDING_JOB_PAYLOAD_VERSION,
  AI_EMBEDDING_MAX_BATCH_SIZE,
  AI_EMBEDDING_MAX_DIMENSIONS,
  AI_EMBEDDING_VECTOR_CODEC_KEY,
  type AIEmbeddingJobPayload,
} from "./contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;

export function createAIEmbeddingJobHandler(service: {
  executeJob(payload: AIEmbeddingJobPayload, context: AIJobExecutionContext): Promise<void>;
}): AIJobHandlerDefinition {
  return {
    kind: AI_EMBEDDING_JOB_KIND,
    payloadVersion: AI_EMBEDDING_JOB_PAYLOAD_VERSION,
    validatePayload: (value) => validateAIEmbeddingJobPayload(value) as unknown as Record<string, unknown>,
    execute: (payload, context) => service.executeJob(payload as unknown as AIEmbeddingJobPayload, context),
  };
}

export function validateAIEmbeddingJobPayload(value: unknown): AIEmbeddingJobPayload {
  if (!isPlainObject(value)) invalid("The embedding Job payload must be an object.");
  requireExactKeys(value, [
    "embeddingProjectionRevisionId",
    "chunkProjectionRevisionId",
    "chunkProjectionInputFingerprint",
    "chunkCount",
    "modelConfigId",
    "modelConfigRevision",
    "providerConfigId",
    "providerConfigRevision",
    "providerModelId",
    "embeddingAdapterKey",
    "dimensions",
    "vectorCodecKey",
    "vectorCodecRevision",
    "vectorIndexAdapterKey",
    "batchSize",
    "budgetPolicyId",
    "budgetPolicyRevision",
    "rateLimitPolicyId",
    "rateLimitPolicyRevision",
    "budgetPeriodStart",
    "budgetPeriodEnd",
    "costOperationId",
    "admissionIdempotencyKey",
    "admissionRequestFingerprint",
    "costEstimate",
    "circuitPolicyId",
    "circuitPolicyRevision",
  ]);
  const result: AIEmbeddingJobPayload = {
    embeddingProjectionRevisionId: uuid(value.embeddingProjectionRevisionId, "embeddingProjectionRevisionId"),
    chunkProjectionRevisionId: uuid(value.chunkProjectionRevisionId, "chunkProjectionRevisionId"),
    chunkProjectionInputFingerprint: hash(value.chunkProjectionInputFingerprint, "chunkProjectionInputFingerprint"),
    chunkCount: nonNegativeInteger(value.chunkCount, "chunkCount"),
    modelConfigId: uuid(value.modelConfigId, "modelConfigId"),
    modelConfigRevision: positiveInteger(value.modelConfigRevision, "modelConfigRevision"),
    providerConfigId: uuid(value.providerConfigId, "providerConfigId"),
    providerConfigRevision: positiveInteger(value.providerConfigRevision, "providerConfigRevision"),
    providerModelId: text(value.providerModelId, "providerModelId", 200),
    embeddingAdapterKey: key(value.embeddingAdapterKey, "embeddingAdapterKey"),
    dimensions: boundedInteger(value.dimensions, "dimensions", 1, AI_EMBEDDING_MAX_DIMENSIONS),
    vectorCodecKey: value.vectorCodecKey === AI_EMBEDDING_VECTOR_CODEC_KEY ? AI_EMBEDDING_VECTOR_CODEC_KEY : invalid("vectorCodecKey is unsupported."),
    vectorCodecRevision: positiveInteger(value.vectorCodecRevision, "vectorCodecRevision"),
    vectorIndexAdapterKey: key(value.vectorIndexAdapterKey, "vectorIndexAdapterKey"),
    batchSize: boundedInteger(value.batchSize ?? AI_EMBEDDING_DEFAULT_BATCH_SIZE, "batchSize", 1, AI_EMBEDDING_MAX_BATCH_SIZE),
    budgetPolicyId: uuid(value.budgetPolicyId, "budgetPolicyId"),
    budgetPolicyRevision: positiveInteger(value.budgetPolicyRevision, "budgetPolicyRevision"),
    rateLimitPolicyId: uuid(value.rateLimitPolicyId, "rateLimitPolicyId"),
    rateLimitPolicyRevision: positiveInteger(value.rateLimitPolicyRevision, "rateLimitPolicyRevision"),
    budgetPeriodStart: nonNegativeInteger(value.budgetPeriodStart, "budgetPeriodStart"),
    budgetPeriodEnd: nonNegativeInteger(value.budgetPeriodEnd, "budgetPeriodEnd"),
    costOperationId: uuid(value.costOperationId, "costOperationId"),
    admissionIdempotencyKey: text(value.admissionIdempotencyKey, "admissionIdempotencyKey", 200),
    admissionRequestFingerprint: hash(value.admissionRequestFingerprint, "admissionRequestFingerprint"),
    costEstimate: normalizeCostEstimate(value.costEstimate),
    circuitPolicyId: value.circuitPolicyId === null ? null : uuid(value.circuitPolicyId, "circuitPolicyId"),
    circuitPolicyRevision: value.circuitPolicyRevision === null ? null : positiveInteger(value.circuitPolicyRevision, "circuitPolicyRevision"),
  };
  if (result.budgetPeriodStart >= result.budgetPeriodEnd) invalid("The embedding budget period is invalid.");
  if ((result.circuitPolicyId === null) !== (result.circuitPolicyRevision === null)) invalid("The Circuit Policy reference is incomplete.");
  return result;
}

function normalizeCostEstimate(value: unknown): AIEmbeddingJobPayload["costEstimate"] {
  if (!isPlainObject(value)) invalid("costEstimate must be an object.");
  requireExactKeys(value, ["currency", "maxCostNano", "estimateBasis", "modelConfigId", "modelConfigRevision", "rateCardId", "rateCardRevision"]);
  return {
    currency: text(value.currency, "costEstimate.currency", 3).toUpperCase(),
    maxCostNano: nonNegativeInteger(value.maxCostNano, "costEstimate.maxCostNano"),
    estimateBasis: text(value.estimateBasis, "costEstimate.estimateBasis", 240),
    modelConfigId: value.modelConfigId === null ? null : uuid(value.modelConfigId, "costEstimate.modelConfigId"),
    modelConfigRevision: value.modelConfigRevision === null ? null : positiveInteger(value.modelConfigRevision, "costEstimate.modelConfigRevision"),
    rateCardId: value.rateCardId === null ? null : uuid(value.rateCardId, "costEstimate.rateCardId"),
    rateCardRevision: value.rateCardRevision === null ? null : positiveInteger(value.rateCardRevision, "costEstimate.rateCardRevision"),
  };
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid("The embedding Job payload fields are invalid.");
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid(`${field} is invalid.`);
  return value;
}

function hash(value: unknown, field: string): string {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) invalid(`${field} is invalid.`);
  return value;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") invalid(`${field} is invalid.`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > max) invalid(`${field} is invalid.`);
  return normalized;
}

function key(value: unknown, field: string): string {
  const normalized = text(value, field, 120);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(normalized)) invalid(`${field} is invalid.`);
  return normalized;
}

function positiveInteger(value: unknown, field: string): number {
  return boundedInteger(value, field, 1, Number.MAX_SAFE_INTEGER);
}

function nonNegativeInteger(value: unknown, field: string): number {
  return boundedInteger(value, field, 0, Number.MAX_SAFE_INTEGER);
}

function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid(`${field} is invalid.`);
  return value as number;
}

function invalid(message: string): never {
  throw new AIJobError("AI_JOB_PAYLOAD_INVALID", message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
