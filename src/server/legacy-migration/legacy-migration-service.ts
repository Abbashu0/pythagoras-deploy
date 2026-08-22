import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { canonicalLegacyJson } from "@/lib/admin/legacy-migration/scanner";
import {
  LEGACY_SNAPSHOT_FORMAT,
  LEGACY_SNAPSHOT_VERSION,
  LEGACY_SECTION_NAMES,
  LEGACY_STORAGE_KEYS,
  type LegacyBrowserSnapshot,
  type LegacyMigrationIssue,
} from "@/lib/admin/legacy-migration/contracts";
import { requireOwnerActor, type AdminActor } from "../admin-auth";
import type { AssetService } from "../assets";
import type { LegacyMigrationDetail, LegacyMigrationRun, StageLegacyAssetInput } from "./contracts";
import { LegacyMigrationError } from "./errors";
import { LEGACY_ORIGIN_MAX_LENGTH, LEGACY_REFERENCE_MAX_LENGTH, resolveLegacySnapshotMaximumBytes } from "./policy";
import { SQLiteLegacyMigrationRepository } from "./sqlite-legacy-migration-repository";

const ISSUE_CODES = new Set([
  "MALFORMED_JSON", "MISSING_LOCALSTORAGE_KEY", "UNKNOWN_FIELD", "INVALID_RECORD", "MISSING_IMAGE_REFERENCE",
  "ORPHAN_IMAGE", "INLINE_IMAGE_FOUND", "DUPLICATE_IMAGE_BYTES", "UNSUPPORTED_IMAGE", "INVALID_IMAGE_DATA_URL",
  "UNKNOWN_LEGACY_KEY_VERSION", "ORDER_GAP", "DUPLICATE_ORDER", "INVALID_ORDER", "DUPLICATE_RECORD_ID",
]);
const FORBIDDEN_PROPERTY = /(?:password|token|secret|cookie|session|storagekey|filesystem|filepath)/iu;

function assertNoSensitiveOrBinary(value: unknown, path = "snapshot") {
  if (typeof value === "string") {
    if (/^data:/iu.test(value) || (/data:/iu.test(value) && /;base64,/iu.test(value))) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "Binary data is not permitted in a migration snapshot.");
    if (/"(?:password|token|secret|cookie|session|storagekey|filesystem|filepath)"\s*:/iu.test(value)) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "Sensitive raw evidence is not permitted in a migration snapshot.");
    return;
  }
  if (Array.isArray(value)) return value.forEach((child, index) => assertNoSensitiveOrBinary(child, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_PROPERTY.test(key)) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", `Sensitive property is not permitted at ${path}.`);
    assertNoSensitiveOrBinary(child, `${path}.${key}`);
  }
}

function asRecords(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

export class LegacyMigrationService {
  constructor(private readonly repository: SQLiteLegacyMigrationRepository, private readonly assets: AssetService) {}

  createRun(sourceOrigin: string, actor: AdminActor): LegacyMigrationRun {
    requireOwnerActor(actor);
    let origin: URL;
    try { origin = new URL(sourceOrigin); } catch { throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "Invalid source origin."); }
    if (origin.origin !== sourceOrigin || sourceOrigin.length > LEGACY_ORIGIN_MAX_LENGTH || !["http:", "https:"].includes(origin.protocol)) {
      throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "Invalid source origin.");
    }
    const now = Date.now();
    const id = uuidv7();
    return this.repository.create({ id, createdBy: actor.actorUserId, sourceOrigin, now, eventId: uuidv7() });
  }

  list(actor: AdminActor): LegacyMigrationRun[] {
    requireOwnerActor(actor);
    return this.repository.list().map((run) => ({ ...run, snapshot: null }));
  }
  get(id: string, actor: AdminActor): LegacyMigrationDetail { requireOwnerActor(actor); return this.repository.getDetail(id) ?? this.notFound(); }

  findReadyByFingerprint(fingerprint: string, actor: AdminActor): LegacyMigrationRun | null {
    requireOwnerActor(actor);
    if (!/^[0-9a-f]{64}$/u.test(fingerprint)) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "Invalid migration fingerprint.");
    const run = this.repository.findReadyByFingerprint(fingerprint);
    return run ? { ...run, snapshot: null } : null;
  }

  resume(id: string, sourceFingerprint: string, actor: AdminActor): LegacyMigrationDetail {
    requireOwnerActor(actor);
    if (!/^[0-9a-f]{64}$/u.test(sourceFingerprint)) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "Invalid migration fingerprint.");
    const detail = this.repository.getDetail(id) ?? this.notFound();
    if (!detail.run.snapshot || detail.run.status !== "IMPORTING") {
      throw new LegacyMigrationError("LEGACY_MIGRATION_IMMUTABLE", "Only a frozen importing source can be resumed.");
    }
    if (detail.run.sourceFingerprint !== sourceFingerprint) {
      throw new LegacyMigrationError("LEGACY_MIGRATION_SOURCE_CHANGED", "The local source changed after this migration snapshot was created.");
    }
    return detail;
  }

  storeSnapshot(id: string, expectedRevision: number, snapshot: LegacyBrowserSnapshot, submittedFingerprint: string, actor: AdminActor): { run: LegacyMigrationRun; duplicateReadyRun: LegacyMigrationRun | null } {
    requireOwnerActor(actor);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !/^[0-9a-f]{64}$/u.test(submittedFingerprint)) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "Invalid migration revision or fingerprint.");
    const run = this.repository.findById(id) ?? this.notFound();
    if (run.status !== "DRAFT" || run.snapshot !== null || run.sourceFingerprint !== null) throw new LegacyMigrationError("LEGACY_MIGRATION_IMMUTABLE", "A migration source snapshot can only be stored once.");
    this.validateSnapshot(snapshot, run.sourceOrigin);
    const serialized = canonicalLegacyJson(snapshot);
    if (Buffer.byteLength(serialized, "utf8") > resolveLegacySnapshotMaximumBytes()) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "The non-binary snapshot is too large.");
    const fingerprint = this.fingerprint(snapshot);
    if (submittedFingerprint !== fingerprint) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "The source fingerprint does not match the snapshot.");
    const sections = snapshot.sections;
    const counts = [asRecords(sections.banners).length, asRecords(sections.materials).length, asRecords(sections.tools).length, asRecords(sections.navigation).length, snapshot.references.images.filter((image) => image.state === "REFERENCED").length];
    const updated = this.repository.storeSnapshot({ id, expectedRevision, fingerprint, snapshot, counts, issues: snapshot.issues, actorId: actor.actorUserId, now: Date.now(), eventId: uuidv7() });
    if (!updated) throw new LegacyMigrationError("LEGACY_MIGRATION_CONFLICT", "The migration run changed in another tab.");
    return { run: updated, duplicateReadyRun: this.repository.findReadyByFingerprint(fingerprint) };
  }

  async stageAsset(input: StageLegacyAssetInput) {
    requireOwnerActor(input.actor);
    const run = this.repository.findById(input.runId) ?? this.notFound();
    if (run.status !== "IMPORTING") throw new LegacyMigrationError("LEGACY_MIGRATION_IMMUTABLE", "Assets can only be staged while importing.");
    if (!input.legacyReference.trim() || input.legacyReference.length > LEGACY_REFERENCE_MAX_LENGTH || !["INDEXED_DB", "INLINE"].includes(input.sourceKind)) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "Invalid legacy image reference.");
    const expected = run.snapshot?.references.images.find((image) => image.legacyReference === input.legacyReference && image.sourceKind === input.sourceKind);
    if (!expected || expected.state === "MISSING_REFERENCE") throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "The image is not part of the stored snapshot.");
    if (canonicalLegacyJson(input.referenceContexts) !== canonicalLegacyJson(expected.contexts)) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "The image reference contexts do not match the stored snapshot.");
    const uploadedDigest = await this.assets.inspectStagedDigest(input.filePath);
    if ((expected.sha256 && expected.sha256 !== uploadedDigest.sha256) || (expected.byteSize && expected.byteSize !== uploadedDigest.byteSize)) throw new LegacyMigrationError("LEGACY_MIGRATION_CONFLICT", "The uploaded image bytes differ from the scanned image.");
    const ingested = await this.assets.ingest({ filePath: input.filePath, originalFilename: input.originalFilename, displayName: input.displayName }, input.actor);
    try {
      const result = this.repository.addMapping({ id: uuidv7(), runId: input.runId, expectedRevision: input.expectedRevision, legacyReference: input.legacyReference, sourceKind: input.sourceKind, assetId: ingested.asset.id, contexts: input.referenceContexts, reused: ingested.reused, actorId: input.actor.actorUserId, now: Date.now(), eventId: uuidv7() });
      if (!result) throw new LegacyMigrationError("LEGACY_MIGRATION_CONFLICT", "The migration run changed in another tab.");
      return { ...result, assetId: ingested.asset.id, reused: ingested.reused };
    } catch (error) {
      if (error instanceof Error && error.message === "DIFFERENT_MAPPING") throw new LegacyMigrationError("LEGACY_MIGRATION_CONFLICT", "This legacy reference is already mapped to different bytes.");
      throw error;
    }
  }

  finalize(id: string, expectedRevision: number, actor: AdminActor): LegacyMigrationRun {
    requireOwnerActor(actor);
    try {
      const run = this.repository.finalize({ id, expectedRevision, actorId: actor.actorUserId, now: Date.now(), eventId: uuidv7() });
      if (!run) throw new LegacyMigrationError("LEGACY_MIGRATION_CONFLICT", "The migration run changed in another tab.");
      return run;
    } catch (error) {
      if (error instanceof Error && error.message === "NOT_READY") throw new LegacyMigrationError("LEGACY_MIGRATION_NOT_READY", "Blocking issues or unmapped referenced images remain.");
      throw error;
    }
  }

  cancel(id: string, expectedRevision: number, actor: AdminActor): LegacyMigrationRun {
    requireOwnerActor(actor);
    const run = this.repository.cancel({ id, expectedRevision, actorId: actor.actorUserId, now: Date.now(), eventId: uuidv7() });
    if (!run) throw new LegacyMigrationError("LEGACY_MIGRATION_CONFLICT", "The migration run changed or is immutable.");
    return run;
  }

  private fingerprint(snapshot: LegacyBrowserSnapshot): string {
    const payload = { format: snapshot.format, version: snapshot.version, origin: snapshot.origin, sections: snapshot.sections, images: snapshot.references.images.map(({ legacyReference, sourceKind, state, sha256 }) => ({ legacyReference, sourceKind, state, sha256 })) };
    return createHash("sha256").update(canonicalLegacyJson(payload)).digest("hex");
  }

  private validateSnapshot(snapshot: LegacyBrowserSnapshot, expectedOrigin: string) {
    if (snapshot?.format !== LEGACY_SNAPSHOT_FORMAT || snapshot.version !== LEGACY_SNAPSHOT_VERSION || snapshot.origin !== expectedOrigin || !snapshot.sections || !snapshot.references || !Array.isArray(snapshot.references.images) || !Array.isArray(snapshot.evidence) || !Array.isArray(snapshot.issues)) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "Invalid legacy snapshot format.");
    const submittedKeys = snapshot.evidence.map((item) => item.key);
    if (submittedKeys.length !== LEGACY_STORAGE_KEYS.length || LEGACY_STORAGE_KEYS.some((key, index) => submittedKeys[index] !== key)) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "The snapshot key registry is incomplete or unknown.");
    const sectionNames = Object.keys(snapshot.sections).sort();
    if (sectionNames.length !== LEGACY_SECTION_NAMES.length || [...LEGACY_SECTION_NAMES].sort().some((name, index) => sectionNames[index] !== name)) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "The snapshot contains an unknown or missing legacy section.");
    if (snapshot.issues.some((issue) => !ISSUE_CODES.has(issue.code) || !["ERROR", "WARNING", "INFO"].includes(issue.severity))) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "Unknown migration issue data.");
    if (!Number.isFinite(Date.parse(snapshot.capturedAt))) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "Invalid snapshot timestamp.");
    if (snapshot.evidence.some((item) => typeof item.present !== "boolean" || !["MISSING", "JSON", "TEXT", "MALFORMED_JSON"].includes(item.parsedStatus) || (item.rawValue !== null && typeof item.rawValue !== "string"))) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "Invalid legacy evidence.");
    if (snapshot.references.images.some((image) => !image.legacyReference?.trim() || image.legacyReference.length > LEGACY_REFERENCE_MAX_LENGTH || !["INDEXED_DB", "INLINE"].includes(image.sourceKind) || !["REFERENCED", "ORPHAN", "MISSING_REFERENCE"].includes(image.state) || !Array.isArray(image.contexts) || image.contexts.some((context) => typeof context !== "string" || context.length > 1000) || (image.sha256 !== null && !/^[0-9a-f]{64}$/u.test(image.sha256)) || (image.byteSize !== null && (!Number.isSafeInteger(image.byteSize) || image.byteSize < 1)))) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "Invalid legacy image inventory.");
    const imageReferences = snapshot.references.images.map((image) => image.legacyReference);
    if (new Set(imageReferences).size !== imageReferences.length) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "Duplicate legacy image references are not permitted.");
    if (snapshot.issues.some((issue) => typeof issue.message !== "string" || !issue.message.trim() || issue.message.length > 1000)) throw new LegacyMigrationError("LEGACY_MIGRATION_INVALID", "Invalid migration issue message.");
    assertNoSensitiveOrBinary(snapshot);
  }

  private notFound(): never { throw new LegacyMigrationError("LEGACY_MIGRATION_NOT_FOUND", "Migration run not found."); }
}
