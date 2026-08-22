import { AdminValidationError } from "./errors";
import {
  ADMIN_DISPLAY_NAME_MAX_LENGTH,
  ADMIN_EMAIL_MAX_LENGTH,
  ADMIN_PASSWORD_MAX_LENGTH,
  ADMIN_PASSWORD_MIN_LENGTH,
} from "@/lib/admin-auth-policy";

export {
  ADMIN_DISPLAY_NAME_MAX_LENGTH,
  ADMIN_EMAIL_MAX_LENGTH,
  ADMIN_PASSWORD_MAX_LENGTH,
  ADMIN_PASSWORD_MIN_LENGTH,
} from "@/lib/admin-auth-policy";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function normalizeAdminEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new AdminValidationError("Email must be a string.");
  }

  const email = value.normalize("NFKC").trim().toLowerCase();
  if (!email || email.length > ADMIN_EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new AdminValidationError("Enter a valid email address.");
  }
  return email;
}

export function tryNormalizeAdminEmail(value: unknown): string | null {
  try {
    return normalizeAdminEmail(value);
  } catch {
    return null;
  }
}

export function normalizeAdminDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw new AdminValidationError("Display name must be a string.");
  }

  const displayName = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const length = Array.from(displayName).length;
  if (length < 2 || length > ADMIN_DISPLAY_NAME_MAX_LENGTH) {
    throw new AdminValidationError("Display name must contain between 2 and 100 characters.");
  }
  return displayName;
}

export function validateNewAdminPassword(value: unknown): string {
  if (typeof value !== "string") {
    throw new AdminValidationError("Password must be a string.");
  }

  const length = Array.from(value).length;
  if (length < ADMIN_PASSWORD_MIN_LENGTH || length > ADMIN_PASSWORD_MAX_LENGTH) {
    throw new AdminValidationError(
      `Password must contain between ${ADMIN_PASSWORD_MIN_LENGTH} and ${ADMIN_PASSWORD_MAX_LENGTH} characters.`,
    );
  }
  return value;
}

export function isAcceptableLoginPassword(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const length = Array.from(value).length;
  return length > 0 && length <= ADMIN_PASSWORD_MAX_LENGTH;
}
