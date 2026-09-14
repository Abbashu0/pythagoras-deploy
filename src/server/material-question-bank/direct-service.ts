import { eq, sql } from "drizzle-orm";
import type { AdminActor } from "../admin-auth";
import { getContentDatabase, type ContentDatabase } from "../content";
import { canonicalMaterials, publicationState } from "../content/schema";
import { SQLiteCanonicalContentRepository } from "../canonical-content";
import {
  DirectQuestionPackageService,
  type PreparedDirectQuestionPackage,
} from "../question-import";
import type {
  MaterialQuestionBankLayoutContent,
  MaterialQuestionBankNodeContent,
} from "./contracts";
import { MaterialQuestionBankError } from "./errors";
import {
  assertProductPresetStructure,
  createProductPresetLayout,
  getMaterialQuestionBankProductPreset,
} from "./product-presets";
import { SQLiteMaterialQuestionBankRepository } from "./sqlite-repository";
import { assertMaterialQuestionBankReferences, normalizeMaterialQuestionBankLayout } from "./validation";

export interface DirectMaterialQuestionBankPackageOption {
  id: string;
  packageKey: string;
  title: string;
  subjectKey: string;
  subjectLabel: string;
  contentRevision: number;
  sourceAssetId: string | null;
  sourceFilename: string | null;
  questionCount: number;
  variantCount: number;
  occurrenceCount: number;
  taxonomyCount: number;
  inspectionStatus: string | null;
}

export interface DirectMaterialQuestionBankTaxonomyOption {
  id: string;
  packageId: string;
  label: string;
  breadcrumb: string;
}

export interface DirectMaterialQuestionBankWorkspace {
  material: { id: string; subjectKey: string; label: string; available: boolean };
  layout: MaterialQuestionBankLayoutContent | null;
  canonicalRevision: number;
  published: boolean;
  packages: DirectMaterialQuestionBankPackageOption[];
  taxonomy: DirectMaterialQuestionBankTaxonomyOption[];
  productPreset: string | null;
  warnings: Array<{ code: "CROSS_SUBJECT_PLACEMENT"; nodeId: string; message: string }>;
}

export interface DirectMaterialQuestionBankPackageSource {
  packageId: string;
  assetId: string;
}

export interface DirectMaterialQuestionBankSaveOptions {
  acknowledgeWarnings?: boolean;
  acknowledgeCrossSubject?: boolean;
}

function assertActor(actor: AdminActor): void {
  if (!actor.actorUserId?.trim() || !["OWNER", "ADMIN"].includes(actor.actorRole)) {
    throw new MaterialQuestionBankError(
      "MATERIAL_BANK_INVALID",
      "An authenticated local Admin actor is required.",
    );
  }
}

function notFound(message = "Material was not found."): never {
  throw new MaterialQuestionBankError("MATERIAL_BANK_NOT_FOUND", message);
}

function invalid(message: string): never {
  throw new MaterialQuestionBankError("MATERIAL_BANK_INVALID", message);
}

function conflict(message: string): never {
  throw new MaterialQuestionBankError("MATERIAL_BANK_CONFLICT", message);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 120) {
    invalid(`${label} is invalid.`);
  }
  return value.trim();
}

function packageCounts(database: ContentDatabase, subjectKey?: string) {
  const condition = subjectKey ? "where p.subject_key = ?" : "";
  const args = subjectKey ? [subjectKey] : [];
  return database.client
    .prepare(
      `select p.id,p.package_key,p.title,p.subject_key,m.label subject_label,
              p.content_revision,p.source_asset_id,
              source.original_filename source_filename,
              inspection.status inspection_status,
              (select count(*) from questions q where q.package_id=p.id) question_count,
              (select count(*) from question_variants v join questions q on q.id=v.question_id where q.package_id=p.id) variant_count,
              (select count(*) from question_occurrences o join question_variants v on v.id=o.variant_id join questions q on q.id=v.question_id where q.package_id=p.id) occurrence_count,
              (select count(*) from question_taxonomy_nodes t where t.package_id=p.id) taxonomy_count
         from question_packages p
         join canonical_materials m on m.subject_key=p.subject_key
         left join assets source on source.id=p.source_asset_id
         left join question_package_inspections inspection on inspection.asset_id=p.source_asset_id
         ${condition}
        order by m.display_order,p.bank_browse_entry_order,p.id`,
    )
    .all(...args) as Array<Record<string, unknown>>;
}

function packageOptions(database: ContentDatabase): DirectMaterialQuestionBankPackageOption[] {
  return packageCounts(database).map((row) => ({
    id: String(row.id),
    packageKey: String(row.package_key),
    title: String(row.title),
    subjectKey: String(row.subject_key),
    subjectLabel: String(row.subject_label),
    contentRevision: Number(row.content_revision),
    sourceAssetId: row.source_asset_id === null ? null : String(row.source_asset_id),
    sourceFilename: row.source_filename === null ? null : String(row.source_filename),
    questionCount: Number(row.question_count ?? 0),
    variantCount: Number(row.variant_count ?? 0),
    occurrenceCount: Number(row.occurrence_count ?? 0),
    taxonomyCount: Number(row.taxonomy_count ?? 0),
    inspectionStatus: row.inspection_status === null ? null : String(row.inspection_status),
  }));
}

function taxonomyOptions(database: ContentDatabase, packageIds: string[]): DirectMaterialQuestionBankTaxonomyOption[] {
  if (!packageIds.length) return [];
  const placeholders = packageIds.map(() => "?").join(",");
  const rows = database.client
    .prepare(
      `select id,package_id,label,parent_id
         from question_taxonomy_nodes
        where package_id in (${placeholders})
        order by package_id,coalesce(parent_id,''),display_order,id`,
    )
    .all(...packageIds) as Array<{ id: string; package_id: string; label: string; parent_id: string | null }>;
  const byPackage = new Map<string, typeof rows>();
  for (const row of rows) byPackage.set(row.package_id, [...(byPackage.get(row.package_id) ?? []), row]);
  return rows.map((row) => {
    const nodes = new Map((byPackage.get(row.package_id) ?? []).map((item) => [item.id, item]));
    const labels: string[] = [];
    const seen = new Set<string>();
    let current: string | null = row.id;
    while (current && !seen.has(current)) {
      seen.add(current);
      const node = nodes.get(current);
      if (!node) break;
      labels.unshift(node.label);
      current = node.parent_id;
    }
    return { id: row.id, packageId: row.package_id, label: row.label, breadcrumb: labels.join(" / ") };
  });
}

export class DirectMaterialQuestionBankService {
  private readonly repository: SQLiteMaterialQuestionBankRepository;
  private readonly packages: DirectQuestionPackageService;
  private readonly canonical: SQLiteCanonicalContentRepository;

  constructor(private readonly database: ContentDatabase) {
    this.repository = new SQLiteMaterialQuestionBankRepository(database);
    this.packages = new DirectQuestionPackageService(database);
    this.canonical = new SQLiteCanonicalContentRepository(database);
  }

  getWorkspace(subjectKey: string, actor: AdminActor): DirectMaterialQuestionBankWorkspace {
    assertActor(actor);
    const material = this.requireMaterial(subjectKey);
    this.ensureProductPreset(material.id, material.subjectKey, actor);
    const layoutEntity = this.repository.get(material.id);
    const layout = layoutEntity ? contentOf(layoutEntity) : null;
    const packages = packageOptions(this.database);
    return {
      material,
      layout,
      canonicalRevision: layoutEntity?.revision ?? 0,
      published: Boolean(layoutEntity),
      packages,
      taxonomy: taxonomyOptions(this.database, packages.map((item) => item.id)),
      productPreset: getMaterialQuestionBankProductPreset(material.subjectKey)?.key ?? null,
      warnings: layout ? crossSubjectWarnings(layout, material.subjectKey, material.label, packages) : [],
    };
  }

  async save(
    subjectKey: string,
    desired: unknown,
    expectedRevision: unknown,
    packageSources: unknown,
    options: DirectMaterialQuestionBankSaveOptions,
    actor: AdminActor,
  ): Promise<DirectMaterialQuestionBankWorkspace> {
    assertActor(actor);
    const material = this.requireMaterial(subjectKey);
    this.ensureProductPreset(material.id, material.subjectKey, actor);
    const current = this.repository.get(material.id);
    const expected = this.revision(expectedRevision);
    if ((current?.revision ?? 0) !== expected) conflict("Material Question Bank changed before saving.");
    const layout = normalizeMaterialQuestionBankLayout(desired);
    if (layout.materialId !== material.id) invalid("Material Question Bank material identity is invalid.");
    assertProductPresetStructure(material.subjectKey, layout);
    assertProductPresetAssignmentFields(material.id, material.subjectKey, layout);
    const sources = this.normalizeSources(packageSources);
    const packageIds = [...new Set(layout.nodes.flatMap((node) => node.packageId ? [node.packageId] : []))];
    const sourceByPackage = new Map(sources.map((source) => [source.packageId, source.assetId]));
    for (const packageId of packageIds) {
      if (!sourceByPackage.has(packageId)) invalid("Every assigned package must retain its source Asset reference.");
    }

    const prepared: PreparedDirectQuestionPackage[] = [];
    for (const packageId of packageIds) {
      const assetId = sourceByPackage.get(packageId)!;
      const item = await this.packages.prepare(assetId, actor);
      if (item.preflight.package?.id !== packageId) invalid("Package source does not match the selected canonical Package ID.");
      if (item.preflight.acknowledgementRequired && !options.acknowledgeWarnings) {
        throw new MaterialQuestionBankError("MATERIAL_BANK_INVALID", "Package warnings must be acknowledged before saving.");
      }
      if (item.preflight.package.subjectKey !== material.subjectKey && !options.acknowledgeCrossSubject) {
        throw new MaterialQuestionBankError("MATERIAL_BANK_INVALID", "Cross-subject package placement requires explicit confirmation.");
      }
      prepared.push(item);
    }

    const changedLayout = JSON.stringify(current ? contentOf(current) : null) !== JSON.stringify(layout);
    const hasPackageApplication = prepared.some((item) => item.plan !== null);
    if (!changedLayout && !hasPackageApplication) return this.getWorkspace(subjectKey, actor);

    this.database.client
      .transaction(() => {
        for (const item of prepared) this.packages.applyPreparedInTransaction(item);
        assertMaterialQuestionBankReferences(this.database, layout);
        this.repository.save({
          content: layout,
          expectedRevision: expected,
          actor,
          operation: current ? "UPDATE" : "CREATE",
        });
        this.bumpContentRevision();
      })
      .immediate();

    return this.getWorkspace(subjectKey, actor);
  }

  private requireMaterial(subjectKey: string) {
    this.canonical.bootstrap();
    const key = text(subjectKey, "subjectKey").toLowerCase();
    const row = this.database.db
      .select({ id: canonicalMaterials.id, subjectKey: canonicalMaterials.subjectKey, label: canonicalMaterials.label, available: canonicalMaterials.available })
      .from(canonicalMaterials)
      .where(eq(canonicalMaterials.subjectKey, key))
      .get();
    if (!row) notFound();
    return { id: row.id, subjectKey: row.subjectKey, label: row.label, available: Boolean(row.available) };
  }

  private ensureProductPreset(materialId: string, subjectKey: string, actor: AdminActor): void {
    const baseline = createProductPresetLayout(materialId, subjectKey);
    if (!baseline || this.repository.get(materialId)) return;
    this.database.client
      .transaction(() => {
        if (!this.repository.get(materialId)) {
          this.repository.save({ content: baseline, expectedRevision: 0, actor, operation: "CREATE" });
        }
      })
      .immediate();
  }

  private normalizeSources(value: unknown): DirectMaterialQuestionBankPackageSource[] {
    if (!Array.isArray(value) || value.length > 100) invalid("Package source references are invalid.");
    const result = value.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) invalid("Package source reference is invalid.");
      const row = item as Record<string, unknown>;
      if (Object.keys(row).some((key) => !["packageId", "assetId"].includes(key))) {
        invalid("Package source reference contains unsupported fields.");
      }
      const packageId = text(row.packageId, "packageId");
      const assetId = text(row.assetId, "assetId");
      return { packageId, assetId };
    });
    if (new Set(result.map((item) => item.packageId)).size !== result.length) invalid("Package source references contain duplicates.");
    return result;
  }

  private revision(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) conflict("Material Question Bank revision is stale or invalid.");
    return value;
  }

  private bumpContentRevision(): void {
    this.database.db
      .update(publicationState)
      .set({ currentRevision: sql`${publicationState.currentRevision} + 1`, updatedAt: Date.now() })
      .where(eq(publicationState.id, "global"))
      .run();
  }
}

function assertProductPresetAssignmentFields(
  materialId: string,
  subjectKey: string,
  layout: MaterialQuestionBankLayoutContent,
): void {
  const baseline = createProductPresetLayout(materialId, subjectKey);
  if (!baseline) return;
  const expected = new Map(baseline.nodes.map((node) => [node.id, node]));
  for (const node of layout.nodes) {
    const reference = expected.get(node.id);
    if (!reference || node.nodeType !== "BANK") continue;
    if (
      node.targetMode !== reference.targetMode ||
      node.taxonomyNodeId !== reference.taxonomyNodeId ||
      node.includeDescendants !== reference.includeDescendants
    ) {
      invalid("Only the package assignment may change in the Product-defined BANK.");
    }
  }
}

function contentOf(value: { materialId: string; rootPresentation: "DIRECT" | "CARDS"; nodes: MaterialQuestionBankNodeContent[] }): MaterialQuestionBankLayoutContent {
  return { materialId: value.materialId, rootPresentation: value.rootPresentation, nodes: value.nodes };
}

function crossSubjectWarnings(
  layout: MaterialQuestionBankLayoutContent,
  subjectKey: string,
  materialLabel: string,
  packages: DirectMaterialQuestionBankPackageOption[],
) {
  const byId = new Map(packages.map((item) => [item.id, item]));
  return layout.nodes.flatMap((node) => {
    const pack = node.packageId ? byId.get(node.packageId) : null;
    return pack && pack.subjectKey !== subjectKey
      ? [{ code: "CROSS_SUBJECT_PLACEMENT" as const, nodeId: node.id, message: `هذه الحزمة مصنفة ضمن ${pack.subjectLabel}، لكنها ستظهر داخل بنك ${materialLabel} وفق هذا التوزيع.` }]
      : [];
  });
}

let singleton: DirectMaterialQuestionBankService | undefined;

export function createDirectMaterialQuestionBankService(database: ContentDatabase): DirectMaterialQuestionBankService {
  return new DirectMaterialQuestionBankService(database);
}

export function getDirectMaterialQuestionBankService(): DirectMaterialQuestionBankService {
  singleton ??= new DirectMaterialQuestionBankService(getContentDatabase());
  return singleton;
}
