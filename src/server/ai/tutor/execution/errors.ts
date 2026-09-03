export const AI_TUTOR_EXECUTION_ERROR_CODES = [
  "AI_TUTOR_EXECUTION_INVALID",
  "AI_TUTOR_EXECUTION_PREFLIGHT_FAILED",
  "AI_TUTOR_EXECUTION_OPERATION_CONFLICT",
  "AI_TUTOR_EXECUTION_ADMISSION_DENIED",
  "AI_TUTOR_EXECUTION_RETRIEVAL_FAILED",
  "AI_TUTOR_EXECUTION_BLOCKED",
  "AI_TUTOR_EXECUTION_PLAN_INVALID",
  "AI_TUTOR_EXECUTION_CONFIGURATION_CHANGED",
  "AI_TUTOR_EXECUTION_PROVIDER_FAILED",
  "AI_TUTOR_EXECUTION_CANCELLED",
  "AI_TUTOR_EXECUTION_RESPONSE_LIMIT",
  "AI_TUTOR_EXECUTION_ACCOUNTING_FAILED",
] as const;

export type AITutorExecutionErrorCode = (typeof AI_TUTOR_EXECUTION_ERROR_CODES)[number];

export class AITutorExecutionError extends Error {
  constructor(
    readonly code: AITutorExecutionErrorCode,
    message: string,
    readonly details: Readonly<Record<string, boolean | number | string | null>> = {},
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AITutorExecutionError";
  }
}

export function isAITutorExecutionError(value: unknown): value is AITutorExecutionError {
  return value instanceof AITutorExecutionError;
}
