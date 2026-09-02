export const AI_CONVERSATION_ERROR_CODES = [
  "AI_STUDENT_PRINCIPAL_UNAVAILABLE",
  "AI_STUDENT_PRINCIPAL_INACTIVE",
  "AI_CONVERSATION_NOT_FOUND",
  "AI_CONVERSATION_INVALID",
  "AI_CONVERSATION_SUBJECT_INVALID",
  "AI_CONVERSATION_DELETED",
  "AI_CONVERSATION_BUSY",
  "AI_CONVERSATION_IDEMPOTENCY_CONFLICT",
  "AI_CONVERSATION_RESPONSE_INVALID",
  "AI_CONVERSATION_STREAM_CONFLICT",
  "AI_CONVERSATION_RESPONSE_TERMINAL",
] as const;
export type AIConversationErrorCode = (typeof AI_CONVERSATION_ERROR_CODES)[number];

export class AIConversationError extends Error {
  constructor(
    readonly code: AIConversationErrorCode,
    message: string,
    readonly details: Readonly<Record<string, boolean | number | string | null>> = {},
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIConversationError";
  }
}

export function isAIConversationError(value: unknown): value is AIConversationError {
  return value instanceof AIConversationError;
}
