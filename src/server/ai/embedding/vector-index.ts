import { createHash } from "node:crypto";

import type { ContentDatabase } from "../../content/database";
import { AIEmbeddingError } from "./errors";
import {
  AI_EMBEDDING_DEFAULT_QUERY_LIMIT,
  AI_EMBEDDING_MAX_QUERY_LIMIT,
  type AIEmbeddingProjectionRevision,
  type AIEmbeddingVector,
  type AIEmbeddingVectorCandidate,
  type AIEmbeddingVectorCoverage,
  type AIEmbeddingVectorIndexAdapter,
  type AIEmbeddingVectorSearchQuery,
} from "./contracts";
import { Float32LEEmbeddingVectorCodec, stableNorm, type AIEmbeddingVectorCodec } from "./codec";

export interface SQLiteAIVectorIndexOptions {
  codec?: AIEmbeddingVectorCodec;
  isRevisionSearchable?: (revision: AIEmbeddingProjectionRevision) => boolean;
}

interface VectorRow {
  embedding_projection_revision_id: string;
  chunk_projection_revision_id: string;
  chunk_id: string;
  subject_key: string;
  dimensions: number;
  vector_blob: Buffer;
  vector_hash: string;
  norm: number;
  created_at: number;
}

/** SQLite-backed exact cosine index. It keeps only the bounded top-K in memory. */
export class SQLiteAIVectorIndexAdapter implements AIEmbeddingVectorIndexAdapter {
  private readonly codec: AIEmbeddingVectorCodec;
  private readonly isRevisionSearchable: (revision: AIEmbeddingProjectionRevision) => boolean;

  constructor(
    private readonly database: ContentDatabase,
    options: SQLiteAIVectorIndexOptions = {},
  ) {
    this.codec = options.codec ?? new Float32LEEmbeddingVectorCodec();
    this.isRevisionSearchable = options.isRevisionSearchable ?? (() => true);
  }

  persistBatch(input: { projectionRevisionId: string; vectors: readonly AIEmbeddingVector[] }): { insertedVectors: number } {
    const operation = (): { insertedVectors: number } => {
      let insertedVectors = 0;
      for (const vector of input.vectors) {
        this.validatePersistedVector(vector);
        const result = this.database.client.prepare(`
          insert or ignore into ai_embedding_vectors (
            embedding_projection_revision_id, chunk_projection_revision_id, chunk_id,
            subject_key, dimensions, vector_blob, vector_hash, norm, created_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          vector.embeddingProjectionRevisionId,
          vector.chunkProjectionRevisionId,
          vector.chunkId,
          vector.subjectKey,
          vector.dimensions,
          vector.vectorBlob,
          vector.vectorHash,
          vector.norm,
          vector.createdAt,
        );
        if (result.changes > 0) {
          insertedVectors += 1;
          continue;
        }
        const existing = this.database.client.prepare(`
          select vector_hash, vector_blob
          from ai_embedding_vectors
          where embedding_projection_revision_id = ?
            and chunk_projection_revision_id = ?
            and chunk_id = ?
        `).get(vector.embeddingProjectionRevisionId, vector.chunkProjectionRevisionId, vector.chunkId) as { vector_hash: string; vector_blob: Buffer } | undefined;
        if (!existing || existing.vector_hash !== vector.vectorHash || !Buffer.from(existing.vector_blob).equals(vector.vectorBlob)) {
          throw new AIEmbeddingError("AI_EMBEDDING_VECTOR_CONFLICT", "A replayed embedding vector has conflicting derived content.");
        }
      }
      return { insertedVectors };
    };
    try {
      return this.runAtomic(operation);
    } catch (error) {
      if (error instanceof AIEmbeddingError) throw error;
      throw new AIEmbeddingError("AI_EMBEDDING_VECTOR_OWNERSHIP", "The embedding vector batch could not be persisted.", {}, { cause: error });
    }
  }

  getVector(input: { projectionRevisionId: string; chunkProjectionRevisionId: string; chunkId: string }): AIEmbeddingVector | null {
    const row = this.database.client.prepare(`
      select embedding_projection_revision_id, chunk_projection_revision_id, chunk_id,
             subject_key, dimensions, vector_blob, vector_hash, norm, created_at
      from ai_embedding_vectors
      where embedding_projection_revision_id = ?
        and chunk_projection_revision_id = ?
        and chunk_id = ?
    `).get(input.projectionRevisionId, input.chunkProjectionRevisionId, input.chunkId) as VectorRow | undefined;
    return row ? vectorFromRow(row) : null;
  }

  getCoverage(input: { projectionRevisionId: string; chunkProjectionRevisionId: string; chunkCount: number }): AIEmbeddingVectorCoverage {
    const chunks = this.database.client.prepare(`
      select count(*) as chunk_count,
             coalesce(sum(case when vector.chunk_id is null then 1 else 0 end), 0) as missing_count
      from ai_retrieval_chunks as chunk
      left join ai_embedding_vectors as vector
        on vector.embedding_projection_revision_id = ?
       and vector.chunk_projection_revision_id = chunk.projection_revision_id
       and vector.chunk_id = chunk.chunk_id
      where chunk.projection_revision_id = ?
    `).get(input.projectionRevisionId, input.chunkProjectionRevisionId) as { chunk_count: number; missing_count: number };
    const vectors = this.database.client.prepare(`
      select count(*) as vector_count,
             coalesce(sum(case when chunk.chunk_id is null then 1 else 0 end), 0) as orphan_count
      from ai_embedding_vectors as vector
      left join ai_retrieval_chunks as chunk
        on chunk.projection_revision_id = vector.chunk_projection_revision_id
       and chunk.chunk_id = vector.chunk_id
      where vector.embedding_projection_revision_id = ?
        and vector.chunk_projection_revision_id = ?
    `).get(input.projectionRevisionId, input.chunkProjectionRevisionId) as { vector_count: number; orphan_count: number };
    const chunkCount = Number(chunks.chunk_count);
    const vectorCount = Number(vectors.vector_count);
    const missingVectorCount = Number(chunks.missing_count);
    const orphanVectorCount = Number(vectors.orphan_count);
    return {
      chunkCount,
      vectorCount,
      missingVectorCount,
      orphanVectorCount,
      complete: chunkCount === input.chunkCount && vectorCount === input.chunkCount && missingVectorCount === 0 && orphanVectorCount === 0,
    };
  }

  search(input: AIEmbeddingVectorSearchQuery): AIEmbeddingVectorCandidate[] {
    this.assertSubject(input.subjectKey);
    const limit = input.limit ?? AI_EMBEDDING_DEFAULT_QUERY_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > AI_EMBEDDING_MAX_QUERY_LIMIT) {
      throw new AIEmbeddingError("AI_EMBEDDING_VECTOR_QUERY_INVALID", "The vector search limit is outside the safe bound.");
    }
    const revisionRow = this.database.client.prepare(`
      select * from ai_embedding_projection_revisions
      where id = ?
    `).get(input.embeddingProjectionRevisionId) as Record<string, unknown> | undefined;
    if (!revisionRow) throw new AIEmbeddingError("AI_EMBEDDING_PROJECTION_NOT_FOUND", "The requested embedding projection is not a current READY revision.");
    const revision = revisionFromRow(revisionRow);
    if (revision.subjectKey !== input.subjectKey) throw new AIEmbeddingError("AI_EMBEDDING_SUBJECT_INVALID", "The vector search subject does not match the projection scope.");
    if (revision.status !== "READY" || !revision.isCurrent) throw new AIEmbeddingError("AI_EMBEDDING_PROJECTION_NOT_FOUND", "The requested embedding projection is not a current READY revision.");
    if (!this.isRevisionSearchable(revision)) return [];
    const encodedQuery = this.codec.encode(input.queryVector, revision.dimensions);
    const queryValues = this.codec.decode(encodedQuery.blob, revision.dimensions);
    const queryNorm = stableNorm(queryValues);
    const statement = this.database.client.prepare(`
      select vector.embedding_projection_revision_id,
             vector.chunk_projection_revision_id,
             vector.chunk_id,
             vector.subject_key,
             vector.dimensions,
             vector.vector_blob,
             vector.vector_hash,
             vector.norm,
             vector.created_at,
             chunk.origin_kind,
             chunk.origin_id,
             chunk.origin_revision,
             chunk.origin_content_revision,
             chunk.source_id,
             chunk.source_revision,
             chunk.source_type,
             chunk.trust_tier,
             chunk.source_item_id,
             chunk.source_item_order,
             chunk.question_id,
             chunk.question_revision,
             chunk.variant_id,
             chunk.variant_revision,
             chunk.text,
             chunk.language,
             chunk.provenance,
             chunk.origin_metadata
      from ai_embedding_vectors as vector
      join ai_retrieval_chunks as chunk
        on chunk.projection_revision_id = vector.chunk_projection_revision_id
       and chunk.chunk_id = vector.chunk_id
      where vector.embedding_projection_revision_id = ?
        and vector.subject_key = ?
        and chunk.subject_key = ?
        and (
          chunk.origin_kind = 'QUESTION_PACKAGE'
          or exists (
            select 1
            from ai_knowledge_sources as source
            join ai_knowledge_source_revisions as source_revision
              on source_revision.source_id = source.id
             and source_revision.revision = source.current_revision
            where source.id = chunk.source_id
              and source_revision.enabled = 1
              and source_revision.rights_status = 'CLEARED'
          )
        )
    `);
    const top: Array<{ score: number; candidate: Omit<AIEmbeddingVectorCandidate, "rank"> }> = [];
    for (const raw of statement.iterate(input.embeddingProjectionRevisionId, input.subjectKey, input.subjectKey) as Iterable<Record<string, unknown>>) {
      const row = raw as Record<string, unknown>;
      const values = this.codec.decode(Buffer.from(row.vector_blob as Buffer), revision.dimensions);
      let dot = 0;
      for (let index = 0; index < values.length; index += 1) dot += queryValues[index] * values[index];
      const score = dot / (queryNorm * Number(row.norm));
      if (!Number.isFinite(score)) continue;
      const candidate: Omit<AIEmbeddingVectorCandidate, "rank"> = {
        chunkId: String(row.chunk_id),
        embeddingProjectionRevisionId: String(row.embedding_projection_revision_id),
        chunkProjectionRevisionId: String(row.chunk_projection_revision_id),
        subjectKey: String(row.subject_key),
        originKind: String(row.origin_kind) as AIEmbeddingVectorCandidate["originKind"],
        originId: String(row.origin_id),
        originRevision: Number(row.origin_revision),
        originContentRevision: Number(row.origin_content_revision),
        sourceId: row.source_id === null ? null : String(row.source_id),
        sourceRevision: row.source_revision === null ? null : Number(row.source_revision),
        sourceType: row.source_type === null ? null : String(row.source_type),
        trustTier: String(row.trust_tier) as AIEmbeddingVectorCandidate["trustTier"],
        sourceItemId: String(row.source_item_id),
        sourceItemOrder: Number(row.source_item_order),
        questionId: row.question_id === null ? null : String(row.question_id),
        questionRevision: row.question_revision === null ? null : Number(row.question_revision),
        variantId: row.variant_id === null ? null : String(row.variant_id),
        variantRevision: row.variant_revision === null ? null : Number(row.variant_revision),
        text: String(row.text),
        language: String(row.language),
        provenance: parseJson(row.provenance) as AIEmbeddingVectorCandidate["provenance"],
        originMetadata: parseJson(row.origin_metadata) as Record<string, unknown>,
        cosineSimilarity: score,
      };
      top.push({ score, candidate });
      top.sort(compareScoredCandidates);
      if (top.length > limit) top.pop();
    }
    return top.map((entry, index) => ({ ...entry.candidate, rank: index + 1 }));
  }

  private validatePersistedVector(vector: AIEmbeddingVector): void {
    const decoded = this.codec.decode(vector.vectorBlob, vector.dimensions);
    const hash = createHash("sha256").update(vector.vectorBlob).digest("hex");
    const norm = stableNorm(decoded);
    if (hash !== vector.vectorHash || !Number.isFinite(vector.norm) || Math.abs(norm - vector.norm) > Math.max(1e-12, norm * 1e-12)) {
      throw new AIEmbeddingError("AI_EMBEDDING_VECTOR_INVALID", "The persisted embedding vector integrity metadata is invalid.");
    }
  }

  private assertSubject(subjectKey: string): void {
    if (!this.database.client.prepare("select subject_key from canonical_materials where subject_key = ?").get(subjectKey)) {
      throw new AIEmbeddingError("AI_EMBEDDING_SUBJECT_INVALID", "The vector search subject is not canonical.");
    }
  }

  private runAtomic<T>(operation: () => T): T {
    if (this.database.client.inTransaction) return operation();
    return this.database.client.transaction(operation).immediate();
  }
}

export function createSQLiteAIVectorIndexAdapter(database: ContentDatabase, options: SQLiteAIVectorIndexOptions = {}): SQLiteAIVectorIndexAdapter {
  return new SQLiteAIVectorIndexAdapter(database, options);
}

function compareScoredCandidates(left: { score: number; candidate: Omit<AIEmbeddingVectorCandidate, "rank"> }, right: { score: number; candidate: Omit<AIEmbeddingVectorCandidate, "rank"> }): number {
  return right.score - left.score || left.candidate.chunkId.localeCompare(right.candidate.chunkId);
}

function vectorFromRow(row: VectorRow): AIEmbeddingVector {
  return {
    embeddingProjectionRevisionId: row.embedding_projection_revision_id,
    chunkProjectionRevisionId: row.chunk_projection_revision_id,
    chunkId: row.chunk_id,
    subjectKey: row.subject_key,
    dimensions: Number(row.dimensions),
    vectorBlob: Buffer.from(row.vector_blob),
    vectorHash: row.vector_hash,
    norm: Number(row.norm),
    createdAt: Number(row.created_at),
  };
}

function revisionFromRow(row: Record<string, unknown>): AIEmbeddingProjectionRevision {
  return {
    id: String(row.id),
    embeddingProjectionSetId: String(row.embedding_projection_set_id),
    revision: Number(row.revision),
    subjectKey: String(row.subject_key),
    chunkProjectionSetId: String(row.chunk_projection_set_id),
    chunkProjectionRevisionId: String(row.chunk_projection_revision_id),
    chunkProjectionInputFingerprint: String(row.chunk_projection_input_fingerprint),
    chunkCount: Number(row.chunk_count),
    modelConfigId: String(row.model_config_id),
    modelConfigRevision: Number(row.model_config_revision),
    providerConfigId: String(row.provider_config_id),
    providerConfigRevision: Number(row.provider_config_revision),
    providerModelId: String(row.provider_model_id),
    embeddingAdapterKey: String(row.embedding_adapter_key),
    dimensions: Number(row.dimensions),
    vectorCodecKey: String(row.vector_codec_key) as AIEmbeddingProjectionRevision["vectorCodecKey"],
    vectorCodecRevision: Number(row.vector_codec_revision),
    vectorIndexAdapterKey: String(row.vector_index_adapter_key),
    inputFingerprint: String(row.input_fingerprint),
    status: String(row.status) as AIEmbeddingProjectionRevision["status"],
    isCurrent: Boolean(row.is_current),
    sourceCursor: row.source_cursor === null ? null : JSON.parse(String(row.source_cursor)) as AIEmbeddingProjectionRevision["sourceCursor"],
    batchCount: Number(row.batch_count),
    vectorCount: Number(row.vector_count),
    jobId: String(row.job_id),
    costOperationId: String(row.cost_operation_id),
    startedAt: Number(row.started_at),
    updatedAt: Number(row.updated_at),
    readyAt: row.ready_at === null ? null : Number(row.ready_at),
    failedAt: row.failed_at === null ? null : Number(row.failed_at),
    safeErrorCode: row.safe_error_code === null ? null : String(row.safe_error_code),
  };
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return null; }
}
