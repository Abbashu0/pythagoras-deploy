export const AI_HYBRID_RETRIEVAL_ERROR_CODES = [
  "AI_HYBRID_INVALID",
  "AI_HYBRID_SUBJECT_INVALID",
  "AI_HYBRID_CONFIG_NOT_FOUND",
  "AI_HYBRID_CONFIG_INVALID",
  "AI_HYBRID_ORIGIN_CAPACITY",
  "AI_HYBRID_EXECUTION_CONTEXT_INVALID",
  "AI_HYBRID_SEMANTIC_COVERAGE_INCOMPLETE",
  "AI_HYBRID_PROVIDER_FAILURE",
  "AI_HYBRID_ACCOUNTING_FAILED",
  "AI_HYBRID_PROVIDER_SPACE_CHANGED",
  "AI_HYBRID_RERANK_INVALID",
  "AI_HYBRID_FINAL_FENCE_FAILED",
] as const;

export type AIHybridRetrievalErrorCode = (typeof AI_HYBRID_RETRIEVAL_ERROR_CODES)[number];

export class AIHybridRetrievalError extends Error {
  constructor(
    readonly code: AIHybridRetrievalErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "AIHybridRetrievalError";
  }
}
