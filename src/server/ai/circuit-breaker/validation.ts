import { AICircuitBreakerError } from "./errors";
import type { AICircuitBreakerPolicyContent, AICircuitTarget } from "./contracts";
import { AI_MODEL_CAPABILITIES } from "../model-registry";

const KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ADAPTER_KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const MAX_DURATION_MS = 86_400_000;

export function normalizeAICircuitBreakerPolicyContent(value: unknown): AICircuitBreakerPolicyContent {
  if (!isPlainObject(value)) invalid("Circuit Breaker Policy must be an object.");
  requireExactKeys(value, ["key", "displayName", "failureThreshold", "openDurationMs", "halfOpenProbeLeaseMs", "enabled"]);
  const key = text(value.key, "key", 1, 120).toLowerCase();
  if (!KEY_PATTERN.test(key)) invalid("Circuit Breaker Policy key is invalid.");
  const displayName = text(value.displayName, "displayName", 1, 200);
  const failureThreshold = boundedInteger(value.failureThreshold, "failureThreshold", 1, 100);
  const openDurationMs = boundedInteger(value.openDurationMs, "openDurationMs", 1_000, MAX_DURATION_MS);
  const halfOpenProbeLeaseMs = boundedInteger(value.halfOpenProbeLeaseMs, "halfOpenProbeLeaseMs", 100, MAX_DURATION_MS);
  if (typeof value.enabled !== "boolean") invalid("Circuit Breaker Policy enabled state is invalid.");
  return { key, displayName, failureThreshold, openDurationMs, halfOpenProbeLeaseMs, enabled: value.enabled };
}

export function validateAICircuitTarget(target: AICircuitTarget): void {
  if (!isPlainObject(target)) targetInvalid();
  for (const [value, field] of [
    [target.policyId, "policyId"],
    [target.modelConfigId, "modelConfigId"],
    [target.providerConfigId, "providerConfigId"],
  ] as const) {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) targetInvalid(`${field} is invalid.`);
  }
  for (const [value, field] of [
    [target.policyRevision, "policyRevision"],
    [target.modelConfigRevision, "modelConfigRevision"],
    [target.providerConfigRevision, "providerConfigRevision"],
    [target.secretVersion, "secretVersion"],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000_000) targetInvalid(`${field} is invalid.`);
  }
  if (typeof target.capability !== "string" || !AI_MODEL_CAPABILITIES.includes(target.capability as never)) targetInvalid("capability is invalid.");
  if (typeof target.adapterKey !== "string" || !ADAPTER_KEY_PATTERN.test(target.adapterKey) || target.adapterKey.length > 120) targetInvalid("adapterKey is invalid.");
}

export function validateCircuitTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) {
    throw new AICircuitBreakerError("AI_CIRCUIT_TARGET_INVALID", "Circuit timestamp is invalid.");
  }
}

function invalid(message: string): never {
  throw new AICircuitBreakerError("AI_CIRCUIT_POLICY_INVALID", message);
}

function targetInvalid(message = "Circuit target is invalid."): never {
  throw new AICircuitBreakerError("AI_CIRCUIT_TARGET_INVALID", message);
}

function text(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") invalid(`${field} must be text.`);
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < min || normalized.length > max) invalid(`${field} length is invalid.`);
  return normalized;
}

function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid(`${field} is outside its valid range.`);
  return value as number;
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid("Circuit Breaker Policy fields are invalid.");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
