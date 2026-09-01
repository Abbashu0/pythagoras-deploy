export const AI_ACCOUNTING_ERROR_CODES = [
  "AI_RATE_CARD_NOT_FOUND",
  "AI_RATE_CARD_AMBIGUOUS",
  "AI_RATE_CARD_INVALID",
  "AI_RATE_CARD_INCOMPLETE",
  "AI_BILLING_NORMALIZER_NOT_FOUND",
  "AI_BILLING_USAGE_INVALID",
  "AI_COST_OVERFLOW",
  "AI_ACCOUNTING_CONFLICT",
  "AI_ACCOUNTING_NOT_FOUND",
  "AI_MODEL_REVISION_NOT_FOUND",
] as const;

export type AIAccountingErrorCode = (typeof AI_ACCOUNTING_ERROR_CODES)[number];

export class AIAccountingError extends Error {
  constructor(
    readonly code: AIAccountingErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIAccountingError";
  }
}

export function isAIAccountingError(value: unknown): value is AIAccountingError {
  return value instanceof AIAccountingError;
}
