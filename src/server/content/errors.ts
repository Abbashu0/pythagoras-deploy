export type ContentFoundationErrorCode =
  | "CONTENT_CONFLICT"
  | "CONTENT_DUPLICATE"
  | "CONTENT_NOT_FOUND"
  | "CONTENT_STORAGE_UNAVAILABLE"
  | "CONTENT_VALIDATION_FAILED";

export class ContentFoundationError extends Error {
  readonly code: ContentFoundationErrorCode;
  readonly cause?: unknown;

  constructor(code: ContentFoundationErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "ContentFoundationError";
    this.code = code;
    this.cause = cause;
  }
}

export class ContentConflictError extends ContentFoundationError {
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super(
      "CONTENT_CONFLICT",
      `Content revision conflict: expected ${expectedRevision}, found ${actualRevision}.`,
    );
    this.name = "ContentConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class ContentNotFoundError extends ContentFoundationError {
  constructor(id: string) {
    super("CONTENT_NOT_FOUND", `Content resource was not found: ${id}.`);
    this.name = "ContentNotFoundError";
  }
}

export class ContentDuplicateError extends ContentFoundationError {
  constructor(resourceType: string, resourceKey: string, cause?: unknown) {
    super(
      "CONTENT_DUPLICATE",
      `Content resource already exists: ${resourceType}/${resourceKey}.`,
      cause,
    );
    this.name = "ContentDuplicateError";
  }
}
