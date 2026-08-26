import { v7 as uuidv7 } from "uuid";
import { extractRichDocumentPlainText } from "@/lib/rich-content";
import type { AdminActor } from "../admin-auth";
import { createCanonicalContentRepository } from "../canonical-content";
import { createChangeManagementService } from "../change-management";
import type { ChangeOperation, ChangeSnapshot } from "../change-management";
import type { ContentDatabase } from "../content";
import { getContentDatabase } from "../content";
import { SQLiteQuestionRepository } from "../questions";
import type {
  CanonicalRichDocument,
  QuestionBrowseContent,
  QuestionItemContent,
  QuestionPackageContent,
  QuestionTaxonomyContent,
} from "../questions";
import {
  QUESTION_EDITOR_PAGE_SIZE,
  QUESTION_EDITOR_RESOURCE_TYPES,
  type EffectiveBrowseNode,
  type EffectiveQuestionDetail,
  type EffectiveQuestionPackage,
  type EffectiveTaxonomyNode,
  type PreparedQuestionEditorIds,
  type QuestionEditorDraft,
  type QuestionEditorProposal,
  type QuestionPackageCounts,
  type QuestionPackageWorkspaceSummary,
  type QuestionPackageWorkflow,
  type QuestionSummary,
} from "./contracts";
import { QuestionEditorError } from "./errors";

type DraftItemRow = {
  id: string;
  resource_type: string;
  resource_id: string;
  operation: ChangeOperation;
  proposed_snapshot: string;
  revision: number;
};

type DraftRow = {
  id: string;
  title: string;
  status: "DRAFT" | "NEEDS_CHANGES";
  revision: number;
  updated_at: number;
  item_count: number;
};

export class QuestionEditorService {
  private readonly repository: SQLiteQuestionRepository;
  private readonly changes;

  constructor(private readonly database: ContentDatabase) {
    this.repository = new SQLiteQuestionRepository(database);
    this.changes = createChangeManagementService(database);
  }

  listPackages(actor: AdminActor): { packages: QuestionPackageWorkspaceSummary[]; materials: Array<{ subjectKey: string; label: string; available: boolean }> } {
    assertActor(actor);
    const materials = createCanonicalContentRepository(this.database).getSnapshot().materials
      .map(({ subjectKey, label, available }) => ({ subjectKey, label, available }));
    const labels = new Map(materials.map((item) => [item.subjectKey, item.label]));
    const canonical = this.database.client.prepare(`
      select p.*,
        (select count(*) from questions q where q.package_id = p.id) question_count,
        (select count(*) from question_variants v join questions q on q.id = v.question_id where q.package_id = p.id) variant_count,
        (select count(*) from question_occurrences o join question_variants v on v.id = o.variant_id join questions q on q.id = v.question_id where q.package_id = p.id) occurrence_count,
        (select count(*) from question_taxonomy_nodes t where t.package_id = p.id) taxonomy_count,
        (select count(*) from question_bank_browse_nodes b where b.package_id = p.id) browse_count
      from question_packages p order by p.subject_key, p.bank_browse_entry_order
    `).all() as Array<Record<string, unknown>>;
    const result = canonical.map((row) => {
      const activeDraft = this.findEditableDraft(String(row.id), actor);
      const effectivePackage = activeDraft ? this.readDraftItem(activeDraft.id, "question.package", String(row.id)) : null;
      const content = effectivePackage ? parseSnapshot<QuestionPackageContent>(effectivePackage.proposed_snapshot) : packageContentFromRow(row);
      const counts = activeDraft ? this.effectiveCounts(String(row.id), activeDraft.id) : countsFromRow(row);
      return this.packageSummary(String(row.id), content, Number(row.revision), Number(row.updated_at), true, labels, counts, activeDraft, activeDraft ? workflowFromDraft(activeDraft) : null);
    });

    const workflowVisibility = actor.actorRole === "OWNER" ? "1=1" : "c.created_by = ?";
    const workflowArgs = actor.actorRole === "OWNER" ? [] : [actor.actorUserId];
    const draftPackages = this.database.client.prepare(`
      select i.resource_id, i.proposed_snapshot, c.id change_set_id, c.title, c.status, c.revision change_set_revision,
             c.updated_at, (select count(*) from change_set_items x where x.change_set_id = c.id) item_count
      from change_set_items i join change_sets c on c.id = i.change_set_id
      where i.resource_type = 'question.package' and i.operation = 'CREATE'
        and ${workflowVisibility} and c.status in ('DRAFT','NEEDS_CHANGES','SUBMITTED','APPROVED','CONFLICTED')
        and not exists (select 1 from question_packages p where p.id = i.resource_id)
      order by c.updated_at desc
    `).all(...workflowArgs) as Array<Record<string, unknown>>;
    for (const row of draftPackages) {
      if (result.some((item) => item.id === row.resource_id)) continue;
      const content = parseSnapshot<QuestionPackageContent>(String(row.proposed_snapshot));
      const workflow = workflowFromJoinedRow(row);
      const draft = workflow.editable ? draftFromJoinedRow(row) : null;
      result.push(this.packageSummary(String(row.resource_id), content, 0, Number(row.updated_at), false, labels, this.effectiveCounts(String(row.resource_id), workflow.id), draft, workflow));
    }
    return { packages: result, materials };
  }

  getPackage(packageId: string, actor: AdminActor) {
    assertActor(actor);
    const canonical = this.repository.getPackage(packageId);
    const activeDraft = this.findEditableDraft(packageId, actor);
    const packageItem = activeDraft ? this.readDraftItem(activeDraft.id, "question.package", packageId) : null;
    if (!canonical && !packageItem) notFound();
    const content = packageItem ? parseSnapshot<QuestionPackageContent>(packageItem.proposed_snapshot) : packageContent(canonical!);
    const effectivePackage: EffectiveQuestionPackage = {
      id: packageId,
      content,
      revision: canonical?.revision ?? 0,
      updatedAt: canonical?.updatedAt ?? activeDraft?.updatedAt ?? null,
      published: Boolean(canonical),
      draft: Boolean(packageItem),
    };
    const taxonomy = this.overlayTaxonomy(packageId, activeDraft?.id ?? null);
    const browse = this.overlayBrowse(packageId, activeDraft?.id ?? null);
    const material = createCanonicalContentRepository(this.database).getSnapshot().materials.find((item) => item.subjectKey === content.subjectKey);
    const otherDrafts = this.countOtherDrafts(packageId, actor.actorUserId);
    return {
      package: effectivePackage,
      subjectLabel: material?.label ?? content.subjectKey,
      counts: activeDraft ? this.effectiveCounts(packageId, activeDraft.id) : this.canonicalCounts(packageId),
      taxonomy,
      browse,
      activeDraft,
      otherAdminDraftCount: otherDrafts,
      nextQuestionOrder: this.nextQuestionOrder(packageId, activeDraft?.id ?? null),
    };
  }

  listQuestions(packageId: string, actor: AdminActor, offset = 0, limit = QUESTION_EDITOR_PAGE_SIZE) {
    const workspace = this.getPackage(packageId, actor);
    const boundedLimit = Math.min(Math.max(1, Math.trunc(limit)), QUESTION_EDITOR_PAGE_SIZE);
    const boundedOffset = Math.max(0, Math.trunc(offset));
    const draftId = workspace.activeDraft?.id ?? "";
    const rows = this.database.client.prepare(`
      with draft_questions as (
        select i.resource_id id,
          cast(json_extract(i.proposed_snapshot, '$.displayOrder') as integer) display_order,
          0 revision, 1 draft, case when i.operation = 'CREATE' then 1 else 0 end draft_only,
          i.proposed_snapshot snapshot,
          null primary_content, null variant_count, null occurrence_count,
          null has_answer, null primary_taxonomy_id
        from change_set_items i
        where i.change_set_id = ? and i.resource_type = 'question.item'
          and json_extract(i.proposed_snapshot, '$.packageId') = ?
      ), canonical_questions as (
        select q.id, q.display_order, q.revision, 0 draft, 0 draft_only, null snapshot, v.content primary_content,
          coalesce(vc.variant_count, 0) variant_count,
          coalesce(oc.occurrence_count, 0) occurrence_count,
          case when q.shared_answer is null then 0 else 1 end has_answer,
          pt.taxonomy_node_id primary_taxonomy_id
        from questions q
        left join question_primary_variants pv on pv.question_id = q.id
        left join question_variants v on v.id = pv.variant_id
        left join (
          select question_id, count(*) variant_count
          from question_variants group by question_id
        ) vc on vc.question_id = q.id
        left join (
          select v.question_id, count(*) occurrence_count
          from question_occurrences o join question_variants v on v.id = o.variant_id
          group by v.question_id
        ) oc on oc.question_id = q.id
        left join question_taxonomy_assignments pt
          on pt.question_id = q.id and pt.role = 'PRIMARY'
        where q.package_id = ? and not exists (select 1 from draft_questions d where d.id = q.id)
      )
      select * from (select * from draft_questions union all select * from canonical_questions)
      order by display_order, id limit ? offset ?
    `).all(draftId, packageId, packageId, boundedLimit, boundedOffset) as Array<Record<string, unknown>>;
    const total = this.effectiveCounts(packageId, draftId).questionCount;
    const taxonomy = new Map(workspace.taxonomy.map((node) => [node.id, node]));
    const items = rows.map((row): QuestionSummary => {
      if (Number(row.draft)) {
        const desired = parseSnapshot<QuestionItemContent>(String(row.snapshot));
        const primary = desired.variants.find((item) => item.id === desired.primaryVariantId) ?? desired.variants[0];
        return {
          id: String(row.id), displayOrder: desired.displayOrder, primaryPreview: documentText(primary?.content),
          taxonomyBreadcrumb: assignmentBreadcrumb(desired.taxonomyAssignments.find((item) => item.role === "PRIMARY")?.taxonomyNodeId, taxonomy),
          variantCount: desired.variants.length,
          occurrenceCount: desired.variants.reduce((sum, item) => sum + item.occurrences.length, 0),
          hasAnswer: Boolean(desired.sharedAnswer), revision: Number(row.revision), draft: true, draftOnly: Boolean(row.draft_only),
        };
      }
      const primary = parseMaybeJson<CanonicalRichDocument>(row.primary_content);
      return { id: String(row.id), displayOrder: Number(row.display_order), primaryPreview: documentText(primary), taxonomyBreadcrumb: assignmentBreadcrumb(typeof row.primary_taxonomy_id === "string" ? row.primary_taxonomy_id : undefined, taxonomy), variantCount: Number(row.variant_count), occurrenceCount: Number(row.occurrence_count), hasAnswer: Boolean(row.has_answer), revision: Number(row.revision), draft: false, draftOnly: false };
    });
    return { items, total, limit: boundedLimit, offset: boundedOffset };
  }

  getQuestion(packageId: string, questionId: string, actor: AdminActor): EffectiveQuestionDetail {
    const workspace = this.getPackage(packageId, actor);
    const canonical = this.repository.getQuestion(questionId);
    if (canonical && canonical.packageId !== packageId) notFound();
    const item = workspace.activeDraft ? this.readDraftItem(workspace.activeDraft.id, "question.item", questionId) : null;
    if (!canonical && !item) notFound();
    const content = item ? parseSnapshot<QuestionItemContent>(item.proposed_snapshot) : questionContent(canonical!);
    if (content.packageId !== packageId) notFound();
    return {
      id: questionId,
      content,
      revision: canonical?.revision ?? 0,
      draft: Boolean(item),
      draftOnly: item?.operation === "CREATE",
      publishedVariantIds: canonical?.variants.map((variant) => variant.id) ?? [],
      publishedOccurrenceIds: canonical?.variants.flatMap((variant) => variant.occurrences.map((occurrence) => occurrence.id)) ?? [],
    };
  }

  prepareIds(input: Partial<Record<"blocks" | "verses" | "occurrences" | "taxonomy" | "browse", number>> = {}): PreparedQuestionEditorIds {
    const ids = (count = 0) => Array.from({ length: Math.min(100, Math.max(0, Math.trunc(count))) }, () => uuidv7());
    return { questionId: uuidv7(), variantId: uuidv7(), blockIds: ids(input.blocks), verseIds: ids(input.verses), occurrenceIds: ids(input.occurrences), taxonomyIds: ids(input.taxonomy), browseIds: ids(input.browse) };
  }

  save(packageId: string, proposal: QuestionEditorProposal, actor: AdminActor) {
    assertActor(actor);
    if (!QUESTION_EDITOR_RESOURCE_TYPES.includes(proposal.resourceType)) invalid("Unsupported Question editor resource.");
    if (proposal.resourceType !== "question.package" && proposal.desired.packageId !== packageId) invalid("Question editor Package ownership is invalid.");
    if (proposal.resourceType === "question.package" && proposal.resourceId !== packageId) invalid("Question Package identity is invalid.");
    const canonicalRevision = this.canonicalRevision(proposal.resourceType, proposal.resourceId);
    const operation: ChangeOperation = canonicalRevision === null ? "CREATE" : "UPDATE";
    const active = this.findEditableDraft(packageId, actor);
    if (!active) {
      const created = this.changes.createChangeSet({
        title: `مسودة تعديلات: ${this.packageTitle(packageId, proposal)}`,
        description: "تعديلات مرئية على محتوى حزمة الأسئلة؛ لا تصبح قانونية قبل مراجعة OWNER ونشرها.",
        initialItem: { resourceType: proposal.resourceType, resourceId: proposal.resourceId, expectedRevision: canonicalRevision ?? 0, operation, desired: proposal.desired },
      }, actor);
      return compactDraft(created.changeSet, created.items.length);
    }
    const updated = this.changes.addItem(active.id, { resourceType: proposal.resourceType, resourceId: proposal.resourceId, expectedRevision: canonicalRevision ?? 0, operation, desired: proposal.desired, expectedChangeSetRevision: active.revision }, actor);
    return compactDraft(updated.changeSet, updated.items.length);
  }

  removeDraftOnly(packageId: string, itemId: string, actor: AdminActor) {
    const active = this.findEditableDraft(packageId, actor);
    if (!active) notFound();
    const item = this.database.client.prepare("select * from change_set_items where id = ? and change_set_id = ?").get(itemId, active.id) as DraftItemRow | undefined;
    if (!item || item.operation !== "CREATE") invalid("Only resources created in this Draft may be removed here.");
    this.assertDraftRemovalUnreferenced(active.id, item);
    const updated = this.changes.removeItem(active.id, item.id, active.revision, actor);
    return compactDraft(updated.changeSet, updated.items.length);
  }

  submit(packageId: string, expectedRevision: number, actor: AdminActor) {
    const active = this.findEditableDraft(packageId, actor);
    if (!active || active.revision !== expectedRevision) throw new QuestionEditorError("QUESTION_EDITOR_CONFLICT", "The editing Draft changed before submission.");
    return this.changes.submit(active.id, expectedRevision, actor).changeSet;
  }

  private packageSummary(id: string, content: QuestionPackageContent, revision: number, updatedAt: number | null, published: boolean, labels: Map<string, string>, counts: QuestionPackageCounts, draft: QuestionEditorDraft | null, workflow: QuestionPackageWorkflow | null): QuestionPackageWorkspaceSummary {
    return { id, ...content, subjectLabel: labels.get(content.subjectKey) ?? content.subjectKey, revision, updatedAt, published, activeDraft: draft, workflow, ...counts };
  }

  private findEditableDraft(packageId: string, actor: AdminActor): QuestionEditorDraft | null {
    const row = this.database.client.prepare(`
      select c.id, c.title, c.status, c.revision, c.updated_at,
        (select count(*) from change_set_items x where x.change_set_id = c.id) item_count
      from change_sets c where c.created_by = ? and c.status in ('DRAFT','NEEDS_CHANGES')
        and exists (select 1 from change_set_items i where i.change_set_id = c.id and (
          (i.resource_type = 'question.package' and i.resource_id = ?)
          or json_extract(i.proposed_snapshot, '$.packageId') = ?
        )) order by c.updated_at desc limit 1
    `).get(actor.actorUserId, packageId, packageId) as DraftRow | undefined;
    return row ? draftFromRow(row) : null;
  }

  private readDraftItem(changeSetId: string, resourceType: string, resourceId: string): DraftItemRow | null {
    return this.database.client.prepare("select id, resource_type, resource_id, operation, proposed_snapshot, revision from change_set_items where change_set_id = ? and resource_type = ? and resource_id = ?")
      .get(changeSetId, resourceType, resourceId) as DraftItemRow | undefined ?? null;
  }

  private overlayTaxonomy(packageId: string, draftId: string | null): EffectiveTaxonomyNode[] {
    const rows = new Map<string, EffectiveTaxonomyNode>(this.repository.listTaxonomy(packageId).map((node) => [node.id, { id: node.id, ...taxonomyContent(node), revision: node.revision, draft: false, draftOnly: false, draftItemId: null }]));
    if (draftId) for (const item of this.readDraftItems(draftId, "question.taxonomy", packageId)) {
      const desired = parseSnapshot<QuestionTaxonomyContent>(item.proposed_snapshot);
      rows.set(item.resource_id, { id: item.resource_id, ...desired, revision: rows.get(item.resource_id)?.revision ?? 0, draft: true, draftOnly: item.operation === "CREATE", draftItemId: item.id });
    }
    return [...rows.values()].sort(hierarchySort);
  }

  private overlayBrowse(packageId: string, draftId: string | null): EffectiveBrowseNode[] {
    const rows = new Map<string, EffectiveBrowseNode>(this.repository.listBrowseNodes(packageId).map((node) => [node.id, { id: node.id, ...browseContent(node), revision: node.revision, draft: false, draftOnly: false, draftItemId: null }]));
    if (draftId) for (const item of this.readDraftItems(draftId, "question.browse", packageId)) {
      const desired = parseSnapshot<QuestionBrowseContent>(item.proposed_snapshot);
      rows.set(item.resource_id, { id: item.resource_id, ...desired, revision: rows.get(item.resource_id)?.revision ?? 0, draft: true, draftOnly: item.operation === "CREATE", draftItemId: item.id });
    }
    return [...rows.values()].sort(hierarchySort);
  }

  private readDraftItems(changeSetId: string, resourceType: string, packageId: string): DraftItemRow[] {
    return this.database.client.prepare("select id, resource_type, resource_id, operation, proposed_snapshot, revision from change_set_items where change_set_id = ? and resource_type = ? and json_extract(proposed_snapshot, '$.packageId') = ?")
      .all(changeSetId, resourceType, packageId) as DraftItemRow[];
  }

  private canonicalCounts(packageId: string): QuestionPackageCounts {
    const row = this.database.client.prepare(`select
      (select count(*) from questions where package_id = ?) question_count,
      (select count(*) from question_variants v join questions q on q.id=v.question_id where q.package_id = ?) variant_count,
      (select count(*) from question_occurrences o join question_variants v on v.id=o.variant_id join questions q on q.id=v.question_id where q.package_id = ?) occurrence_count,
      (select count(*) from question_taxonomy_nodes where package_id = ?) taxonomy_count,
      (select count(*) from question_bank_browse_nodes where package_id = ?) browse_count`).get(packageId, packageId, packageId, packageId, packageId) as Record<string, unknown>;
    return countsFromRow(row);
  }

  private effectiveCounts(packageId: string, draftId: string): QuestionPackageCounts {
    if (!draftId) return this.canonicalCounts(packageId);
    const row = this.database.client.prepare(`select
      (select count(*) from questions q where q.package_id=? and not exists(select 1 from change_set_items i where i.change_set_id=? and i.resource_type='question.item' and i.resource_id=q.id)) +
      (select count(*) from change_set_items i where i.change_set_id=? and i.resource_type='question.item' and json_extract(i.proposed_snapshot,'$.packageId')=?) question_count,
      (select count(*) from question_variants v join questions q on q.id=v.question_id where q.package_id=? and not exists(select 1 from change_set_items i where i.change_set_id=? and i.resource_type='question.item' and i.resource_id=q.id)) +
      coalesce((select sum(json_array_length(json_extract(i.proposed_snapshot,'$.variants'))) from change_set_items i where i.change_set_id=? and i.resource_type='question.item' and json_extract(i.proposed_snapshot,'$.packageId')=?),0) variant_count,
      (select count(*) from question_occurrences o join question_variants v on v.id=o.variant_id join questions q on q.id=v.question_id where q.package_id=? and not exists(select 1 from change_set_items i where i.change_set_id=? and i.resource_type='question.item' and i.resource_id=q.id)) +
      coalesce((select sum((select coalesce(sum(json_array_length(json_extract(v.value,'$.occurrences'))),0) from json_each(json_extract(i.proposed_snapshot,'$.variants')) v)) from change_set_items i where i.change_set_id=? and i.resource_type='question.item' and json_extract(i.proposed_snapshot,'$.packageId')=?),0) occurrence_count,
      (select count(*) from question_taxonomy_nodes t where t.package_id=? and not exists(select 1 from change_set_items i where i.change_set_id=? and i.resource_type='question.taxonomy' and i.resource_id=t.id)) +
      (select count(*) from change_set_items i where i.change_set_id=? and i.resource_type='question.taxonomy' and json_extract(i.proposed_snapshot,'$.packageId')=?) taxonomy_count,
      (select count(*) from question_bank_browse_nodes b where b.package_id=? and not exists(select 1 from change_set_items i where i.change_set_id=? and i.resource_type='question.browse' and i.resource_id=b.id)) +
      (select count(*) from change_set_items i where i.change_set_id=? and i.resource_type='question.browse' and json_extract(i.proposed_snapshot,'$.packageId')=?) browse_count
    `).get(packageId,draftId,draftId,packageId, packageId,draftId,draftId,packageId, packageId,draftId,draftId,packageId, packageId,draftId,draftId,packageId, packageId,draftId,draftId,packageId) as Record<string, unknown>;
    return countsFromRow(row);
  }

  private canonicalRevision(type: string, id: string): number | null {
    const table = { "question.package": "question_packages", "question.taxonomy": "question_taxonomy_nodes", "question.browse": "question_bank_browse_nodes", "question.item": "questions" }[type];
    if (!table) invalid("Unsupported resource type.");
    const row = this.database.client.prepare(`select revision from ${table} where id = ?`).get(id) as { revision: number } | undefined;
    return row?.revision ?? null;
  }

  private packageTitle(packageId: string, proposal: QuestionEditorProposal): string {
    if (proposal.resourceType === "question.package") return proposal.desired.title;
    const canonical = this.repository.getPackage(packageId);
    if (canonical) return canonical.title;
    const packageDraft = this.database.client.prepare("select proposed_snapshot from change_set_items where resource_type='question.package' and resource_id=? order by updated_at desc limit 1").get(packageId) as { proposed_snapshot: string } | undefined;
    return packageDraft ? parseSnapshot<QuestionPackageContent>(packageDraft.proposed_snapshot).title : "حزمة الأسئلة";
  }

  private countOtherDrafts(packageId: string, actorId: string): number {
    const row = this.database.client.prepare(`select count(distinct c.id) count from change_sets c join change_set_items i on i.change_set_id=c.id where c.created_by<>? and c.status in ('DRAFT','NEEDS_CHANGES') and ((i.resource_type='question.package' and i.resource_id=?) or json_extract(i.proposed_snapshot,'$.packageId')=?)`).get(actorId, packageId, packageId) as { count: number };
    return Number(row.count);
  }

  private nextQuestionOrder(packageId: string, draftId: string | null): number {
    const draftMax = draftId ? Number((this.database.client.prepare("select coalesce(max(cast(json_extract(proposed_snapshot,'$.displayOrder') as integer)),0) value from change_set_items where change_set_id=? and resource_type='question.item' and json_extract(proposed_snapshot,'$.packageId')=?").get(draftId, packageId) as { value: number }).value) : 0;
    const canonicalMax = Number((this.database.client.prepare("select coalesce(max(display_order),0) value from questions where package_id=?").get(packageId) as { value: number }).value);
    return Math.max(draftMax, canonicalMax) + 1;
  }

  private assertDraftRemovalUnreferenced(changeSetId: string, item: DraftItemRow): void {
    const snapshots = (this.database.client.prepare("select resource_type, resource_id, proposed_snapshot from change_set_items where change_set_id=? and id<>?").all(changeSetId, item.id) as Array<{ resource_type: string; resource_id: string; proposed_snapshot: string }>).map((row) => ({ ...row, value: parseSnapshot<Record<string, unknown>>(row.proposed_snapshot) }));
    if (item.resource_type === "question.taxonomy") {
      if (snapshots.some((row) => row.value.parentId === item.resource_id || row.value.taxonomyNodeId === item.resource_id || JSON.stringify(row.value.taxonomyAssignments ?? []).includes(item.resource_id))) invalid("Draft Taxonomy node is still referenced.");
    }
    if (item.resource_type === "question.browse" && snapshots.some((row) => row.value.parentId === item.resource_id)) invalid("Draft Browse node still has children.");
  }
}

function draftFromRow(row: DraftRow): QuestionEditorDraft { return { id: row.id, title: row.title, status: row.status, revision: Number(row.revision), itemCount: Number(row.item_count), updatedAt: Number(row.updated_at) }; }
function draftFromJoinedRow(row: Record<string, unknown>): QuestionEditorDraft { return { id: String(row.change_set_id), title: String(row.title), status: row.status as "DRAFT" | "NEEDS_CHANGES", revision: Number(row.change_set_revision), itemCount: Number(row.item_count), updatedAt: Number(row.updated_at) }; }
function workflowFromJoinedRow(row: Record<string, unknown>): QuestionPackageWorkflow { const status = row.status as QuestionPackageWorkflow["status"]; return { id: String(row.change_set_id), title: String(row.title), status, revision: Number(row.change_set_revision), itemCount: Number(row.item_count), updatedAt: Number(row.updated_at), editable: status === "DRAFT" || status === "NEEDS_CHANGES" }; }
function workflowFromDraft(draft: QuestionEditorDraft): QuestionPackageWorkflow { return { ...draft, editable: true }; }
function compactDraft(changeSet: { id: string; title: string; status: string; revision: number; updatedAt: number }, itemCount: number): QuestionEditorDraft { return { id: changeSet.id, title: changeSet.title, status: changeSet.status as "DRAFT" | "NEEDS_CHANGES", revision: changeSet.revision, itemCount, updatedAt: changeSet.updatedAt }; }
function parseSnapshot<T>(value: string): T { return JSON.parse(value) as T; }
function parseMaybeJson<T>(value: unknown): T | null { if (!value) return null; return typeof value === "string" ? JSON.parse(value) as T : value as T; }
function packageContent(value: NonNullable<ReturnType<SQLiteQuestionRepository["getPackage"]>>): QuestionPackageContent { return { packageKey: value.packageKey, title: value.title, subjectKey: value.subjectKey, language: value.language, contentRevision: value.contentRevision, bankBrowseMode: value.bankBrowseMode, bankBrowseEntryKey: value.bankBrowseEntryKey, bankBrowseEntryLabel: value.bankBrowseEntryLabel, bankBrowseEntryOrder: value.bankBrowseEntryOrder, sourceAssetId: value.sourceAssetId, assetBindings: [] }; }
function packageContentFromRow(row: Record<string, unknown>): QuestionPackageContent { return { packageKey: String(row.package_key), title: String(row.title), subjectKey: String(row.subject_key), language: String(row.language), contentRevision: Number(row.content_revision), bankBrowseMode: row.bank_browse_mode as QuestionPackageContent["bankBrowseMode"], bankBrowseEntryKey: String(row.bank_browse_entry_key), bankBrowseEntryLabel: String(row.bank_browse_entry_label), bankBrowseEntryOrder: Number(row.bank_browse_entry_order), sourceAssetId: row.source_asset_id ? String(row.source_asset_id) : null, assetBindings: [] }; }
function taxonomyContent(value: { packageId: string; nodeKey: string; label: string; kind: string; parentId: string | null; displayOrder: number }): QuestionTaxonomyContent { return { packageId: value.packageId, nodeKey: value.nodeKey, label: value.label, kind: value.kind, parentId: value.parentId, displayOrder: value.displayOrder }; }
function browseContent(value: { packageId: string; nodeKey: string; label: string; nodeType: QuestionBrowseContent["nodeType"]; parentId: string | null; displayOrder: number; taxonomyNodeId: string | null; includeDescendants: boolean | null }): QuestionBrowseContent { return { packageId: value.packageId, nodeKey: value.nodeKey, label: value.label, nodeType: value.nodeType, parentId: value.parentId, displayOrder: value.displayOrder, taxonomyNodeId: value.taxonomyNodeId, includeDescendants: value.includeDescendants }; }
function questionContent(value: NonNullable<ReturnType<SQLiteQuestionRepository["getQuestion"]>>): QuestionItemContent { return { packageId: value.packageId, displayOrder: value.displayOrder, primaryVariantId: value.primaryVariantId, taxonomyAssignments: value.taxonomyAssignments.map(({ taxonomyNodeId, role, position }) => ({ taxonomyNodeId, role, position })), variants: value.variants.map((variant) => ({ id: variant.id, displayOrder: variant.displayOrder, content: variant.content, occurrences: variant.occurrences.map(({ id, displayOrder, sourceKind, year, roundCode, session, sourceName, notes, rawLabel, branches, qualifiers }) => ({ id, displayOrder, sourceKind, year, roundCode, session, sourceName, notes, rawLabel, branches, qualifiers })) })), sharedAnswer: value.sharedAnswer }; }
function countsFromRow(row: Record<string, unknown>): QuestionPackageCounts { return { questionCount: Number(row.question_count ?? 0), variantCount: Number(row.variant_count ?? 0), occurrenceCount: Number(row.occurrence_count ?? 0), taxonomyCount: Number(row.taxonomy_count ?? 0), browseCount: Number(row.browse_count ?? 0) }; }
function hierarchySort<T extends { parentId: string | null; displayOrder: number; id: string }>(left: T, right: T) { return String(left.parentId).localeCompare(String(right.parentId)) || left.displayOrder - right.displayOrder || left.id.localeCompare(right.id); }
function documentText(document: CanonicalRichDocument | null | undefined): string { return extractRichDocumentPlainText(document).slice(0, 180) || (document ? "محتوى بصري" : "لا يوجد نص"); }
function assignmentBreadcrumb(id: string | undefined, nodes: Map<string, EffectiveTaxonomyNode>): string { if (!id) return "غير مصنّف"; const parts: string[] = []; const seen = new Set<string>(); let current = nodes.get(id); while (current && !seen.has(current.id)) { seen.add(current.id); parts.unshift(current.label); current = current.parentId ? nodes.get(current.parentId) : undefined; } return parts.join(" / ") || "غير مصنّف"; }
function assertActor(actor: AdminActor) { if (!actor.actorUserId || !["OWNER", "ADMIN"].includes(actor.actorRole)) throw new QuestionEditorError("QUESTION_EDITOR_FORBIDDEN", "Authenticated Admin actor is required."); }
function invalid(message: string): never { throw new QuestionEditorError("QUESTION_EDITOR_INVALID", message); }
function notFound(): never { throw new QuestionEditorError("QUESTION_EDITOR_NOT_FOUND", "Question editor resource was not found."); }

let singleton: QuestionEditorService | undefined;
export function createQuestionEditorService(database: ContentDatabase) { return new QuestionEditorService(database); }
export function getQuestionEditorService() { singleton ??= new QuestionEditorService(getContentDatabase()); return singleton; }
