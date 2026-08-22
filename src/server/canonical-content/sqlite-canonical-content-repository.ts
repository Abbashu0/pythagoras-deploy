import { asc, eq, inArray, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { AdminActor } from "../admin-auth/contracts";
import type { ContentDatabase } from "../content/database";
import {
  assets,
  canonicalBanners,
  canonicalCarouselSettings,
  canonicalContentState,
  canonicalMaterials,
  canonicalMaterialSettings,
  canonicalNavigation,
  canonicalTools,
  publicationState,
  type AssetRow,
  type CanonicalBannerRow,
  type CanonicalMaterialRow,
} from "../content/schema";
import {
  CANONICAL_BANNER_DEFAULTS,
  CANONICAL_BOOTSTRAP_VERSION,
  CANONICAL_CAROUSEL_SETTINGS_DEFAULT,
  CANONICAL_MATERIAL_DEFAULTS,
  CANONICAL_MATERIAL_SETTINGS_DEFAULT,
  CANONICAL_NAVIGATION_DEFAULTS,
  CANONICAL_TOOL_DEFAULTS,
} from "./defaults";
import type {
  CanonicalAssetReference,
  CanonicalAssetUsage,
  CanonicalBanner,
  CanonicalContentRepository,
  CanonicalContentSnapshot,
  CanonicalContentState,
  CanonicalMaterial,
  PublicCanonicalAppContent,
} from "./contracts";
import { CanonicalContentError } from "./errors";

const PENDING_STATUSES = ["DRAFT", "SUBMITTED", "NEEDS_CHANGES", "APPROVED", "CONFLICTED"] as const;

function assetReference(row: AssetRow | null): CanonicalAssetReference | null {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.displayName,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    url: `/api/content/assets/${encodeURIComponent(row.id)}`,
  };
}

function stateFromRow(row: typeof canonicalContentState.$inferSelect): CanonicalContentState {
  return {
    id: "global",
    bootstrapVersion: row.bootstrapVersion,
    bootstrapCompletedAt: row.bootstrapCompletedAt,
    runtimeSourceMode: row.runtimeSourceMode as CanonicalContentState["runtimeSourceMode"],
    updatedAt: row.updatedAt,
    revision: row.revision,
  };
}

export class SQLiteCanonicalContentRepository implements CanonicalContentRepository {
  constructor(private readonly database: ContentDatabase, private readonly clock: () => number = Date.now) {}

  bootstrap(): CanonicalContentState {
    const run = this.database.client.transaction(() => {
      const existing = this.database.db.select().from(canonicalContentState).where(eq(canonicalContentState.id, "global")).get();
      if (existing) {
        if (existing.bootstrapVersion !== CANONICAL_BOOTSTRAP_VERSION) {
          throw new CanonicalContentError("CANONICAL_BOOTSTRAP_FAILED", "Canonical content bootstrap version is not supported.");
        }
        this.assertBootstrapShape();
        return stateFromRow(existing);
      }

      const existingRows = this.countCanonicalRows();
      if (Object.values(existingRows).some((count) => count !== 0)) {
        throw new CanonicalContentError("CANONICAL_BOOTSTRAP_FAILED", "Canonical content is partially initialized; automatic repair was refused.");
      }

      const now = this.clock();
      this.database.db.insert(canonicalBanners).values(CANONICAL_BANNER_DEFAULTS.map((item) => ({
        id: uuidv7(),
        ...item,
        assetId: null,
        createdAt: now,
        updatedAt: now,
        updatedBy: null,
        revision: 1,
      }))).run();
      this.database.db.insert(canonicalMaterials).values(CANONICAL_MATERIAL_DEFAULTS.map((item) => ({
        id: uuidv7(),
        ...item,
        assetId: null,
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        createdAt: now,
        updatedAt: now,
        updatedBy: null,
        revision: 1,
      }))).run();
      this.database.db.insert(canonicalMaterialSettings).values({
        id: "global",
        ...CANONICAL_MATERIAL_SETTINGS_DEFAULT,
        updatedAt: now,
        updatedBy: null,
        revision: 1,
      }).run();
      this.database.db.insert(canonicalTools).values(CANONICAL_TOOL_DEFAULTS.map((item) => ({
        id: uuidv7(), ...item, createdAt: now, updatedAt: now, updatedBy: null, revision: 1,
      }))).run();
      this.database.db.insert(canonicalNavigation).values(CANONICAL_NAVIGATION_DEFAULTS.map((item) => ({
        id: uuidv7(), ...item, createdAt: now, updatedAt: now, updatedBy: null, revision: 1,
      }))).run();
      this.database.db.insert(canonicalCarouselSettings).values({
        id: "global", ...CANONICAL_CAROUSEL_SETTINGS_DEFAULT, updatedAt: now, updatedBy: null, revision: 1,
      }).run();
      const created = this.database.db.insert(canonicalContentState).values({
        id: "global",
        bootstrapVersion: CANONICAL_BOOTSTRAP_VERSION,
        bootstrapCompletedAt: now,
        runtimeSourceMode: "LEGACY",
        updatedAt: now,
        updatedBy: null,
        revision: 1,
      }).returning().get();
      this.assertBootstrapShape();
      return stateFromRow(created);
    });
    return run.immediate();
  }

  getSnapshot(): CanonicalContentSnapshot {
    const state = this.bootstrap();
    const assetRows = this.database.db.select().from(assets).all();
    const assetMap = new Map(assetRows.map((asset) => [asset.id, asset]));
    const banners = this.database.db.select().from(canonicalBanners).orderBy(asc(canonicalBanners.displayOrder), asc(canonicalBanners.id)).all();
    const materials = this.database.db.select().from(canonicalMaterials).orderBy(asc(canonicalMaterials.displayOrder), asc(canonicalMaterials.id)).all();
    const materialSettings = this.database.db.select().from(canonicalMaterialSettings).where(eq(canonicalMaterialSettings.id, "global")).get();
    const tools = this.database.db.select().from(canonicalTools).orderBy(asc(canonicalTools.displayOrder), asc(canonicalTools.id)).all();
    const navigation = this.database.db.select().from(canonicalNavigation).orderBy(asc(canonicalNavigation.displayOrder), asc(canonicalNavigation.id)).all();
    const carouselSettings = this.database.db.select().from(canonicalCarouselSettings).where(eq(canonicalCarouselSettings.id, "global")).get();
    if (!materialSettings || !carouselSettings) throw new CanonicalContentError("CANONICAL_BOOTSTRAP_FAILED", "Canonical singleton settings are missing.");
    const revision = this.database.db.select().from(publicationState).where(eq(publicationState.id, "global")).get()?.currentRevision ?? 0;
    return {
      state,
      contentRevision: revision,
      banners: banners.map((row) => this.toBanner(row, assetMap.get(row.assetId ?? "") ?? null)),
      materials: materials.map((row) => this.toMaterial(row, assetMap.get(row.assetId ?? "") ?? null)),
      materialSettings: { id: "global", fadeIntensity: materialSettings.fadeIntensity, textVerticalPosition: materialSettings.textVerticalPosition, textScale: materialSettings.textScale, cardHeight: materialSettings.cardHeight, updatedAt: materialSettings.updatedAt, revision: materialSettings.revision },
      tools: tools.map((row) => ({ id: row.id, toolKey: row.toolKey, label: row.label, iconKey: row.iconKey, available: row.available, displayOrder: row.displayOrder, createdAt: row.createdAt, updatedAt: row.updatedAt, revision: row.revision })),
      navigation: navigation.map((row) => ({ id: row.id, navKey: row.navKey, label: row.label, iconKey: row.iconKey, enabled: row.enabled, displayOrder: row.displayOrder, createdAt: row.createdAt, updatedAt: row.updatedAt, revision: row.revision })),
      carouselSettings: { id: "global", autoSlideInterval: carouselSettings.autoSlideInterval, updatedAt: carouselSettings.updatedAt, revision: carouselSettings.revision },
      pendingResourceKeys: this.pendingResourceKeys(),
    };
  }

  getPublicContent(): PublicCanonicalAppContent {
    const snapshot = this.getSnapshot();
    if (snapshot.state.runtimeSourceMode === "LEGACY") {
      return { runtimeSourceMode: "LEGACY", contentRevision: snapshot.contentRevision, content: null };
    }
    return {
      runtimeSourceMode: "CANONICAL",
      contentRevision: snapshot.contentRevision,
      content: {
        banners: snapshot.banners.filter((item) => item.status === "ACTIVE").map(({ asset, assetId: _assetId, createdAt: _createdAt, updatedAt: _updatedAt, revision: _revision, ...item }) => ({ ...item, imageUrl: asset?.url ?? null })),
        materials: snapshot.materials.filter((item) => item.available).map(({ asset, assetId: _assetId, createdAt: _createdAt, updatedAt: _updatedAt, revision: _revision, ...item }) => ({ ...item, imageUrl: asset?.url ?? null })),
        materialSettings: { id: "global", fadeIntensity: snapshot.materialSettings.fadeIntensity, textVerticalPosition: snapshot.materialSettings.textVerticalPosition, textScale: snapshot.materialSettings.textScale, cardHeight: snapshot.materialSettings.cardHeight },
        tools: snapshot.tools.map(({ createdAt: _createdAt, updatedAt: _updatedAt, revision: _revision, ...item }) => item),
        navigation: snapshot.navigation.filter((item) => item.enabled).map(({ createdAt: _createdAt, updatedAt: _updatedAt, revision: _revision, ...item }) => item),
        carouselSettings: { id: "global", autoSlideInterval: snapshot.carouselSettings.autoSlideInterval },
      },
    };
  }

  getAssetUsage(assetId: string): CanonicalAssetUsage {
    const banners = this.database.db.select({ id: canonicalBanners.id, title: canonicalBanners.title }).from(canonicalBanners).where(eq(canonicalBanners.assetId, assetId)).all();
    const materials = this.database.db.select({ id: canonicalMaterials.id, subjectKey: canonicalMaterials.subjectKey, label: canonicalMaterials.label }).from(canonicalMaterials).where(eq(canonicalMaterials.assetId, assetId)).all();
    return { assetId, banners, materials };
  }

  isStudentVisibleAsset(assetId: string): boolean {
    const state = this.database.db.select({ mode: canonicalContentState.runtimeSourceMode }).from(canonicalContentState).where(eq(canonicalContentState.id, "global")).get();
    if (state?.mode !== "CANONICAL") return false;
    const banner = this.database.db.select({ id: canonicalBanners.id }).from(canonicalBanners).where(sql`${canonicalBanners.assetId} = ${assetId} and ${canonicalBanners.status} = 'ACTIVE'`).get();
    if (banner) return true;
    return Boolean(this.database.db.select({ id: canonicalMaterials.id }).from(canonicalMaterials).where(sql`${canonicalMaterials.assetId} = ${assetId} and ${canonicalMaterials.available} = 1`).get());
  }

  requireActor(actor: AdminActor): void {
    if (!actor.actorUserId || !["OWNER", "ADMIN"].includes(actor.actorRole)) {
      throw new CanonicalContentError("CANONICAL_AUTHORIZATION_FAILED", "An authenticated Admin actor is required.");
    }
  }

  private toBanner(row: CanonicalBannerRow, asset: AssetRow | null): CanonicalBanner {
    return { id: row.id, bannerType: row.bannerType as CanonicalBanner["bannerType"], title: row.title, subtitle: row.subtitle, iconKey: row.iconKey, gradient: row.gradient, assetId: row.assetId, asset: assetReference(asset), status: row.status as CanonicalBanner["status"], displayOrder: row.displayOrder, offsetX: row.offsetX, offsetY: row.offsetY, scale: row.scale, createdAt: row.createdAt, updatedAt: row.updatedAt, revision: row.revision };
  }

  private toMaterial(row: CanonicalMaterialRow, asset: AssetRow | null): CanonicalMaterial {
    return { id: row.id, subjectKey: row.subjectKey, label: row.label, englishTitle: row.englishTitle, iconKey: row.iconKey, available: row.available, displayOrder: row.displayOrder, assetId: row.assetId, asset: assetReference(asset), gradient: row.gradient, offsetX: row.offsetX, offsetY: row.offsetY, scale: row.scale, createdAt: row.createdAt, updatedAt: row.updatedAt, revision: row.revision };
  }

  private pendingResourceKeys(): string[] {
    const placeholders = PENDING_STATUSES.map(() => "?").join(",");
    const rows = this.database.client.prepare(`select distinct csi.resource_type as resourceType, csi.resource_id as resourceId from change_set_items csi inner join change_sets cs on cs.id = csi.change_set_id where cs.status in (${placeholders}) order by csi.resource_type, csi.resource_id`).all(...PENDING_STATUSES) as Array<{ resourceType: string; resourceId: string }>;
    return rows.map((row) => `${row.resourceType}:${row.resourceId}`);
  }

  private countCanonicalRows(): Record<string, number> {
    const tableNames = ["canonical_banners", "canonical_materials", "canonical_material_settings", "canonical_tools", "canonical_navigation", "canonical_carousel_settings"];
    return Object.fromEntries(tableNames.map((table) => [table, Number((this.database.client.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count)]));
  }

  private assertBootstrapShape(): void {
    const counts = this.countCanonicalRows();
    const expected: Record<string, number> = { canonical_banners: 5, canonical_materials: 8, canonical_material_settings: 1, canonical_tools: 5, canonical_navigation: 5, canonical_carousel_settings: 1 };
    for (const [table, minimum] of Object.entries(expected)) {
      if ((counts[table] ?? 0) < minimum) throw new CanonicalContentError("CANONICAL_BOOTSTRAP_FAILED", `Canonical bootstrap invariant failed for ${table}.`);
    }
  }
}
