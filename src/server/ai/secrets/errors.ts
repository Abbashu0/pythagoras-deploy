export const AI_SECRET_ERROR_CODES = [
  "AI_SECRET_STORE_UNAVAILABLE",
  "AI_SECRET_CONFIGURATION_INVALID",
  "AI_SECRET_REF_INVALID",
  "AI_SECRET_INPUT_INVALID",
  "AI_SECRET_NOT_FOUND",
  "AI_SECRET_REVOKED",
  "AI_SECRET_DECRYPTION_FAILED",
  "AI_SECRET_CONFLICT",
] as const;

export type AISecretErrorCode = (typeof AI_SECRET_ERROR_CODES)[number];

export class AISecretStoreError extends Error {
  constructor(
    readonly code: AISecretErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AISecretStoreError";
  }
}

export function isAISecretStoreError(
  value: unknown,
): value is AISecretStoreError {
  return value instanceof AISecretStoreError;
}
