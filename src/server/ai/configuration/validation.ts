import {
  AI_PROVIDER_API_FORMATS,
  AI_PROVIDER_RETENTION_POLICIES,
  AI_PROVIDER_TRAINING_POLICIES,
  type AIProviderConfigContent,
  type AIProviderRetentionPolicy,
  type AIProviderTrainingPolicy,
} from "./contracts";
import { AIProviderConfigError } from "./errors";
import { isAISecretCredentialRef } from "../secrets/contracts";

const PROVIDER_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_BASE_URL_LENGTH = 2_048;

export interface AIProviderConfigValidationOptions {
  /** Only isolated tests may opt into loopback HTTP URLs. */
  allowLocalHttp?: boolean;
}

export function normalizeAIProviderConfigContent(
  value: unknown,
  options: AIProviderConfigValidationOptions = {},
): AIProviderConfigContent {
  if (!isPlainObject(value)) invalid("Provider configuration must be an object.");

  const expectedKeys = [
    "key",
    "displayName",
    "baseUrl",
    "credentialRef",
    "apiFormat",
    "enabled",
    "retentionPolicy",
    "trainingPolicy",
    "zdrSupported",
    "zdrRequired",
  ];
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  const requiredKeys = sortedExpectedKeys.filter((key) => key !== "apiFormat");
  if (
    actualKeys.some((key) => !sortedExpectedKeys.includes(key)) ||
    requiredKeys.some((key) => !actualKeys.includes(key))
  ) {
    invalid("Provider configuration fields are invalid.");
  }

  const key = normalizedText(value.key, "key", 1, 120).toLowerCase();
  if (!PROVIDER_KEY_PATTERN.test(key)) {
    invalid("Provider key must be a lowercase semantic key.");
  }

  const displayName = normalizedText(value.displayName, "displayName", 1, 200);
  const enabled = booleanValue(value.enabled, "enabled");
  const baseUrl = normalizeBaseUrl(value.baseUrl, enabled, options);
  const credentialRef = value.credentialRef;
  if (credentialRef !== null && !isAISecretCredentialRef(credentialRef)) {
    invalid("Provider credential reference is invalid.");
  }

  const apiFormat = enumValue(
    value.apiFormat === undefined
      ? "OPENAI_CHAT_COMPLETIONS"
      : value.apiFormat,
    AI_PROVIDER_API_FORMATS,
    "apiFormat",
  );

  const retentionPolicy = enumValue(
    value.retentionPolicy,
    AI_PROVIDER_RETENTION_POLICIES,
    "retentionPolicy",
  );
  const trainingPolicy = enumValue(
    value.trainingPolicy,
    AI_PROVIDER_TRAINING_POLICIES,
    "trainingPolicy",
  );
  const zdrSupported = booleanValue(value.zdrSupported, "zdrSupported");
  const zdrRequired = booleanValue(value.zdrRequired, "zdrRequired");

  if (enabled && credentialRef === null) {
    invalid("An enabled Provider configuration requires a credential reference.");
  }
  if (zdrRequired && !zdrSupported) {
    invalid("Zero-data-retention is required but not supported by this Provider configuration.");
  }

  return {
    key,
    displayName,
    baseUrl,
    credentialRef,
    apiFormat,
    enabled,
    retentionPolicy,
    trainingPolicy,
    zdrSupported,
    zdrRequired,
  };
}

export function assertAIProviderConfigContent(
  value: unknown,
  options?: AIProviderConfigValidationOptions,
): asserts value is AIProviderConfigContent {
  normalizeAIProviderConfigContent(value, options);
}

export function normalizeAIProviderConfigKey(value: unknown): string {
  const key = normalizedText(value, "key", 1, 120).toLowerCase();
  if (!PROVIDER_KEY_PATTERN.test(key)) {
    invalid("Provider key must be a lowercase semantic key.");
  }
  return key;
}

function normalizeBaseUrl(
  value: unknown,
  enabled: boolean,
  options: AIProviderConfigValidationOptions,
): string {
  const raw = normalizedText(value, "baseUrl", 1, MAX_BASE_URL_LENGTH);
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    invalid("Provider base URL must be an absolute URL.", error);
  }

  if (url.username || url.password) {
    invalid("Provider base URL must not contain credentials.");
  }
  if (url.search || url.hash) {
    invalid("Provider base URL must not contain a query or fragment.");
  }

  const isHttps = url.protocol === "https:";
  const isLocalHttp =
    url.protocol === "http:" &&
    options.allowLocalHttp === true &&
    isLoopbackHost(url.hostname);
  if (!isHttps && !isLocalHttp) {
    invalid("Provider base URL must use HTTPS.");
  }
  if (enabled && !isHttps) {
    invalid("Enabled Provider configurations must use HTTPS.");
  }

  return url.toString();
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]" || normalized === "::1";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function invalid(message: string, cause?: unknown): never {
  throw new AIProviderConfigError("AI_PROVIDER_CONFIG_INVALID", message, cause);
}
