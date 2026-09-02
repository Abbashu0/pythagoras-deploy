export const AI_KNOWLEDGE_ERROR_CODES = [
  "AI_KNOWLEDGE_INVALID",
  "AI_KNOWLEDGE_UNSUPPORTED_VERSION",
  "AI_KNOWLEDGE_SOURCE_NOT_FOUND",
  "AI_KNOWLEDGE_PACKAGE_NOT_FOUND",
  "AI_KNOWLEDGE_SOURCE_CONFLICT",
  "AI_KNOWLEDGE_PACKAGE_CONFLICT",
  "AI_KNOWLEDGE_ASSET_INVALID",
  "AI_KNOWLEDGE_ARTIFACT_NOT_FOUND",
  "AI_KNOWLEDGE_ARTIFACT_INVALID",
  "AI_KNOWLEDGE_PUBLICATION_INVALID",
] as const;

export type AIKnowledgeErrorCode = (typeof AI_KNOWLEDGE_ERROR_CODES)[number];

export class AIKnowledgeError extends Error {
  readonly name = "AIKnowledgeError";

  constructor(
    readonly code: AIKnowledgeErrorCode,
    message: string,
    readonly details: Record<string, string | number | boolean | null> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
