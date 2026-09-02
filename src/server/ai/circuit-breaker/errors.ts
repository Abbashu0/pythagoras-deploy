export const AI_CIRCUIT_ERROR_CODES = [
  "AI_CIRCUIT_POLICY_INVALID",
  "AI_CIRCUIT_POLICY_NOT_FOUND",
  "AI_CIRCUIT_POLICY_CONFLICT",
  "AI_CIRCUIT_TARGET_INVALID",
  "AI_CIRCUIT_STATE_INVALID",
  "AI_CIRCUIT_OPEN",
  "AI_CIRCUIT_STALE_PERMIT",
] as const;
export type AICircuitErrorCode = (typeof AI_CIRCUIT_ERROR_CODES)[number];

export class AICircuitBreakerError extends Error {
  constructor(
    readonly code: AICircuitErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AICircuitBreakerError";
  }
}

export function isAICircuitBreakerError(value: unknown): value is AICircuitBreakerError {
  return value instanceof AICircuitBreakerError;
}
