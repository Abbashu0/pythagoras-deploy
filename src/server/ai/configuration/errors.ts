export const AI_PROVIDER_CONFIG_ERROR_CODES = [
  "AI_PROVIDER_CONFIG_INVALID",
  "AI_PROVIDER_CONFIG_NOT_FOUND",
  "AI_PROVIDER_CONFIG_CONFLICT",
  "AI_PROVIDER_CONFIG_CREDENTIAL_NOT_FOUND",
] as const;

export type AIProviderConfigErrorCode =
  (typeof AI_PROVIDER_CONFIG_ERROR_CODES)[number];

export class AIProviderConfigError extends Error {
  constructor(
    readonly code: AIProviderConfigErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIProviderConfigError";
  }
}

export function isAIProviderConfigError(
  value: unknown,
): value is AIProviderConfigError {
  return value instanceof AIProviderConfigError;
}
