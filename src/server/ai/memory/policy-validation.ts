import {
  AI_MEMORY_POLICY_MAX_RETENTION_DAYS,
  AI_MEMORY_POLICY_MAX_SELECTED_MEMORIES,
  type AIMemoryPolicyContent,
} from "./contracts";
import { AIMemoryError } from "./contracts";

const KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const SUBJECT_KEY_PATTERN = /^[a-z0-9-]{1,80}$/u;

export function normalizeAIMemoryPolicyContent(value: unknown): AIMemoryPolicyContent {
  if (!isPlainObject(value)) invalid("Memory Policy must be an object.");
  requireExactKeys(value, [
    "key",
    "subjectKey",
    "displayName",
    "enabled",
    "candidateReviewRequired",
    "retentionDays",
    "maxSelectedMemories",
  ]);
  const key = text(value.key, "key", 120).toLowerCase();
  if (!KEY_PATTERN.test(key)) invalid("Memory Policy key is invalid.");
  const subjectKey = text(value.subjectKey, "subjectKey", 80).toLowerCase();
  if (!SUBJECT_KEY_PATTERN.test(subjectKey)) invalid("Memory Policy subject is invalid.");
  const displayName = text(value.displayName, "displayName", 200);
  const enabled = booleanValue(value.enabled, "enabled");
  const candidateReviewRequired = booleanValue(value.candidateReviewRequired, "candidateReviewRequired");
  const retentionDays = boundedInteger(value.retentionDays, 1, AI_MEMORY_POLICY_MAX_RETENTION_DAYS, "retentionDays");
  const maxSelectedMemories = boundedInteger(value.maxSelectedMemories, 1, AI_MEMORY_POLICY_MAX_SELECTED_MEMORIES, "maxSelectedMemories");
  return { key, subjectKey, displayName, enabled, candidateReviewRequired, retentionDays, maxSelectedMemories };
}

export function normalizeAIMemoryText(value: unknown): string {
  if (typeof value !== "string") invalid("Memory text must be text.");
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > 128 * 1024) invalid("Memory text exceeds its bounded limit.");
  return normalized;
}

function boundedInteger(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid(`${field} is invalid.`);
  return value;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(`${field} is invalid.`);
  return value;
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") invalid(`${field} must be text.`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > maxLength) invalid(`${field} length is invalid.`);
  return normalized;
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid("Memory Policy fields are invalid.");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message: string): never {
  throw new AIMemoryError("AI_MEMORY_INVALID", message);
}
