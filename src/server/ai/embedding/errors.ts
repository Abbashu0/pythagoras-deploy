export const AI_EMBEDDING_ERROR_CODES = [
  "AI_EMBEDDING_INVALID",
  "AI_EMBEDDING_SUBJECT_INVALID",
  "AI_EMBEDDING_M7A_NOT_READY",
  "AI_EMBEDDING_MODEL_INVALID",
  "AI_EMBEDDING_PROVIDER_INVALID",
  "AI_EMBEDDING_ADAPTER_INVALID",
  "AI_EMBEDDING_CONFIG_CHANGED",
  "AI_EMBEDDING_PROJECTION_NOT_FOUND",
  "AI_EMBEDDING_PROJECTION_CONFLICT",
  "AI_EMBEDDING_PROJECTION_FAILED",
  "AI_EMBEDDING_VECTOR_INVALID",
  "AI_EMBEDDING_VECTOR_CONFLICT",
  "AI_EMBEDDING_VECTOR_OWNERSHIP",
  "AI_EMBEDDING_VECTOR_QUERY_INVALID",
  "AI_EMBEDDING_COVERAGE_INVALID",
  "AI_EMBEDDING_JOB_PAYLOAD_INVALID",
  "AI_EMBEDDING_COST_INVALID",
] as const;

export type AIEmbeddingErrorCode = (typeof AI_EMBEDDING_ERROR_CODES)[number];

export class AIEmbeddingError extends Error {
  constructor(
    readonly code: AIEmbeddingErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "AIEmbeddingError";
  }
}

export function isAIEmbeddingError(value: unknown): value is AIEmbeddingError {
  return value instanceof AIEmbeddingError;
}
