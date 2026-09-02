export const AI_TUTOR_PLANNING_ERROR_CODES = [
  "AI_TUTOR_EVIDENCE_INVALID",
  "AI_TUTOR_EVIDENCE_CONTEXT_BUDGET_INSUFFICIENT",
  "AI_TUTOR_GENERATION_LIMIT_EXCEEDED",
  "AI_TUTOR_CONTEXT_LIMIT_EXCEEDED",
  "AI_TUTOR_PLAN_INVALID",
] as const;
export type AITutorPlanningErrorCode = (typeof AI_TUTOR_PLANNING_ERROR_CODES)[number];

export class AITutorPlanningError extends Error {
  constructor(
    readonly code: AITutorPlanningErrorCode,
    message: string,
    readonly details: Readonly<Record<string, boolean | number | string | null>> = {},
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AITutorPlanningError";
  }
}

export function isAITutorPlanningError(value: unknown): value is AITutorPlanningError {
  return value instanceof AITutorPlanningError;
}
