import { v7 as uuidv7 } from "uuid";
import { extractRichDocumentPlainText } from "@/lib/rich-content";
import { createAssetService } from "../assets";
import type { AdminActor } from "../admin-auth";
import { createCanonicalContentRepository } from "../canonical-content";
import { getContentDatabase, type ContentDatabase } from "../content";
import { loadPublicQuestionSourceSummaries, type PublicQuestionSourceSummary } from "../questions/public-provenance";
import {
  assertCanonicalRichDocument,
  QuestionDomainConflictError,
  QuestionDomainError,
  SQLiteQuestionRepository,
  type CanonicalRichDocument,
  type QuestionAggregate,
  type QuestionItemContent,
  type QuestionOccurrenceContent,
  type QuestionPackageEntity,
  type QuestionSourceKind,
} from "../questions";
import { QUESTION_SOURCE_KINDS } from "../questions/contracts";
import { QuestionSearchService, type QuestionSearchFilters } from "../question-search";
import { QuestionEditorError } from "./errors";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_VARIANTS = 100;
const MAX_OCCURRENCES_PER_VARIANT = 1_000;
const MAX_ASSIGNMENTS = 100;
const MAX_TAGS = 100;
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

export interface DirectQuestionPackageSourceAsset {
  id: string;
  originalFilename: string;
  displayName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  revision: number;
  sourceContentRevision: number | null;
  inspectionStatus: string | null;
  inspectedAt: number | null;
  liveContentIsNewer: boolean;
}

export interface DirectQuestionPackagePlacement {
  materialId: string;
  subjectKey: string;
  materialLabel: string;
  nodeId: string;
  nodeKey: string;
  nodeLabel: string;
  nodeType: "GROUP" | "BANK";
  parentId: string | null;
  displayOrder: number;
}

export interface DirectQuestionPackageTaxonomyNode {
  id: string;
  packageId: string;
  nodeKey: string;
  label: string;
  kind: string;
  parentId: string | null;
  displayOrder: number;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  revision: number;
  questionCount: number;
  breadcrumb: string;
}

export interface DirectQuestionPackageWorkspace {
  package: QuestionPackageEntity & {
    subjectLabel: string;
    sourceAsset: DirectQuestionPackageSourceAsset | null;
    placements: DirectQuestionPackagePlacement[];
  };
  counts: {
    questionCount: number;
    variantCount: number;
    occurrenceCount: number;
    taxonomyCount: number;
    browseCount: number;
    assetBindingCount: number;
  };
  taxonomy: DirectQuestionPackageTaxonomyNode[];
  browseNodes: Array<{
    id: string;
    packageId: string;
    nodeKey: string;
    label: string;
    nodeType: "GROUP" | "QUESTION_LIST";
    parentId: string | null;
    displayOrder: number;
    taxonomyNodeId: string | null;
    includeDescendants: boolean | null;
    createdAt: number;
    updatedAt: number;
    updatedBy: string;
    revision: number;
  }>;
  filterOptions: {
    years: number[];
    sourceKinds: Array<{ value: QuestionSourceKind; count: number }>;
  };
}

export interface DirectQuestionSummary {
  id: string;
  displayOrder: number;
  primaryPreview: string;
  taxonomyBreadcrumb: string;
  variantCount: number;
  occurrenceCount: number;
  hasAnswer: boolean;
  sourceSummary: PublicQuestionSourceSummary[];
  updatedAt: number;
  revision: number;
  matchContext?: "PRIMARY_VARIANT" | "ALTERNATE_VARIANT" | "ANSWER" | "TAXONOMY" | "PROVENANCE";
  matchPreview?: string;
}

export interface DirectQuestionListOptions {
  offset?: number;
  limit?: number;
  query?: string;
  taxonomyNodeId?: string;
  sourceKind?: QuestionSourceKind;
  year?: number;
  hasAnswer?: boolean;
  variantCount?: "ONE" | "MULTIPLE";
  occurrenceState?: "HAS" | "NONE";
}

export interface DirectQuestionListResult {
  items: DirectQuestionSummary[];
  total: number;
  offset: number;
  limit: number;
  query: string;
  normalizedQuery: string | null;
}

export interface DirectQuestionDetail {
  id: string;
  packageId: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  content: QuestionItemContent;
}

export interface PreparedDirectQuestion {
  questionId: string;
  variantId: string;
  blockId: string;
  content: QuestionItemContent;
}

export interface PreparedDirectQuestionIds {
  questionId: string;
  variantId: string;
  variantIds: string[];
  blockIds: string[];
  verseIds: string[];
  occurrenceIds: string[];
  taxonomyIds: string[];
  browseIds: string[];
}

interface Row {
  [key: string]: unknown;
}

interface DeleteIntent {
  variantIds: string[];
  occurrenceIds: string[];
}

export class DirectQuestionEditorService {
  private readonly repository: SQLiteQuestionRepository;
  private readonly search: QuestionSearchService;

  constructor(private readonly database: ContentDatabase) {
    this.repository = new SQLiteQuestionRepository(database);
    this.search = new QuestionSearchService(database);
  }

  async getPackageWorkspace(packageId: string, actor: AdminActor): Promise<DirectQuestionPackageWorkspace> {
    assertActor(actor);
    const packageEntity = this.requirePackage(packageId);
    const materials = createCanonicalContentRepository(this.database).getSnapshot().materials;
    const subjectLabel = materials.find((item) => item.subjectKey === packageEntity.subjectKey)?.label ?? packageEntity.subjectKey;
    const sourceAsset = await this.sourceAsset(packageEntity);
    const taxonomy = this.taxonomy(packageId);
    const browseNodes = this.repository.listBrowseNodes(packageId);
    const counts = this.counts(packageId);
    const placements = this.placements(packageId);

    return {
      package: { ...packageEntity, subjectLabel, sourceAsset, placements },
      counts,
      taxonomy,
      browseNodes,
      filterOptions: this.filterOptions(packageId),
    };
  }

  listQuestions(packageId: string, actor: AdminActor, options: DirectQuestionListOptions = {}): DirectQuestionListResult {
    assertActor(actor);
    this.requirePackage(packageId);
    if (options.year !== undefined && (!Number.isSafeInteger(options.year) || options.year < MIN_YEAR || options.year > MAX_YEAR)) {
      invalid("Year filter is invalid.");
    }
    const offset = boundedOffset(options.offset);
    const limit = boundedLimit(options.limit);
    const query = typeof options.query === "string" ? options.query : "";
    const taxonomyNodeId = this.optionalTaxonomy(packageId, options.taxonomyNodeId);
    const filters = questionSearchFilters(options);
    const taxonomyNodeIds = taxonomyNodeId ? [taxonomyNodeId] : [];
    const scope = {
      packageId,
      targetMode: taxonomyNodeId ? "TAXONOMY_FILTER" as const : "ALL_PACKAGE_QUESTIONS" as const,
      taxonomyNodeIds,
    };

    if (query.trim()) {
      const result = this.search.searchPlacement(scope, query, offset, limit, filters);
      const metadata = this.questionMetadata(result.items.map((item) => item.questionId));
      return {
        items: result.items.flatMap((item) => {
          const meta = metadata.get(item.questionId);
          return meta ? [{
            id: item.questionId,
            displayOrder: meta.displayOrder,
            primaryPreview: item.primaryPreview,
            taxonomyBreadcrumb: item.taxonomyBreadcrumb,
            variantCount: item.variantCount,
            occurrenceCount: item.occurrenceCount,
            hasAnswer: item.hasAnswer,
            sourceSummary: item.sourceSummary,
            updatedAt: meta.updatedAt,
            revision: meta.revision,
            matchContext: item.matchContext,
            matchPreview: item.matchPreview,
          }] : [];
        }),
        total: result.total,
        offset: result.offset,
        limit: result.limit,
        query: result.query,
        normalizedQuery: result.normalizedQuery,
      };
    }

    const filter = questionWhere(packageId, options, taxonomyNodeId);
    const rows = this.database.client.prepare(`
      select q.id,q.display_order,q.revision,q.updated_at,q.shared_answer,
             pvc.content primary_content,
             coalesce(vc.variant_count,0) variant_count,
             coalesce(oc.occurrence_count,0) occurrence_count,
             pt.taxonomy_node_id primary_taxonomy_id
        from questions q
        left join question_primary_variants pv on pv.question_id=q.id
        left join question_variants pvc on pvc.id=pv.variant_id
        left join (select question_id,count(*) variant_count from question_variants group by question_id) vc on vc.question_id=q.id
        left join (select v.question_id,count(o.id) occurrence_count from question_variants v left join question_occurrences o on o.variant_id=v.id group by v.question_id) oc on oc.question_id=q.id
        left join question_taxonomy_assignments pt on pt.question_id=q.id and pt.role='PRIMARY'
       where ${filter.sql}
       order by q.display_order,q.id
       limit ? offset ?
    `).all(...filter.params, limit, offset) as Row[];
    const total = Number((this.database.client.prepare(`select count(*) count from questions q where ${filter.sql}`).get(...filter.params) as Row).count ?? 0);
    const taxonomy = new Map(this.taxonomy(packageId).map((node) => [node.id, node.breadcrumb]));
    const questionIds = rows.map((row) => String(row.id));
    const sourceSummaries = loadPublicQuestionSourceSummaries(this.database, questionIds);
    const items = rows.map((row): DirectQuestionSummary => ({
      id: String(row.id),
      displayOrder: Number(row.display_order),
      primaryPreview: documentText(parseDocument(row.primary_content)),
      taxonomyBreadcrumb: taxonomy.get(String(row.primary_taxonomy_id ?? "")) ?? "غير مصنّف",
      variantCount: Number(row.variant_count ?? 0),
      occurrenceCount: Number(row.occurrence_count ?? 0),
      hasAnswer: row.shared_answer !== null,
      sourceSummary: sourceSummaries.get(String(row.id)) ?? [],
      updatedAt: Number(row.updated_at),
      revision: Number(row.revision),
    }));
    return { items, total, offset, limit, query: "", normalizedQuery: null };
  }

  getQuestion(packageId: string, questionId: string, actor: AdminActor): DirectQuestionDetail {
    assertActor(actor);
    this.requirePackage(packageId);
    const question = this.repository.getQuestion(questionId);
    if (!question || question.packageId !== packageId) notFound("Question");
    return {
      id: question.id,
      packageId: question.packageId,
      revision: question.revision,
      createdAt: question.createdAt,
      updatedAt: question.updatedAt,
      updatedBy: question.updatedBy,
      content: questionContent(question),
    };
  }

  prepareIds(input: Partial<Record<"blocks" | "verses" | "occurrences" | "variants" | "taxonomy" | "browse", number>> = {}): PreparedDirectQuestionIds {
    const ids = (count = 0) => Array.from({ length: Math.min(100, Math.max(0, Math.trunc(count))) }, () => uuidv7());
    const variantIds = ids(input.variants);
    const variantId = variantIds[0] ?? uuidv7();
    return {
      questionId: uuidv7(),
      variantId,
      variantIds,
      blockIds: ids(input.blocks),
      verseIds: ids(input.verses),
      occurrenceIds: ids(input.occurrences),
      taxonomyIds: ids(input.taxonomy),
      browseIds: ids(input.browse),
    };
  }

  prepareNewQuestion(packageId: string, actor: AdminActor): PreparedDirectQuestion {
    assertActor(actor);
    this.requirePackage(packageId);
    const ids = this.prepareIds({ blocks: 1, variants: 1 });
    const blockId = ids.blockIds[0] ?? uuidv7();
    const variantId = ids.variantIds[0] ?? ids.variantId;
    const questionId = ids.questionId;
    const maxOrder = Number((this.database.client.prepare("select coalesce(max(display_order),0) value from questions where package_id=?").get(packageId) as Row).value ?? 0);
    return {
      questionId,
      variantId,
      blockId,
      content: {
        packageId,
        displayOrder: maxOrder + 1,
        primaryVariantId: variantId,
        taxonomyAssignments: [],
        variants: [{
          id: variantId,
          displayOrder: 1,
          content: { type: "doc", version: 1, blocks: [{ id: blockId, type: "paragraph", spans: [{ text: "" }] }] },
          occurrences: [],
        }],
        sharedAnswer: null,
      },
    };
  }

  async updatePackageTitle(packageId: string, title: unknown, expectedRevision: unknown, actor: AdminActor): Promise<DirectQuestionPackageWorkspace> {
    assertActor(actor);
    this.requirePackage(packageId);
    const cleanTitle = boundedText(title, "Package title", 1, 1000);
    const expected = revisionValue(expectedRevision, "Package revision");
    const now = Date.now();
    try {
      this.database.client.transaction(() => {
        const updated = this.database.client.prepare("update question_packages set title=?,updated_at=?,updated_by=?,revision=revision+1 where id=? and revision=?").run(cleanTitle, now, actor.actorUserId, packageId, expected);
        if (updated.changes !== 1) throw new QuestionEditorError("QUESTION_EDITOR_CONFLICT", "Question Package changed before saving.");
        this.bumpPublicRevision(now);
      }).immediate();
    } catch (error) {
      throw mapDirectError(error);
    }
    return this.getPackageWorkspace(packageId, actor);
  }

  createQuestion(packageId: string, questionIdValue: unknown, value: unknown, actor: AdminActor): DirectQuestionDetail {
    assertActor(actor);
    this.requirePackage(packageId);
    const questionId = uuid(questionIdValue, "questionId");
    const content = normalizeQuestionContent(value, packageId);
    this.assertImageAltRequirements(content);
    this.assertQuestionReferences(content);
    try {
      this.database.client.transaction(() => {
        this.repository.createQuestionAggregate({ id: questionId, content, actor });
        this.search.rebuildPackageInTransaction(packageId);
        this.bumpPackageContent(packageId, actor.actorUserId, Date.now());
      }).immediate();
    } catch (error) {
      throw mapDirectError(error);
    }
    return this.getQuestion(packageId, questionId, actor);
  }

  updateQuestion(packageId: string, questionId: string, value: unknown, expectedRevision: unknown, deletion: { variantIds?: unknown; occurrenceIds?: unknown } = {}, actor: AdminActor): DirectQuestionDetail {
    assertActor(actor);
    this.requirePackage(packageId);
    const current = this.repository.getQuestion(questionId);
    if (!current || current.packageId !== packageId) notFound("Question");
    const content = normalizeQuestionContent(value, packageId);
    this.assertImageAltRequirements(content, current);
    this.assertQuestionReferences(content);
    const intent = normalizeDeleteIntent(deletion);
    assertExplicitDeletions(current, content, intent);
    if (intent.variantIds.includes(current.primaryVariantId)) invalid("Choose a replacement Primary Variant before deleting this Variant.");
    const persisted = hydrateDeletedChildren(current, content, intent);
    const expected = revisionValue(expectedRevision, "Question revision");
    if (current.revision !== expected) throw new QuestionEditorError("QUESTION_EDITOR_CONFLICT", "The canonical Question changed before saving.");
    const changed = intent.variantIds.length > 0 || intent.occurrenceIds.length > 0 || !sameJson(questionContent(current), content);
    if (!changed) return this.getQuestion(packageId, questionId, actor);

    try {
      this.database.client.transaction(() => {
        this.repository.updateQuestionAggregate({ id: questionId, content: persisted, expectedRevision: expected, actor });
        for (const occurrenceId of intent.occurrenceIds) {
          this.database.client.prepare("delete from question_occurrences where id=? and exists(select 1 from question_variants v where v.id=question_occurrences.variant_id and v.question_id=?)").run(occurrenceId, questionId);
        }
        for (const variantId of intent.variantIds) {
          this.database.client.prepare("delete from question_variants where id=? and question_id=?").run(variantId, questionId);
        }
        this.search.rebuildPackageInTransaction(packageId);
        this.bumpPackageContent(packageId, actor.actorUserId, Date.now());
      }).immediate();
    } catch (error) {
      throw mapDirectError(error);
    }
    return this.getQuestion(packageId, questionId, actor);
  }

  deleteQuestion(packageId: string, questionId: string, expectedRevision: unknown, actor: AdminActor): void {
    assertActor(actor);
    this.requirePackage(packageId);
    const expected = revisionValue(expectedRevision, "Question revision");
    const current = this.repository.getQuestion(questionId);
    if (!current || current.packageId !== packageId) notFound("Question");
    try {
      this.database.client.transaction(() => {
        const deleted = this.database.client.prepare("delete from questions where id=? and package_id=? and revision=?").run(questionId, packageId, expected);
        if (deleted.changes !== 1) throw new QuestionEditorError("QUESTION_EDITOR_CONFLICT", "Question changed before deletion.");
        this.search.rebuildPackageInTransaction(packageId);
        this.bumpPackageContent(packageId, actor.actorUserId, Date.now());
      }).immediate();
    } catch (error) {
      throw mapDirectError(error);
    }
  }

  private requirePackage(packageId: string): QuestionPackageEntity {
    if (!isUuid(packageId)) notFound("Question Package");
    const packageEntity = this.repository.getPackage(packageId);
    if (!packageEntity) notFound("Question Package");
    return packageEntity;
  }

  private async sourceAsset(packageEntity: QuestionPackageEntity): Promise<DirectQuestionPackageSourceAsset | null> {
    if (!packageEntity.sourceAssetId) return null;
    const row = this.database.client.prepare(`
      select a.id,a.original_filename,a.display_name,a.mime_type,a.byte_size,a.sha256,a.revision,
             i.status inspection_status,i.inspected_at
        from assets a left join question_package_inspections i on i.asset_id=a.id
       where a.id=?
    `).get(packageEntity.sourceAssetId) as Row | undefined;
    if (!row) return null;
    let sourceContentRevision: number | null = null;
    try {
      const { body } = await createAssetService(this.database).openContent(String(row.id));
      const payload = await new Response(body).json() as { package?: { contentRevision?: unknown } };
      const candidate = payload.package?.contentRevision;
      if (typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 1) sourceContentRevision = candidate;
    } catch {
      sourceContentRevision = null;
    }
    return {
      id: String(row.id),
      originalFilename: String(row.original_filename),
      displayName: String(row.display_name),
      mimeType: String(row.mime_type),
      byteSize: Number(row.byte_size),
      sha256: String(row.sha256),
      revision: Number(row.revision),
      sourceContentRevision,
      inspectionStatus: row.inspection_status == null ? null : String(row.inspection_status),
      inspectedAt: row.inspected_at == null ? null : Number(row.inspected_at),
      liveContentIsNewer: sourceContentRevision !== null && packageEntity.contentRevision > sourceContentRevision,
    };
  }

  private counts(packageId: string) {
    const row = this.database.client.prepare(`select
      (select count(*) from questions where package_id=?) question_count,
      (select count(*) from question_variants v join questions q on q.id=v.question_id where q.package_id=?) variant_count,
      (select count(*) from question_occurrences o join question_variants v on v.id=o.variant_id join questions q on q.id=v.question_id where q.package_id=?) occurrence_count,
      (select count(*) from question_taxonomy_nodes where package_id=?) taxonomy_count,
      (select count(*) from question_bank_browse_nodes where package_id=?) browse_count,
      (select count(*) from question_package_asset_bindings where package_id=?) asset_binding_count
    `).get(packageId, packageId, packageId, packageId, packageId, packageId) as Row;
    return {
      questionCount: Number(row.question_count ?? 0),
      variantCount: Number(row.variant_count ?? 0),
      occurrenceCount: Number(row.occurrence_count ?? 0),
      taxonomyCount: Number(row.taxonomy_count ?? 0),
      browseCount: Number(row.browse_count ?? 0),
      assetBindingCount: Number(row.asset_binding_count ?? 0),
    };
  }

  private taxonomy(packageId: string): DirectQuestionPackageTaxonomyNode[] {
    const nodes = this.repository.listTaxonomy(packageId);
    const counts = new Map((this.database.client.prepare("select a.taxonomy_node_id,count(distinct a.question_id) count from question_taxonomy_assignments a where a.package_id=? group by a.taxonomy_node_id").all(packageId) as Row[]).map((row) => [String(row.taxonomy_node_id), Number(row.count)]));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return nodes.map((node) => ({
      ...node,
      questionCount: counts.get(node.id) ?? 0,
      breadcrumb: taxonomyBreadcrumb(node.id, byId),
    }));
  }

  private placements(packageId: string): DirectQuestionPackagePlacement[] {
    return (this.database.client.prepare(`
      select n.id node_id,n.node_key,n.label node_label,n.node_type,n.parent_id,n.display_order,
             m.id material_id,m.subject_key,m.label material_label
        from material_question_bank_nodes n
        join canonical_materials m on m.id=n.material_id
       where n.package_id=?
       order by m.subject_key,n.display_order,n.id
    `).all(packageId) as Row[]).map((row) => ({
      materialId: String(row.material_id),
      subjectKey: String(row.subject_key),
      materialLabel: String(row.material_label),
      nodeId: String(row.node_id),
      nodeKey: String(row.node_key),
      nodeLabel: String(row.node_label),
      nodeType: row.node_type as "GROUP" | "BANK",
      parentId: row.parent_id == null ? null : String(row.parent_id),
      displayOrder: Number(row.display_order),
    }));
  }

  private filterOptions(packageId: string): DirectQuestionPackageWorkspace["filterOptions"] {
    const sourceKinds = (this.database.client.prepare(`
      select o.source_kind,count(*) count
        from question_occurrences o
        join question_variants v on v.id=o.variant_id
        join questions q on q.id=v.question_id
       where q.package_id=?
       group by o.source_kind
       order by o.source_kind
    `).all(packageId) as Row[]).map((row) => ({ value: row.source_kind as QuestionSourceKind, count: Number(row.count) }));
    const years = (this.database.client.prepare(`
      select distinct o.year
        from question_occurrences o
        join question_variants v on v.id=o.variant_id
        join questions q on q.id=v.question_id
       where q.package_id=? and o.year is not null
       order by o.year desc
    `).all(packageId) as Row[]).map((row) => Number(row.year));
    return { years, sourceKinds };
  }

  private optionalTaxonomy(packageId: string, value: unknown): string | null {
    if (value == null || value === "") return null;
    if (!isUuid(String(value))) invalid("Taxonomy filter is invalid.");
    const row = this.database.client.prepare("select id from question_taxonomy_nodes where id=? and package_id=?").get(String(value), packageId);
    if (!row) invalid("Taxonomy filter does not belong to this Package.");
    return String(value);
  }

  private questionMetadata(ids: string[]): Map<string, { displayOrder: number; revision: number; updatedAt: number }> {
    if (!ids.length) return new Map();
    const rows = this.database.client.prepare(`select id,display_order,revision,updated_at from questions where id in (${ids.map(() => "?").join(",")})`).all(...ids) as Row[];
    return new Map(rows.map((row) => [String(row.id), { displayOrder: Number(row.display_order), revision: Number(row.revision), updatedAt: Number(row.updated_at) }]));
  }

  private assertQuestionReferences(content: QuestionItemContent): void {
    const taxonomyIds = new Set((this.database.client.prepare("select id from question_taxonomy_nodes where package_id=?").all(content.packageId) as Row[]).map((row) => String(row.id)));
    for (const assignment of content.taxonomyAssignments) {
      if (!taxonomyIds.has(assignment.taxonomyNodeId)) invalid("Question taxonomy assignment must belong to the same Package.");
    }
    const assetIds = new Set<string>();
    for (const variant of content.variants) collectAssetIds(variant.content, assetIds);
    if (content.sharedAnswer) collectAssetIds(content.sharedAnswer, assetIds);
    for (const assetId of assetIds) {
      const asset = this.database.client.prepare("select media_kind,mime_type from assets where id=?").get(assetId) as Row | undefined;
      if (!asset || asset.media_kind !== "image" || !String(asset.mime_type).startsWith("image/")) invalid("Question images must reference validated image Assets.");
    }
  }

  private assertImageAltRequirements(content: QuestionItemContent, current?: QuestionAggregate): void {
    const existingAltByBlockId = new Map<string, string>();
    if (current) {
      for (const variant of current.variants) collectImageAlt(variant.content, existingAltByBlockId);
      if (current.sharedAnswer) collectImageAlt(current.sharedAnswer, existingAltByBlockId);
    }
    const assertDocument = (document: CanonicalRichDocument) => {
      for (const block of document.blocks) {
        if (block.type !== "image" || block.alt.trim()) continue;
        const previousAlt = existingAltByBlockId.get(block.id);
        if (previousAlt === undefined || previousAlt.trim()) invalid("New Question image blocks require ALT text.");
      }
    };
    for (const variant of content.variants) assertDocument(variant.content);
    if (content.sharedAnswer) assertDocument(content.sharedAnswer);
  }

  private bumpPackageContent(packageId: string, actorId: string, now: number): void {
    const updated = this.database.client.prepare("update question_packages set content_revision=content_revision+1,updated_at=?,updated_by=?,revision=revision+1 where id=?").run(now, actorId, packageId);
    if (updated.changes !== 1) invalid("Question Package could not be advanced safely.");
    this.bumpPublicRevision(now);
  }

  private bumpPublicRevision(now: number): void {
    this.database.client.prepare("update publication_state set current_revision=current_revision+1,updated_at=? where id='global'").run(now);
  }
}

function assertActor(actor: AdminActor): void {
  if (!actor.actorUserId?.trim() || !["OWNER", "ADMIN"].includes(actor.actorRole)) {
    throw new QuestionEditorError("QUESTION_EDITOR_FORBIDDEN", "An authenticated Admin actor is required.");
  }
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function boundedOffset(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function boundedLimit(value: unknown): number {
  const candidate = typeof value === "number" && Number.isSafeInteger(value) ? value : DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, candidate));
}

function questionSearchFilters(options: DirectQuestionListOptions): QuestionSearchFilters {
  return {
    sourceKinds: options.sourceKind ? [options.sourceKind] : undefined,
    year: options.year,
    hasAnswer: options.hasAnswer,
    variantCount: options.variantCount,
    occurrenceState: options.occurrenceState,
  };
}

function questionWhere(packageId: string, options: DirectQuestionListOptions, taxonomyNodeId: string | null): { sql: string; params: unknown[] } {
  const clauses = ["q.package_id=?"];
  const params: unknown[] = [packageId];
  if (taxonomyNodeId) {
    clauses.push("exists(select 1 from question_taxonomy_assignments a where a.question_id=q.id and a.taxonomy_node_id=? and a.package_id=?)");
    params.push(taxonomyNodeId, packageId);
  }
  if (options.sourceKind) {
    clauses.push("exists(select 1 from question_occurrences o join question_variants v on v.id=o.variant_id where v.question_id=q.id and o.source_kind=?)");
    params.push(options.sourceKind);
  }
  if (options.year !== undefined) {
    clauses.push("exists(select 1 from question_occurrences o join question_variants v on v.id=o.variant_id where v.question_id=q.id and o.year=?)");
    params.push(options.year);
  }
  if (options.hasAnswer !== undefined) clauses.push(options.hasAnswer ? "q.shared_answer is not null" : "q.shared_answer is null");
  if (options.variantCount === "ONE") clauses.push("(select count(*) from question_variants v where v.question_id=q.id)=1");
  if (options.variantCount === "MULTIPLE") clauses.push("(select count(*) from question_variants v where v.question_id=q.id)>1");
  if (options.occurrenceState === "HAS") clauses.push("exists(select 1 from question_occurrences o join question_variants v on v.id=o.variant_id where v.question_id=q.id)");
  if (options.occurrenceState === "NONE") clauses.push("not exists(select 1 from question_occurrences o join question_variants v on v.id=o.variant_id where v.question_id=q.id)");
  return { sql: clauses.join(" and "), params };
}

function normalizeQuestionContent(value: unknown, packageId: string): QuestionItemContent {
  const input = record(value, "Question content");
  exactKeys(input, ["packageId", "displayOrder", "primaryVariantId", "taxonomyAssignments", "variants", "sharedAnswer"]);
  if (input.packageId !== packageId) invalid("Question Package ownership is invalid.");
  const displayOrder = positiveInteger(input.displayOrder, "displayOrder");
  const variants = array(input.variants, "variants", MAX_VARIANTS).map((item, index) => normalizeVariant(item, `variants[${index}]`));
  if (!variants.length) invalid("A Question must contain at least one Variant.");
  unique(variants.map((item) => item.id), "Variant IDs");
  unique(variants.map((item) => item.displayOrder), "Variant display orders");
  const primaryVariantId = uuid(input.primaryVariantId, "primaryVariantId");
  if (!variants.some((item) => item.id === primaryVariantId)) invalid("Primary Variant must belong to the Question.");

  const assignments = array(input.taxonomyAssignments, "taxonomyAssignments", MAX_ASSIGNMENTS).map((item, index) => {
    const row = record(item, `taxonomyAssignments[${index}]`);
    exactKeys(row, ["taxonomyNodeId", "role", "position"]);
    const role = row.role === "PRIMARY" || row.role === "RELATED" ? row.role : invalid("Taxonomy assignment role is invalid.");
    return { taxonomyNodeId: uuid(row.taxonomyNodeId, "taxonomyNodeId"), role, position: nonNegativeInteger(row.position, "taxonomy position") };
  });
  unique(assignments.map((item) => item.taxonomyNodeId), "Taxonomy assignment IDs");
  unique(assignments.map((item) => item.position), "Taxonomy assignment positions");
  if (assignments.filter((item) => item.role === "PRIMARY").length > 1) invalid("A Question can have only one PRIMARY taxonomy assignment.");

  let sharedAnswer: CanonicalRichDocument | null = null;
  if (input.sharedAnswer !== null) {
    assertCanonicalRichDocument(input.sharedAnswer, false);
    sharedAnswer = structuredClone(input.sharedAnswer);
  }
  return { packageId, displayOrder, primaryVariantId, taxonomyAssignments: assignments, variants, sharedAnswer };
}

function normalizeVariant(value: unknown, path: string): QuestionItemContent["variants"][number] {
  const input = record(value, path);
  exactKeys(input, ["id", "displayOrder", "content", "occurrences"]);
  const content = input.content;
  assertCanonicalRichDocument(content, true);
  const occurrences = array(input.occurrences, `${path}.occurrences`, MAX_OCCURRENCES_PER_VARIANT).map((item, index) => normalizeOccurrence(item, `${path}.occurrences[${index}]`));
  unique(occurrences.map((item) => item.id), "Occurrence IDs");
  unique(occurrences.map((item) => item.displayOrder), "Occurrence display orders");
  return { id: uuid(input.id, `${path}.id`), displayOrder: positiveInteger(input.displayOrder, `${path}.displayOrder`), content: structuredClone(content), occurrences };
}

function normalizeOccurrence(value: unknown, path: string): QuestionOccurrenceContent {
  const input = record(value, path);
  exactKeys(input, ["id", "displayOrder", "sourceKind", "year", "roundCode", "session", "sourceName", "notes", "rawLabel", "branches", "qualifiers"]);
  if (!QUESTION_SOURCE_KINDS.includes(input.sourceKind as QuestionSourceKind)) invalid(`${path}.sourceKind is invalid.`);
  return {
    id: uuid(input.id, `${path}.id`),
    displayOrder: positiveInteger(input.displayOrder, `${path}.displayOrder`),
    sourceKind: input.sourceKind as QuestionSourceKind,
    year: nullableYear(input.year, `${path}.year`),
    roundCode: nullableText(input.roundCode, `${path}.roundCode`, 160),
    session: nullableText(input.session, `${path}.session`, 160),
    sourceName: nullableText(input.sourceName, `${path}.sourceName`, 500),
    notes: nullableText(input.notes, `${path}.notes`, 2_000),
    rawLabel: boundedText(input.rawLabel, `${path}.rawLabel`, 1, 1_000),
    branches: boundedStringArray(input.branches, `${path}.branches`),
    qualifiers: boundedStringArray(input.qualifiers, `${path}.qualifiers`),
  };
}

function normalizeDeleteIntent(value: { variantIds?: unknown; occurrenceIds?: unknown }): DeleteIntent {
  return {
    variantIds: normalizeIdArray(value.variantIds, "deleteVariantIds"),
    occurrenceIds: normalizeIdArray(value.occurrenceIds, "deleteOccurrenceIds"),
  };
}

function assertExplicitDeletions(current: QuestionAggregate, content: QuestionItemContent, intent: DeleteIntent): void {
  const currentVariants = new Map(current.variants.map((item) => [item.id, item]));
  const currentOccurrences = new Map(current.variants.flatMap((variant) => variant.occurrences.map((item) => [item.id, { item, variantId: variant.id }] as const)));
  for (const id of intent.variantIds) {
    if (!currentVariants.has(id)) invalid("Variant deletion intent does not belong to this Question.");
    if (content.variants.some((item) => item.id === id)) invalid("A Variant marked for deletion must be omitted from the submitted content.");
  }
  for (const id of intent.occurrenceIds) {
    const occurrence = currentOccurrences.get(id);
    if (!occurrence) invalid("Occurrence deletion intent does not belong to this Question.");
    if (content.variants.some((variant) => variant.occurrences.some((item) => item.id === id))) invalid("An Occurrence marked for deletion must be omitted from the submitted content.");
  }
  const deletedVariants = new Set(intent.variantIds);
  for (const variant of current.variants) {
    if (deletedVariants.has(variant.id)) continue;
    if (!content.variants.some((item) => item.id === variant.id)) invalid("Existing Variants require explicit deletion intent.");
    const proposed = content.variants.find((item) => item.id === variant.id)!;
    const deletedOccurrences = new Set(intent.occurrenceIds);
    for (const occurrence of variant.occurrences) {
      if (!deletedOccurrences.has(occurrence.id) && !proposed.occurrences.some((item) => item.id === occurrence.id)) invalid("Existing Occurrences require explicit deletion intent.");
    }
  }
}

function hydrateDeletedChildren(current: QuestionAggregate, content: QuestionItemContent, intent: DeleteIntent): QuestionItemContent {
  const currentVariants = new Map(current.variants.map((item) => [item.id, item]));
  const variants = content.variants.map((proposed) => {
    const currentVariant = currentVariants.get(proposed.id);
    if (!currentVariant) return proposed;
    const proposedOccurrenceIds = new Set(proposed.occurrences.map((item) => item.id));
    const occurrences = [
      ...proposed.occurrences,
      ...currentVariant.occurrences
        .filter((occurrence) => !proposedOccurrenceIds.has(occurrence.id))
        .map(occurrenceContent),
    ];
    return { ...proposed, occurrences };
  });
  for (const currentVariant of current.variants) {
    if (!content.variants.some((item) => item.id === currentVariant.id)) {
      variants.push(questionVariantContent(currentVariant));
    }
  }
  return { ...content, variants };
}

function questionVariantContent(variant: QuestionAggregate["variants"][number]): QuestionItemContent["variants"][number] {
  return { id: variant.id, displayOrder: variant.displayOrder, content: structuredClone(variant.content), occurrences: variant.occurrences.map(occurrenceContent) };
}

function occurrenceContent(occurrence: QuestionAggregate["variants"][number]["occurrences"][number]): QuestionOccurrenceContent {
  return { id: occurrence.id, displayOrder: occurrence.displayOrder, sourceKind: occurrence.sourceKind, year: occurrence.year, roundCode: occurrence.roundCode, session: occurrence.session, sourceName: occurrence.sourceName, notes: occurrence.notes, rawLabel: occurrence.rawLabel, branches: [...occurrence.branches], qualifiers: [...occurrence.qualifiers] };
}

function questionContent(question: QuestionAggregate): QuestionItemContent {
  return {
    packageId: question.packageId,
    displayOrder: question.displayOrder,
    primaryVariantId: question.primaryVariantId,
    taxonomyAssignments: question.taxonomyAssignments.map(({ taxonomyNodeId, role, position }) => ({ taxonomyNodeId, role, position })),
    variants: question.variants.map(questionVariantContent),
    sharedAnswer: question.sharedAnswer ? structuredClone(question.sharedAnswer) : null,
  };
}

function collectAssetIds(document: CanonicalRichDocument, target: Set<string>): void {
  for (const block of document.blocks) if (block.type === "image") target.add(block.assetId);
}

function collectImageAlt(document: CanonicalRichDocument, target: Map<string, string>): void {
  for (const block of document.blocks) if (block.type === "image") target.set(block.id, block.alt);
}

function documentText(document: CanonicalRichDocument | null): string {
  return extractRichDocumentPlainText(document).slice(0, 220) || (document ? "محتوى بصري" : "لا يوجد نص");
}

function parseDocument(value: unknown): CanonicalRichDocument | null {
  if (value == null) return null;
  try {
    const document = typeof value === "string" ? JSON.parse(value) : value;
    assertCanonicalRichDocument(document);
    return document;
  } catch {
    return null;
  }
}

function taxonomyBreadcrumb<T extends { id: string; label: string; parentId: string | null }>(id: string, nodes: Map<string, T>): string {
  const labels: string[] = [];
  const seen = new Set<string>();
  let current: string | null = id;
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = nodes.get(current);
    if (!node) break;
    labels.unshift(node.label);
    current = node.parentId;
  }
  return labels.join(" / ") || "غير مصنّف";
}

function boundedText(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string" || value.length < min || value.length > max || !value.trim()) invalid(`${label} is invalid.`);
  return value;
}

function nullableText(value: unknown, label: string, max: number): string | null {
  if (value === null) return null;
  return boundedText(value, label, 1, max);
}

function nullableYear(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < MIN_YEAR || value > MAX_YEAR) invalid(`${label} is invalid.`);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalid(`${label} is invalid.`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid(`${label} is invalid.`);
  return value;
}

function revisionValue(value: unknown, label: string): number {
  return nonNegativeInteger(value, label);
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !isUuid(value)) invalid(`${label} is invalid.`);
  return value;
}

function boundedStringArray(value: unknown, label: string): string[] {
  return array(value, label, MAX_TAGS).map((item) => boundedText(item, label, 1, 160));
}

function normalizeIdArray(value: unknown, label: string): string[] {
  if (value == null) return [];
  const result = array(value, label, MAX_VARIANTS * MAX_OCCURRENCES_PER_VARIANT).map((item) => uuid(item, label));
  unique(result, label);
  return result;
}

function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid(`${label} is invalid.`);
  return value;
}

function record(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} is invalid.`);
  return value as Record<string, any>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  const expected = new Set(keys);
  if (Object.keys(value).some((key) => !expected.has(key)) || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) invalid("Question editor payload contains unsupported or missing fields.");
}

function unique(values: unknown[], label: string): void {
  if (new Set(values).size !== values.length) invalid(`${label} must be unique.`);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mapDirectError(error: unknown): QuestionEditorError {
  if (error instanceof QuestionEditorError) return error;
  if (error instanceof QuestionDomainConflictError) return new QuestionEditorError("QUESTION_EDITOR_CONFLICT", "The canonical Question changed before saving.");
  if (error instanceof QuestionDomainError) return new QuestionEditorError(error.code === "QUESTION_DOMAIN_NOT_FOUND" ? "QUESTION_EDITOR_NOT_FOUND" : "QUESTION_EDITOR_INVALID", error.message);
  const code = error instanceof Error && "code" in error ? String((error as Error & { code?: unknown }).code) : "";
  if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") return new QuestionEditorError("QUESTION_EDITOR_CONFLICT", "A Question identity or order already exists.");
  if (code.startsWith("SQLITE_CONSTRAINT")) return new QuestionEditorError("QUESTION_EDITOR_INVALID", "The canonical Question violates a relational constraint.");
  return new QuestionEditorError("QUESTION_EDITOR_INVALID", "The canonical Question could not be saved.");
}

function invalid(message: string): never {
  throw new QuestionEditorError("QUESTION_EDITOR_INVALID", message);
}

function notFound(label: string): never {
  throw new QuestionEditorError("QUESTION_EDITOR_NOT_FOUND", `${label} was not found.`);
}

export function createDirectQuestionEditorService(database: ContentDatabase): DirectQuestionEditorService {
  return new DirectQuestionEditorService(database);
}

type DirectQuestionEditorGlobal = typeof globalThis & { __pythagorasDirectQuestionEditorService?: DirectQuestionEditorService };

export function getDirectQuestionEditorService(): DirectQuestionEditorService {
  const target = globalThis as DirectQuestionEditorGlobal;
  return target.__pythagorasDirectQuestionEditorService ??= new DirectQuestionEditorService(getContentDatabase());
}
