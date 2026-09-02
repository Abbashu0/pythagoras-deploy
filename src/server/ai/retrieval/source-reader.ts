import { createHash } from "node:crypto";
import type { ContentDatabase } from "../../content/database";
import { createQuestionKnowledgeProjector } from "../knowledge/question-projector";
import type { AIQuestionKnowledgeProjection } from "../knowledge/contracts";
import { SQLiteAIKnowledgePackageRepository } from "../knowledge/package-repository";
import type {
  AIChunkSourceItem,
  AIRetrievalOriginInput,
  AIRetrievalSourceCursor,
} from "./contracts";
import { AIRetrievalError } from "./errors";

export interface AIRetrievalSourceDescriptor extends AIRetrievalOriginInput {
  packageRevisionId: string | null;
  originRevision: number;
  originContentRevision: number;
  language: string;
  sourceId: string | null;
  sourceRevision: number | null;
  sourceType: string | null;
  trustTier: "OFFICIAL" | "PYTHAGORAS_APPROVED" | "TEACHER_REVIEWED" | "OTHER_APPROVED";
  artifactSha256: string | null;
  eligible: boolean;
}

export interface AIRetrievalSourceBatch {
  items: AIChunkSourceItem[];
  cursor: AIRetrievalSourceCursor;
  done: boolean;
  processedItems: number;
}

/** Bounded canonical reader used by the M7A builder; it never loads a whole origin aggregate. */
export class AIRetrievalSourceReader {
  private readonly questionProjector;
  private readonly knowledgePackages;

  constructor(private readonly database: ContentDatabase) {
    this.questionProjector = createQuestionKnowledgeProjector(database);
    this.knowledgePackages = new SQLiteAIKnowledgePackageRepository(database);
  }

  loadOrigin(input: AIRetrievalOriginInput): AIRetrievalSourceDescriptor {
    this.assertCanonicalSubject(input.subjectKey);
    if (input.originKind === "KNOWLEDGE_PACKAGE") return this.loadKnowledgeOrigin(input);
    return this.loadQuestionOrigin(input);
  }

  readBatch(origin: AIRetrievalSourceDescriptor, cursor: AIRetrievalSourceCursor, limit: number): AIRetrievalSourceBatch {
    if (origin.originKind === "KNOWLEDGE_PACKAGE") return this.readKnowledgeBatch(origin, cursor, limit);
    return this.readQuestionBatch(origin, cursor, limit);
  }

  computeFingerprint(origin: AIRetrievalSourceDescriptor, limit: number, config: { strategyKey: string; strategyRevision: number; normalizerKey: string; normalizerRevision: number }): string {
    const hash = createHash("sha256");
    hash.update(JSON.stringify({
      version: 1,
      originKind: origin.originKind,
      subjectKey: origin.subjectKey,
      originId: origin.originId,
      originRevision: origin.originRevision,
      originContentRevision: origin.originContentRevision,
      packageRevisionId: origin.packageRevisionId,
      sourceId: origin.sourceId,
      sourceRevision: origin.sourceRevision,
      sourceType: origin.sourceType,
      trustTier: origin.trustTier,
      artifactSha256: origin.artifactSha256,
      strategyKey: config.strategyKey,
      strategyRevision: config.strategyRevision,
      normalizerKey: config.normalizerKey,
      normalizerRevision: config.normalizerRevision,
    }));
    let cursor: AIRetrievalSourceCursor = { kind: "START" };
    while (cursor.kind !== "DONE") {
      const batch = this.readBatch(origin, cursor, limit);
      for (const item of batch.items) {
        if (origin.originKind === "KNOWLEDGE_PACKAGE") {
          hash.update(JSON.stringify({ sourceItemId: item.sourceItemId, sourceItemOrder: item.sourceItemOrder, provenance: item.provenance }));
        } else {
          hash.update(JSON.stringify({ projectionId: item.originMetadata.projectionId, projectionRevisionFingerprint: item.originMetadata.projectionRevisionFingerprint }));
        }
      }
      cursor = batch.cursor;
      if (batch.done) cursor = { kind: "DONE" };
    }
    return hash.digest("hex");
  }

  private loadKnowledgeOrigin(input: AIRetrievalOriginInput): AIRetrievalSourceDescriptor {
    const metadata = this.knowledgePackages.getProjectionMetadata(input.originId, input.subjectKey);
    if (!metadata) throw new AIRetrievalError("AI_RETRIEVAL_ORIGIN_NOT_FOUND", "The published Knowledge Package origin was not found.");
    return {
      originKind: "KNOWLEDGE_PACKAGE",
      originId: metadata.packageId,
      subjectKey: metadata.subjectKey,
      packageRevisionId: metadata.packageRevisionId,
      originRevision: metadata.packageRevision,
      originContentRevision: metadata.packageContentRevision,
      language: metadata.language,
      sourceId: metadata.sourceId,
      sourceRevision: metadata.sourceRevision,
      sourceType: metadata.sourceType,
      trustTier: metadata.trustTier,
      artifactSha256: metadata.artifactSha256,
      eligible: metadata.currentSourceEnabled && metadata.currentSourceRightsStatus === "CLEARED",
    };
  }

  private loadQuestionOrigin(input: AIRetrievalOriginInput): AIRetrievalSourceDescriptor {
    const row = this.database.client.prepare(`
      select id, subject_key, revision, content_revision, language
      from question_packages
      where id = ? and subject_key = ?
    `).get(input.originId, input.subjectKey) as Record<string, unknown> | undefined;
    if (!row) throw new AIRetrievalError("AI_RETRIEVAL_ORIGIN_NOT_FOUND", "The canonical Question Package origin was not found.");
    return {
      originKind: "QUESTION_PACKAGE",
      originId: String(row.id),
      subjectKey: String(row.subject_key),
      packageRevisionId: null,
      originRevision: Number(row.revision),
      originContentRevision: Number(row.content_revision),
      language: String(row.language),
      sourceId: null,
      sourceRevision: null,
      sourceType: null,
      trustTier: "PYTHAGORAS_APPROVED",
      artifactSha256: null,
      eligible: true,
    };
  }

  private readKnowledgeBatch(origin: AIRetrievalSourceDescriptor, cursor: AIRetrievalSourceCursor, limit: number): AIRetrievalSourceBatch {
    if (!origin.eligible) throw new AIRetrievalError("AI_RETRIEVAL_SOURCE_INELIGIBLE", "The Knowledge Source is not currently eligible for retrieval projection.");
    const page = this.readRows("ai_knowledge_documents", "package_revision_id", origin.packageRevisionId!, cursor, limit);
    const items = page.rows.map((row) => ({
      subjectKey: origin.subjectKey,
      language: origin.language,
      originKind: origin.originKind,
      originId: origin.originId,
      originRevision: origin.originRevision,
      originContentRevision: origin.originContentRevision,
      sourceId: origin.sourceId,
      sourceRevision: origin.sourceRevision,
      sourceType: origin.sourceType,
      trustTier: origin.trustTier,
      artifactSha256: origin.artifactSha256,
      sourceItemId: String(row.document_id),
      sourceItemOrder: Number(row.display_order),
      content: parseJson(row.content, "Knowledge Document content"),
      provenance: parseNullableJson(row.provenance),
      originMetadata: { documentId: String(row.document_id), documentOrder: Number(row.display_order) },
      questionId: null,
      questionRevision: null,
      variantId: null,
      variantRevision: null,
    }));
    return { items, cursor: page.cursor, done: page.done, processedItems: items.length };
  }

  private readQuestionBatch(origin: AIRetrievalSourceDescriptor, cursor: AIRetrievalSourceCursor, limit: number): AIRetrievalSourceBatch {
    const page = this.readRows("questions", "package_id", origin.originId, cursor, limit);
    const items: AIChunkSourceItem[] = [];
    for (const row of page.rows) {
      const projections = this.questionProjector.projectQuestionById({ questionId: String(row.id), subjectKey: origin.subjectKey });
      for (const projection of projections) items.push(...questionSourceItems(origin, projection));
    }
    return { items, cursor: page.cursor, done: page.done, processedItems: page.rows.length };
  }

  private readRows(table: "ai_knowledge_documents" | "questions", parentColumn: "package_revision_id" | "package_id", parentId: string, cursor: AIRetrievalSourceCursor, limit: number): { rows: Array<Record<string, unknown>>; cursor: AIRetrievalSourceCursor; done: boolean } {
    const cursorKind = table === "questions" ? "QUESTION" : "KNOWLEDGE_DOCUMENT";
    const args: unknown[] = [parentId];
    let condition = "";
    if (cursor.kind !== "START" && cursor.kind !== "DONE") {
      args.push(cursor.order, cursor.id);
      condition = "and (display_order > ? or (display_order = ? and document_id > ?))";
      if (table === "questions") condition = "and (display_order > ? or (display_order = ? and id > ?))";
      args.splice(args.length - 2, 0, cursor.order);
    }
    if (cursor.kind === "DONE") return { rows: [], cursor, done: true };
    const idColumn = table === "questions" ? "id" : "document_id";
    const rows = this.database.client.prepare(`select * from ${table} where ${parentColumn} = ? ${condition} order by display_order asc, ${idColumn} asc limit ?`).all(...args, limit + 1) as Array<Record<string, unknown>>;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    const nextCursor: AIRetrievalSourceCursor = last ? { kind: cursorKind, order: Number(last.display_order), id: String(last[idColumn]) } : { kind: "DONE" };
    return { rows: pageRows, cursor: nextCursor, done: rows.length <= limit };
  }

  private assertCanonicalSubject(subjectKey: string): void {
    if (!subjectKey.trim()) throw new AIRetrievalError("AI_RETRIEVAL_SUBJECT_INVALID", "A canonical subject scope is required.");
    const row = this.database.client.prepare("select subject_key from canonical_materials where subject_key = ?").get(subjectKey) as Record<string, unknown> | undefined;
    if (!row) throw new AIRetrievalError("AI_RETRIEVAL_SUBJECT_INVALID", "The retrieval subject is not canonical.");
  }
}

function questionSourceItems(origin: AIRetrievalSourceDescriptor, projection: AIQuestionKnowledgeProjection): AIChunkSourceItem[] {
  const base: AIChunkSourceItem = {
    subjectKey: origin.subjectKey,
    language: origin.language,
    originKind: origin.originKind,
    originId: origin.originId,
    originRevision: projection.questionPackageRevision,
    originContentRevision: projection.questionPackageContentRevision,
    sourceId: null,
    sourceRevision: null,
    sourceType: null,
    trustTier: "PYTHAGORAS_APPROVED",
    artifactSha256: null,
    sourceItemId: projection.variantId,
    sourceItemOrder: projection.variantDisplayOrder,
    content: projection.formulation,
    provenance: null,
    originMetadata: {
      contentKind: "VARIANT_FORMULATION",
      projectionId: projection.projectionId,
      projectionRevisionFingerprint: projection.projectionRevisionFingerprint,
      questionId: projection.questionId,
      questionRevision: projection.questionRevision,
      variantId: projection.variantId,
      variantRevision: projection.variantRevision,
      occurrences: projection.occurrences.map((occurrence) => ({
        id: occurrence.id,
        revision: occurrence.revision,
        displayOrder: occurrence.displayOrder,
        sourceKind: occurrence.sourceKind,
        year: occurrence.year,
        roundCode: occurrence.roundCode,
        session: occurrence.session,
        sourceName: occurrence.sourceName,
        notes: occurrence.notes,
        rawLabel: occurrence.rawLabel,
        branches: occurrence.branches,
        qualifiers: occurrence.qualifiers,
      })),
      taxonomyAssignments: projection.taxonomyAssignments.map((assignment) => ({
        questionId: assignment.questionId,
        taxonomyNodeId: assignment.taxonomyNodeId,
        packageId: assignment.packageId,
        role: assignment.role,
        position: assignment.position,
      })),
    },
    questionId: projection.questionId,
    questionRevision: projection.questionRevision,
    variantId: projection.variantId,
    variantRevision: projection.variantRevision,
  };
  if (!projection.isPrimaryVariant || !projection.sharedAnswer) return [base];
  return [
    base,
    {
      ...base,
      sourceItemId: `${projection.questionId}:answer`,
      sourceItemOrder: projection.questionDisplayOrder,
      content: projection.sharedAnswer,
      originMetadata: { ...base.originMetadata, contentKind: "SHARED_ANSWER" },
    },
  ];
}

function parseJson(value: unknown, label: string): import("../../questions/contracts").CanonicalRichDocument {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed as import("../../questions/contracts").CanonicalRichDocument;
  } catch (error) {
    throw new AIRetrievalError("AI_RETRIEVAL_ORIGIN_NOT_FOUND", `${label} could not be read safely.`, {}, { cause: error });
  }
}

function parseNullableJson(value: unknown): import("../knowledge/contracts").AIKnowledgeDocumentProvenance | null {
  if (value === null || value === undefined) return null;
  try { return (typeof value === "string" ? JSON.parse(value) : value) as import("../knowledge/contracts").AIKnowledgeDocumentProvenance; }
  catch { return null; }
}
