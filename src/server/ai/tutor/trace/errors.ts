export const AI_TUTOR_TRACE_ERROR_CODES = [
  "AI_TUTOR_TRACE_INVALID",
  "AI_TUTOR_TRACE_NOT_FOUND",
  "AI_TUTOR_TRACE_CONFLICT",
  "AI_TUTOR_TRACE_LIFECYCLE_INVALID",
] as const;
export type AITutorTraceErrorCode = (typeof AI_TUTOR_TRACE_ERROR_CODES)[number];

export class AITutorTraceError extends Error {
  constructor(
    readonly code: AITutorTraceErrorCode,
    message: string,
    readonly details: Readonly<Record<string, boolean | number | string | null>> = {},
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AITutorTraceError";
  }
}

export function isAITutorTraceError(value: unknown): value is AITutorTraceError {
  return value instanceof AITutorTraceError;
}
