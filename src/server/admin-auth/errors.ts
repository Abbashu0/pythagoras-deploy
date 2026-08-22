export const ADMIN_AUTH_ERROR_CODES = [
  "ADMIN_AUTH_REQUIRED",
  "ADMIN_FORBIDDEN",
  "ADMIN_IDENTITY_CONFLICT",
  "ADMIN_INVALID_CREDENTIALS",
  "ADMIN_INVALID_INPUT",
  "ADMIN_OWNER_INVARIANT",
  "ADMIN_RATE_LIMITED",
  "ADMIN_SESSION_COLLISION",
  "ADMIN_SETUP_UNAVAILABLE",
  "ADMIN_UNTRUSTED_ORIGIN",
] as const;

export type AdminAuthErrorCode = (typeof ADMIN_AUTH_ERROR_CODES)[number];

const ADMIN_AUTH_ERROR_CODE_SET = new Set<string>(ADMIN_AUTH_ERROR_CODES);

export function isAdminAuthError(error: unknown): error is AdminAuthError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    ADMIN_AUTH_ERROR_CODE_SET.has(error.code)
  );
}

/*
 * Keep the concrete classes for domain-level handling and tests. Route boundaries
 * use the stable `code` discriminator because server bundlers may evaluate the
 * same module in separate chunks, where `instanceof` identity is not reliable.
 */

export class AdminAuthError extends Error {
  constructor(
    readonly code: AdminAuthErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}

export class AdminValidationError extends AdminAuthError {
  constructor(message: string) {
    super("ADMIN_INVALID_INPUT", message);
    this.name = "AdminValidationError";
  }
}

export class AdminSetupUnavailableError extends AdminAuthError {
  constructor(cause?: unknown) {
    super(
      "ADMIN_SETUP_UNAVAILABLE",
      "Initial owner setup is no longer available.",
      cause,
    );
    this.name = "AdminSetupUnavailableError";
  }
}

export class AdminIdentityConflictError extends AdminAuthError {
  constructor(cause?: unknown) {
    super("ADMIN_IDENTITY_CONFLICT", "The admin identity already exists.", cause);
    this.name = "AdminIdentityConflictError";
  }
}

export class InvalidAdminCredentialsError extends AdminAuthError {
  constructor() {
    super("ADMIN_INVALID_CREDENTIALS", "The supplied credentials are invalid.");
    this.name = "InvalidAdminCredentialsError";
  }
}

export class AdminAuthorizationError extends AdminAuthError {
  constructor(code: "ADMIN_AUTH_REQUIRED" | "ADMIN_FORBIDDEN") {
    super(code, code === "ADMIN_AUTH_REQUIRED" ? "Authentication is required." : "Owner access is required.");
    this.name = "AdminAuthorizationError";
  }
}

export class AdminOwnerInvariantError extends AdminAuthError {
  constructor() {
    super("ADMIN_OWNER_INVARIANT", "The only owner cannot be disabled or demoted.");
    this.name = "AdminOwnerInvariantError";
  }
}

export class AdminRateLimitError extends AdminAuthError {
  constructor(readonly retryAfterSeconds: number) {
    super("ADMIN_RATE_LIMITED", "Too many authentication attempts.");
    this.name = "AdminRateLimitError";
  }
}

export class AdminSessionCollisionError extends AdminAuthError {
  constructor(cause?: unknown) {
    super("ADMIN_SESSION_COLLISION", "A secure session could not be created.", cause);
    this.name = "AdminSessionCollisionError";
  }
}

export class AdminUntrustedOriginError extends AdminAuthError {
  constructor() {
    super("ADMIN_UNTRUSTED_ORIGIN", "The request origin is not trusted.");
    this.name = "AdminUntrustedOriginError";
  }
}
