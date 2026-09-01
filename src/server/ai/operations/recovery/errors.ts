export const AI_RECOVERY_ERROR_CODES = ["AI_RECOVERY_INVALID"] as const;
export type AIRecoveryErrorCode = (typeof AI_RECOVERY_ERROR_CODES)[number];

export class AIRecoveryError extends Error {
  constructor(readonly code: AIRecoveryErrorCode, message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AIRecoveryError";
  }
}
