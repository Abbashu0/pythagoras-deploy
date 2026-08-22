import { and, eq, sql } from "drizzle-orm";
import type { AdminActor } from "../admin-auth/contracts";
import { normalizeAssetDisplayName } from "../assets/filename";
import type { ContentDatabase } from "../content/database";
import { assets } from "../content/schema";
import type { ChangeResourceAdapter, ChangeSnapshot, ResourceState } from "./contracts";
import { ChangeManagementError } from "./errors";
import { deriveChangedPaths, validateChangeSnapshot } from "./snapshot";

interface AssetMetadataSnapshot extends ChangeSnapshot { displayName: string }

function normalizeDisplayName(value: string, fallback: string): string {
  try {
    return normalizeAssetDisplayName(value, fallback);
  } catch (error) {
    throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "The proposed Asset display name is invalid.", error);
  }
}

function validateAssetMetadataSnapshot(snapshot: ChangeSnapshot): asserts snapshot is AssetMetadataSnapshot {
  validateChangeSnapshot(snapshot);
  const keys = Object.keys(snapshot);
  if (keys.length !== 1 || keys[0] !== "displayName" || typeof snapshot.displayName !== "string") {
    throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "Asset metadata proposals may contain only displayName.");
  }
  snapshot.displayName = normalizeDisplayName(snapshot.displayName, snapshot.displayName);
}

export class AssetMetadataChangeAdapter implements ChangeResourceAdapter {
  readonly resourceType = "asset.metadata";
  readonly areaLabel = "مكتبة المحتوى";

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    const row = database.db
      .select({ id: assets.id, displayName: assets.displayName, originalFilename: assets.originalFilename, revision: assets.revision })
      .from(assets)
      .where(eq(assets.id, resourceId))
      .get();
    if (!row) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The Asset no longer exists.");
    return { resourceId: row.id, revision: row.revision, snapshot: { displayName: row.displayName } };
  }

  captureProposal(database: ContentDatabase, resourceId: string, desired: unknown) {
    const current = this.loadCurrent(database, resourceId);
    const desiredObject = typeof desired === "object" && desired !== null ? desired as Record<string, unknown> : {};
    const proposedSnapshot: AssetMetadataSnapshot = {
      displayName: normalizeDisplayName(
        typeof desiredObject.displayName === "string" ? desiredObject.displayName : "",
        "",
      ),
    };
    this.validateSnapshot(proposedSnapshot);
    const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
    if (changedPaths.length === 0) {
      throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "The proposed Asset name is unchanged.");
    }
    return { current, proposedSnapshot, changedPaths };
  }

  validateSnapshot(snapshot: ChangeSnapshot): void {
    validateAssetMetadataSnapshot(snapshot);
  }

  describe(resourceId: string, before: ChangeSnapshot, proposed: ChangeSnapshot) {
    validateAssetMetadataSnapshot(before);
    validateAssetMetadataSnapshot(proposed);
    return {
      resourceLabel: "ملف في مكتبة المحتوى",
      resourceSubtitle: before.displayName,
      changeSummary: "تعديل اسم عرض الملف",
      areaLabel: "مكتبة المحتوى",
      fieldDiffs: [{ path: "displayName", label: "اسم العرض", before: before.displayName, after: proposed.displayName }],
    };
  }

  apply(database: ContentDatabase, resourceId: string, snapshot: ChangeSnapshot, expectedRevision: number, actor: AdminActor): ResourceState {
    validateAssetMetadataSnapshot(snapshot);
    if (actor.actorRole !== "OWNER") {
      throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only OWNER may apply a publication.");
    }
    const now = Date.now();
    const updated = database.db
      .update(assets)
      .set({
        displayName: snapshot.displayName,
        updatedBy: actor.actorUserId,
        updatedAt: now,
        revision: sql`${assets.revision} + 1`,
      })
      .where(and(eq(assets.id, resourceId), eq(assets.revision, expectedRevision)))
      .returning({ id: assets.id, displayName: assets.displayName, revision: assets.revision })
      .get();
    if (!updated) {
      throw new ChangeManagementError("CHANGE_CONFLICT", "The Asset changed before publication.");
    }
    return { resourceId: updated.id, revision: updated.revision, snapshot: { displayName: updated.displayName } };
  }
}
