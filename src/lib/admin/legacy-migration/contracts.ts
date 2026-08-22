export const LEGACY_SNAPSHOT_FORMAT = "pythagoras.legacy-browser-snapshot" as const;
export const LEGACY_SNAPSHOT_VERSION = 1 as const;
export const LEGACY_INDEXED_DB_NAME = "pythagoras-images" as const;
export const LEGACY_INDEXED_DB_VERSION = 2 as const;
export const LEGACY_IMAGE_STORE = "images" as const;

export const LEGACY_STORAGE_KEYS = [
  "pythagoras-admin-banners",
  "pythagoras-admin-history",
  "pythagoras-admin-theme",
  "pythagoras-admin-carousel-settings",
  "pythagoras-admin-materials",
  "pythagoras-admin-materials-settings",
  "pythagoras-admin-materials-fade",
  "pythagoras-admin-tools",
  "pythagoras-admin-tools-settings",
  "pythagoras-admin-tools-fade",
  "pythagoras-admin-nav-items",
  "pythagoras-theme",
  "pythagoras-density",
] as const;

export const LEGACY_SECTION_NAMES = [
  "banners",
  "legacyActivityHistory",
  "adminThemePreference",
  "carouselSettings",
  "materials",
  "materialsSettings",
  "legacyMaterialsFade",
  "tools",
  "legacyToolsSettings",
  "legacyToolsFade",
  "navigation",
  "studentThemePreference",
  "studentDensityPreference",
] as const;

export type LegacyStorageKey = (typeof LEGACY_STORAGE_KEYS)[number];
export type LegacyParsedStatus = "MISSING" | "JSON" | "TEXT" | "MALFORMED_JSON";
export type LegacyIssueSeverity = "ERROR" | "WARNING" | "INFO";
export type LegacyImageSourceKind = "INDEXED_DB" | "INLINE";

export interface LegacyStorageEvidence {
  key: LegacyStorageKey;
  present: boolean;
  parsedStatus: LegacyParsedStatus;
  rawValue: string | null;
}

export interface LegacyImageReference {
  legacyReference: string;
  sourceKind: LegacyImageSourceKind;
  contexts: string[];
  state: "REFERENCED" | "ORPHAN" | "MISSING_REFERENCE";
  mimeType: string | null;
  byteSize: number | null;
  sha256: string | null;
}

export interface LegacyMigrationIssue {
  severity: LegacyIssueSeverity;
  code: string;
  section: string | null;
  legacyReference: string | null;
  message: string;
}

export interface LegacyBrowserSnapshot {
  format: typeof LEGACY_SNAPSHOT_FORMAT;
  version: typeof LEGACY_SNAPSHOT_VERSION;
  capturedAt: string;
  origin: string;
  evidence: LegacyStorageEvidence[];
  sections: Record<string, unknown>;
  references: { images: LegacyImageReference[] };
  issues: LegacyMigrationIssue[];
}

export interface LegacyImageCandidate {
  legacyReference: string;
  sourceKind: LegacyImageSourceKind;
  contexts: string[];
  state: "REFERENCED" | "ORPHAN";
  blob: Blob;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

export interface LegacyBrowserScanResult {
  snapshot: LegacyBrowserSnapshot;
  sourceFingerprint: string;
  imageCandidates: LegacyImageCandidate[];
}
