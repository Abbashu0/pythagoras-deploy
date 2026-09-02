export const AI_RETRIEVAL_CONFIG_ERROR_CODES = [
  "AI_RETRIEVAL_CONFIG_INVALID",
  "AI_RETRIEVAL_CONFIG_NOT_FOUND",
  "AI_RETRIEVAL_CONFIG_CONFLICT",
  "AI_RETRIEVAL_CONFIG_SUBJECT_MISMATCH",
  "AI_RETRIEVAL_CONFIG_MODEL_INVALID",
] as const;

export type AIRetrievalConfigErrorCode = (typeof AI_RETRIEVAL_CONFIG_ERROR_CODES)[number];

export class AIRetrievalConfigError extends Error {
  constructor(
    readonly code: AIRetrievalConfigErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "AIRetrievalConfigError";
  }
}
