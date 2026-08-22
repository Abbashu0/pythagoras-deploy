export const ASSET_ERROR_CODES = [
  "ASSET_CONFLICT",
  "ASSET_DUPLICATE",
  "ASSET_INTEGRITY_FAILED",
  "ASSET_NOT_FOUND",
  "ASSET_STORAGE_UNAVAILABLE",
  "ASSET_TOO_LARGE",
  "ASSET_UNSUPPORTED_TYPE",
  "ASSET_UPLOAD_INVALID",
  "ASSET_VALIDATION_FAILED",
] as const;

export type AssetErrorCode = (typeof ASSET_ERROR_CODES)[number];

const ASSET_ERROR_CODE_SET = new Set<string>(ASSET_ERROR_CODES);

export function isAssetError(error: unknown): error is AssetError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    ASSET_ERROR_CODE_SET.has(error.code)
  );
}

export class AssetError extends Error {
  constructor(
    readonly code: AssetErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AssetError";
  }
}

export class AssetValidationError extends AssetError {
  constructor(message = "The asset input is invalid.", cause?: unknown) {
    super("ASSET_VALIDATION_FAILED", message, cause);
    this.name = "AssetValidationError";
  }
}

export class AssetUploadError extends AssetError {
  constructor(message = "The asset upload is invalid.", cause?: unknown) {
    super("ASSET_UPLOAD_INVALID", message, cause);
    this.name = "AssetUploadError";
  }
}

export class AssetTooLargeError extends AssetError {
  constructor(readonly maximumBytes: number) {
    super("ASSET_TOO_LARGE", `The asset exceeds the ${maximumBytes} byte limit.`);
    this.name = "AssetTooLargeError";
  }
}

export class AssetUnsupportedTypeError extends AssetError {
  constructor() {
    super("ASSET_UNSUPPORTED_TYPE", "This file type is not accepted as asset data.");
    this.name = "AssetUnsupportedTypeError";
  }
}

export class AssetNotFoundError extends AssetError {
  constructor(id: string) {
    super("ASSET_NOT_FOUND", `Asset was not found: ${id}.`);
    this.name = "AssetNotFoundError";
  }
}

export class AssetConflictError extends AssetError {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      "ASSET_CONFLICT",
      `Asset revision conflict: expected ${expectedRevision}, found ${actualRevision}.`,
    );
    this.name = "AssetConflictError";
  }
}

export class AssetDuplicateError extends AssetError {
  constructor(readonly sha256: string, cause?: unknown) {
    super("ASSET_DUPLICATE", "An asset already exists for these bytes.", cause);
    this.name = "AssetDuplicateError";
  }
}

export class AssetStorageError extends AssetError {
  constructor(message = "The local asset object store is unavailable.", cause?: unknown) {
    super("ASSET_STORAGE_UNAVAILABLE", message, cause);
    this.name = "AssetStorageError";
  }
}

export class AssetIntegrityError extends AssetError {
  constructor(readonly assetId: string, cause?: unknown) {
    super("ASSET_INTEGRITY_FAILED", "The asset binary failed integrity verification.", cause);
    this.name = "AssetIntegrityError";
  }
}
