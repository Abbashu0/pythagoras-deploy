export const AI_CONTEXT_ERROR_CODES = [
  "AI_CONTEXT_POLICY_NOT_FOUND",
  "AI_CONTEXT_POLICY_INVALID",
  "AI_CONTEXT_POLICY_DISABLED",
  "AI_CONTEXT_HARD_LIMIT_EXCEEDED",
  "AI_CONTEXT_POLICY_BUDGET_EXCEEDED",
  "AI_CONTEXT_RESPONSE_INVALID",
  "AI_CONTEXT_SNAPSHOT_CONFLICT",
  "AI_CONTEXT_ESTIMATOR_INVALID",
  "AI_CONTEXT_SUMMARY_INVALID",
] as const;
export type AIContextErrorCode = (typeof AI_CONTEXT_ERROR_CODES)[number];

export class AIContextError extends Error {
  constructor(
    readonly code: AIContextErrorCode,
    message: string,
    readonly details: Readonly<Record<string, boolean | number | string | null>> = {},
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIContextError";
  }
}
