export type MaterialQuestionBankErrorCode =
  | "MATERIAL_BANK_INVALID"
  | "MATERIAL_BANK_NOT_FOUND"
  | "MATERIAL_BANK_CONFLICT"
  | "MATERIAL_BANK_UNAVAILABLE";

export class MaterialQuestionBankError extends Error {
  constructor(readonly code: MaterialQuestionBankErrorCode, message: string, readonly cause?: unknown) {
    super(message);
    this.name = "MaterialQuestionBankError";
  }
}

export function isMaterialQuestionBankError(error: unknown): error is MaterialQuestionBankError {
  return error instanceof MaterialQuestionBankError;
}
