export const AI_EVAL_ERROR_CODES = [
  "AI_EVAL_INVALID",
  "AI_EVAL_NOT_FOUND",
  "AI_EVAL_CONFLICT",
  "AI_EVAL_GOVERNANCE_INVALID",
  "AI_EVAL_CASE_NOT_IN_SUITE",
  "AI_EVAL_CASE_REVISION_MISMATCH",
  "AI_EVAL_DUPLICATE_RESULT",
  "AI_EVAL_RUN_INVALID",
  "AI_EVAL_RUN_NOT_SCORABLE",
  "AI_EVAL_BASELINE_NOT_COMPARABLE",
  "AI_EVAL_GRADER_UNSUPPORTED",
  "AI_EVAL_GATE_BLOCKED",
] as const;
export type AIEvalErrorCode = (typeof AI_EVAL_ERROR_CODES)[number];

export class AIEvalError extends Error {
  constructor(
    readonly code: AIEvalErrorCode,
    message: string,
    readonly details: Readonly<Record<string, boolean | number | string | null>> = {},
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIEvalError";
  }
}

export function isAIEvalError(value: unknown): value is AIEvalError {
  return value instanceof AIEvalError;
}
