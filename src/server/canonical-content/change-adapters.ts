import { and, asc, eq, sql } from "drizzle-orm";
import type { AdminActor } from "../admin-auth/contracts";
import type { ChangeOperation, ChangePresentation, ChangeResourceAdapter, ChangeSnapshot, ResourceState } from "../change-management/contracts";
import { ChangeManagementError } from "../change-management/errors";
import { deriveChangedPaths, validateChangeSnapshot } from "../change-management/snapshot";
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
} from "../content/schema";
import {
  bannerStatus,
  bannerType,
  booleanValue,
  exactKeys,
  finiteRange,
  integerRange,
  nullableAssetId,
  normalizedText,
  optionalText,
  plainObject,
  runtimeSourceMode,
  semanticKey,
} from "./validation";
import { CanonicalContentError } from "./errors";

export const CANONICAL_RESOURCE_TYPES = [
  "banner",
  "material",
  "materials.settings",
  "tool",
  "navigation",
  "carousel.settings",
  "platform.runtime-content",
] as const;

export type CanonicalResourceType = (typeof CANONICAL_RESOURCE_TYPES)[number];

const AREA_LABELS: Record<CanonicalResourceType, string> = {
  banner: "البانرات",
  material: "المواد",
  "materials.settings": "مظهر المواد",
  tool: "الأدوات",
  navigation: "التنقل",
  "carousel.settings": "إعدادات العرض",
  "platform.runtime-content": "مصدر محتوى التطبيق",
};

const FIELD_LABELS: Record<string, string> = {
  bannerType: "نوع البانر", title: "العنوان", subtitle: "الوصف", iconKey: "الأيقونة", gradient: "الخلفية", assetId: "الصورة", status: "الحالة", displayOrder: "الترتيب", offsetX: "موضع الصورة أفقيًا", offsetY: "موضع الصورة عموديًا", scale: "حجم الصورة",
  subjectKey: "مفتاح المادة", label: "الاسم", englishTitle: "الاسم الإنجليزي", available: "الإتاحة", enabled: "التفعيل", toolKey: "مفتاح الأداة", navKey: "مفتاح التنقل",
  fadeIntensity: "شدة التعتيم", textVerticalPosition: "موضع النص", textScale: "حجم النص", cardHeight: "ارتفاع البطاقة", autoSlideInterval: "مدة انتقال البانر", runtimeSourceMode: "مصدر المحتوى",
};

function validationError(message: string): never {
  throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", message);
}

function assertImageAsset(database: ContentDatabase, assetId: string | null): void {
  if (!assetId) return;
  const asset = database.db.select({ mediaKind: assets.mediaKind, mimeType: assets.mimeType }).from(assets).where(eq(assets.id, assetId)).get();
  if (!asset) validationError("The selected Asset does not exist.");
  if (asset.mediaKind !== "image" || !asset.mimeType.startsWith("image/")) validationError("Only validated image Assets may be attached to product content.");
}

function bannerSnapshot(value: unknown): ChangeSnapshot {
  const input = plainObject(value);
  exactKeys(input, ["bannerType", "title", "subtitle", "iconKey", "gradient", "assetId", "status", "displayOrder", "offsetX", "offsetY", "scale"]);
  return {
    bannerType: bannerType(input.bannerType),
    title: optionalText(input.title, "title", 160),
    subtitle: optionalText(input.subtitle, "subtitle", 500),
    iconKey: normalizedText(input.iconKey, "iconKey", 1, 80),
    gradient: normalizedText(input.gradient, "gradient", 1, 500),
    assetId: nullableAssetId(input.assetId),
    status: bannerStatus(input.status),
    displayOrder: integerRange(input.displayOrder, "displayOrder", 0, 10_000),
    offsetX: finiteRange(input.offsetX, "offsetX", -50, 50),
    offsetY: finiteRange(input.offsetY, "offsetY", -50, 50),
    scale: finiteRange(input.scale, "scale", 0.5, 3),
  };
}

function materialSnapshot(value: unknown): ChangeSnapshot {
  const input = plainObject(value);
  exactKeys(input, ["subjectKey", "label", "englishTitle", "iconKey", "available", "displayOrder", "assetId", "gradient", "offsetX", "offsetY", "scale"]);
  return {
    subjectKey: semanticKey(input.subjectKey, "subjectKey"),
    label: normalizedText(input.label, "label", 1, 160),
    englishTitle: normalizedText(input.englishTitle, "englishTitle", 1, 160),
    iconKey: normalizedText(input.iconKey, "iconKey", 1, 80),
    available: booleanValue(input.available, "available"),
    displayOrder: integerRange(input.displayOrder, "displayOrder", 0, 10_000),
    assetId: nullableAssetId(input.assetId),
    gradient: normalizedText(input.gradient, "gradient", 1, 500),
    offsetX: finiteRange(input.offsetX, "offsetX", -50, 50),
    offsetY: finiteRange(input.offsetY, "offsetY", -50, 50),
    scale: finiteRange(input.scale, "scale", 0.5, 3),
  };
}

function settingsSnapshot(value: unknown): ChangeSnapshot {
  const input = plainObject(value);
  exactKeys(input, ["fadeIntensity", "textVerticalPosition", "textScale", "cardHeight"]);
  return { fadeIntensity: finiteRange(input.fadeIntensity, "fadeIntensity", 0, 1), textVerticalPosition: finiteRange(input.textVerticalPosition, "textVerticalPosition", -100, 100), textScale: finiteRange(input.textScale, "textScale", 0.8, 1.4), cardHeight: integerRange(input.cardHeight, "cardHeight", 160, 340) };
}

function toolSnapshot(value: unknown): ChangeSnapshot {
  const input = plainObject(value);
  exactKeys(input, ["toolKey", "label", "iconKey", "available", "displayOrder"]);
  return { toolKey: semanticKey(input.toolKey, "toolKey"), label: normalizedText(input.label, "label", 1, 160), iconKey: normalizedText(input.iconKey, "iconKey", 1, 80), available: booleanValue(input.available, "available"), displayOrder: integerRange(input.displayOrder, "displayOrder", 0, 10_000) };
}

function navigationSnapshot(value: unknown): ChangeSnapshot {
  const input = plainObject(value);
  exactKeys(input, ["navKey", "label", "iconKey", "enabled", "displayOrder"]);
  return { navKey: semanticKey(input.navKey, "navKey"), label: normalizedText(input.label, "label", 1, 160), iconKey: normalizedText(input.iconKey, "iconKey", 1, 80), enabled: booleanValue(input.enabled, "enabled"), displayOrder: integerRange(input.displayOrder, "displayOrder", 0, 10_000) };
}

function carouselSnapshot(value: unknown): ChangeSnapshot {
  const input = plainObject(value);
  exactKeys(input, ["autoSlideInterval"]);
  return { autoSlideInterval: integerRange(input.autoSlideInterval, "autoSlideInterval", 1000, 120_000) };
}

function runtimeSnapshot(value: unknown): ChangeSnapshot {
  const input = plainObject(value);
  exactKeys(input, ["runtimeSourceMode"]);
  return { runtimeSourceMode: runtimeSourceMode(input.runtimeSourceMode) };
}

function normalize(type: CanonicalResourceType, value: unknown): ChangeSnapshot {
  try {
    switch (type) {
      case "banner": return bannerSnapshot(value);
      case "material": return materialSnapshot(value);
      case "materials.settings": return settingsSnapshot(value);
      case "tool": return toolSnapshot(value);
      case "navigation": return navigationSnapshot(value);
      case "carousel.settings": return carouselSnapshot(value);
      case "platform.runtime-content": return runtimeSnapshot(value);
    }
  } catch (error) {
    if (error instanceof CanonicalContentError) throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", error.message, error);
    throw error;
  }
}

function selectSnapshot(database: ContentDatabase, type: CanonicalResourceType, resourceId: string): ResourceState | null {
  switch (type) {
    case "banner": {
      const row = database.db.select().from(canonicalBanners).where(eq(canonicalBanners.id, resourceId)).get();
      return row ? { resourceId, revision: row.revision, snapshot: bannerSnapshot({ bannerType: row.bannerType, title: row.title, subtitle: row.subtitle, iconKey: row.iconKey, gradient: row.gradient, assetId: row.assetId, status: row.status, displayOrder: row.displayOrder, offsetX: row.offsetX, offsetY: row.offsetY, scale: row.scale }) } : null;
    }
    case "material": {
      const row = database.db.select().from(canonicalMaterials).where(eq(canonicalMaterials.id, resourceId)).get();
      return row ? { resourceId, revision: row.revision, snapshot: materialSnapshot({ subjectKey: row.subjectKey, label: row.label, englishTitle: row.englishTitle, iconKey: row.iconKey, available: row.available, displayOrder: row.displayOrder, assetId: row.assetId, gradient: row.gradient, offsetX: row.offsetX, offsetY: row.offsetY, scale: row.scale }) } : null;
    }
    case "materials.settings": {
      const row = database.db.select().from(canonicalMaterialSettings).where(eq(canonicalMaterialSettings.id, resourceId)).get();
      return row ? { resourceId, revision: row.revision, snapshot: settingsSnapshot({ fadeIntensity: row.fadeIntensity, textVerticalPosition: row.textVerticalPosition, textScale: row.textScale, cardHeight: row.cardHeight }) } : null;
    }
    case "tool": {
      const row = database.db.select().from(canonicalTools).where(eq(canonicalTools.id, resourceId)).get();
      return row ? { resourceId, revision: row.revision, snapshot: toolSnapshot({ toolKey: row.toolKey, label: row.label, iconKey: row.iconKey, available: row.available, displayOrder: row.displayOrder }) } : null;
    }
    case "navigation": {
      const row = database.db.select().from(canonicalNavigation).where(eq(canonicalNavigation.id, resourceId)).get();
      return row ? { resourceId, revision: row.revision, snapshot: navigationSnapshot({ navKey: row.navKey, label: row.label, iconKey: row.iconKey, enabled: row.enabled, displayOrder: row.displayOrder }) } : null;
    }
    case "carousel.settings": {
      const row = database.db.select().from(canonicalCarouselSettings).where(eq(canonicalCarouselSettings.id, resourceId)).get();
      return row ? { resourceId, revision: row.revision, snapshot: carouselSnapshot({ autoSlideInterval: row.autoSlideInterval }) } : null;
    }
    case "platform.runtime-content": {
      const row = database.db.select().from(canonicalContentState).where(eq(canonicalContentState.id, resourceId)).get();
      return row ? { resourceId, revision: row.revision, snapshot: runtimeSnapshot({ runtimeSourceMode: row.runtimeSourceMode }) } : null;
    }
  }
}

function changedRows(result: unknown[]): ResourceState {
  const row = result[0] as Record<string, unknown> | undefined;
  if (!row) throw new ChangeManagementError("CHANGE_CONFLICT", "The canonical resource changed before publication.");
  return { resourceId: String(row.id), revision: Number(row.revision), snapshot: {} };
}

export class CanonicalChangeAdapter implements ChangeResourceAdapter {
  readonly areaLabel: string;
  constructor(readonly resourceType: CanonicalResourceType) { this.areaLabel = AREA_LABELS[resourceType]; }

  loadCurrent(database: ContentDatabase, resourceId: string): ResourceState {
    const current = selectSnapshot(database, this.resourceType, resourceId);
    if (!current) throw new ChangeManagementError("CHANGE_NOT_FOUND", "The canonical resource was not found.");
    return current;
  }

  captureProposal(database: ContentDatabase, resourceId: string, desired: unknown, operation: ChangeOperation = "UPDATE") {
    if (operation === "CREATE" && this.resourceType !== "banner") validationError("Only banners may be created in this milestone.");
    const current = operation === "CREATE" ? { resourceId, revision: 0, snapshot: {} } : this.loadCurrent(database, resourceId);
    if (operation === "CREATE" && selectSnapshot(database, this.resourceType, resourceId)) throw new ChangeManagementError("CHANGE_CONFLICT", "The resource already exists.");
    const proposedSnapshot = normalize(this.resourceType, desired);
    this.validateSnapshot(proposedSnapshot, operation);
    if (this.resourceType === "banner" || this.resourceType === "material") assertImageAsset(database, proposedSnapshot.assetId as string | null);
    const changedPaths = deriveChangedPaths(current.snapshot, proposedSnapshot);
    if (!changedPaths.length) validationError("The proposal does not change any fields.");
    return { current, proposedSnapshot, changedPaths };
  }

  validateSnapshot(snapshot: ChangeSnapshot, operation: ChangeOperation = "UPDATE"): void {
    validateChangeSnapshot(snapshot);
    normalize(this.resourceType, snapshot);
    if (operation === "CREATE" && this.resourceType !== "banner") validationError("This canonical resource cannot be created.");
  }

  describe(resourceId: string, before: ChangeSnapshot, proposed: ChangeSnapshot, operation: ChangeOperation = "UPDATE"): ChangePresentation {
    const fieldDiffs = deriveChangedPaths(before, proposed).map((path) => ({ path, label: FIELD_LABELS[path] ?? path, before: before[path], after: proposed[path] }));
    const label = String(proposed.title ?? proposed.label ?? proposed.subjectKey ?? proposed.toolKey ?? proposed.navKey ?? (this.resourceType === "platform.runtime-content" ? "مصدر التطبيق" : resourceId));
    return { resourceLabel: label, resourceSubtitle: operation === "CREATE" ? "عنصر جديد" : resourceId, changeSummary: `${fieldDiffs.length} ${fieldDiffs.length === 1 ? "حقل" : "حقول"}`, areaLabel: this.areaLabel, fieldDiffs };
  }

  apply(database: ContentDatabase, resourceId: string, snapshot: ChangeSnapshot, expectedRevision: number, actor: AdminActor, operation: ChangeOperation = "UPDATE"): ResourceState {
    const clean = normalize(this.resourceType, snapshot);
    if (this.resourceType === "banner" || this.resourceType === "material") assertImageAsset(database, clean.assetId as string | null);
    const now = Date.now();
    if (operation === "CREATE") {
      if (this.resourceType !== "banner" || expectedRevision !== 0) validationError("Invalid canonical create operation.");
      try {
        database.db.insert(canonicalBanners).values({
          id: resourceId,
          bannerType: String(clean.bannerType), title: String(clean.title), subtitle: String(clean.subtitle),
          iconKey: String(clean.iconKey), gradient: String(clean.gradient), assetId: clean.assetId as string | null,
          status: String(clean.status), displayOrder: Number(clean.displayOrder), offsetX: Number(clean.offsetX),
          offsetY: Number(clean.offsetY), scale: Number(clean.scale), createdAt: now, updatedAt: now,
          updatedBy: actor.actorUserId, revision: 1,
        }).run();
      } catch (error) {
        throw new ChangeManagementError("CHANGE_CONFLICT", "The new banner could not be created.", error);
      }
      return this.loadCurrent(database, resourceId);
    }
    const whereRevision = (idColumn: typeof canonicalBanners.id, revisionColumn: typeof canonicalBanners.revision) => and(eq(idColumn, resourceId), eq(revisionColumn, expectedRevision));
    let rows: unknown[];
    switch (this.resourceType) {
      case "banner": rows = database.db.update(canonicalBanners).set({ ...(clean as Partial<typeof canonicalBanners.$inferInsert>), updatedAt: now, updatedBy: actor.actorUserId, revision: sql`${canonicalBanners.revision} + 1` }).where(whereRevision(canonicalBanners.id, canonicalBanners.revision)).returning().all(); break;
      case "material": rows = database.db.update(canonicalMaterials).set({ ...(clean as Partial<typeof canonicalMaterials.$inferInsert>), updatedAt: now, updatedBy: actor.actorUserId, revision: sql`${canonicalMaterials.revision} + 1` }).where(and(eq(canonicalMaterials.id, resourceId), eq(canonicalMaterials.revision, expectedRevision))).returning().all(); break;
      case "materials.settings": rows = database.db.update(canonicalMaterialSettings).set({ ...(clean as Partial<typeof canonicalMaterialSettings.$inferInsert>), updatedAt: now, updatedBy: actor.actorUserId, revision: sql`${canonicalMaterialSettings.revision} + 1` }).where(and(eq(canonicalMaterialSettings.id, resourceId), eq(canonicalMaterialSettings.revision, expectedRevision))).returning().all(); break;
      case "tool": rows = database.db.update(canonicalTools).set({ ...(clean as Partial<typeof canonicalTools.$inferInsert>), updatedAt: now, updatedBy: actor.actorUserId, revision: sql`${canonicalTools.revision} + 1` }).where(and(eq(canonicalTools.id, resourceId), eq(canonicalTools.revision, expectedRevision))).returning().all(); break;
      case "navigation": rows = database.db.update(canonicalNavigation).set({ ...(clean as Partial<typeof canonicalNavigation.$inferInsert>), updatedAt: now, updatedBy: actor.actorUserId, revision: sql`${canonicalNavigation.revision} + 1` }).where(and(eq(canonicalNavigation.id, resourceId), eq(canonicalNavigation.revision, expectedRevision))).returning().all(); break;
      case "carousel.settings": rows = database.db.update(canonicalCarouselSettings).set({ ...(clean as Partial<typeof canonicalCarouselSettings.$inferInsert>), updatedAt: now, updatedBy: actor.actorUserId, revision: sql`${canonicalCarouselSettings.revision} + 1` }).where(and(eq(canonicalCarouselSettings.id, resourceId), eq(canonicalCarouselSettings.revision, expectedRevision))).returning().all(); break;
      case "platform.runtime-content":
        if (actor.actorRole !== "OWNER") throw new ChangeManagementError("CHANGE_AUTHORIZATION_FAILED", "Only OWNER may switch the Student content source.");
        if (clean.runtimeSourceMode !== "CANONICAL") validationError("The controlled cutover may only activate canonical content.");
        rows = database.db.update(canonicalContentState).set({ runtimeSourceMode: "CANONICAL", updatedAt: now, updatedBy: actor.actorUserId, revision: sql`${canonicalContentState.revision} + 1` }).where(and(eq(canonicalContentState.id, resourceId), eq(canonicalContentState.revision, expectedRevision), eq(canonicalContentState.runtimeSourceMode, "LEGACY"))).returning().all(); break;
    }
    changedRows(rows);
    return this.loadCurrent(database, resourceId);
  }

  validatePublication(database: ContentDatabase): void {
    switch (this.resourceType) {
      case "banner": {
        const active = database.db.select({ order: canonicalBanners.displayOrder }).from(canonicalBanners).where(eq(canonicalBanners.status, "ACTIVE")).orderBy(asc(canonicalBanners.displayOrder)).all();
        if (active.length > 5) validationError("At most five active banners may be published.");
        const orders = active.map((row) => row.order);
        if (new Set(orders).size !== orders.length) validationError("Active banner display order must be unique.");
        break;
      }
      case "material": this.assertUniqueOrders(database.db.select({ order: canonicalMaterials.displayOrder }).from(canonicalMaterials).all().map((row) => row.order), "materials"); break;
      case "tool": this.assertUniqueOrders(database.db.select({ order: canonicalTools.displayOrder }).from(canonicalTools).all().map((row) => row.order), "tools"); break;
      case "navigation": this.assertUniqueOrders(database.db.select({ order: canonicalNavigation.displayOrder }).from(canonicalNavigation).all().map((row) => row.order), "navigation items"); break;
    }
  }

  private assertUniqueOrders(orders: number[], label: string): void {
    if (new Set(orders).size !== orders.length) validationError(`Published ${label} must have unique display order values.`);
  }
}

export function createCanonicalChangeAdapters(): ChangeResourceAdapter[] {
  return CANONICAL_RESOURCE_TYPES.map((type) => new CanonicalChangeAdapter(type));
}
