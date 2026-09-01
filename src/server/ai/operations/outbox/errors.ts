export const AI_OUTBOX_ERROR_CODES = [
  "AI_OUTBOX_INVALID",
  "AI_OUTBOX_DEDUPE_CONFLICT",
  "AI_OUTBOX_ROUTER_NOT_FOUND",
  "AI_OUTBOX_DISPATCH_FAILED",
] as const;
export type AIOutboxErrorCode = (typeof AI_OUTBOX_ERROR_CODES)[number];

export class AIOutboxError extends Error {
  constructor(
    readonly code: AIOutboxErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIOutboxError";
  }
}
