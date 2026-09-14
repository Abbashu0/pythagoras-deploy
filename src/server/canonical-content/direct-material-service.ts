import { and, asc, eq, sql } from "drizzle-orm";
import type { AdminActor } from "../admin-auth/contracts";
import { getContentDatabase, type ContentDatabase } from "../content/database";
import {
  assets,
  canonicalContentState,
  canonicalMaterialSettings,
  canonicalMaterials,
  publicationState,
} from "../content/schema";
import { CanonicalContentError } from "./errors";
import type { CanonicalMaterial, CanonicalMaterialSettings } from "./contracts";
import {
  booleanValue,
  finiteRange,
  nullableAssetId,
  normalizedText,
  semanticKey,
  integerRange,
} from "./validation";
import { SQLiteCanonicalContentRepository } from "./sqlite-canonical-content-repository";

export interface DirectMaterialUpdateInput {
  label?: unknown;
  englishTitle?: unknown;
  available?: unknown;
  assetId?: unknown;
  offsetX?: unknown;
  offsetY?: unknown;
  scale?: unknown;
}

export interface DirectMaterialSettingsUpdateInput {
  fadeIntensity?: unknown;
  textVerticalPosition?: unknown;
  textScale?: unknown;
  cardHeight?: unknown;
}

type DirectMaterialTransaction = Parameters<
  Parameters<ContentDatabase["db"]["transaction"]>[0]
>[0];

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

function expectedRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new CanonicalContentError(
      "CANONICAL_CONFLICT",
      "The material revision is stale or invalid.",
    );
  }
  return value;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export class DirectMaterialService {
  private readonly canonical: SQLiteCanonicalContentRepository;

  constructor(private readonly database: ContentDatabase) {
    this.canonical = new SQLiteCanonicalContentRepository(database);
  }

  list(): CanonicalMaterial[] {
    return this.canonical.getSnapshot().materials;
  }

  getSettings(): CanonicalMaterialSettings {
    return this.canonical.getSnapshot().materialSettings;
  }

  update(
    subjectKey: string,
    input: DirectMaterialUpdateInput,
    revision: unknown,
    actor: AdminActor,
  ): CanonicalMaterial {
    assertActor(actor);
    this.canonical.bootstrap();
    const key = semanticKey(subjectKey, "subjectKey");
    const expected = expectedRevision(revision);
    const now = Date.now();

    this.database.db.transaction((transaction) => {
      const current = transaction
        .select()
        .from(canonicalMaterials)
        .where(eq(canonicalMaterials.subjectKey, key))
        .get();
      if (!current) {
        throw new CanonicalContentError(
          "CANONICAL_NOT_FOUND",
          "The material was not found.",
        );
      }
      if (current.revision !== expected) {
        throw new CanonicalContentError(
          "CANONICAL_CONFLICT",
          "The material changed before it was saved.",
        );
      }

      const label = hasOwn(input, "label")
        ? normalizedText(input.label, "label", 1, 160)
        : current.label;
      const englishTitle = hasOwn(input, "englishTitle")
        ? normalizedText(input.englishTitle, "englishTitle", 1, 160)
        : current.englishTitle;
      const available = hasOwn(input, "available")
        ? booleanValue(input.available, "available")
        : current.available;
      const nextAssetId = hasOwn(input, "assetId")
        ? nullableAssetId(input.assetId)
        : current.assetId;
      if (nextAssetId) this.requireImageAsset(transaction, nextAssetId);
      const offsetX = hasOwn(input, "offsetX")
        ? finiteRange(input.offsetX, "offsetX", -50, 50)
        : current.offsetX;
      const offsetY = hasOwn(input, "offsetY")
        ? finiteRange(input.offsetY, "offsetY", -50, 50)
        : current.offsetY;
      const scale = hasOwn(input, "scale")
        ? finiteRange(input.scale, "scale", 0.5, 3)
        : current.scale;

      const updated = transaction
        .update(canonicalMaterials)
        .set({
          label,
          englishTitle,
          available,
          assetId: nextAssetId,
          offsetX,
          offsetY,
          scale,
          updatedAt: now,
          updatedBy: actor.actorUserId,
          revision: sql`${canonicalMaterials.revision} + 1`,
        })
        .where(
          and(
            eq(canonicalMaterials.subjectKey, key),
            eq(canonicalMaterials.revision, expected),
          ),
        )
        .returning({ id: canonicalMaterials.id })
        .get();
      if (!updated) {
        throw new CanonicalContentError(
          "CANONICAL_CONFLICT",
          "The material changed before it was saved.",
        );
      }
      this.activateCanonicalSource(transaction, actor, now);
      this.bumpContentRevision(transaction, now);
    });

    return this.requireMaterial(key);
  }

  reorder(
    ids: unknown,
    expectedRevisions: unknown,
    actor: AdminActor,
  ): CanonicalMaterial[] {
    assertActor(actor);
    this.canonical.bootstrap();
    if (!Array.isArray(ids) || !ids.length || ids.length > 100) {
      invalid("Material order is invalid.");
    }
    const orderedIds = ids.map((value) => semanticKey(value, "subjectKey"));
    if (new Set(orderedIds).size !== orderedIds.length) {
      invalid("Material order contains a duplicate subjectKey.");
    }
    if (!expectedRevisions || typeof expectedRevisions !== "object" || Array.isArray(expectedRevisions)) {
      invalid("Material revisions are required for reorder.");
    }
    const revisions = expectedRevisions as Record<string, unknown>;
    const now = Date.now();

    this.database.db.transaction((transaction) => {
      const current = transaction
        .select({
          subjectKey: canonicalMaterials.subjectKey,
          displayOrder: canonicalMaterials.displayOrder,
          revision: canonicalMaterials.revision,
        })
        .from(canonicalMaterials)
        .orderBy(asc(canonicalMaterials.displayOrder), asc(canonicalMaterials.id))
        .all();
      if (
        current.length !== orderedIds.length ||
        current.some((row) => !orderedIds.includes(row.subjectKey))
      ) {
        invalid("Material order must include every material exactly once.");
      }
      for (const row of current) {
        if (
          typeof revisions[row.subjectKey] !== "number" ||
          revisions[row.subjectKey] !== row.revision
        ) {
          throw new CanonicalContentError(
            "CANONICAL_CONFLICT",
            "A material changed before reordering.",
          );
        }
      }
      const changed = current.some((row, index) => row.subjectKey !== orderedIds[index]);
      if (!changed) return;
      for (const [index, subjectKey] of orderedIds.entries()) {
        transaction
          .update(canonicalMaterials)
          .set({
            displayOrder: index,
            updatedAt: now,
            updatedBy: actor.actorUserId,
            revision: sql`${canonicalMaterials.revision} + 1`,
          })
          .where(eq(canonicalMaterials.subjectKey, subjectKey))
          .run();
      }
      this.activateCanonicalSource(transaction, actor, now);
      this.bumpContentRevision(transaction, now);
    });

    return this.list();
  }

  updateSettings(
    input: DirectMaterialSettingsUpdateInput,
    revision: unknown,
    actor: AdminActor,
  ): CanonicalMaterialSettings {
    assertActor(actor);
    this.canonical.bootstrap();
    const expected = expectedRevision(revision);
    const current = this.getSettings();
    const fadeIntensity = hasOwn(input, "fadeIntensity")
      ? finiteRange(input.fadeIntensity, "fadeIntensity", 0, 1)
      : current.fadeIntensity;
    const textVerticalPosition = hasOwn(input, "textVerticalPosition")
      ? finiteRange(input.textVerticalPosition, "textVerticalPosition", -100, 100)
      : current.textVerticalPosition;
    const textScale = hasOwn(input, "textScale")
      ? finiteRange(input.textScale, "textScale", 0.8, 1.4)
      : current.textScale;
    const cardHeight = hasOwn(input, "cardHeight")
      ? integerRange(input.cardHeight, "cardHeight", 160, 340)
      : current.cardHeight;
    const now = Date.now();

    this.database.db.transaction((transaction) => {
      const updated = transaction
        .update(canonicalMaterialSettings)
        .set({
          fadeIntensity,
          textVerticalPosition,
          textScale,
          cardHeight,
          updatedAt: now,
          updatedBy: actor.actorUserId,
          revision: sql`${canonicalMaterialSettings.revision} + 1`,
        })
        .where(
          and(
            eq(canonicalMaterialSettings.id, "global"),
            eq(canonicalMaterialSettings.revision, expected),
          ),
        )
        .returning({ id: canonicalMaterialSettings.id })
        .get();
      if (!updated) {
        throw new CanonicalContentError(
          "CANONICAL_CONFLICT",
          "Material appearance settings changed before they were saved.",
        );
      }
      this.activateCanonicalSource(transaction, actor, now);
      this.bumpContentRevision(transaction, now);
    });

    return this.getSettings();
  }

  private requireMaterial(subjectKey: string): CanonicalMaterial {
    const material = this.list().find((item) => item.subjectKey === subjectKey);
    if (!material) {
      throw new CanonicalContentError("CANONICAL_NOT_FOUND", "The material was not found.");
    }
    return material;
  }

  private requireImageAsset(transaction: DirectMaterialTransaction, id: string): void {
    const asset = transaction
      .select({ mimeType: assets.mimeType, mediaKind: assets.mediaKind })
      .from(assets)
      .where(eq(assets.id, id))
      .get();
    if (!asset || asset.mediaKind !== "image" || !asset.mimeType.startsWith("image/")) {
      invalid("Only a validated image Asset may be attached to a material.");
    }
  }

  private activateCanonicalSource(
    transaction: DirectMaterialTransaction,
    actor: AdminActor,
    now: number,
  ): void {
    transaction
      .update(canonicalContentState)
      .set({
        runtimeSourceMode: "CANONICAL",
        updatedAt: now,
        updatedBy: actor.actorUserId,
        revision: sql`${canonicalContentState.revision} + 1`,
      })
      .where(
        and(
          eq(canonicalContentState.id, "global"),
          eq(canonicalContentState.runtimeSourceMode, "LEGACY"),
        ),
      )
      .run();
  }

  private bumpContentRevision(
    transaction: DirectMaterialTransaction,
    now: number,
  ): void {
    transaction
      .update(publicationState)
      .set({
        currentRevision: sql`${publicationState.currentRevision} + 1`,
        updatedAt: now,
      })
      .where(eq(publicationState.id, "global"))
      .run();
  }
}

let singleton: DirectMaterialService | undefined;

export function createDirectMaterialService(database: ContentDatabase): DirectMaterialService {
  return new DirectMaterialService(database);
}

export function getDirectMaterialService(): DirectMaterialService {
  singleton ??= new DirectMaterialService(getContentDatabase());
  return singleton;
}
