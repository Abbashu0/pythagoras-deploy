export const AI_RATE_LIMIT_POLICY_ERROR_CODES = [
  "AI_RATE_LIMIT_POLICY_NOT_FOUND",
  "AI_RATE_LIMIT_POLICY_INVALID",
  "AI_RATE_LIMIT_POLICY_CONFLICT",
] as const;
export type AIRateLimitPolicyErrorCode = (typeof AI_RATE_LIMIT_POLICY_ERROR_CODES)[number];

export class AIRateLimitPolicyError extends Error {
  constructor(
    readonly code: AIRateLimitPolicyErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIRateLimitPolicyError";
  }
}
