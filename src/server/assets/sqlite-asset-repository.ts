import { and, desc, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { ContentDatabase } from "../content/database";
import { assets, type AssetRow } from "../content/schema";
import type {
  Asset,
  AssetRepository,
  CreateAssetRecord,
  ListAssetsOptions,
  UpdateAssetMetadata,
} from "./contracts";
import {
  AssetConflictError,
  AssetDuplicateError,
  AssetNotFoundError,
  AssetValidationError,
} from "./errors";
import { normalizeAssetDisplayName } from "./filename";

type Clock = () => number;

function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    originalFilename: row.originalFilename,
    displayName: row.displayName,
    mimeType: row.mimeType,
    mediaKind: row.mediaKind,
    byteSize: row.byteSize,
    sha256: row.sha256,
    storageKey: row.storageKey,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: row.revision,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  const code = String((error as Error & { code?: unknown }).code);
  return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY";
}

function normalizePagination(options: ListAssetsOptions): {
  limit: number;
  offset: number;
} {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new AssetValidationError("Asset list limit must be between 1 and 200.");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new AssetValidationError("Asset list offset must be a non-negative integer.");
  }
  return { limit, offset };
}

export class SQLiteAssetRepository implements AssetRepository {
  constructor(
    private readonly database: ContentDatabase,
    private readonly clock: Clock = Date.now,
  ) {}

  create(input: CreateAssetRecord): Asset {
    const id = input.id?.trim() || uuidv7();
    const now = this.clock();

    try {
      const row = this.database.db
        .insert(assets)
        .values({
          id,
          originalFilename: input.originalFilename,
          displayName: input.displayName,
          mimeType: input.mimeType,
          mediaKind: input.mediaKind,
          byteSize: input.byteSize,
          sha256: input.sha256,
          storageKey: input.storageKey,
          width: input.width,
          height: input.height,
          durationMs: input.durationMs,
          createdBy: input.actor.actorUserId,
          updatedBy: input.actor.actorUserId,
          createdAt: now,
          updatedAt: now,
          revision: 1,
        })
        .returning()
        .get();
      return toAsset(row);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AssetDuplicateError(input.sha256, error);
      }
      throw error;
    }
  }

  findById(id: string): Asset | null {
    const normalizedId = id.trim();
    if (!normalizedId) throw new AssetValidationError("Asset ID is required.");
    const row = this.database.db
      .select()
      .from(assets)
      .where(eq(assets.id, normalizedId))
      .get();
    return row ? toAsset(row) : null;
  }

  findBySha256(sha256: string): Asset | null {
    if (!/^[0-9a-f]{64}$/u.test(sha256)) {
      throw new AssetValidationError("Asset SHA-256 is invalid.");
    }
    const row = this.database.db
      .select()
      .from(assets)
      .where(eq(assets.sha256, sha256))
      .get();
    return row ? toAsset(row) : null;
  }

  list(options: ListAssetsOptions = {}): Asset[] {
    const { limit, offset } = normalizePagination(options);
    return this.database.db
      .select()
      .from(assets)
      .orderBy(desc(assets.createdAt), desc(assets.id))
      .limit(limit)
      .offset(offset)
      .all()
      .map(toAsset);
  }

  updateMetadata(input: UpdateAssetMetadata): Asset {
    const displayName = normalizeAssetDisplayName(input.displayName, input.displayName);
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new AssetValidationError("Expected asset revision is invalid.");
    }

    return this.database.db.transaction((transaction) => {
      const updated = transaction
        .update(assets)
        .set({
          displayName,
          updatedBy: input.actor.actorUserId,
          updatedAt: this.clock(),
          revision: sql`${assets.revision} + 1`,
        })
        .where(
          and(
            eq(assets.id, input.id),
            eq(assets.revision, input.expectedRevision),
          ),
        )
        .returning()
        .get();

      if (updated) return toAsset(updated);

      const current = transaction
        .select({ revision: assets.revision })
        .from(assets)
        .where(eq(assets.id, input.id))
        .get();
      if (!current) throw new AssetNotFoundError(input.id);
      throw new AssetConflictError(input.expectedRevision, current.revision);
    });
  }
}
