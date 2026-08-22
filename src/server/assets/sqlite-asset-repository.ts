import { and, asc, count, desc, eq, getTableColumns, sql, type SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { ContentDatabase } from "../content/database";
import { adminUsers, assets, type AssetRow } from "../content/schema";
import type {
  Asset,
  AssetInventoryStats,
  AssetMediaKind,
  AssetPage,
  AssetRepository,
  AssetSort,
  AssetWithCreator,
  BrowseAssetsOptions,
  CreateAssetRecord,
  ListAssetsOptions,
  UpdateAssetMetadata,
} from "./contracts";
import { ASSET_MEDIA_KINDS, ASSET_SORT_OPTIONS } from "./contracts";
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

function normalizeBrowseOptions(options: BrowseAssetsOptions): {
  limit: number;
  offset: number;
  query: string;
  mediaKind?: AssetMediaKind;
  sort: AssetSort;
} {
  const { limit, offset } = normalizePagination(options);
  const query = options.query?.normalize("NFKC").trim() ?? "";
  if (query.length > 200) {
    throw new AssetValidationError("Asset search query is too long.");
  }
  if (
    options.mediaKind !== undefined &&
    !ASSET_MEDIA_KINDS.includes(options.mediaKind)
  ) {
    throw new AssetValidationError("Asset media kind is invalid.");
  }
  const sort = options.sort ?? "newest";
  if (!ASSET_SORT_OPTIONS.includes(sort)) {
    throw new AssetValidationError("Asset sort is invalid.");
  }
  return { limit, offset, query, mediaKind: options.mediaKind, sort };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, "\\$&");
}

function browseCondition(query: string, mediaKind?: AssetMediaKind): SQL | undefined {
  const conditions: SQL[] = [];
  if (query) {
    const pattern = `%${escapeLike(query)}%`;
    conditions.push(
      sql`(${assets.displayName} like ${pattern} escape '\\' or ${assets.originalFilename} like ${pattern} escape '\\')`,
    );
  }
  if (mediaKind) conditions.push(eq(assets.mediaKind, mediaKind));
  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : and(...conditions);
}

function browseOrder(sort: AssetSort): SQL[] {
  switch (sort) {
    case "oldest":
      return [asc(assets.createdAt), asc(assets.id)];
    case "name":
      return [asc(assets.displayName), asc(assets.id)];
    case "size":
      return [desc(assets.byteSize), desc(assets.id)];
    case "newest":
      return [desc(assets.createdAt), desc(assets.id)];
  }
}

const assetWithCreatorSelection = {
  ...getTableColumns(assets),
  creatorId: adminUsers.id,
  creatorDisplayName: adminUsers.displayName,
};

function toAssetWithCreator(
  row: AssetRow & { creatorId: string; creatorDisplayName: string },
): AssetWithCreator {
  return {
    asset: toAsset(row),
    creator: { id: row.creatorId, displayName: row.creatorDisplayName },
  };
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

  findByIdWithCreator(id: string): AssetWithCreator | null {
    const normalizedId = id.trim();
    if (!normalizedId) throw new AssetValidationError("Asset ID is required.");
    const row = this.database.db
      .select(assetWithCreatorSelection)
      .from(assets)
      .innerJoin(adminUsers, eq(assets.createdBy, adminUsers.id))
      .where(eq(assets.id, normalizedId))
      .get();
    return row ? toAssetWithCreator(row) : null;
  }

  browse(options: BrowseAssetsOptions = {}): AssetPage {
    const { limit, offset, query, mediaKind, sort } = normalizeBrowseOptions(options);
    const condition = browseCondition(query, mediaKind);
    const totalRow = this.database.db
      .select({ value: count() })
      .from(assets)
      .where(condition)
      .get();
    const rows = this.database.db
      .select(assetWithCreatorSelection)
      .from(assets)
      .innerJoin(adminUsers, eq(assets.createdBy, adminUsers.id))
      .where(condition)
      .orderBy(...browseOrder(sort))
      .limit(limit)
      .offset(offset)
      .all();
    return {
      items: rows.map(toAssetWithCreator),
      total: Number(totalRow?.value ?? 0),
      limit,
      offset,
    };
  }

  getInventoryStats(): AssetInventoryStats {
    const row = this.database.db
      .select({
        totalCount: count(),
        totalBytes: sql<number>`coalesce(sum(${assets.byteSize}), 0)`,
        image: sql<number>`sum(case when ${assets.mediaKind} = 'image' then 1 else 0 end)`,
        video: sql<number>`sum(case when ${assets.mediaKind} = 'video' then 1 else 0 end)`,
        audio: sql<number>`sum(case when ${assets.mediaKind} = 'audio' then 1 else 0 end)`,
        document: sql<number>`sum(case when ${assets.mediaKind} = 'document' then 1 else 0 end)`,
        json: sql<number>`sum(case when ${assets.mediaKind} = 'json' then 1 else 0 end)`,
        other: sql<number>`sum(case when ${assets.mediaKind} = 'other-safe-file' then 1 else 0 end)`,
      })
      .from(assets)
      .get();
    return {
      totalCount: Number(row?.totalCount ?? 0),
      totalBytes: Number(row?.totalBytes ?? 0),
      byMediaKind: {
        image: Number(row?.image ?? 0),
        video: Number(row?.video ?? 0),
        audio: Number(row?.audio ?? 0),
        document: Number(row?.document ?? 0),
        json: Number(row?.json ?? 0),
        "other-safe-file": Number(row?.other ?? 0),
      },
    };
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
