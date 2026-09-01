export const AI_MODEL_CONFIG_ERROR_CODES = [
  "AI_MODEL_CONFIG_INVALID",
  "AI_MODEL_CONFIG_NOT_FOUND",
  "AI_MODEL_CONFIG_CONFLICT",
  "AI_MODEL_CONFIG_PROVIDER_NOT_FOUND",
] as const;

export type AIModelConfigErrorCode =
  (typeof AI_MODEL_CONFIG_ERROR_CODES)[number];

export class AIModelConfigError extends Error {
  constructor(
    readonly code: AIModelConfigErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIModelConfigError";
  }
}

export function isAIModelConfigError(
  value: unknown,
): value is AIModelConfigError {
  return value instanceof AIModelConfigError;
}
