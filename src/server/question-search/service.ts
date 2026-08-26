import { extractRichDocumentPlainText } from "@/lib/rich-content";
import { getContentDatabase, type ContentDatabase } from "../content";
import type { CanonicalRichDocument } from "../questions";
import { loadPublicQuestionSourceSummaries } from "../questions/public-provenance";
import { buildSafeFtsPrefixQuery, normalizeArabicSearchText } from "./arabic-normalization";
import { QUESTION_SEARCH_INDEX_VERSION, type PublicQuestionSearchResult, type QuestionSearchHealth, type QuestionSearchMatchContext, type QuestionSearchPlacementScope, type QuestionSearchQuery } from "./contracts";
import { QuestionSearchError } from "./errors";

type Row = Record<string, unknown>;
type Segment = { id: string; questionId: string; packageId: string; segmentType: QuestionSearchMatchContext; variantId: string | null; occurrenceId: string | null; sourceRefId: string | null; normalizedText: string; displayText: string };
const PRIORITY: Record<QuestionSearchMatchContext, number> = { PRIMARY_VARIANT: 0, ALTERNATE_VARIANT: 1, ANSWER: 2, TAXONOMY: 3, PROVENANCE: 4 };

export class QuestionSearchService {
  constructor(private readonly database: ContentDatabase) {}

  async search(query: QuestionSearchQuery): Promise<PublicQuestionSearchResult> { return this.searchPlacement(query.scope, query.query, query.offset, query.limit); }

  getHealth(): QuestionSearchHealth {
    const canonicalQuestionCount = Number((this.database.client.prepare("select count(*) count from questions").get() as Row).count);
    const indexedQuestionCount = Number((this.database.client.prepare("select count(distinct question_id) count from question_search_documents where index_version=?").get(QUESTION_SEARCH_INDEX_VERSION) as Row).count);
    const indexedSegmentCount = Number((this.database.client.prepare("select count(*) count from question_search_documents where index_version=?").get(QUESTION_SEARCH_INDEX_VERSION) as Row).count);
    return { canonicalQuestionCount, indexedQuestionCount, indexedSegmentCount, healthy: canonicalQuestionCount === indexedQuestionCount };
  }

  searchPlacement(scope: QuestionSearchPlacementScope, query: string, offset = 0, limit = 25): PublicQuestionSearchResult {
    const parsed = buildSafeFtsPrefixQuery(query);
    if (!parsed) throw new QuestionSearchError("QUESTION_SEARCH_EMPTY_QUERY", "A searchable query is required.");
    if (!this.getHealth().healthy) throw new QuestionSearchError("QUESTION_SEARCH_UNAVAILABLE", "Question search projection needs an OWNER rebuild.");
    const safeOffset = Math.max(0, Math.trunc(offset || 0));
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit || 25)));
    const filter = placementFilter(scope);
    const rows = this.database.client.prepare(`
      select d.question_id, d.segment_type, d.display_text, bm25(question_search_fts) rank
      from question_search_fts
      join question_search_documents d on d.id = question_search_fts.document_id
      where question_search_fts match ? and d.index_version=? and d.question_id in (
        select q.id from questions q where ${filter.sql}
      )
      order by rank asc, d.question_id asc
    `).all(parsed.match, QUESTION_SEARCH_INDEX_VERSION, ...filter.params) as Row[];
    const best = new Map<string, { context: QuestionSearchMatchContext; preview: string; rank: number }>();
    for (const row of rows) {
      const context = String(row.segment_type) as QuestionSearchMatchContext;
      const candidate = { context, preview: String(row.display_text), rank: Number(row.rank) };
      const current = best.get(String(row.question_id));
      if (!current || PRIORITY[candidate.context] < PRIORITY[current.context] || (PRIORITY[candidate.context] === PRIORITY[current.context] && candidate.rank < current.rank)) best.set(String(row.question_id), candidate);
    }
    const ordered = [...best.entries()].sort((left, right) => PRIORITY[left[1].context] - PRIORITY[right[1].context] || left[1].rank - right[1].rank || left[0].localeCompare(right[0]));
    const page = ordered.slice(safeOffset, safeOffset + safeLimit);
    const details = this.questionDetails(page.map(([id]) => id), scope);
    return { query, normalizedQuery: parsed.normalizedQuery, total: ordered.length, offset: safeOffset, limit: safeLimit, items: page.flatMap(([questionId, match]) => {
      const item = details.get(questionId); return item ? [{ ...item, matchContext: match.context, matchPreview: preview(match.preview) }] : [];
    }) };
  }

  rebuildQuestion(questionId: string): void { this.database.client.transaction(() => this.rebuildQuestionInTransaction(questionId)).immediate(); }
  rebuildPackage(packageId: string): void { this.database.client.transaction(() => this.rebuildPackageInTransaction(packageId)).immediate(); }
  rebuildAll(): void { this.database.client.transaction(() => this.rebuildAllInTransaction()).immediate(); }

  rebuildQuestionInTransaction(questionId: string): void {
    const row = this.database.client.prepare("select package_id from questions where id=?").get(questionId) as Row | undefined;
    this.clearQuestion(questionId);
    if (row) this.insertSegments(this.collectSegments(String(row.package_id), questionId));
  }

  rebuildPackageInTransaction(packageId: string): void {
    this.clearPackage(packageId);
    this.insertSegments(this.collectSegments(packageId));
  }

  rebuildAllInTransaction(): void {
    this.database.client.exec("delete from question_search_fts; delete from question_search_documents;");
    const packages = this.database.client.prepare("select id from question_packages order by id").all() as Row[];
    for (const item of packages) this.insertSegments(this.collectSegments(String(item.id)));
  }

  rebuildForPublicationInTransaction(items: ReadonlyArray<{ resourceType: string; resourceId: string }>): void {
    const packages = new Set<string>();
    for (const item of items) {
      if (item.resourceType === "question.package") packages.add(item.resourceId);
      else if (item.resourceType === "question.item") {
        const row = this.database.client.prepare("select package_id from questions where id=?").get(item.resourceId) as Row | undefined;
        if (row) packages.add(String(row.package_id));
      } else if (item.resourceType === "question.taxonomy") {
        const row = this.database.client.prepare("select package_id from question_taxonomy_nodes where id=?").get(item.resourceId) as Row | undefined;
        if (row) packages.add(String(row.package_id));
      }
    }
    for (const packageId of packages) this.rebuildPackageInTransaction(packageId);
  }

  private clearQuestion(questionId: string) {
    this.database.client.prepare("delete from question_search_fts where document_id in (select id from question_search_documents where question_id=?)").run(questionId);
    this.database.client.prepare("delete from question_search_documents where question_id=?").run(questionId);
  }
  private clearPackage(packageId: string) {
    this.database.client.prepare("delete from question_search_fts where document_id in (select id from question_search_documents where package_id=?)").run(packageId);
    this.database.client.prepare("delete from question_search_documents where package_id=?").run(packageId);
  }
  private insertSegments(segments: Segment[]) {
    const insertDocument = this.database.client.prepare("insert into question_search_documents(id,question_id,package_id,segment_type,variant_id,occurrence_id,source_ref_id,normalized_text,display_text,index_version) values(?,?,?,?,?,?,?,?,?,?)");
    const insertFts = this.database.client.prepare("insert into question_search_fts(document_id,normalized_text) values(?,?)");
    for (const segment of segments) {
      if (!segment.normalizedText) continue;
      insertDocument.run(segment.id, segment.questionId, segment.packageId, segment.segmentType, segment.variantId, segment.occurrenceId, segment.sourceRefId, segment.normalizedText, segment.displayText, QUESTION_SEARCH_INDEX_VERSION);
      insertFts.run(segment.id, segment.normalizedText);
    }
  }

  private collectSegments(packageId: string, onlyQuestionId?: string): Segment[] {
    const where = onlyQuestionId ? "and q.id=?" : "";
    const args = onlyQuestionId ? [packageId, onlyQuestionId] : [packageId];
    const questions = this.database.client.prepare(`select q.id,q.shared_answer,pv.variant_id primary_variant_id from questions q left join question_primary_variants pv on pv.question_id=q.id where q.package_id=? ${where}`).all(...args) as Row[];
    if (!questions.length) return [];
    const ids = questions.map((row) => String(row.id)); const placeholders = ids.map(() => "?").join(",");
    const variants = this.database.client.prepare(`select id,question_id,content from question_variants where question_id in (${placeholders})`).all(...ids) as Row[];
    const occurrences = this.database.client.prepare(`select o.id,o.variant_id,o.source_kind,o.year,o.round_code,o.session,o.source_name,o.notes,o.raw_label,v.question_id from question_occurrences o join question_variants v on v.id=o.variant_id where v.question_id in (${placeholders})`).all(...ids) as Row[];
    const branchRows = this.database.client.prepare(`select b.occurrence_id,b.value from question_occurrence_branches b where b.occurrence_id in (select o.id from question_occurrences o join question_variants v on v.id=o.variant_id where v.question_id in (${placeholders}))`).all(...ids) as Row[];
    const qualifierRows = this.database.client.prepare(`select q.occurrence_id,q.value from question_occurrence_qualifiers q where q.occurrence_id in (select o.id from question_occurrences o join question_variants v on v.id=o.variant_id where v.question_id in (${placeholders}))`).all(...ids) as Row[];
    const assignmentRows = this.database.client.prepare(`select a.question_id,a.taxonomy_node_id,t.label,t.parent_id from question_taxonomy_assignments a join question_taxonomy_nodes t on t.id=a.taxonomy_node_id where a.question_id in (${placeholders})`).all(...ids) as Row[];
    const nodeRows = this.database.client.prepare("select id,label,parent_id from question_taxonomy_nodes where package_id=?").all(packageId) as Row[];
    const nodeMap = new Map(nodeRows.map((row) => [String(row.id), { label: String(row.label), parentId: row.parent_id === null ? null : String(row.parent_id) }]));
    const branches = groupedValues(branchRows); const qualifiers = groupedValues(qualifierRows);
    const result: Segment[] = [];
    for (const question of questions) {
      const questionId = String(question.id); const primaryId = String(question.primary_variant_id ?? "");
      for (const variant of variants.filter((item) => String(item.question_id) === questionId)) {
        const displayText = extractRichDocumentPlainText(parseDocument(variant.content));
        result.push(segment(questionId, packageId, String(variant.id), String(variant.id) === primaryId ? "PRIMARY_VARIANT" : "ALTERNATE_VARIANT", displayText, String(variant.id)));
      }
      if (question.shared_answer !== null) {
        const displayText = extractRichDocumentPlainText(parseDocument(question.shared_answer));
        result.push(segment(questionId, packageId, "answer", "ANSWER", displayText));
      }
      for (const assignment of assignmentRows.filter((item) => String(item.question_id) === questionId)) {
        const id = String(assignment.taxonomy_node_id); result.push(segment(questionId, packageId, `taxonomy:${id}`, "TAXONOMY", breadcrumb(id, nodeMap), null, null, id));
      }
      for (const occurrence of occurrences.filter((item) => String(item.question_id) === questionId)) {
        const occurrenceId = String(occurrence.id);
        const displayText = [occurrence.raw_label, occurrence.year, occurrence.round_code, occurrence.session, occurrence.source_name, occurrence.notes, ...(branches.get(occurrenceId) ?? []), ...(qualifiers.get(occurrenceId) ?? [])].filter((value) => value !== null && value !== undefined && String(value).trim()).join(" ");
        result.push(segment(questionId, packageId, `occurrence:${occurrenceId}`, "PROVENANCE", displayText, String(occurrence.variant_id), occurrenceId));
      }
    }
    return result;
  }

  private questionDetails(ids: string[], scope: QuestionSearchPlacementScope) {
    const values = new Map<string, { questionId: string; bankOrdinal: number; primaryPreview: string; taxonomyBreadcrumb: string; variantCount: number; occurrenceCount: number; sourceSummary: import("../questions/public-provenance").PublicQuestionSourceSummary[]; hasAnswer: boolean }>();
    if (!ids.length) return values;
    const filter = placementFilter(scope); const params = [...filter.params, ...ids]; const placeholders = ids.map(() => "?").join(",");
    const rows = this.database.client.prepare(`select q.id,q.shared_answer,pvc.content primary_content,coalesce(vc.count,0) variant_count,coalesce(oc.count,0) occurrence_count,pa.taxonomy_node_id primary_taxonomy_id from questions q left join question_primary_variants pv on pv.question_id=q.id left join question_variants pvc on pvc.id=pv.variant_id left join (select question_id,count(*) count from question_variants group by question_id) vc on vc.question_id=q.id left join (select v.question_id,count(o.id) count from question_variants v left join question_occurrences o on o.variant_id=v.id group by v.question_id) oc on oc.question_id=q.id left join question_taxonomy_assignments pa on pa.question_id=q.id and pa.role='PRIMARY' where ${filter.sql} and q.id in (${placeholders}) order by q.display_order,q.id`).all(...params) as Row[];
    const allRows = this.database.client.prepare(`select q.id from questions q where ${filter.sql} order by q.display_order,q.id`).all(...filter.params) as Row[];
    const ordinal = new Map(allRows.map((row, index) => [String(row.id), index + 1]));
    const nodes = this.database.client.prepare("select id,label,parent_id from question_taxonomy_nodes where package_id=?").all(scope.packageId) as Row[];
    const nodeMap = new Map(nodes.map((row) => [String(row.id), { label: String(row.label), parentId: row.parent_id === null ? null : String(row.parent_id) }]));
    const sourceSummaries = loadPublicQuestionSourceSummaries(this.database, rows.map((row) => String(row.id)));
    for (const row of rows) values.set(String(row.id), { questionId: String(row.id), bankOrdinal: ordinal.get(String(row.id)) ?? 0, primaryPreview: preview(extractRichDocumentPlainText(parseDocument(row.primary_content))), taxonomyBreadcrumb: breadcrumb(String(row.primary_taxonomy_id ?? ""), nodeMap), variantCount: Number(row.variant_count), occurrenceCount: Number(row.occurrence_count), sourceSummary: sourceSummaries.get(String(row.id)) ?? [], hasAnswer: row.shared_answer !== null });
    return values;
  }
}

function segment(questionId: string, packageId: string, suffix: string, segmentType: QuestionSearchMatchContext, displayText: string, variantId: string | null = null, occurrenceId: string | null = null, sourceRefId: string | null = null): Segment { return { id: `${questionId}:${suffix}`, questionId, packageId, segmentType, variantId, occurrenceId, sourceRefId, normalizedText: normalizeArabicSearchText(displayText), displayText }; }
function groupedValues(rows: Row[]) { const map = new Map<string, string[]>(); for (const row of rows) map.set(String(row.occurrence_id), [...(map.get(String(row.occurrence_id)) ?? []), String(row.value)]); return map; }
function parseDocument(value: unknown): CanonicalRichDocument | null { if (!value) return null; try { return typeof value === "string" ? JSON.parse(value) as CanonicalRichDocument : value as CanonicalRichDocument; } catch { return null; } }
function breadcrumb(id: string, nodes: Map<string, { label: string; parentId: string | null }>) { const labels: string[] = []; const seen = new Set<string>(); let currentId: string | null = id; while (currentId && !seen.has(currentId)) { seen.add(currentId); const node = nodes.get(currentId); if (!node) break; labels.unshift(node.label); currentId = node.parentId; } return labels.join(" / ") || "غير مصنّف"; }
function preview(value: string) { return value.slice(0, 220) || "محتوى بصري"; }
function placementFilter(scope: QuestionSearchPlacementScope) { if (scope.targetMode !== "TAXONOMY_FILTER") return { sql: "q.package_id=?", params: [scope.packageId] as unknown[] }; if (!scope.taxonomyNodeIds.length) return { sql: "0=1", params: [] as unknown[] }; return { sql: `q.package_id=? and exists(select 1 from question_taxonomy_assignments a where a.question_id=q.id and a.taxonomy_node_id in (${scope.taxonomyNodeIds.map(() => "?").join(",")}))`, params: [scope.packageId, ...scope.taxonomyNodeIds] as unknown[] }; }

let singleton: QuestionSearchService | undefined;
export function createQuestionSearchService(database: ContentDatabase) { return new QuestionSearchService(database); }
export function getQuestionSearchService() { singleton ??= new QuestionSearchService(getContentDatabase()); return singleton; }
