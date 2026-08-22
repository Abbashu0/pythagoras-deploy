import type { AdminActor } from "../admin-auth";
import type { LegacyBrowserSnapshot, LegacyImageSourceKind, LegacyMigrationIssue } from "@/lib/admin/legacy-migration/contracts";

export const LEGACY_MIGRATION_STATUSES = ["DRAFT", "IMPORTING", "READY", "FAILED", "CANCELLED", "APPLIED"] as const;
export type LegacyMigrationStatus = (typeof LEGACY_MIGRATION_STATUSES)[number];

export interface LegacyMigrationRun {
  id: string;
  createdBy: string;
  creatorDisplayName: string;
  sourceOrigin: string;
  sourceFingerprint: string | null;
  status: LegacyMigrationStatus;
  snapshot: LegacyBrowserSnapshot | null;
  snapshotVersion: number | null;
  bannerCount: number;
  materialCount: number;
  toolCount: number;
  navigationCount: number;
  imageReferenceCount: number;
  imageImportedCount: number;
  issueCount: number;
  createdAt: number;
  updatedAt: number;
  finalizedAt: number | null;
  revision: number;
}

export interface LegacyMigrationAssetMapping {
  id: string;
  runId: string;
  legacyReference: string;
  sourceKind: LegacyImageSourceKind;
  assetId: string;
  referenceContexts: string[];
  reused: boolean;
  createdAt: number;
}

export interface LegacyMigrationEvent {
  id: string;
  runId: string;
  eventType: string;
  actorUserId: string;
  createdAt: number;
  metadata: Record<string, unknown> | null;
}

export interface LegacyMigrationDetail {
  run: LegacyMigrationRun;
  assets: LegacyMigrationAssetMapping[];
  issues: (LegacyMigrationIssue & { id: string; createdAt: number })[];
  events: LegacyMigrationEvent[];
}

export interface StageLegacyAssetInput {
  runId: string;
  expectedRevision: number;
  legacyReference: string;
  sourceKind: LegacyImageSourceKind;
  referenceContexts: string[];
  filePath: string;
  originalFilename: string;
  displayName: string;
  actor: AdminActor;
}
