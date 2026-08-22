export type LegacyMigrationErrorCode =
  | "LEGACY_MIGRATION_NOT_FOUND"
  | "LEGACY_MIGRATION_CONFLICT"
  | "LEGACY_MIGRATION_INVALID"
  | "LEGACY_MIGRATION_IMMUTABLE"
  | "LEGACY_MIGRATION_NOT_READY";

export class LegacyMigrationError extends Error {
  constructor(public readonly code: LegacyMigrationErrorCode, message: string) {
    super(message);
    this.name = "LegacyMigrationError";
  }
}

export function isLegacyMigrationError(error: unknown): error is LegacyMigrationError {
  return error instanceof LegacyMigrationError;
}
