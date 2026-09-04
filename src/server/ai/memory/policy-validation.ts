import {
  AI_MEMORY_CONFIDENCE_SCALE,
  AI_MEMORY_KINDS,
  AI_MEMORY_MAX_PROPOSED_PER_SCOPE,
  AI_MEMORY_MAX_TEXT_BYTES,
  AI_MEMORY_POLICY_MAX_HARD_ACTIVE,
  AI_MEMORY_POLICY_MAX_PER_MEMORY_BYTES,
  AI_MEMORY_POLICY_MAX_RETENTION_DAYS,
  AI_MEMORY_POLICY_MAX_SELECTED_MEMORIES,
  AI_MEMORY_POLICY_MAX_SELECTED_PER_REQUEST,
  type AIMemoryKind,
  type AIMemoryPolicyContent,
} from "./contracts";
import { AIMemoryError } from "./contracts";

const KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const SUBJECT_KEY_PATTERN = /^[a-z0-9-]{1,80}$/u;
const POLICY_KEYS = [
  "key", "scope", "subjectKey", "displayName", "enabled", "allowedKinds",
  "targetActiveCount", "hardActiveMaximum", "maxSelectedPerRequest",
  "proposedHardMaximum", "perMemoryMaxBytes", "retentionDays", "mutationEnabled",
  "explicitMinConfidenceUnits", "inferredMinConfidenceUnits",
  "inferredMinDistinctEvidenceTurns", "candidateReviewRequired", "maxSelectedMemories",
] as const;

/** Normalizes both the historical M10A shape and the new scoped shape. */
export function normalizeAIMemoryPolicyContent(value: unknown): AIMemoryPolicyContent {
  if (!isPlainObject(value)) invalid("Memory Policy must be an object.");
  requireAllowedKeys(value);
  requireKeys(value, ["key", "subjectKey", "displayName", "enabled", "retentionDays"]);
  const scopedShape = value.scope !== undefined || value.allowedKinds !== undefined || value.hardActiveMaximum !== undefined || value.mutationEnabled !== undefined;
  if (scopedShape) requireKeys(value, ["scope", "allowedKinds", "targetActiveCount", "hardActiveMaximum", "maxSelectedPerRequest", "proposedHardMaximum", "perMemoryMaxBytes", "mutationEnabled", "explicitMinConfidenceUnits", "inferredMinConfidenceUnits", "inferredMinDistinctEvidenceTurns"]);

  const scope = value.scope === undefined ? "SUBJECT" : enumValue(value.scope, ["GLOBAL", "SUBJECT"] as const, "scope");
  const subjectKey = value.subjectKey === null ? null : text(value.subjectKey, "subjectKey", 80).toLowerCase();
  if (scope === "GLOBAL" && subjectKey !== null) invalid("A GLOBAL Memory Policy must not have a subject.");
  if (scope === "SUBJECT" && (subjectKey === null || !SUBJECT_KEY_PATTERN.test(subjectKey))) invalid("A SUBJECT Memory Policy requires a canonical subject key.");

  const legacyMax = value.maxSelectedMemories === undefined ? 3 : bounded(value.maxSelectedMemories, "maxSelectedMemories", 1, AI_MEMORY_POLICY_MAX_SELECTED_MEMORIES);
  const legacyShape = value.hardActiveMaximum === undefined && value.targetActiveCount === undefined && value.maxSelectedPerRequest === undefined && value.proposedHardMaximum === undefined && value.perMemoryMaxBytes === undefined && value.mutationEnabled === undefined && value.explicitMinConfidenceUnits === undefined && value.inferredMinConfidenceUnits === undefined && value.inferredMinDistinctEvidenceTurns === undefined;
  const hardActiveMaximum = bounded(value.hardActiveMaximum ?? (legacyShape ? AI_MEMORY_POLICY_MAX_HARD_ACTIVE : legacyMax), "hardActiveMaximum", 1, AI_MEMORY_POLICY_MAX_HARD_ACTIVE);
  const targetActiveCount = bounded(value.targetActiveCount ?? Math.min(legacyMax, hardActiveMaximum), "targetActiveCount", 0, hardActiveMaximum);
  const maxSelectedPerRequest = bounded(value.maxSelectedPerRequest ?? Math.min(legacyMax, hardActiveMaximum), "maxSelectedPerRequest", 0, Math.min(hardActiveMaximum, AI_MEMORY_POLICY_MAX_SELECTED_PER_REQUEST));
  const proposedHardMaximum = bounded(value.proposedHardMaximum ?? Math.min(legacyShape ? AI_MEMORY_MAX_PROPOSED_PER_SCOPE : hardActiveMaximum, AI_MEMORY_MAX_PROPOSED_PER_SCOPE), "proposedHardMaximum", 0, AI_MEMORY_MAX_PROPOSED_PER_SCOPE);
  const perMemoryMaxBytes = bounded(value.perMemoryMaxBytes ?? AI_MEMORY_MAX_TEXT_BYTES, "perMemoryMaxBytes", 1, AI_MEMORY_POLICY_MAX_PER_MEMORY_BYTES);
  const allowedKinds = value.allowedKinds === undefined ? [...AI_MEMORY_KINDS] : kinds(value.allowedKinds);
  const mutationEnabled = value.mutationEnabled === undefined ? true : booleanValue(value.mutationEnabled, "mutationEnabled");
  const explicitMinConfidenceUnits = bounded(value.explicitMinConfidenceUnits ?? 0, "explicitMinConfidenceUnits", 0, AI_MEMORY_CONFIDENCE_SCALE);
  const inferredMinConfidenceUnits = bounded(value.inferredMinConfidenceUnits ?? 900_000, "inferredMinConfidenceUnits", 0, AI_MEMORY_CONFIDENCE_SCALE);
  const inferredMinDistinctEvidenceTurns = bounded(value.inferredMinDistinctEvidenceTurns ?? 2, "inferredMinDistinctEvidenceTurns", 1, 10);
  const candidateReviewRequired = value.candidateReviewRequired === undefined ? true : booleanValue(value.candidateReviewRequired, "candidateReviewRequired");

  return {
    key: key(value.key, "key"),
    scope,
    subjectKey,
    displayName: text(value.displayName, "displayName", 200),
    enabled: booleanValue(value.enabled, "enabled"),
    allowedKinds,
    targetActiveCount,
    hardActiveMaximum,
    maxSelectedPerRequest,
    proposedHardMaximum,
    perMemoryMaxBytes,
    retentionDays: bounded(value.retentionDays, "retentionDays", 1, AI_MEMORY_POLICY_MAX_RETENTION_DAYS),
    mutationEnabled,
    explicitMinConfidenceUnits,
    inferredMinConfidenceUnits,
    inferredMinDistinctEvidenceTurns,
    candidateReviewRequired,
    maxSelectedMemories: maxSelectedPerRequest || legacyMax,
  };
}

export function normalizeAIMemoryText(value: unknown, maxBytes = AI_MEMORY_MAX_TEXT_BYTES): string {
  if (typeof value !== "string") invalid("Memory text must be text.");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > AI_MEMORY_POLICY_MAX_PER_MEMORY_BYTES) invalid("Memory text bound is invalid.");
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maxBytes) invalid("Memory text exceeds its bounded limit.");
  return normalized;
}

function kinds(value: unknown): AIMemoryKind[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > AI_MEMORY_KINDS.length || value.some((entry) => typeof entry !== "string" || !AI_MEMORY_KINDS.includes(entry as AIMemoryKind))) invalid("Memory Policy allowed kinds are invalid.");
  const result = value as AIMemoryKind[];
  if (new Set(result).size !== result.length) invalid("Memory Policy allowed kinds must not contain duplicates.");
  return [...result];
}

function bounded(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid(`${field} is invalid.`);
  return value;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(`${field} is invalid.`);
  return value;
}

function enumValue<T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) invalid(`${field} is invalid.`);
  return value as T[number];
}

function key(value: unknown, field: string): string {
  const normalized = text(value, field, 120).toLowerCase();
  if (!KEY_PATTERN.test(normalized)) invalid(`${field} is invalid.`);
  return normalized;
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") invalid(`${field} must be text.`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > maxLength) invalid(`${field} length is invalid.`);
  return normalized;
}

function requireKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) if (!(key in value)) invalid("Memory Policy fields are incomplete.");
}

function requireAllowedKeys(value: Record<string, unknown>): void {
  if (Object.keys(value).some((key) => !POLICY_KEYS.includes(key as (typeof POLICY_KEYS)[number]))) invalid("Memory Policy fields are invalid.");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message: string): never {
  throw new AIMemoryError("AI_MEMORY_INVALID", message);
}
