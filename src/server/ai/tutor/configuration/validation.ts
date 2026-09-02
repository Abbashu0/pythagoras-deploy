import { AI_TUTOR_CITATION_PROTOCOL_KEY, AI_TUTOR_CITATION_PROTOCOL_REVISION, AI_TUTOR_GROUNDING_PROTOCOL_KEY, AI_TUTOR_GROUNDING_PROTOCOL_REVISION, AI_TUTOR_MAX_OUTPUT_TOKENS, type AITutorConfigContent, type AITutorConfigSnapshot } from "./contracts";
import { AITutorConfigError } from "./errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_PATTERN = /^[a-z][a-z0-9.-]{0,119}$/u;
const SUBJECT_PATTERN = /^[a-z][a-z0-9-]{0,79}$/u;
const MAX_DISPLAY_NAME = 200;

export function normalizeAITutorConfigContent(value: unknown): AITutorConfigContent {
  if (!isPlainObject(value)) invalid("Tutor Config must be an object.");
  requireExactKeys(value, [
    "key", "subjectKey", "displayName", "enabled", "generationModelConfigId",
    "contextPolicyId", "retrievalConfigId", "budgetPolicyId", "rateLimitPolicyId", "maxOutputTokens",
  ]);
  const content: AITutorConfigContent = {
    key: normalizedText(value.key, "key", 1, 120).toLowerCase(),
    subjectKey: normalizedText(value.subjectKey, "subjectKey", 1, 80).toLowerCase(),
    displayName: normalizedText(value.displayName, "displayName", 1, MAX_DISPLAY_NAME),
    enabled: booleanValue(value.enabled, "enabled"),
    generationModelConfigId: uuid(value.generationModelConfigId, "generationModelConfigId"),
    contextPolicyId: uuid(value.contextPolicyId, "contextPolicyId"),
    retrievalConfigId: uuid(value.retrievalConfigId, "retrievalConfigId"),
    budgetPolicyId: uuid(value.budgetPolicyId, "budgetPolicyId"),
    rateLimitPolicyId: uuid(value.rateLimitPolicyId, "rateLimitPolicyId"),
    maxOutputTokens: positiveInteger(value.maxOutputTokens, "maxOutputTokens", AI_TUTOR_MAX_OUTPUT_TOKENS),
  };
  if (!KEY_PATTERN.test(content.key)) invalid("Tutor Config key is invalid.");
  if (!SUBJECT_PATTERN.test(content.subjectKey)) invalid("Tutor Config subject is invalid.");
  return content;
}

export function normalizeAITutorConfigSnapshot(value: unknown): AITutorConfigSnapshot {
  if (!isPlainObject(value)) invalid("Tutor Config snapshot must be an object.");
  requireExactKeys(value, [
    "key", "subjectKey", "displayName", "enabled", "generationModelConfigId",
    "contextPolicyId", "retrievalConfigId", "budgetPolicyId", "rateLimitPolicyId", "maxOutputTokens",
    "groundingProtocolKey", "groundingProtocolRevision", "citationProtocolKey", "citationProtocolRevision",
  ]);
  const content = normalizeAITutorConfigContent({
    key: value.key,
    subjectKey: value.subjectKey,
    displayName: value.displayName,
    enabled: value.enabled,
    generationModelConfigId: value.generationModelConfigId,
    contextPolicyId: value.contextPolicyId,
    retrievalConfigId: value.retrievalConfigId,
    budgetPolicyId: value.budgetPolicyId,
    rateLimitPolicyId: value.rateLimitPolicyId,
    maxOutputTokens: value.maxOutputTokens,
  });
  if (value.groundingProtocolKey !== AI_TUTOR_GROUNDING_PROTOCOL_KEY || value.groundingProtocolRevision !== AI_TUTOR_GROUNDING_PROTOCOL_REVISION) invalid("Tutor Config grounding protocol is server-owned.");
  if (value.citationProtocolKey !== AI_TUTOR_CITATION_PROTOCOL_KEY || value.citationProtocolRevision !== AI_TUTOR_CITATION_PROTOCOL_REVISION) invalid("Tutor Config citation protocol is server-owned.");
  return {
    ...content,
    groundingProtocolKey: AI_TUTOR_GROUNDING_PROTOCOL_KEY,
    groundingProtocolRevision: AI_TUTOR_GROUNDING_PROTOCOL_REVISION,
    citationProtocolKey: AI_TUTOR_CITATION_PROTOCOL_KEY,
    citationProtocolRevision: AI_TUTOR_CITATION_PROTOCOL_REVISION,
  };
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid("Tutor Config fields are invalid.");
}

function uuid(value: unknown, field: string): string {
  const normalized = normalizedText(value, field, 36, 36);
  if (!UUID_PATTERN.test(normalized)) invalid(`${field} is invalid.`);
  return normalized;
}

function normalizedText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") invalid(`${field} is invalid.`);
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < min || normalized.length > max) invalid(`${field} is invalid.`);
  return normalized;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(`${field} is invalid.`);
  return value;
}

function positiveInteger(value: unknown, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) invalid(`${field} is invalid.`);
  return value as number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message: string): never {
  throw new AITutorConfigError("AI_TUTOR_CONFIG_INVALID", message);
}
