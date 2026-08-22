export const CHANGE_MANAGEMENT_ERROR_CODES = [
  "CHANGE_AUTHORIZATION_FAILED",
  "CHANGE_CONFLICT",
  "CHANGE_INVALID_STATE",
  "CHANGE_NOT_FOUND",
  "CHANGE_VALIDATION_FAILED",
  "CHANGE_RESOURCE_UNSUPPORTED",
  "CHANGE_PUBLICATION_FAILED",
] as const;

export type ChangeManagementErrorCode = (typeof CHANGE_MANAGEMENT_ERROR_CODES)[number];

export class ChangeManagementError extends Error {
  constructor(readonly code: ChangeManagementErrorCode, message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ChangeManagementError";
  }
}

export function isChangeManagementError(error: unknown): error is ChangeManagementError {
  return error instanceof ChangeManagementError || (
    typeof error === "object" && error !== null && "code" in error &&
    CHANGE_MANAGEMENT_ERROR_CODES.includes(String(error.code) as ChangeManagementErrorCode)
  );
}
