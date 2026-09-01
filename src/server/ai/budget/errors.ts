export const AI_BUDGET_POLICY_ERROR_CODES = [
  "AI_BUDGET_POLICY_NOT_FOUND",
  "AI_BUDGET_POLICY_INVALID",
  "AI_BUDGET_POLICY_CONFLICT",
] as const;
export type AIBudgetPolicyErrorCode = (typeof AI_BUDGET_POLICY_ERROR_CODES)[number];

export class AIBudgetPolicyError extends Error {
  constructor(
    readonly code: AIBudgetPolicyErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIBudgetPolicyError";
  }
}
