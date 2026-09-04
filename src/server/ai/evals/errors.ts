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
  "AI_EVAL_EXECUTION_CONFIG_INVALID",
  "AI_EVAL_EXECUTION_CONFIG_CONFLICT",
  "AI_EVAL_TARGET_INVALID",
  "AI_EVAL_TARGET_NOT_READY",
  "AI_EVAL_TARGET_STALE",
  "AI_EVAL_TARGET_AMBIGUOUS",
  "AI_EVAL_TARGET_CONCURRENCY_LIMITED",
  "AI_EVAL_TARGET_ADMISSION_RETRYABLE",
  "AI_EVAL_JUDGE_CONFIG_INVALID",
  "AI_EVAL_JUDGE_CONFIG_CONFLICT",
  "AI_EVAL_JUDGE_UNSUPPORTED",
  "AI_EVAL_JUDGE_SECURITY_FORBIDDEN",
  "AI_EVAL_JUDGE_INVALID",
  "AI_EVAL_JUDGE_STALE",
  "AI_EVAL_JUDGE_AMBIGUOUS",
  "AI_EVAL_JUDGE_COST_UNKNOWN",
  "AI_EVAL_JUDGE_OUTPUT_INVALID",
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
