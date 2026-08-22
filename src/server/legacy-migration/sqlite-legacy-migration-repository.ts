import type { ContentDatabase } from "../content";
import type { LegacyMigrationAssetMapping, LegacyMigrationDetail, LegacyMigrationEvent, LegacyMigrationRun, LegacyMigrationStatus } from "./contracts";
import type { LegacyBrowserSnapshot, LegacyMigrationIssue } from "@/lib/admin/legacy-migration/contracts";

type RunRow = {
  id: string; created_by: string; creator_display_name: string; source_origin: string; source_fingerprint: string | null;
  status: LegacyMigrationStatus; snapshot: string | null; snapshot_version: number | null; banner_count: number; material_count: number;
  tool_count: number; navigation_count: number; image_reference_count: number; image_imported_count: number; issue_count: number;
  created_at: number; updated_at: number; finalized_at: number | null; revision: number;
};

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function mapRun(row: RunRow): LegacyMigrationRun {
  return {
    id: row.id, createdBy: row.created_by, creatorDisplayName: row.creator_display_name, sourceOrigin: row.source_origin,
    sourceFingerprint: row.source_fingerprint, status: row.status, snapshot: parseJson<LegacyBrowserSnapshot | null>(row.snapshot, null),
    snapshotVersion: row.snapshot_version, bannerCount: row.banner_count, materialCount: row.material_count, toolCount: row.tool_count,
    navigationCount: row.navigation_count, imageReferenceCount: row.image_reference_count, imageImportedCount: row.image_imported_count,
    issueCount: row.issue_count, createdAt: row.created_at, updatedAt: row.updated_at, finalizedAt: row.finalized_at, revision: row.revision,
  };
}

const RUN_SELECT = `select r.*, u.display_name as creator_display_name from legacy_migration_runs r join admin_users u on u.id = r.created_by`;

export class SQLiteLegacyMigrationRepository {
  constructor(private readonly database: ContentDatabase) {}

  create(input: { id: string; createdBy: string; sourceOrigin: string; now: number; eventId: string }): LegacyMigrationRun {
    this.database.client.transaction(() => {
      this.database.client.prepare(`insert into legacy_migration_runs (id,created_by,source_origin,status,created_at,updated_at,revision) values (?,?,?,'DRAFT',?,?,1)`).run(input.id, input.createdBy, input.sourceOrigin, input.now, input.now);
      this.addEvent(input.eventId, input.id, "RUN_CREATED", input.createdBy, input.now, null);
    })();
    return this.findById(input.id)!;
  }

  list(limit = 30): LegacyMigrationRun[] {
    return (this.database.client.prepare(`${RUN_SELECT} order by r.created_at desc limit ?`).all(limit) as RunRow[]).map(mapRun);
  }

  findById(id: string): LegacyMigrationRun | null {
    const row = this.database.client.prepare(`${RUN_SELECT} where r.id = ?`).get(id) as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  findReadyByFingerprint(fingerprint: string): LegacyMigrationRun | null {
    const row = this.database.client.prepare(`${RUN_SELECT} where r.source_fingerprint = ? and r.status = 'READY' order by r.finalized_at desc limit 1`).get(fingerprint) as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  storeSnapshot(input: { id: string; expectedRevision: number; fingerprint: string; snapshot: LegacyBrowserSnapshot; counts: number[]; issues: LegacyMigrationIssue[]; actorId: string; now: number; eventId: string }): LegacyMigrationRun | null {
    const transaction = this.database.client.transaction(() => {
      const result = this.database.client.prepare(`update legacy_migration_runs set source_fingerprint=?,snapshot=?,snapshot_version=1,status='IMPORTING',banner_count=?,material_count=?,tool_count=?,navigation_count=?,image_reference_count=?,issue_count=?,updated_at=?,revision=revision+1 where id=? and revision=? and status='DRAFT' and snapshot is null and source_fingerprint is null`).run(
        input.fingerprint, JSON.stringify(input.snapshot), ...input.counts, input.issues.length, input.now, input.id, input.expectedRevision,
      );
      if (result.changes !== 1) return false;
      this.database.client.prepare(`delete from legacy_migration_issues where run_id=?`).run(input.id);
      const insertIssue = this.database.client.prepare(`insert into legacy_migration_issues (id,run_id,severity,code,section,legacy_reference,message,created_at) values (?,?,?,?,?,?,?,?)`);
      for (const [index, issue] of input.issues.entries()) {
        insertIssue.run(`${input.eventId}-issue-${index}`, input.id, issue.severity, issue.code, issue.section, issue.legacyReference, issue.message, input.now);
        this.addEvent(`${input.eventId}-issue-event-${index}`, input.id, "ISSUE_RECORDED", input.actorId, input.now, { code: issue.code, severity: issue.severity });
      }
      this.addEvent(input.eventId, input.id, "SNAPSHOT_STORED", input.actorId, input.now, { fingerprint: input.fingerprint });
      return true;
    });
    return transaction() ? this.findById(input.id) : null;
  }

  addMapping(input: { id: string; runId: string; expectedRevision: number; legacyReference: string; sourceKind: string; assetId: string; contexts: string[]; reused: boolean; actorId: string; now: number; eventId: string }): { run: LegacyMigrationRun; mapping: LegacyMigrationAssetMapping } | null {
    const transaction = this.database.client.transaction(() => {
      const existing = this.database.client.prepare(`select * from legacy_migration_assets where run_id=? and legacy_reference=?`).get(input.runId, input.legacyReference) as Record<string, unknown> | undefined;
      if (existing) {
        const sameContexts = JSON.stringify(parseJson<string[]>(String(existing.reference_contexts), [])) === JSON.stringify(input.contexts);
        if (existing.asset_id !== input.assetId || existing.source_kind !== input.sourceKind || !sameContexts) return "DIFFERENT" as const;
        return "IDEMPOTENT" as const;
      }
      // Mapping rows are independently unique and immutable. Keeping the run
      // revision stable lets bounded parallel uploads commit without creating
      // expected 409 noise; snapshot/finalize/cancel still rotate the run
      // revision and therefore invalidate stale upload batches.
      const updated = this.database.client.prepare(`update legacy_migration_runs set image_imported_count=image_imported_count+1,updated_at=? where id=? and revision=? and status='IMPORTING'`).run(input.now, input.runId, input.expectedRevision);
      if (updated.changes !== 1) return "CONFLICT" as const;
      this.database.client.prepare(`insert into legacy_migration_assets (id,run_id,legacy_reference,source_kind,asset_id,reference_contexts,reused,created_at) values (?,?,?,?,?,?,?,?)`).run(input.id, input.runId, input.legacyReference, input.sourceKind, input.assetId, JSON.stringify(input.contexts), input.reused ? 1 : 0, input.now);
      this.addEvent(input.eventId, input.runId, input.reused ? "IMAGE_REUSED" : "IMAGE_IMPORTED", input.actorId, input.now, { legacyReference: input.legacyReference, assetId: input.assetId });
      return "CREATED" as const;
    });
    const result = transaction();
    if (result === "CONFLICT") return null;
    if (result === "DIFFERENT") throw new Error("DIFFERENT_MAPPING");
    const detail = this.getDetail(input.runId)!;
    const mapping = detail.assets.find((item) => item.legacyReference === input.legacyReference)!;
    return { run: detail.run, mapping };
  }

  finalize(input: { id: string; expectedRevision: number; actorId: string; now: number; eventId: string }): LegacyMigrationRun | null {
    const transaction = this.database.client.transaction(() => {
      const blockers = this.database.client.prepare(`select count(*) as count from legacy_migration_issues where run_id=? and severity='ERROR'`).get(input.id) as { count: number };
      const run = this.findById(input.id);
      const mappings = this.getDetail(input.id)?.assets ?? [];
      const inventory = new Map(run?.snapshot?.references.images.map((image) => [image.legacyReference, image]) ?? []);
      const mappedReferences = new Set(mappings.map((mapping) => mapping.legacyReference));
      const hasUnmappedReference = run?.snapshot?.references.images.some((image) => image.state === "REFERENCED" && !mappedReferences.has(image.legacyReference)) ?? true;
      const hasStaleMapping = mappings.some((mapping) => {
        const expected = inventory.get(mapping.legacyReference);
        return !expected || expected.sourceKind !== mapping.sourceKind || JSON.stringify(expected.contexts) !== JSON.stringify(mapping.referenceContexts);
      });
      if (!run || !run.snapshot || blockers.count > 0 || hasUnmappedReference || hasStaleMapping) return "NOT_READY" as const;
      const result = this.database.client.prepare(`update legacy_migration_runs set status='READY',finalized_at=?,updated_at=?,revision=revision+1 where id=? and revision=? and status='IMPORTING'`).run(input.now, input.now, input.id, input.expectedRevision);
      if (result.changes !== 1) return "CONFLICT" as const;
      this.addEvent(input.eventId, input.id, "FINALIZED_READY", input.actorId, input.now, null);
      return "OK" as const;
    });
    const result = transaction();
    if (result === "NOT_READY") throw new Error("NOT_READY");
    return result === "OK" ? this.findById(input.id) : null;
  }

  cancel(input: { id: string; expectedRevision: number; actorId: string; now: number; eventId: string }): LegacyMigrationRun | null {
    const transaction = this.database.client.transaction(() => {
      const result = this.database.client.prepare(`update legacy_migration_runs set status='CANCELLED',updated_at=?,revision=revision+1 where id=? and revision=? and status in ('DRAFT','IMPORTING','FAILED')`).run(input.now, input.id, input.expectedRevision);
      if (result.changes !== 1) return false;
      this.addEvent(input.eventId, input.id, "CANCELLED", input.actorId, input.now, null);
      return true;
    });
    return transaction() ? this.findById(input.id) : null;
  }

  getDetail(id: string): LegacyMigrationDetail | null {
    const run = this.findById(id);
    if (!run) return null;
    const assets = (this.database.client.prepare(`select * from legacy_migration_assets where run_id=? order by created_at,id`).all(id) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), runId: String(row.run_id), legacyReference: String(row.legacy_reference), sourceKind: row.source_kind as "INDEXED_DB" | "INLINE", assetId: String(row.asset_id), referenceContexts: parseJson<string[]>(String(row.reference_contexts), []), reused: Boolean(row.reused), createdAt: Number(row.created_at) }));
    const issues = (this.database.client.prepare(`select * from legacy_migration_issues where run_id=? order by created_at,id`).all(id) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), severity: row.severity as "ERROR" | "WARNING" | "INFO", code: String(row.code), section: row.section === null ? null : String(row.section), legacyReference: row.legacy_reference === null ? null : String(row.legacy_reference), message: String(row.message), createdAt: Number(row.created_at) }));
    const events = (this.database.client.prepare(`select * from legacy_migration_events where run_id=? order by created_at,id`).all(id) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), runId: String(row.run_id), eventType: String(row.event_type), actorUserId: String(row.actor_user_id), createdAt: Number(row.created_at), metadata: parseJson<Record<string, unknown> | null>(row.metadata === null ? null : String(row.metadata), null) }));
    return { run, assets, issues, events };
  }

  addEvent(id: string, runId: string, eventType: string, actorId: string, now: number, metadata: Record<string, unknown> | null) {
    this.database.client.prepare(`insert into legacy_migration_events (id,run_id,event_type,actor_user_id,created_at,metadata) values (?,?,?,?,?,?)`).run(id, runId, eventType, actorId, now, metadata ? JSON.stringify(metadata) : null);
  }
}
