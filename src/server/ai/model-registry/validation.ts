import {
  AI_MODEL_CAPABILITIES,
  type AIModelConfigContent,
  type AIModelCapability,
} from "./contracts";
import { AIModelConfigError } from "./errors";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MODEL_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ADAPTER_KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;

export function normalizeAIModelConfigContent(
  value: unknown,
): AIModelConfigContent {
  if (!isPlainObject(value)) invalid("Model configuration must be an object.");

  const expectedKeys = [
    "key",
    "displayName",
    "providerConfigId",
    "providerModelId",
    "capability",
    "adapterKey",
    "enabled",
    "contextWindowTokens",
    "maxOutputTokens",
    "embeddingDimensions",
    "supportsStreaming",
    "supportsReasoning",
    "supportsStructuredOutput",
  ].sort();
  const actualKeys = Object.keys(value).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    invalid("Model configuration fields are invalid.");
  }

  const key = normalizedText(value.key, "key", 1, 120).toLowerCase();
  if (!MODEL_KEY_PATTERN.test(key)) {
    invalid("Model key must be a lowercase semantic key.");
  }
  const displayName = normalizedText(value.displayName, "displayName", 1, 200);
  const providerConfigId = normalizedText(
    value.providerConfigId,
    "providerConfigId",
    36,
    36,
  );
  if (!UUID_PATTERN.test(providerConfigId)) {
    invalid("Provider configuration identity is invalid.");
  }
  const providerModelId = normalizedText(
    value.providerModelId,
    "providerModelId",
    1,
    200,
  );
  const capability = enumValue(
    value.capability,
    AI_MODEL_CAPABILITIES,
    "capability",
  );
  const adapterKey = normalizedText(value.adapterKey, "adapterKey", 1, 120).toLowerCase();
  if (!ADAPTER_KEY_PATTERN.test(adapterKey)) {
    invalid("Adapter key must be a lowercase registered key.");
  }
  const enabled = booleanValue(value.enabled, "enabled");
  const contextWindowTokens = nullablePositiveInteger(
    value.contextWindowTokens,
    "contextWindowTokens",
  );
  const maxOutputTokens = nullablePositiveInteger(
    value.maxOutputTokens,
    "maxOutputTokens",
  );
  const embeddingDimensions = nullablePositiveInteger(
    value.embeddingDimensions,
    "embeddingDimensions",
  );
  const supportsStreaming = booleanValue(
    value.supportsStreaming,
    "supportsStreaming",
  );
  const supportsReasoning = booleanValue(
    value.supportsReasoning,
    "supportsReasoning",
  );
  const supportsStructuredOutput = booleanValue(
    value.supportsStructuredOutput,
    "supportsStructuredOutput",
  );

  if (
    contextWindowTokens !== null &&
    maxOutputTokens !== null &&
    maxOutputTokens > contextWindowTokens
  ) {
    invalid("maxOutputTokens cannot exceed contextWindowTokens.");
  }
  if (capability !== "EMBEDDING" && embeddingDimensions !== null) {
    invalid("embeddingDimensions only applies to embedding models.");
  }
  if (capability !== "GENERATION") {
    if (contextWindowTokens !== null || maxOutputTokens !== null) {
      invalid("Token-window fields only apply to generation models.");
    }
    if (supportsStreaming || supportsReasoning || supportsStructuredOutput) {
      invalid("Generation-only capability flags are invalid for this model.");
    }
  }

  return {
    key,
    displayName,
    providerConfigId,
    providerModelId,
    capability,
    adapterKey,
    enabled,
    contextWindowTokens,
    maxOutputTokens,
    embeddingDimensions,
    supportsStreaming,
    supportsReasoning,
    supportsStructuredOutput,
  };
}

export function assertAIModelConfigContent(
  value: unknown,
): asserts value is AIModelConfigContent {
  normalizeAIModelConfigContent(value);
}

export function normalizeAIModelConfigKey(value: unknown): string {
  const key = normalizedText(value, "key", 1, 120).toLowerCase();
  if (!MODEL_KEY_PATTERN.test(key)) {
    invalid("Model key must be a lowercase semantic key.");
  }
  return key;
}

function nullablePositiveInteger(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1
  ) {
    invalid(`${field} must be a positive integer or null.`);
  }
  return value as number;
}

function normalizedText(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") invalid(`${field} must be text.`);
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < min || normalized.length > max) {
    invalid(`${field} length is invalid.`);
  }
  return normalized;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(`${field} must be boolean.`);
  return value;
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    invalid(`${field} is invalid.`);
  }
  return value as T[number];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message: string): never {
  throw new AIModelConfigError("AI_MODEL_CONFIG_INVALID", message);
}

export function isAIModelCapability(value: unknown): value is AIModelCapability {
  return typeof value === "string" && AI_MODEL_CAPABILITIES.includes(value as AIModelCapability);
}
