export const CANONICAL_CONTENT_ERROR_CODES = [
  "CANONICAL_AUTHORIZATION_FAILED",
  "CANONICAL_BOOTSTRAP_FAILED",
  "CANONICAL_CONFLICT",
  "CANONICAL_NOT_FOUND",
  "CANONICAL_VALIDATION_FAILED",
] as const;

export type CanonicalContentErrorCode = (typeof CANONICAL_CONTENT_ERROR_CODES)[number];

export class CanonicalContentError extends Error {
  constructor(readonly code: CanonicalContentErrorCode, message: string, readonly cause?: unknown) {
    super(message);
    this.name = "CanonicalContentError";
  }
}

export function isCanonicalContentError(error: unknown): error is CanonicalContentError {
  return error instanceof CanonicalContentError;
}
