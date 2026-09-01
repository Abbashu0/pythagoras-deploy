import { AIRateLimitPolicyError } from "./errors";
import type { AIRateLimitPolicyContent } from "./contracts";

const KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const MAX_WINDOW_MS = 31_536_000_000;
const MAX_REQUESTS = 1_000_000;

export function normalizeAIRateLimitPolicyContent(value: unknown): AIRateLimitPolicyContent {
  if (!isPlainObject(value)) invalid("Rate Limit Policy must be an object.");
  requireExactKeys(value, ["key", "displayName", "windowMs", "maxRequests", "maxConcurrentRequests", "enabled"]);
  const key = text(value.key, "key", 1, 120).toLowerCase();
  if (!KEY_PATTERN.test(key)) invalid("Rate Limit Policy key is invalid.");
  const displayName = text(value.displayName, "displayName", 1, 200);
  const windowMs = boundedInteger(value.windowMs, "windowMs", 1, MAX_WINDOW_MS);
  const maxRequests = boundedInteger(value.maxRequests, "maxRequests", 0, MAX_REQUESTS);
  const maxConcurrentRequests = boundedInteger(value.maxConcurrentRequests, "maxConcurrentRequests", 0, MAX_REQUESTS);
  if (typeof value.enabled !== "boolean") invalid("Rate Limit Policy enabled state is invalid.");
  return { key, displayName, windowMs, maxRequests, maxConcurrentRequests, enabled: value.enabled };
}
function invalid(message: string): never {
  throw new AIRateLimitPolicyError("AI_RATE_LIMIT_POLICY_INVALID", message);
}

function text(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") invalid(`${field} must be text.`);
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < min || normalized.length > max) invalid(`${field} length is invalid.`);
  return normalized;
}

function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    invalid(`${field} is outside its valid range.`);
  }
  return value as number;
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid("Rate Limit Policy fields are invalid.");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
