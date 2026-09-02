export const AI_TUTOR_PREFLIGHT_ERROR_CODES = [
  "AI_TUTOR_PRINCIPAL_INACTIVE",
  "AI_TUTOR_CONFIG_NOT_FOUND",
  "AI_TUTOR_CONFIG_INVALID",
  "AI_TUTOR_RESPONSE_INVALID",
  "AI_TUTOR_CONVERSATION_INVALID",
  "AI_TUTOR_CONTEXT_INVALID",
  "AI_TUTOR_RETRIEVAL_CONFIG_INVALID",
  "AI_TUTOR_MODEL_INVALID",
  "AI_TUTOR_PROVIDER_INVALID",
  "AI_TUTOR_COST_INVALID",
  "AI_TUTOR_COST_CURRENCY_MISMATCH",
  "AI_TUTOR_PLAN_INVALID",
] as const;
export type AITutorPreflightErrorCode = (typeof AI_TUTOR_PREFLIGHT_ERROR_CODES)[number];

export class AITutorPreflightError extends Error {
  constructor(
    readonly code: AITutorPreflightErrorCode,
    message: string,
    readonly details: Readonly<Record<string, boolean | number | string | null>> = {},
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AITutorPreflightError";
  }
}

export function isAITutorPreflightError(value: unknown): value is AITutorPreflightError {
  return value instanceof AITutorPreflightError;
}
