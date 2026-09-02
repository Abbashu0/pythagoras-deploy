export const AI_POLICY_ERROR_CODES = [
  "AI_POLICY_NOT_FOUND",
  "AI_POLICY_INVALID",
  "AI_POLICY_DISABLED",
  "AI_POLICY_SCOPE_CONFLICT",
  "AI_POLICY_SUBJECT_MISMATCH",
  "AI_POLICY_CONFLICT",
] as const;
export type AIPolicyErrorCode = (typeof AI_POLICY_ERROR_CODES)[number];

export class AIPolicyError extends Error {
  constructor(
    readonly code: AIPolicyErrorCode,
    message: string,
    readonly details: Readonly<Record<string, boolean | number | string | null>> = {},
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIPolicyError";
  }
}
