export const AI_JOB_ERROR_CODES = [
  "AI_JOB_INVALID",
  "AI_JOB_DEDUPE_CONFLICT",
  "AI_JOB_HANDLER_NOT_FOUND",
  "AI_JOB_PAYLOAD_INVALID",
  "AI_JOB_LEASE_LOST",
  "AI_JOB_NOT_CLAIMABLE",
  "AI_JOB_TIMEOUT",
  "AI_JOB_DEAD_LETTER",
  "AI_JOB_NOT_CANCELLABLE",
  "AI_JOB_HANDLER_FAILED",
  "AI_RECONCILIATION_INCOMPLETE",
] as const;
export type AIJobErrorCode = (typeof AI_JOB_ERROR_CODES)[number];

export class AIJobError extends Error {
  constructor(
    readonly code: AIJobErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIJobError";
  }
}

export class AIJobExecutionError extends Error {
  constructor(
    readonly safeErrorCode: string,
    readonly retryable: boolean,
    message = safeErrorCode,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIJobExecutionError";
  }
}
