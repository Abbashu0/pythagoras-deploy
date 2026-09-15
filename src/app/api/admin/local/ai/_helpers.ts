import { AdminValidationError } from "@/server/admin-auth";

export function assertFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(body).some((key) => !allowedSet.has(key))) {
    throw new AdminValidationError("AI Admin request contains unsupported fields.");
  }
}

export function requiredText(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new AdminValidationError(`${field} is required.`);
  }
  return value;
}

export function requiredRevision(body: Record<string, unknown>): number {
  const value = body.expectedRevision;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new AdminValidationError("A valid expected revision is required.");
  }
  return value as number;
}

export function requiredNumber(
  body: Record<string, unknown>,
  field: string,
): number {
  const value = body[field];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new AdminValidationError(`${field} must be a positive integer.`);
  }
  return value as number;
}
