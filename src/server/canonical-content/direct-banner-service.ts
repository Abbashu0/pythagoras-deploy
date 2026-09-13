import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { AdminActor } from "../admin-auth/contracts";
import { getContentDatabase, type ContentDatabase } from "../content/database";
import {
  assets,
  canonicalBanners,
  canonicalContentState,
  publicationState,
} from "../content/schema";
import { CanonicalContentError } from "./errors";
import { SQLiteCanonicalContentRepository } from "./sqlite-canonical-content-repository";
import type { CanonicalBanner } from "./contracts";

export interface DirectBannerCreateInput {
  title?: unknown;
  assetId?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  offsetX?: unknown;
  offsetY?: unknown;
  scale?: unknown;
  enabled?: unknown;
}

export interface DirectBannerUpdateInput {
  title?: unknown;
  assetId?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  offsetX?: unknown;
  offsetY?: unknown;
  scale?: unknown;
  enabled?: unknown;
}

type BannerVisibilityRow = {
  id: string;
  status: string;
  assetId: string | null;
  assetMimeType: string | null;
  startsAt: number | null;
  endsAt: number | null;
};

type DirectBannerTransaction = Parameters<
  Parameters<ContentDatabase["db"]["transaction"]>[0]
>[0];

const DEFAULT_FULL_GRADIENT =
  "linear-gradient(135deg, oklch(58% 0.13 230), oklch(45% 0.12 260))";

function invalid(message: string): never {
  throw new CanonicalContentError("CANONICAL_VALIDATION_FAILED", message);
}

function assertActor(actor: AdminActor): void {
  if (!actor.actorUserId?.trim() || !["OWNER", "ADMIN"].includes(actor.actorRole)) {
    throw new CanonicalContentError(
      "CANONICAL_AUTHORIZATION_FAILED",
      "A valid local Admin actor is required.",
    );
  }
}

function normalizedId(value: string): string {
  const result = value.trim();
  if (!result || result.length > 80) invalid("Banner ID is invalid.");
  return result;
}

function normalizedTitle(value: unknown, fallback = ""): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string") invalid("Banner internal name must be text.");
  const result = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (result.length > 160) invalid("Banner internal name is too long.");
  return result;
}

function normalizedAssetId(value: unknown, required: boolean): string | null {
  if (value === null || value === undefined || value === "") {
    if (required) invalid("A validated image Asset is required.");
    return null;
  }
  if (typeof value !== "string") invalid("Asset ID is invalid.");
  const result = value.trim();
  if (!result || result.length > 80) invalid("Asset ID is invalid.");
  return result;
}

function normalizedTimestamp(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    invalid(`${field} must be a non-negative epoch-millisecond integer.`);
  }
  return Number(value);
}

function normalizedOffset(value: unknown, field: string, fallback: number): number {
  const result = value === undefined ? fallback : value;
  if (typeof result !== "number" || !Number.isFinite(result) || result < -50 || result > 50) {
    invalid(`${field} must be between -50 and 50.`);
  }
  return result;
}

function normalizedScale(value: unknown, fallback: number): number {
  const result = value === undefined ? fallback : value;
  if (typeof result !== "number" || !Number.isFinite(result) || result < 0.5 || result > 3) {
    invalid("scale must be between 0.5 and 3.");
  }
  return result;
}

function normalizedEnabled(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") invalid("Banner enabled state must be boolean.");
  return value;
}

function assertSchedule(startsAt: number | null, endsAt: number | null): void {
  if (startsAt !== null && endsAt !== null && endsAt <= startsAt) {
    invalid("Banner end time must be after its start time.");
  }
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export class DirectBannerService {
  private readonly canonical: SQLiteCanonicalContentRepository;

  constructor(private readonly database: ContentDatabase) {
    this.canonical = new SQLiteCanonicalContentRepository(database);
  }

  list(): CanonicalBanner[] {
    this.ensureReady();
    return this.canonical.getSnapshot().banners;
  }

  create(input: DirectBannerCreateInput, actor: AdminActor): CanonicalBanner {
    assertActor(actor);
    this.ensureReady();
    const assetId = normalizedAssetId(input.assetId, true)!;
    const title = normalizedTitle(input.title);
    const startsAt = normalizedTimestamp(input.startsAt, "startsAt");
    const endsAt = normalizedTimestamp(input.endsAt, "endsAt");
    const offsetX = normalizedOffset(input.offsetX, "offsetX", 0);
    const offsetY = normalizedOffset(input.offsetY, "offsetY", 0);
    const scale = normalizedScale(input.scale, 1);
    const enabled = normalizedEnabled(input.enabled, true);
    assertSchedule(startsAt, endsAt);

    const id = uuidv7();
    const now = Date.now();
    this.database.db.transaction((transaction) => {
      const asset = this.requireImageAsset(transaction, assetId);
      const current = this.readVisibilityRows(transaction);
      this.assertVisibleLimit([
        ...current,
        {
          id,
          status: enabled ? "ACTIVE" : "ARCHIVED",
          assetId,
          assetMimeType: asset.mimeType,
          startsAt,
          endsAt,
        },
      ]);

      transaction
        .insert(canonicalBanners)
        .values({
          id,
          bannerType: "FULL",
          title,
          subtitle: "",
          iconKey: "image",
          gradient: DEFAULT_FULL_GRADIENT,
          assetId,
          status: enabled ? "ACTIVE" : "ARCHIVED",
          displayOrder: current.length,
          offsetX,
          offsetY,
          scale,
          startsAt,
          endsAt,
          createdAt: now,
          updatedAt: now,
          updatedBy: actor.actorUserId,
          revision: 1,
        })
        .run();
      this.normalizeOrder(transaction, actor, now);
      this.activateCanonicalSource(transaction, actor, now);
      this.bumpContentRevision(transaction, now);
    });

    return this.requireFromSnapshot(id);
  }

  update(
    id: string,
    input: DirectBannerUpdateInput,
    expectedRevision: number,
    actor: AdminActor,
  ): CanonicalBanner {
    assertActor(actor);
    this.ensureReady();
    const bannerId = normalizedId(id);
    this.assertExpectedRevision(expectedRevision);
    const now = Date.now();

    this.database.db.transaction((transaction) => {
      const current = transaction
        .select()
        .from(canonicalBanners)
        .where(eq(canonicalBanners.id, bannerId))
        .get();
      if (!current) {
        throw new CanonicalContentError("CANONICAL_NOT_FOUND", "The banner was not found.");
      }
      if (current.revision !== expectedRevision) {
        throw new CanonicalContentError("CANONICAL_CONFLICT", "The banner changed before it was saved.");
      }

      const assetId = hasOwn(input, "assetId")
        ? normalizedAssetId(input.assetId, false)
        : current.assetId;
      const asset = assetId ? this.requireImageAsset(transaction, assetId) : null;
      const startsAt = hasOwn(input, "startsAt")
        ? normalizedTimestamp(input.startsAt, "startsAt")
        : current.startsAt;
      const endsAt = hasOwn(input, "endsAt")
        ? normalizedTimestamp(input.endsAt, "endsAt")
        : current.endsAt;
      const title = hasOwn(input, "title")
        ? normalizedTitle(input.title)
        : current.title;
      const offsetX = normalizedOffset(input.offsetX, "offsetX", current.offsetX);
      const offsetY = normalizedOffset(input.offsetY, "offsetY", current.offsetY);
      const scale = normalizedScale(input.scale, current.scale);
      const enabled = normalizedEnabled(input.enabled, current.status === "ACTIVE");
      assertSchedule(startsAt, endsAt);

      this.assertVisibleLimit(
        this.readVisibilityRows(transaction).map((row) =>
          row.id === bannerId
            ? {
                ...row,
                status: enabled ? "ACTIVE" : "ARCHIVED",
                assetId,
                assetMimeType: asset?.mimeType ?? null,
                startsAt,
                endsAt,
              }
            : row,
        ),
      );

      const updated = transaction
        .update(canonicalBanners)
        .set({
          title,
          assetId,
          status: enabled ? "ACTIVE" : "ARCHIVED",
          offsetX,
          offsetY,
          scale,
          startsAt,
          endsAt,
          updatedAt: now,
          updatedBy: actor.actorUserId,
          revision: sql`${canonicalBanners.revision} + 1`,
        })
        .where(
          and(
            eq(canonicalBanners.id, bannerId),
            eq(canonicalBanners.revision, expectedRevision),
          ),
        )
        .returning({ id: canonicalBanners.id })
        .get();
      if (!updated) {
        throw new CanonicalContentError("CANONICAL_CONFLICT", "The banner changed before it was saved.");
      }
      this.activateCanonicalSource(transaction, actor, now);
      this.bumpContentRevision(transaction, now);
    });

    return this.requireFromSnapshot(bannerId);
  }

  setEnabled(
    id: string,
    enabled: boolean,
    expectedRevision: number,
    actor: AdminActor,
  ): CanonicalBanner {
    if (typeof enabled !== "boolean") invalid("Banner enabled state must be boolean.");
    return this.update(id, { enabled }, expectedRevision, actor);
  }

  reorder(
    ids: unknown,
    expectedRevisions: unknown,
    actor: AdminActor,
  ): CanonicalBanner[] {
    assertActor(actor);
    this.ensureReady();
    if (!Array.isArray(ids) || ids.length > 200) invalid("Banner order is invalid.");
    const orderedIds = ids.map((id) => {
      if (typeof id !== "string") invalid("Banner order contains an invalid ID.");
      return normalizedId(id);
    });
    if (new Set(orderedIds).size !== orderedIds.length) invalid("Banner order contains a duplicate ID.");
    if (!expectedRevisions || typeof expectedRevisions !== "object" || Array.isArray(expectedRevisions)) {
      invalid("Banner revisions are required for reorder.");
    }
    const revisions = expectedRevisions as Record<string, unknown>;
    const now = Date.now();

    this.database.db.transaction((transaction) => {
      const current = transaction
        .select({ id: canonicalBanners.id, displayOrder: canonicalBanners.displayOrder, revision: canonicalBanners.revision })
        .from(canonicalBanners)
        .orderBy(asc(canonicalBanners.displayOrder), asc(canonicalBanners.id))
        .all();
      if (current.length !== orderedIds.length || current.some((row) => !orderedIds.includes(row.id))) {
        invalid("Banner order must include every existing banner exactly once.");
      }
      for (const row of current) {
        this.assertExpectedRevision(revisions[row.id], row.revision);
      }
      const changed = current.some((row, index) => row.id !== orderedIds[index]);
      if (!changed) return;

      for (const [index, id] of orderedIds.entries()) {
        transaction
          .update(canonicalBanners)
          .set({
            displayOrder: index,
            updatedAt: now,
            updatedBy: actor.actorUserId,
            revision: sql`${canonicalBanners.revision} + 1`,
          })
          .where(eq(canonicalBanners.id, id))
          .run();
      }
      this.activateCanonicalSource(transaction, actor, now);
      this.bumpContentRevision(transaction, now);
    });

    return this.list();
  }

  delete(id: string, expectedRevision: number, actor: AdminActor): void {
    assertActor(actor);
    this.ensureReady();
    const bannerId = normalizedId(id);
    this.assertExpectedRevision(expectedRevision);
    const now = Date.now();

    this.database.db.transaction((transaction) => {
      const deleted = transaction
        .delete(canonicalBanners)
        .where(
          and(
            eq(canonicalBanners.id, bannerId),
            eq(canonicalBanners.revision, expectedRevision),
          ),
        )
        .returning({ id: canonicalBanners.id })
        .get();
      if (!deleted) {
        const current = transaction
          .select({ revision: canonicalBanners.revision })
          .from(canonicalBanners)
          .where(eq(canonicalBanners.id, bannerId))
          .get();
        if (!current) throw new CanonicalContentError("CANONICAL_NOT_FOUND", "The banner was not found.");
        throw new CanonicalContentError("CANONICAL_CONFLICT", "The banner changed before it was deleted.");
      }
      this.normalizeOrder(transaction, actor, now);
      this.activateCanonicalSource(transaction, actor, now);
      this.bumpContentRevision(transaction, now);
    });
  }

  private ensureReady(): void {
    this.canonical.bootstrap();
  }

  private requireFromSnapshot(id: string): CanonicalBanner {
    const found = this.canonical.getSnapshot().banners.find((banner) => banner.id === id);
    if (!found) throw new CanonicalContentError("CANONICAL_NOT_FOUND", "The banner was not found.");
    return found;
  }

  private requireImageAsset(transaction: DirectBannerTransaction, assetId: string) {
    const asset = transaction
      .select({ mimeType: assets.mimeType, mediaKind: assets.mediaKind })
      .from(assets)
      .where(eq(assets.id, assetId))
      .get();
    if (!asset || asset.mediaKind !== "image" || !asset.mimeType.startsWith("image/")) {
      throw new CanonicalContentError(
        "CANONICAL_VALIDATION_FAILED",
        "Only a validated image Asset may be attached to a banner.",
      );
    }
    return asset;
  }

  private readVisibilityRows(transaction: DirectBannerTransaction): BannerVisibilityRow[] {
    const rows = transaction
      .select({
        id: canonicalBanners.id,
        status: canonicalBanners.status,
        assetId: canonicalBanners.assetId,
        startsAt: canonicalBanners.startsAt,
        endsAt: canonicalBanners.endsAt,
      })
      .from(canonicalBanners)
      .orderBy(asc(canonicalBanners.displayOrder), asc(canonicalBanners.id))
      .all();
    const assetIds = rows.flatMap((row) => (row.assetId ? [row.assetId] : []));
    const assetRows = assetIds.length
      ? transaction
          .select({ id: assets.id, mimeType: assets.mimeType })
          .from(assets)
          .where(inArray(assets.id, assetIds))
          .all()
      : [];
    const mimeById = new Map(assetRows.map((row) => [row.id, row.mimeType]));
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      assetId: row.assetId,
      assetMimeType: row.assetId ? mimeById.get(row.assetId) ?? null : null,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    }));
  }

  private assertVisibleLimit(rows: BannerVisibilityRow[]): void {
    const eligible = rows.filter((row) => row.status === "ACTIVE" && row.assetId && row.assetMimeType?.startsWith("image/"));
    const timestamps = new Set<number>();
    for (const row of eligible) {
      if (row.startsAt !== null) timestamps.add(row.startsAt);
      if (row.endsAt !== null) timestamps.add(row.endsAt);
    }
    const isActiveAt = (row: BannerVisibilityRow, at: number | undefined) =>
      row.startsAt === null || (at !== undefined && row.startsAt <= at)
        ? row.endsAt === null || at === undefined || row.endsAt > at
        : false;
    const points: Array<number | undefined> = [undefined, ...[...timestamps].sort((a, b) => a - b)];
    for (const at of points) {
      const activeCount = eligible.filter((row) => isActiveAt(row, at)).length;
      if (activeCount > 5) {
        throw new CanonicalContentError(
          "CANONICAL_VALIDATION_FAILED",
          "At most five banners may be visible at the same time.",
        );
      }
    }
  }

  private normalizeOrder(transaction: DirectBannerTransaction, actor: AdminActor, now: number): void {
    const rows = transaction
      .select({ id: canonicalBanners.id, displayOrder: canonicalBanners.displayOrder })
      .from(canonicalBanners)
      .orderBy(asc(canonicalBanners.displayOrder), asc(canonicalBanners.id))
      .all();
    rows.forEach((row, index) => {
      if (row.displayOrder !== index) {
        transaction
          .update(canonicalBanners)
          .set({ displayOrder: index, updatedAt: now, updatedBy: actor.actorUserId, revision: sql`${canonicalBanners.revision} + 1` })
          .where(eq(canonicalBanners.id, row.id))
          .run();
      }
    });
  }

  private activateCanonicalSource(transaction: DirectBannerTransaction, actor: AdminActor, now: number): void {
    transaction
      .update(canonicalContentState)
      .set({ runtimeSourceMode: "CANONICAL", updatedAt: now, updatedBy: actor.actorUserId, revision: sql`${canonicalContentState.revision} + 1` })
      .where(and(eq(canonicalContentState.id, "global"), eq(canonicalContentState.runtimeSourceMode, "LEGACY")))
      .run();
  }

  private bumpContentRevision(transaction: DirectBannerTransaction, now: number): void {
    transaction
      .update(publicationState)
      .set({ currentRevision: sql`${publicationState.currentRevision} + 1`, updatedAt: now })
      .where(eq(publicationState.id, "global"))
      .run();
  }

  private assertExpectedRevision(value: unknown, expected?: number): void {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || (expected !== undefined && value !== expected)) {
      throw new CanonicalContentError("CANONICAL_CONFLICT", "The banner revision is stale or invalid.");
    }
  }
}

let singleton: DirectBannerService | undefined;

export function createDirectBannerService(database: ContentDatabase): DirectBannerService {
  return new DirectBannerService(database);
}

export function getDirectBannerService(): DirectBannerService {
  singleton ??= new DirectBannerService(
    getContentDatabase(),
  );
  return singleton;
}
