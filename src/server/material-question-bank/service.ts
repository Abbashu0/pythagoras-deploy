import { buildPublicRichContentAssetUrl, extractRichDocumentPlainText, toPublicRichDocument, toPublicRichPreview, type PublicRichDocument } from "@/lib/rich-content";
import { v7 as uuidv7 } from "uuid";
import type { AdminActor } from "../admin-auth";
import { createChangeManagementService, type ChangeSetStatus } from "../change-management";
import { getContentDatabase, type ContentDatabase } from "../content";
import { SQLiteQuestionRepository, type CanonicalRichDocument } from "../questions";
import { loadPublicQuestionSourceSummaries } from "../questions/public-provenance";
import { QuestionSearchService } from "../question-search";
import {
  MATERIAL_QUESTION_BANK_MAX_PAGE_SIZE,
  MATERIAL_QUESTION_BANK_PAGE_SIZE,
  MATERIAL_QUESTION_BANK_RESOURCE_TYPE,
  type MaterialQuestionBankAdminWorkspace,
  type MaterialQuestionBankLayoutContent,
  type MaterialQuestionBankLayoutEntity,
  type MaterialQuestionBankPackageOption,
  type MaterialQuestionBankTaxonomyOption,
  type MaterialQuestionBankWorkflow,
  type PublicMaterialQuestionBankLayout,
  type PublicQuestionDetail,
  type PublicQuestionPage,
  type PublicQuestionSearchPage,
} from "./contracts";
import { MaterialQuestionBankError } from "./errors";
import { assertProductPresetStructure, createProductPresetLayout, getMaterialQuestionBankProductPreset, isProductPresetLayout } from "./product-presets";
import { SQLiteMaterialQuestionBankRepository } from "./sqlite-repository";
import { normalizeMaterialQuestionBankLayout } from "./validation";

type MaterialRow = { id: string; subject_key: string; label: string; available: number };
type PackageRow = { id: string; package_key: string; title: string; subject_key: string; subject_label: string; question_count: number; taxonomy_count: number };
type WorkflowRow = { id: string; status: ChangeSetStatus; revision: number; updated_at: number; item_count: number; proposed_snapshot?: string };

export class MaterialQuestionBankService {
  private readonly repository: SQLiteMaterialQuestionBankRepository;
  private readonly changes;
  constructor(private readonly database: ContentDatabase) {
    this.repository = new SQLiteMaterialQuestionBankRepository(database);
    this.changes = createChangeManagementService(database);
  }

  getAdminWorkspace(subjectKey: string, actor: AdminActor): MaterialQuestionBankAdminWorkspace {
    assertActor(actor);
    const material = this.requireMaterial(subjectKey, false);
    this.ensureProductPreset(material, actor);
    const canonical = this.repository.get(material.id);
    const workflow = this.findWorkflow(material.id, actor);
    const draftSnapshot = workflow?.editable ? this.readWorkflowSnapshot(workflow.id, material.id) : null;
    const layout = draftSnapshot ?? (canonical ? contentOf(canonical) : null) ?? { materialId: material.id, rootPresentation: "CARDS" as const, nodes: [] };
    const packages = this.listPackageOptions(actor);
    const taxonomy = this.listTaxonomyOptions(packages.filter((item) => item.published).map((item) => item.id));
    return {
      material: { id: material.id, subjectKey: material.subject_key, label: material.label, available: Boolean(material.available) },
      layout: normalizeMaterialQuestionBankLayout(layout),
      canonicalRevision: canonical?.revision ?? 0,
      published: Boolean(canonical), publishedNodeIds: canonical?.nodes.map((node) => node.id) ?? [], workflow, packages, taxonomy,
      productPreset: isProductPresetLayout(material.subject_key, layout) ? getMaterialQuestionBankProductPreset(material.subject_key)?.key ?? null : null,
      warnings: crossSubjectWarnings(layout, material.subject_key, material.label, packages),
    };
  }

  prepareNodeId(actor: AdminActor): string { assertActor(actor); return uuidv7(); }

  save(subjectKey: string, desired: unknown, actor: AdminActor): MaterialQuestionBankWorkflow {
    assertActor(actor);
    const material = this.requireMaterial(subjectKey, false);
    this.ensureProductPreset(material, actor);
    const value = normalizeMaterialQuestionBankLayout(desired);
    if (value.materialId !== material.id) invalid("Material layout identity is invalid.");
    assertProductPresetStructure(material.subject_key, value);
    const canonical = this.repository.get(material.id);
    const workflow = this.findWorkflow(material.id, actor);
    if (workflow && !workflow.editable) throw new MaterialQuestionBankError("MATERIAL_BANK_CONFLICT", "The current layout workflow is read-only.");
    const item = { resourceType: MATERIAL_QUESTION_BANK_RESOURCE_TYPE, resourceId: material.id, expectedRevision: canonical?.revision ?? 0, operation: canonical ? "UPDATE" as const : "CREATE" as const, desired: value };
    if (!workflow) {
      const result = this.changes.createChangeSet({ title: `مسودة بنك الأسئلة: ${material.label}`, description: "تخطيط ظهور حزم الأسئلة داخل تجربة المادة؛ لا يصبح عامًا قبل مراجعة OWNER ونشره.", initialItem: item }, actor);
      return workflowFrom(result.changeSet, result.items.length, true);
    }
    const result = this.changes.addItem(workflow.id, { ...item, expectedChangeSetRevision: workflow.revision }, actor);
    return workflowFrom(result.changeSet, result.items.length, true);
  }

  submit(subjectKey: string, expectedRevision: number, actor: AdminActor) {
    const material = this.requireMaterial(subjectKey, false);
    const workflow = this.findWorkflow(material.id, actor);
    if (!workflow?.editable || workflow.revision !== expectedRevision) throw new MaterialQuestionBankError("MATERIAL_BANK_CONFLICT", "Layout Draft changed before submission.");
    return this.changes.submit(workflow.id, expectedRevision, actor).changeSet;
  }

  getPublicLayout(subjectKey: string): PublicMaterialQuestionBankLayout {
    const material = this.requireMaterial(subjectKey, true);
    const layout = this.repository.get(material.id);
    if (!layout) notFound();
    const enabled = layout.nodes.filter((node) => node.enabled);
    const byParent = new Map<string | null, typeof enabled>();
    for (const node of enabled) byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
    const available = new Map<string, boolean>();
    const resolve = (id: string): boolean => {
      if (available.has(id)) return available.get(id)!;
      const node = enabled.find((candidate) => candidate.id === id);
      if (!node) return false;
      const value = node.nodeType === "BANK" ? Boolean(node.packageId) : (byParent.get(node.id) ?? []).some((child) => resolve(child.id));
      available.set(id, value); return value;
    };
    return {
      material: { id: material.id, subjectKey: material.subject_key, label: material.label },
      rootPresentation: layout.rootPresentation,
      nodes: enabled.sort(treeSort).map((node) => ({ id: node.id, nodeKey: node.nodeKey, label: node.label, nodeType: node.nodeType, parentId: node.parentId, displayOrder: node.displayOrder, groupPresentation: node.groupPresentation, available: resolve(node.id) })),
    };
  }

  listPublicQuestions(subjectKey: string, bankNodeId: string, offset = 0, limit = MATERIAL_QUESTION_BANK_PAGE_SIZE): PublicQuestionPage {
    const context = this.requirePublicBank(subjectKey, bankNodeId);
    if (!context.node.packageId) return { total: 0, offset: 0, limit: boundedLimit(limit), items: [] };
    const safeOffset = Math.max(0, Math.trunc(offset));
    const safeLimit = boundedLimit(limit);
    const taxonomyIds = this.targetTaxonomyIds(context.node.packageId, context.node.taxonomyNodeId, Boolean(context.node.includeDescendants));
    const filter = questionFilter(context.node.packageId, context.node.targetMode, taxonomyIds);
    const total = Number((this.database.client.prepare(`select count(*) total from questions q where ${filter.sql}`).get(...filter.params) as { total: number }).total);
    const rows = this.database.client.prepare(`
      select q.id, q.display_order, q.shared_answer,
        pvcontent.content primary_content,
        coalesce(vc.variant_count,0) variant_count,
        coalesce(oc.occurrence_count,0) occurrence_count,
        primary_assignment.taxonomy_node_id primary_taxonomy_id
      from questions q
      left join question_primary_variants pv on pv.question_id=q.id
      left join question_variants pvcontent on pvcontent.id=pv.variant_id
      left join (select question_id,count(*) variant_count from question_variants group by question_id) vc on vc.question_id=q.id
      left join (select v.question_id,count(o.id) occurrence_count from question_variants v left join question_occurrences o on o.variant_id=v.id group by v.question_id) oc on oc.question_id=q.id
      left join question_taxonomy_assignments primary_assignment on primary_assignment.question_id=q.id and primary_assignment.role='PRIMARY'
      where ${filter.sql}
      order by q.display_order,q.id limit ? offset ?
    `).all(...filter.params, safeLimit, safeOffset) as Array<Record<string, unknown>>;
    const taxonomy = this.taxonomyMap(context.node.packageId);
    const sourceSummaries = loadPublicQuestionSourceSummaries(this.database, rows.map((row) => String(row.id)));
    return {
      total, offset: safeOffset, limit: safeLimit,
        items: rows.map((row, index) => ({
          questionId: String(row.id), ordinal: safeOffset + index + 1,
          primaryPreview: documentText(parseDocument(row.primary_content)),
          primaryPreviewRich: previewDocument(parseDocument(row.primary_content)),
          taxonomyBreadcrumb: breadcrumb(String(row.primary_taxonomy_id ?? ""), taxonomy),
        variantCount: Number(row.variant_count), occurrenceCount: Number(row.occurrence_count), sourceSummary: sourceSummaries.get(String(row.id)) ?? [], hasAnswer: row.shared_answer !== null,
      })),
    };
  }

  searchPublicQuestions(subjectKey: string, bankNodeId: string, query: string, offset = 0, limit = MATERIAL_QUESTION_BANK_PAGE_SIZE): PublicQuestionSearchPage {
    const context = this.requirePublicBank(subjectKey, bankNodeId);
    if (!context.node.packageId) notFound();
    const taxonomyNodeIds = this.targetTaxonomyIds(context.node.packageId, context.node.taxonomyNodeId, Boolean(context.node.includeDescendants));
    const result = new QuestionSearchService(this.database).searchPlacement({ packageId: context.node.packageId, targetMode: context.node.targetMode, taxonomyNodeIds }, query, offset, boundedLimit(limit));
    return {
      ...result,
      items: result.items.map((item) => ({
        questionId: item.questionId, ordinal: item.bankOrdinal, bankOrdinal: item.bankOrdinal,
        primaryPreview: item.primaryPreview, primaryPreviewRich: item.primaryPreviewRich, taxonomyBreadcrumb: item.taxonomyBreadcrumb,
        variantCount: item.variantCount, occurrenceCount: item.occurrenceCount, sourceSummary: item.sourceSummary, hasAnswer: item.hasAnswer,
        matchContext: item.matchContext, matchPreview: item.matchPreview,
      })),
    };
  }

  getPublicQuestion(subjectKey: string, bankNodeId: string, questionId: string): PublicQuestionDetail {
    const context = this.requirePublicBank(subjectKey, bankNodeId);
    if (!context.node.packageId) notFound();
    const taxonomyIds = this.targetTaxonomyIds(context.node.packageId, context.node.taxonomyNodeId, Boolean(context.node.includeDescendants));
    const filter = questionFilter(context.node.packageId, context.node.targetMode, taxonomyIds, questionId);
    if (!this.database.client.prepare(`select 1 from questions q where ${filter.sql}`).get(...filter.params)) notFound();
    const aggregate = new SQLiteQuestionRepository(this.database).getQuestion(questionId);
    if (!aggregate) notFound();
    const taxonomy = this.taxonomyMap(aggregate.packageId);
    return {
      questionId: aggregate.id, canonicalOrder: aggregate.displayOrder, primaryVariantId: aggregate.primaryVariantId,
      variants: aggregate.variants.map((variant) => ({
        id: variant.id, displayOrder: variant.displayOrder,
        content: toPublicRichDocument(variant.content, buildPublicRichContentAssetUrl),
        occurrences: variant.occurrences.map(({ createdAt: _createdAt, updatedAt: _updatedAt, updatedBy: _updatedBy, revision: _revision, variantId: _variantId, ...occurrence }) => occurrence),
      })),
      sharedAnswer: aggregate.sharedAnswer ? toPublicRichDocument(aggregate.sharedAnswer, buildPublicRichContentAssetUrl) : null,
      taxonomy: aggregate.taxonomyAssignments.map((assignment) => ({ id: assignment.taxonomyNodeId, role: assignment.role, position: assignment.position, breadcrumb: breadcrumb(assignment.taxonomyNodeId, taxonomy) })),
    };
  }

  isPublicAssetVisible(assetId: string): boolean {
    const banks = this.database.client.prepare(`select n.*,m.subject_key from material_question_bank_nodes n join material_question_bank_layouts l on l.material_id=n.material_id join canonical_materials m on m.id=l.material_id where n.enabled=1 and n.node_type='BANK' and n.package_id is not null and m.available=1`).all() as Array<Record<string, unknown>>;
    for (const bank of banks) {
      const packageId = String(bank.package_id);
      const taxonomyIds = this.targetTaxonomyIds(packageId, bank.taxonomy_node_id ? String(bank.taxonomy_node_id) : null, Boolean(bank.include_descendants));
      const filter = questionFilter(packageId, String(bank.target_mode) as "ALL_PACKAGE_QUESTIONS" | "TAXONOMY_FILTER", taxonomyIds);
      const found = this.database.client.prepare(`select 1 from questions q where ${filter.sql} and (
        exists(select 1 from question_variants v,json_tree(v.content) jt where v.question_id=q.id and jt.key='assetId' and jt.value=?)
        or exists(select 1 from json_tree(q.shared_answer) jt where jt.key='assetId' and jt.value=?)
      ) limit 1`).get(...filter.params, assetId, assetId);
      if (found) return true;
    }
    return false;
  }

  private ensureProductPreset(material: MaterialRow, actor: AdminActor): void {
    const baseline = createProductPresetLayout(material.id, material.subject_key);
    if (!baseline || this.repository.get(material.id)) return;
    this.database.client.transaction(() => {
      if (this.repository.get(material.id)) return;
      this.repository.save({ content: baseline, expectedRevision: 0, actor, operation: "CREATE" });
    })();
  }

  private requireMaterial(subjectKey: string, publicOnly: boolean): MaterialRow {
    const row = this.database.client.prepare(`select id,subject_key,label,available from canonical_materials where subject_key=?${publicOnly ? " and available=1" : ""}`).get(subjectKey) as MaterialRow | undefined;
    if (!row) notFound();
    return row;
  }

  private requirePublicBank(subjectKey: string, bankNodeId: string) {
    const material = this.requireMaterial(subjectKey, true);
    const layout = this.repository.get(material.id);
    const node = layout?.nodes.find((candidate) => candidate.id === bankNodeId && candidate.nodeType === "BANK" && candidate.enabled);
    if (!layout || !node) notFound();
    return { material, layout, node };
  }

  private findWorkflow(materialId: string, actor: AdminActor): MaterialQuestionBankWorkflow | null {
    const row = this.database.client.prepare(`select c.id,c.status,c.revision,c.updated_at,(select count(*) from change_set_items x where x.change_set_id=c.id) item_count
      from change_sets c join change_set_items i on i.change_set_id=c.id
      where i.resource_type=? and i.resource_id=? and c.status not in ('PUBLISHED','REJECTED','CANCELLED','SUPERSEDED')
        and (c.created_by=? or ?='OWNER') order by c.updated_at desc limit 1`).get(MATERIAL_QUESTION_BANK_RESOURCE_TYPE, materialId, actor.actorUserId, actor.actorRole) as WorkflowRow | undefined;
    return row ? workflowFrom(row, Number(row.item_count), ["DRAFT", "NEEDS_CHANGES"].includes(row.status)) : null;
  }

  private readWorkflowSnapshot(changeSetId: string, materialId: string): MaterialQuestionBankLayoutContent | null {
    const row = this.database.client.prepare("select proposed_snapshot from change_set_items where change_set_id=? and resource_type=? and resource_id=?").get(changeSetId, MATERIAL_QUESTION_BANK_RESOURCE_TYPE, materialId) as { proposed_snapshot: string } | undefined;
    return row ? normalizeMaterialQuestionBankLayout(JSON.parse(row.proposed_snapshot)) : null;
  }

  private listPackageOptions(actor: AdminActor): MaterialQuestionBankPackageOption[] {
    const rows = this.database.client.prepare(`select p.id,p.package_key,p.title,p.subject_key,m.label subject_label,
      (select count(*) from questions q where q.package_id=p.id) question_count,
      (select count(*) from question_taxonomy_nodes t where t.package_id=p.id) taxonomy_count
      from question_packages p join canonical_materials m on m.subject_key=p.subject_key order by m.display_order,p.title`).all() as PackageRow[];
    const result: MaterialQuestionBankPackageOption[] = rows.map((row) => ({ id: row.id, packageKey: row.package_key, title: row.title, subjectKey: row.subject_key, subjectLabel: row.subject_label, questionCount: Number(row.question_count), taxonomyCount: Number(row.taxonomy_count), published: true, workflow: null }));
    const condition = actor.actorRole === "OWNER" ? "1=1" : "c.created_by=?";
    const args = actor.actorRole === "OWNER" ? [] : [actor.actorUserId];
    const drafts = this.database.client.prepare(`select i.resource_id,i.proposed_snapshot,c.id,c.status,c.revision,c.updated_at,(select count(*) from change_set_items x where x.change_set_id=c.id) item_count
      from change_set_items i join change_sets c on c.id=i.change_set_id where i.resource_type='question.package' and i.operation='CREATE'
      and c.status in ('DRAFT','NEEDS_CHANGES','SUBMITTED','APPROVED','CONFLICTED') and ${condition}
      and not exists(select 1 from question_packages p where p.id=i.resource_id) order by c.updated_at desc`).all(...args) as Array<Record<string, unknown>>;
    for (const row of drafts) {
      if (result.some((item) => item.id === row.resource_id)) continue;
      const value = JSON.parse(String(row.proposed_snapshot)) as { packageKey: string; title: string; subjectKey: string };
      const subjectLabel = this.database.client.prepare("select label from canonical_materials where subject_key=?").get(value.subjectKey) as { label: string } | undefined;
      result.push({ id: String(row.resource_id), packageKey: value.packageKey, title: value.title, subjectKey: value.subjectKey, subjectLabel: subjectLabel?.label ?? value.subjectKey, questionCount: 0, taxonomyCount: 0, published: false, workflow: workflowFrom(row as unknown as WorkflowRow, Number(row.item_count), ["DRAFT", "NEEDS_CHANGES"].includes(String(row.status))) });
    }
    return result;
  }

  private listTaxonomyOptions(packageIds: string[]): MaterialQuestionBankTaxonomyOption[] {
    if (!packageIds.length) return [];
    const placeholders = packageIds.map(() => "?").join(",");
    const rows = this.database.client.prepare(`select id,package_id,label,parent_id,display_order from question_taxonomy_nodes where package_id in (${placeholders}) order by package_id,coalesce(parent_id,''),display_order`).all(...packageIds) as Array<{ id: string; package_id: string; label: string; parent_id: string | null; display_order: number }>;
    const byPackage = new Map<string, typeof rows>();
    for (const row of rows) byPackage.set(row.package_id, [...(byPackage.get(row.package_id) ?? []), row]);
    return rows.map((row) => ({ id: row.id, packageId: row.package_id, label: row.label, breadcrumb: breadcrumb(row.id, new Map((byPackage.get(row.package_id) ?? []).map((item) => [item.id, { id: item.id, label: item.label, parentId: item.parent_id }]))) }));
  }

  private taxonomyMap(packageId: string): Map<string, { id: string; label: string; parentId: string | null }> {
    const rows = this.database.client.prepare("select id,label,parent_id from question_taxonomy_nodes where package_id=?").all(packageId) as Array<{ id: string; label: string; parent_id: string | null }>;
    return new Map(rows.map((row) => [row.id, { id: row.id, label: row.label, parentId: row.parent_id }]));
  }

  private targetTaxonomyIds(packageId: string, taxonomyNodeId: string | null, descendants: boolean): string[] {
    if (!taxonomyNodeId) return [];
    if (!descendants) return [taxonomyNodeId];
    return (this.database.client.prepare(`with recursive tree(id) as (select id from question_taxonomy_nodes where id=? and package_id=? union all select t.id from question_taxonomy_nodes t join tree on t.parent_id=tree.id where t.package_id=?) select id from tree`).all(taxonomyNodeId, packageId, packageId) as Array<{ id: string }>).map((row) => row.id);
  }
}

function questionFilter(packageId: string, mode: string | null, taxonomyIds: string[], questionId?: string) {
  const params: unknown[] = [packageId];
  let sql = "q.package_id=?";
  if (mode === "TAXONOMY_FILTER") {
    if (!taxonomyIds.length) return { sql: "0=1", params: [] as unknown[] };
    sql += ` and exists(select 1 from question_taxonomy_assignments a where a.question_id=q.id and a.taxonomy_node_id in (${taxonomyIds.map(() => "?").join(",")}))`;
    params.push(...taxonomyIds);
  }
  if (questionId) { sql += " and q.id=?"; params.push(questionId); }
  return { sql, params };
}

function boundedLimit(value: number): number { return Math.min(MATERIAL_QUESTION_BANK_MAX_PAGE_SIZE, Math.max(1, Math.trunc(value || MATERIAL_QUESTION_BANK_PAGE_SIZE))); }
function contentOf(entity: MaterialQuestionBankLayoutEntity): MaterialQuestionBankLayoutContent {
  return { materialId: entity.materialId, rootPresentation: entity.rootPresentation, nodes: entity.nodes };
}
function workflowFrom(row: { id: string; status: ChangeSetStatus; revision: number; updatedAt?: number; updated_at?: number }, itemCount: number, editable: boolean): MaterialQuestionBankWorkflow { return { id: row.id, status: row.status, revision: Number(row.revision), itemCount, editable, updatedAt: Number(row.updatedAt ?? row.updated_at ?? 0) }; }
function crossSubjectWarnings(layout: MaterialQuestionBankLayoutContent, subjectKey: string, materialLabel: string, packages: MaterialQuestionBankPackageOption[]) { const byId = new Map(packages.map((item) => [item.id, item])); return layout.nodes.flatMap((node) => { const pack = node.packageId ? byId.get(node.packageId) : null; return pack && pack.subjectKey !== subjectKey ? [{ code: "CROSS_SUBJECT_PLACEMENT" as const, nodeId: node.id, message: `هذه الحزمة مصنفة ضمن ${pack.subjectLabel}، لكنها ستظهر داخل بنك ${materialLabel} وفق هذا التوزيع.` }] : []; }); }
function treeSort(left: { parentId: string | null; displayOrder: number; id: string }, right: { parentId: string | null; displayOrder: number; id: string }) { return String(left.parentId).localeCompare(String(right.parentId)) || left.displayOrder - right.displayOrder || left.id.localeCompare(right.id); }
function breadcrumb(id: string, nodes: Map<string, { id: string; label: string; parentId: string | null }>): string { const parts: string[] = []; const seen = new Set<string>(); let currentId: string | null = id; while (currentId && !seen.has(currentId)) { seen.add(currentId); const current = nodes.get(currentId); if (!current) break; parts.unshift(current.label); currentId = current.parentId; } return parts.join(" / ") || "غير مصنّف"; }
function parseDocument(value: unknown): CanonicalRichDocument | null { if (!value) return null; if (typeof value === "string") try { return JSON.parse(value) as CanonicalRichDocument; } catch { return null; } return value as CanonicalRichDocument; }
function documentText(document: CanonicalRichDocument | null): string { return extractRichDocumentPlainText(document).slice(0, 220) || (document ? "محتوى بصري" : "لا يوجد نص"); }
function previewDocument(document: CanonicalRichDocument | null): PublicRichDocument { return document ? toPublicRichPreview(document) : { type: "doc", version: 1, blocks: [] }; }
function assertActor(actor: AdminActor): void { if (!actor.actorUserId || !["OWNER", "ADMIN"].includes(actor.actorRole)) invalid("Authenticated Admin is required."); }
function invalid(message: string): never { throw new MaterialQuestionBankError("MATERIAL_BANK_INVALID", message); }
function notFound(): never { throw new MaterialQuestionBankError("MATERIAL_BANK_NOT_FOUND", "Material Question Bank resource was not found."); }

let singleton: MaterialQuestionBankService | undefined;
export function createMaterialQuestionBankService(database: ContentDatabase) { return new MaterialQuestionBankService(database); }
export function getMaterialQuestionBankService() { singleton ??= new MaterialQuestionBankService(getContentDatabase()); return singleton; }
