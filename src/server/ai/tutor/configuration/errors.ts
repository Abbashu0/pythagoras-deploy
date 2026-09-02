export const AI_TUTOR_CONFIG_ERROR_CODES = [
  "AI_TUTOR_CONFIG_INVALID",
  "AI_TUTOR_CONFIG_NOT_FOUND",
  "AI_TUTOR_CONFIG_CONFLICT",
  "AI_TUTOR_CONFIG_SUBJECT_MISMATCH",
  "AI_TUTOR_CONFIG_DEPENDENCY_INVALID",
] as const;
export type AITutorConfigErrorCode = (typeof AI_TUTOR_CONFIG_ERROR_CODES)[number];

export class AITutorConfigError extends Error {
  constructor(
    readonly code: AITutorConfigErrorCode,
    message: string,
    readonly details: Readonly<Record<string, boolean | number | string | null>> = {},
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AITutorConfigError";
  }
}

export function isAITutorConfigError(value: unknown): value is AITutorConfigError {
  return value instanceof AITutorConfigError;
}
