export const AI_ADMISSION_ERROR_CODES = [
  "AI_ADMISSION_INVALID",
  "AI_ADMISSION_IDEMPOTENCY_CONFLICT",
  "AI_BUDGET_POLICY_NOT_FOUND",
  "AI_RATE_LIMIT_POLICY_NOT_FOUND",
  "AI_BUDGET_EXCEEDED",
  "AI_BUDGET_CURRENCY_MISMATCH",
  "AI_BUDGET_ACCOUNT_CONFLICT",
  "AI_BUDGET_ACCOUNT_POLICY_REVISION_CONFLICT",
  "AI_BUDGET_RECONCILIATION_REQUIRED",
  "AI_RATE_LIMITED",
  "AI_ADMISSION_CONCURRENCY_LIMITED",
] as const;
export type AIAdmissionErrorCode = (typeof AI_ADMISSION_ERROR_CODES)[number];

export type AIAdmissionErrorDetails = Readonly<Record<string, boolean | number | string | null>>;

export class AIAdmissionError extends Error {
  constructor(
    readonly code: AIAdmissionErrorCode,
    message: string,
    readonly details: AIAdmissionErrorDetails = {},
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIAdmissionError";
  }
}
