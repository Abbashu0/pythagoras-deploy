import { createHash } from "node:crypto";

import { AI_COST_CENTERS, type AICostCenter } from "../../economics";
import { AIJobError } from "./errors";
import {
  AI_JOB_PRIORITIES,
  type AIJobPriority,
  type AIJobSpec,
} from "./contracts";

const KIND_PATTERN = /^[a-z][a-z0-9.-]{0,119}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const MAX_ATTEMPTS = 100;
const MAX_DURATION_MS = 86_400_000;
const FORBIDDEN_PAYLOAD_KEY = /^(?:prompt|message|answer|full(?:Conversation|History)|student(?:Message|Prompt|Content)|apiKey|secret|credential|authorization|providerResponse)$/iu;

export interface NormalizedAIJobSpec extends Omit<AIJobSpec, "priority" | "costOperationId" | "scheduledAt" | "maxAttempts" | "timeoutMs" | "leaseDurationMs" | "backoffBaseMs" | "backoffMaxMs"> {
  priority: AIJobPriority;
  costOperationId: string | null;
  maxAttempts: number;
  timeoutMs: number;
  leaseDurationMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  scheduledAt: number;
  payloadJson: string;
  payloadHash: string;
}

export function normalizeAIJobSpec(value: AIJobSpec): NormalizedAIJobSpec {
  if (!isPlainObject(value)) invalid("Job specification must be an object.");
  const kind = text(value.kind, "kind", 120);
  if (!KIND_PATTERN.test(kind)) invalid("Job kind is invalid.");
  const dedupeKey = text(value.dedupeKey, "dedupeKey", 240);
  const payloadVersion = positiveInteger(value.payloadVersion, "payloadVersion", 100);
  if (!isPlainObject(value.payload)) invalid("Job payload must be an object.");
  const payload = canonicalize(value.payload, "payload");
  const payloadJson = JSON.stringify(payload);
  if (Buffer.byteLength(payloadJson, "utf8") > MAX_PAYLOAD_BYTES) invalid("Job payload exceeds the bounded size.");
  const payloadHash = createHash("sha256").update(payloadJson).digest("hex");
  if (typeof value.costCenter !== "string" || !AI_COST_CENTERS.includes(value.costCenter as never)) invalid("Job cost center is invalid.");
  const priority = value.priority ?? "NORMAL";
  if (!AI_JOB_PRIORITIES.includes(priority as never)) invalid("Job priority is invalid.");
  const maxAttempts = boundedInteger(value.maxAttempts ?? 3, "maxAttempts", 1, MAX_ATTEMPTS);
  const timeoutMs = boundedInteger(value.timeoutMs ?? 60_000, "timeoutMs", 1, MAX_DURATION_MS);
  const leaseDurationMs = boundedInteger(value.leaseDurationMs ?? 120_000, "leaseDurationMs", 100, MAX_DURATION_MS);
  const backoffBaseMs = boundedInteger(value.backoffBaseMs ?? 1_000, "backoffBaseMs", 0, MAX_DURATION_MS);
  const backoffMaxMs = boundedInteger(value.backoffMaxMs ?? 60_000, "backoffMaxMs", 0, MAX_DURATION_MS);
  if (backoffMaxMs < backoffBaseMs) invalid("backoffMaxMs must be at least backoffBaseMs.");
  const scheduledAt = timestamp(value.scheduledAt ?? Date.now(), "scheduledAt");
  const costOperationId = value.costOperationId === undefined || value.costOperationId === null
    ? null
    : text(value.costOperationId, "costOperationId", 120);
  const id = value.id === undefined ? undefined : text(value.id, "id", 120);
  return {
    id,
    kind,
    payloadVersion,
    payload,
    dedupeKey,
    costCenter: value.costCenter as AICostCenter,
    costOperationId,
    priority: priority as AIJobPriority,
    maxAttempts,
    timeoutMs,
    leaseDurationMs,
    backoffBaseMs,
    backoffMaxMs,
    scheduledAt,
    payloadJson,
    payloadHash,
  };
}

export function assertPayloadHash(value: string): void {
  if (!HASH_PATTERN.test(value)) invalid("Job payload hash is invalid.");
}

export function canonicalize(value: unknown, field = "payload", depth = 0): Record<string, unknown> {
  if (depth > 12 || !isPlainObject(value)) invalid(`${field} must contain only bounded JSON objects.`);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (!key || key.length > 120) invalid(`${field} contains an invalid key.`);
    if (FORBIDDEN_PAYLOAD_KEY.test(key)) invalid(`${field} contains a forbidden sensitive field.`);
    const item = value[key];
    if (item === null || typeof item === "string" || typeof item === "boolean") {
      if (typeof item === "string" && item.length > 4_000) invalid(`${field}.${key} is too long.`);
      result[key] = item;
    } else if (typeof item === "number") {
      if (!Number.isSafeInteger(item)) invalid(`${field}.${key} is not a safe number.`);
      result[key] = item;
    } else if (Array.isArray(item)) {
      if (item.length > 100) invalid(`${field}.${key} array is too large.`);
      result[key] = item.map((entry, index) => canonicalValue(entry, `${field}.${key}[${index}]`, depth + 1));
    } else {
      result[key] = canonicalize(item, `${field}.${key}`, depth + 1);
    }
  }
  return result;
}

function canonicalValue(value: unknown, field: string, depth: number): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    if (typeof value === "string" && value.length > 4_000) invalid(`${field} is too long.`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) invalid(`${field} is not a safe number.`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) invalid(`${field} array is too large.`);
    return value.map((entry, index) => canonicalValue(entry, `${field}[${index}]`, depth + 1));
  }
  return canonicalize(value, field, depth);
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") invalid(`${field} must be text.`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > max) invalid(`${field} length is invalid.`);
  return normalized;
}

function positiveInteger(value: unknown, field: string, max: number): number {
  return boundedInteger(value, field, 1, max);
}

function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid(`${field} is outside its valid range.`);
  return value as number;
}

function timestamp(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_TIMESTAMP) invalid(`${field} is invalid.`);
  return value as number;
}

function invalid(message: string): never {
  throw new AIJobError("AI_JOB_INVALID", message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
