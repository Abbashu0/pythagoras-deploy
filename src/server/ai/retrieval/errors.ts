export const AI_RETRIEVAL_ERROR_CODES = [
  "AI_RETRIEVAL_INVALID",
  "AI_RETRIEVAL_SUBJECT_INVALID",
  "AI_RETRIEVAL_ORIGIN_NOT_FOUND",
  "AI_RETRIEVAL_SOURCE_INELIGIBLE",
  "AI_RETRIEVAL_STRATEGY_NOT_FOUND",
  "AI_RETRIEVAL_PROJECTION_NOT_FOUND",
  "AI_RETRIEVAL_PROJECTION_CONFLICT",
  "AI_RETRIEVAL_PROJECTION_FAILED",
  "AI_RETRIEVAL_INPUT_CHANGED",
  "AI_RETRIEVAL_QUERY_INVALID",
  "AI_RETRIEVAL_QUERY_EMPTY",
  "AI_RETRIEVAL_QUERY_TOO_LARGE",
] as const;

export type AIRetrievalErrorCode = (typeof AI_RETRIEVAL_ERROR_CODES)[number];

export class AIRetrievalError extends Error {
  readonly name = "AIRetrievalError";

  constructor(
    readonly code: AIRetrievalErrorCode,
    message: string,
    readonly details: Record<string, string | number | boolean | null> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
