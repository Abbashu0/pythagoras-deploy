import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import type { AIBudgetAdmissionService } from "../admission";
import type { AIEmbeddingProjectionRepository, AIEmbeddingProjectionRevision, AIEmbeddingVectorIndexAdapter } from "../embedding/contracts";
import {
  AI_EMBEDDING_VECTOR_CODEC_KEY,
  AI_EMBEDDING_VECTOR_CODEC_REVISION,
  AI_EMBEDDING_VECTOR_INDEX_ADAPTER_KEY,
} from "../embedding/contracts";
import { AIEmbeddingProjectionHealthService } from "../embedding/health";
import { SQLiteAIEmbeddingProjectionRepository } from "../embedding/sqlite-projection-repository";
import { SQLiteAIVectorIndexAdapter } from "../embedding/vector-index";
import { Float32LEEmbeddingVectorCodec } from "../embedding/codec";
import type { AIProviderConfigRepository } from "../configuration/contracts";
import { AIProviderGateway, isAIProviderGatewayError, type AIProviderAttemptTrace, type NormalizedProviderUsage } from "../gateway";
import type { AICostAccountingService } from "../economics";
import { SQLiteAIModelConfigRepository } from "../model-registry/sqlite-repository";
import type { AIModelConfig, AIModelConfigRepository } from "../model-registry/contracts";
import { SQLiteAIProviderConfigRepository } from "../configuration/sqlite-repository";
import { SQLiteAIKnowledgeSourceRepository } from "../knowledge/source-repository";
import type { AIKnowledgeDocumentProvenance, AIKnowledgeSourceRepository } from "../knowledge/contracts";
import { AIRetrievalProjectionHealthService } from "./health";
import { AI_RETRIEVAL_MAX_QUERY_BYTES, type AILexicalCandidate } from "./contracts";
import { tokenizeRetrievalQuery } from "./normalization";
import { SQLiteAILexicalRetrievalAdapter } from "./lexical";
import type {
  AIEvidencePack,
  AIHybridChunkCandidate,
  AIHybridEvidenceItem,
  AIHybridFusedCandidate,
  AIHybridLexicalScopedAdapter,
  AIHybridM7AProjectionRef,
  AIHybridOriginIdentity,
  AIHybridProviderExecutionContext,
  AIHybridRetrievalRequest,
  AIHybridRetrievalTrace,
  AIHybridSafeReason,
} from "./hybrid-contracts";
import { AIHybridRetrievalError } from "./hybrid-errors";
import { selectEvidence } from "./evidence";
import { weightedReciprocalRankFusion, type AIHybridLexicalRankedCandidate, type AIHybridSemanticRankedCandidate } from "./fusion";
import { SQLiteAIRetrievalConfigRepository } from "../retrieval-config/sqlite-repository";
import { AI_RETRIEVAL_FUSION_ALGORITHM_KEY, AI_RETRIEVAL_FUSION_ALGORITHM_REVISION, type AIRetrievalConfigRepository, type AIRetrievalConfigRevision } from "../retrieval-config/contracts";

const MAX_REQUEST_ID_BYTES = 120;
const MAX_ORIGINS = 100;
const ORIGIN_PAGE_SIZE = 50;
const MAX_RERANK_INPUT_BYTES = 64 * 1024;
const MAX_PROVENANCE_BYTES = 16 * 1024;

interface M7ASelection {
  origin: AIHybridOriginIdentity;
  projectionSetId: string;
  projectionRevisionId: string;
}

interface EmbeddingSpace {
  model: AIModelConfig;
  providerConfigId: string;
  providerConfigRevision: number;
  providerModelId: string;
  adapterKey: string;
  dimensions: number;
}

interface RerankSpace {
  model: AIModelConfig;
  providerConfigId: string;
  providerConfigRevision: number;
}

export interface AIHybridRetrievalServiceDependencies {
  database: ContentDatabase;
  configs: AIRetrievalConfigRepository;
  models: AIModelConfigRepository;
  providers: AIProviderConfigRepository;
  m7aHealth: AIRetrievalProjectionHealthService;
  lexical: AIHybridLexicalScopedAdapter;
  embeddings: AIEmbeddingProjectionRepository;
  embeddingHealth: AIEmbeddingProjectionHealthService;
  vectors: AIEmbeddingVectorIndexAdapter;
  sources: AIKnowledgeSourceRepository;
  gateway: AIProviderGateway;
  accounting: Pick<AICostAccountingService, "getOperation" | "recordAttempt">;
  admission: Pick<AIBudgetAdmissionService, "getReservation">;
  idFactory?: () => string;
  /** Internal deterministic test seam; not a Product/API input. */
  beforeFinalAssembly?: (input: { requestId: string; candidateCount: number }) => void;
}

/** M7C retrieval boundary. It returns only a bounded runtime EvidencePack. */
export class HybridRetrievalService {
  private readonly idFactory: () => string;

  constructor(private readonly dependencies: AIHybridRetrievalServiceDependencies) {
    this.idFactory = dependencies.idFactory ?? uuidv7;
  }

  /**
   * Re-run the provider-free final eligibility fence for a runtime EvidencePack.
   * M8B calls this immediately before Generation; the pack never becomes a
   * durable authority merely because it was produced earlier in the request.
   */
  assertEvidencePackCurrent(pack: AIEvidencePack): void {
    if (!pack || typeof pack !== "object" || !pack.trace || !Array.isArray(pack.trace.eligibleOriginIdentities) || !Array.isArray(pack.trace.m7aProjectionRefs) || !Array.isArray(pack.trace.m7aProjectionRevisionIds) || !Array.isArray(pack.trace.m7bEmbeddingProjectionRevisionIds) || pack.status !== "SUFFICIENT" || !pack.sufficient) {
      throw new AIHybridRetrievalError("AI_HYBRID_FINAL_FENCE_FAILED", "The EvidencePack is not sufficient for execution.", { reason: "NO_CANDIDATES" });
    }
    if (
      !pack.trace.eligibleOriginIdentities.length ||
      !pack.trace.m7aProjectionRefs.length ||
      pack.trace.retrievalConfigId !== pack.retrievalConfigId ||
      pack.trace.retrievalConfigRevision !== pack.retrievalConfigRevision ||
      pack.trace.fusionAlgorithmKey !== pack.fusionAlgorithmKey ||
      pack.trace.fusionAlgorithmRevision !== pack.fusionAlgorithmRevision
    ) {
      throw new AIHybridRetrievalError("AI_HYBRID_FINAL_FENCE_FAILED", "The EvidencePack identity is invalid.", { reason: "RETRIEVAL_CONFIG_CHANGED" });
    }
    const originKeys = new Set<string>();
    for (const origin of pack.trace.eligibleOriginIdentities) {
      if (origin.subjectKey !== pack.subjectKey) throw new AIHybridRetrievalError("AI_HYBRID_FINAL_FENCE_FAILED", "The EvidencePack origin scope is invalid.", { reason: "RETRIEVAL_SCOPE_CHANGED" });
      const key = `${origin.originKind}\u0000${origin.subjectKey}\u0000${origin.originId}`;
      if (originKeys.has(key)) throw new AIHybridRetrievalError("AI_HYBRID_FINAL_FENCE_FAILED", "The EvidencePack origin scope is duplicated.", { reason: "RETRIEVAL_SCOPE_CHANGED" });
      originKeys.add(key);
    }
    if (pack.trace.m7aProjectionRefs.length !== pack.trace.m7aProjectionRevisionIds.length || pack.trace.m7aProjectionRefs.some((ref, index) => ref.projectionRevisionId !== pack.trace.m7aProjectionRevisionIds[index])) {
      throw new AIHybridRetrievalError("AI_HYBRID_FINAL_FENCE_FAILED", "The EvidencePack projection identity is invalid.", { reason: "PROJECTION_CHANGED" });
    }
    const config = this.dependencies.configs.getRevision(pack.retrievalConfigId, pack.retrievalConfigRevision);
    const currentConfig = this.dependencies.configs.getById(pack.retrievalConfigId);
    if (!config || !currentConfig || currentConfig.currentRevision !== pack.retrievalConfigRevision) {
      throw new AIHybridRetrievalError("AI_HYBRID_FINAL_FENCE_FAILED", "The EvidencePack Retrieval Config is no longer current.", { reason: "RETRIEVAL_CONFIG_CHANGED" });
    }
    const m7a = pack.trace.m7aProjectionRefs.map((ref): M7ASelection => ({
      origin: { originKind: ref.originKind, originId: ref.originId, subjectKey: ref.subjectKey },
      projectionSetId: ref.projectionSetId,
      projectionRevisionId: ref.projectionRevisionId,
    }));
    const m7b = pack.trace.m7bEmbeddingProjectionRevisionIds
      .map((id) => this.dependencies.embeddings.getRevision(id))
      .filter((revision): revision is AIEmbeddingProjectionRevision => revision !== null);
    if (m7b.length !== pack.trace.m7bEmbeddingProjectionRevisionIds.length) {
      throw new AIHybridRetrievalError("AI_HYBRID_FINAL_FENCE_FAILED", "The EvidencePack embedding projection is no longer available.", { reason: "PROJECTION_CHANGED" });
    }
    let rerank: RerankSpace | null = null;
    if (pack.trace.rerankModelConfigId !== null) {
      if (pack.trace.rerankProviderConfigId === null || pack.trace.rerankProviderConfigRevision === null || pack.trace.rerankModelConfigRevision === null) {
        throw new AIHybridRetrievalError("AI_HYBRID_FINAL_FENCE_FAILED", "The EvidencePack rerank identity is incomplete.", { reason: "MODEL_SPACE_CHANGED" });
      }
      const model = this.dependencies.models.getById(pack.trace.rerankModelConfigId);
      if (!model) throw new AIHybridRetrievalError("AI_HYBRID_FINAL_FENCE_FAILED", "The EvidencePack rerank Model is unavailable.", { reason: "MODEL_SPACE_CHANGED" });
      rerank = { model, providerConfigId: pack.trace.rerankProviderConfigId, providerConfigRevision: pack.trace.rerankProviderConfigRevision };
    }
    const result = this.finalFence(
      { subjectKey: pack.subjectKey },
      config,
      originSetFingerprint(pack.trace.eligibleOriginIdentities),
      m7a,
      m7b,
      rerank,
      pack.items,
    );
    if (!result.ok) {
      throw new AIHybridRetrievalError("AI_HYBRID_FINAL_FENCE_FAILED", "The EvidencePack is no longer current.", { reason: result.reason });
    }
  }

  async retrieve(request: AIHybridRetrievalRequest): Promise<AIEvidencePack> {
    this.assertRequestShape(request);
    const config = this.resolveConfig(request);
    if (!this.isCanonicalSubject(request.subjectKey)) throw new AIHybridRetrievalError("AI_HYBRID_SUBJECT_INVALID", "The retrieval subject is not canonical.");
    try {
      tokenizeRetrievalQuery(request.query);
    } catch (error) {
      if (isRetrievalQueryEmpty(error)) return this.emptyPack(request, config, "NO_CANDIDATES");
      throw this.mapQueryError(error);
    }

    const origins = this.listEligibleOrigins(request.subjectKey);
    if (!origins.length) return this.emptyPack(request, config, "NO_CANDIDATES");
    const originSet = originSetFingerprint(origins);
    const m7a = this.resolveM7A(origins, request.subjectKey);
    if (m7a.kind === "INSUFFICIENT") return this.insufficientPack(request, config, "PROJECTION_NOT_READY", m7a.revisionIds, [], 0, 0);
    if (!m7a.selections.length) return this.emptyPack(request, config, "NO_CANDIDATES");

    const semantic = this.resolveSemanticCoverage(m7a.selections, config, request.subjectKey);
    if (semantic.kind === "INSUFFICIENT") {
      return this.insufficientPack(request, config, "SEMANTIC_COVERAGE_INCOMPLETE", m7a.selections.map((selection) => selection.projectionRevisionId), semantic.revisionIds, 0, 0);
    }

    let lexical: AIHybridLexicalRankedCandidate[];
    try {
      lexical = this.dependencies.lexical.searchExact({
        subjectKey: request.subjectKey,
        query: request.query,
        projectionRevisionIds: m7a.selections.map((selection) => selection.projectionRevisionId),
        limit: config.lexicalCandidateLimit,
      }).filter((candidate) => config.allowedTrustTiers.includes(candidate.trustTier)).map((candidate) => ({
        candidate: lexicalCandidate(candidate),
        rank: candidate.rank,
      }));
    } catch (error) {
      throw this.mapQueryError(error);
    }

    try {
      this.assertExecutionContext(request.providerExecutionContext);
    } catch (error) {
      return this.insufficientPack(request, config, "EXECUTION_CONTEXT_INVALID", m7a.selections.map((selection) => selection.projectionRevisionId), semantic.revisions.map((revision) => revision.id), lexical.length, 0);
    }

    const queryEmbedding = await this.embedQuery(request, config, semantic.space);
    if (queryEmbedding.kind === "FAILURE") {
      if (config.semanticFailureBehavior === "LEXICAL_ONLY") {
        const ordered = weightedReciprocalRankFusion(lexical, [], config);
        this.dependencies.beforeFinalAssembly?.({ requestId: request.requestId, candidateCount: ordered.length });
        const finalFence = this.finalFence(request, config, originSet, m7a.selections, semantic.revisions, null, ordered);
        if (!finalFence.ok) return this.insufficientPack(request, config, finalFence.reason, m7a.selections.map((selection) => selection.projectionRevisionId), semantic.revisions.map((revision) => revision.id), lexical.length, 0);
        return this.finishPack({
          request,
          config,
          mode: "LEXICAL_ONLY",
          degraded: true,
          safeReason: "QUERY_EMBEDDING_FAILED",
          eligibleOriginIdentities: origins,
          m7aRevisionIds: m7a.selections.map((selection) => selection.projectionRevisionId),
          m7aSelections: m7a.selections,
          m7bRevisions: semantic.revisions,
          lexical,
          semantic: [],
          ordered,
          rerankSpace: null,
        });
      }
      return this.insufficientPack(request, config, "QUERY_EMBEDDING_FAILED", m7a.selections.map((selection) => selection.projectionRevisionId), semantic.revisions.map((revision) => revision.id), lexical.length, 0);
    }
    if (queryEmbedding.kind === "SPACE_CHANGED") {
      return this.insufficientPack(request, config, "MODEL_SPACE_CHANGED", m7a.selections.map((selection) => selection.projectionRevisionId), semantic.revisions.map((revision) => revision.id), lexical.length, 0);
    }

    let semanticCandidates: AIHybridSemanticRankedCandidate[];
    try {
      semanticCandidates = this.searchSemantic(request.subjectKey, queryEmbedding.vector, semantic.revisions, config);
    } catch {
      return this.insufficientPack(request, config, "PROJECTION_CHANGED", m7a.selections.map((selection) => selection.projectionRevisionId), semantic.revisions.map((revision) => revision.id), lexical.length, 0);
    }
    const fused = weightedReciprocalRankFusion(lexical, semanticCandidates, config);
    const thresholded = fused.filter((candidate) => candidate.fusionScoreUnits >= config.minimumFusedScoreUnits);
    if (thresholded.length < config.minimumEvidenceItemCount) {
      this.dependencies.beforeFinalAssembly?.({ requestId: request.requestId, candidateCount: thresholded.length });
      const finalFence = this.finalFence(request, config, originSet, m7a.selections, semantic.revisions, null, thresholded);
      const safeReason = finalFence.ok ? "BELOW_MINIMUM_EVIDENCE" : finalFence.reason;
      return this.finishPack({
        request,
        config,
        mode: "HYBRID",
        degraded: false,
        safeReason,
        eligibleOriginIdentities: origins,
        m7aRevisionIds: m7a.selections.map((selection) => selection.projectionRevisionId),
        m7aSelections: m7a.selections,
        m7bRevisions: semantic.revisions,
        lexical,
        semantic: semanticCandidates,
        ordered: thresholded,
        rerankSpace: null,
      });
    }

    const reranked = await this.maybeRerank(request, config, thresholded);
    if (reranked.kind === "FAILURE") {
      if (config.rerankerFailureBehavior === "USE_FUSION") {
        this.dependencies.beforeFinalAssembly?.({ requestId: request.requestId, candidateCount: thresholded.length });
        const finalFence = this.finalFence(request, config, originSet, m7a.selections, semantic.revisions, null, thresholded);
        if (!finalFence.ok) return this.insufficientPack(request, config, finalFence.reason, m7a.selections.map((selection) => selection.projectionRevisionId), semantic.revisions.map((revision) => revision.id), lexical.length, semanticCandidates.length);
        return this.finishPack({
          request,
          config,
          mode: "HYBRID",
          degraded: true,
          safeReason: "RERANK_FAILED",
          eligibleOriginIdentities: origins,
          m7aRevisionIds: m7a.selections.map((selection) => selection.projectionRevisionId),
          m7aSelections: m7a.selections,
          m7bRevisions: semantic.revisions,
          lexical,
          semantic: semanticCandidates,
          ordered: thresholded,
          rerankSpace: null,
        });
      }
      return this.insufficientPack(request, config, "RERANK_FAILED", m7a.selections.map((selection) => selection.projectionRevisionId), semantic.revisions.map((revision) => revision.id), lexical.length, semanticCandidates.length);
    }

    this.dependencies.beforeFinalAssembly?.({ requestId: request.requestId, candidateCount: reranked.candidates.length });
    const finalFence = this.finalFence(request, config, originSet, m7a.selections, semantic.revisions, reranked.space, reranked.candidates);
    if (!finalFence.ok) {
      return this.insufficientPack(request, config, finalFence.reason, m7a.selections.map((selection) => selection.projectionRevisionId), semantic.revisions.map((revision) => revision.id), lexical.length, semanticCandidates.length);
    }
    return this.finishPack({
      request,
      config,
      mode: "HYBRID",
      degraded: false,
      safeReason: null,
      eligibleOriginIdentities: origins,
      m7aRevisionIds: m7a.selections.map((selection) => selection.projectionRevisionId),
      m7aSelections: m7a.selections,
      m7bRevisions: semantic.revisions,
      lexical,
      semantic: semanticCandidates,
      ordered: reranked.candidates,
      rerankSpace: reranked.space,
    });
  }

  private resolveConfig(request: AIHybridRetrievalRequest): AIRetrievalConfigRevision {
    const config = this.dependencies.configs.getById(request.retrievalConfigId);
    const revision = this.dependencies.configs.getRevision(request.retrievalConfigId, request.retrievalConfigRevision);
    if (!config || !revision || config.currentRevision !== request.retrievalConfigRevision || !revision.enabled || revision.subjectKey !== request.subjectKey || revision.fusionAlgorithmKey !== AI_RETRIEVAL_FUSION_ALGORITHM_KEY || revision.fusionAlgorithmRevision !== AI_RETRIEVAL_FUSION_ALGORITHM_REVISION) {
      throw new AIHybridRetrievalError("AI_HYBRID_CONFIG_INVALID", "The requested Retrieval Config revision is not active for this subject.");
    }
    this.assertModelCapabilities(revision);
    return revision;
  }

  private assertModelCapabilities(config: AIRetrievalConfigRevision): void {
    const embedding = this.dependencies.models.getById(config.embeddingModelConfigId);
    if (!embedding || embedding.capability !== "EMBEDDING") throw new AIHybridRetrievalError("AI_HYBRID_CONFIG_INVALID", "The Retrieval Config embedding model is invalid.");
    if (config.rerankModelConfigId !== null) {
      const reranker = this.dependencies.models.getById(config.rerankModelConfigId);
      if (!reranker || reranker.capability !== "RERANK") throw new AIHybridRetrievalError("AI_HYBRID_CONFIG_INVALID", "The Retrieval Config reranker is invalid.");
    }
  }

  private assertRequestShape(request: AIHybridRetrievalRequest): void {
    if (typeof request.requestId !== "string" || !request.requestId.trim() || Buffer.byteLength(request.requestId, "utf8") > MAX_REQUEST_ID_BYTES) throw new AIHybridRetrievalError("AI_HYBRID_INVALID", "The retrieval request ID is invalid.");
    if (typeof request.subjectKey !== "string" || !request.subjectKey.trim() || typeof request.query !== "string") throw new AIHybridRetrievalError("AI_HYBRID_INVALID", "The retrieval request shape is invalid.");
    if (!Number.isSafeInteger(request.retrievalConfigRevision) || request.retrievalConfigRevision < 1) throw new AIHybridRetrievalError("AI_HYBRID_INVALID", "The Retrieval Config revision is invalid.");
    if (Buffer.byteLength(request.query, "utf8") > AI_RETRIEVAL_MAX_QUERY_BYTES) throw new AIHybridRetrievalError("AI_HYBRID_INVALID", `The retrieval query exceeds ${AI_RETRIEVAL_MAX_QUERY_BYTES} bytes.`);
    const context = request.providerExecutionContext;
    if (!context || typeof context.costOperationId !== "string" || typeof context.budgetReservationId !== "string") throw new AIHybridRetrievalError("AI_HYBRID_EXECUTION_CONTEXT_INVALID", "A caller-owned Cost Operation and Budget Reservation are required.");
  }

  private isCanonicalSubject(subjectKey: string): boolean {
    return Boolean(this.dependencies.database.client.prepare("select subject_key from canonical_materials where subject_key = ?").get(subjectKey));
  }

  private listEligibleOrigins(subjectKey: string): M7ASelection["origin"][] {
    const origins: M7ASelection["origin"][] = [];
    const knowledge = this.dependencies.database.client.prepare("select p.id from ai_knowledge_packages p join ai_knowledge_package_revisions pr on pr.package_id = p.id and pr.revision = p.current_revision join ai_knowledge_sources s on s.id = pr.source_id join ai_knowledge_source_revisions sr on sr.source_id = s.id and sr.revision = s.current_revision where p.subject_key = ? and sr.enabled = 1 and sr.rights_status = 'CLEARED' and p.id > ? order by p.id limit ?");
    const questions = this.dependencies.database.client.prepare("select id from question_packages where subject_key = ? and id > ? order by id limit ?");
    for (const [kind, statement] of [["KNOWLEDGE_PACKAGE", knowledge], ["QUESTION_PACKAGE", questions]] as const) {
      let cursor = "";
      while (true) {
        const rows = statement.all(subjectKey, cursor, ORIGIN_PAGE_SIZE + 1) as Array<{ id: string }>;
        if (origins.length + rows.length > MAX_ORIGINS) throw new AIHybridRetrievalError("AI_HYBRID_ORIGIN_CAPACITY", "The subject has more retrieval origins than the bounded online retrieval contract permits.");
        for (const row of rows.slice(0, ORIGIN_PAGE_SIZE)) {
          cursor = row.id;
          origins.push({ originKind: kind, originId: row.id, subjectKey });
        }
        if (rows.length <= ORIGIN_PAGE_SIZE) break;
      }
    }
    return origins.sort(compareOrigins);
  }

  private resolveM7A(origins: readonly M7ASelection["origin"][], subjectKey: string): { kind: "READY"; selections: M7ASelection[] } | { kind: "INSUFFICIENT"; revisionIds: string[] } {
    const selections: M7ASelection[] = [];
    const revisionIds: string[] = [];
    for (const origin of origins) {
      const status = this.dependencies.m7aHealth.getProjectionStatus(origin);
      if (status.status === "INELIGIBLE") continue;
      if (status.status !== "READY" || status.subjectKey !== subjectKey || !status.projectionSetId || !status.projectionRevisionId || status.inputFingerprint === null || status.currentFingerprint === null || status.inputFingerprint !== status.currentFingerprint) {
        if (status.projectionRevisionId) revisionIds.push(status.projectionRevisionId);
        return { kind: "INSUFFICIENT", revisionIds };
      }
      selections.push({ origin, projectionSetId: status.projectionSetId, projectionRevisionId: status.projectionRevisionId });
      revisionIds.push(status.projectionRevisionId);
    }
    return { kind: "READY", selections };
  }

  private resolveSemanticCoverage(selections: readonly M7ASelection[], config: AIRetrievalConfigRevision, subjectKey: string): { kind: "READY"; revisions: AIEmbeddingProjectionRevision[]; space: EmbeddingSpace } | { kind: "INSUFFICIENT"; revisionIds: string[] } {
    const revisions: AIEmbeddingProjectionRevision[] = [];
    const revisionIds: string[] = [];
    let space: EmbeddingSpace | null = null;
    for (const selection of selections) {
      const set = this.dependencies.embeddings.getSet({
        subjectKey,
        chunkProjectionSetId: selection.projectionSetId,
        modelConfigId: config.embeddingModelConfigId,
        vectorCodecKey: AI_EMBEDDING_VECTOR_CODEC_KEY,
        vectorCodecRevision: AI_EMBEDDING_VECTOR_CODEC_REVISION,
        vectorIndexAdapterKey: AI_EMBEDDING_VECTOR_INDEX_ADAPTER_KEY,
      });
      const revision = set ? this.dependencies.embeddings.getCurrentRevision(set.id) : null;
      if (!revision || revision.subjectKey !== subjectKey || revision.chunkProjectionRevisionId !== selection.projectionRevisionId || revision.modelConfigId !== config.embeddingModelConfigId) return { kind: "INSUFFICIENT", revisionIds };
      const health = this.dependencies.embeddingHealth.getHealthForRevision(revision.id);
      if (health.status !== "READY" || !this.dependencies.embeddingHealth.isRevisionSearchable(revision)) return { kind: "INSUFFICIENT", revisionIds: [...revisionIds, revision.id] };
      const currentSpace: EmbeddingSpace = {
        model: this.requireModel(config.embeddingModelConfigId, "EMBEDDING"),
        providerConfigId: revision.providerConfigId,
        providerConfigRevision: revision.providerConfigRevision,
        providerModelId: revision.providerModelId,
        adapterKey: revision.embeddingAdapterKey,
        dimensions: revision.dimensions,
      };
      if (space && !sameEmbeddingSpace(space, currentSpace)) return { kind: "INSUFFICIENT", revisionIds: [...revisionIds, revision.id] };
      space = currentSpace;
      revisions.push(revision);
      revisionIds.push(revision.id);
    }
    if (!space || !revisions.length) return { kind: "INSUFFICIENT", revisionIds };
    return { kind: "READY", revisions, space };
  }

  private async embedQuery(request: AIHybridRetrievalRequest, config: AIRetrievalConfigRevision, space: EmbeddingSpace): Promise<{ kind: "READY"; vector: readonly number[] } | { kind: "FAILURE" } | { kind: "SPACE_CHANGED" }> {
    try {
      this.assertExecutionContext(request.providerExecutionContext);
      const result = await this.dependencies.gateway.embed(
        { capability: "EMBEDDING", attempts: [config.embeddingModelConfigId] },
        { requestId: request.requestId, inputs: [request.query], inputType: "QUERY" },
        {
          signal: request.providerExecutionContext.signal,
          timeoutMs: request.providerExecutionContext.timeoutMs,
          circuitPolicy: request.providerExecutionContext.circuitPolicy,
        },
      );
      this.recordAttempts(request.providerExecutionContext.costOperationId, result.attempts, result.value.usage);
      if (result.attempts.length !== 1 || !attemptMatchesSpace(result.attempts[0], space, config.embeddingModelConfigId) || result.value.vectors.length !== 1) return { kind: "SPACE_CHANGED" };
      const encoded = new Float32LEEmbeddingVectorCodec().encode(result.value.vectors[0], space.dimensions);
      return { kind: "READY", vector: new Float32LEEmbeddingVectorCodec().decode(encoded.blob, space.dimensions) };
    } catch (error) {
      if (isAIProviderGatewayError(error)) {
        this.recordAttempts(request.providerExecutionContext.costOperationId, error.attempts, emptyUsage());
        return { kind: "FAILURE" };
      }
      if (error instanceof AIHybridRetrievalError) throw error;
      return { kind: "FAILURE" };
    }
  }

  private searchSemantic(subjectKey: string, queryVector: readonly number[], revisions: readonly AIEmbeddingProjectionRevision[], config: AIRetrievalConfigRevision): AIHybridSemanticRankedCandidate[] {
    const byChunk = new Map<string, AIHybridSemanticRankedCandidate>();
    for (const revision of revisions) {
      const local = this.dependencies.vectors.search({ subjectKey, embeddingProjectionRevisionId: revision.id, queryVector, limit: config.semanticCandidateLimit });
      for (const candidate of local) {
        if (!config.allowedTrustTiers.includes(candidate.trustTier)) continue;
        const mapped: AIHybridSemanticRankedCandidate = {
          candidate: embeddingCandidate(candidate),
          rank: 0,
          cosineSimilarity: candidate.cosineSimilarity,
        };
        const previous = byChunk.get(mapped.candidate.chunkId);
        if (!previous || mapped.cosineSimilarity > previous.cosineSimilarity || (mapped.cosineSimilarity === previous.cosineSimilarity && mapped.candidate.chunkId.localeCompare(previous.candidate.chunkId) < 0)) byChunk.set(mapped.candidate.chunkId, mapped);
      }
    }
    return [...byChunk.values()]
      .sort((left, right) => right.cosineSimilarity - left.cosineSimilarity || left.candidate.chunkId.localeCompare(right.candidate.chunkId))
      .slice(0, config.semanticCandidateLimit)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }

  private async maybeRerank(request: AIHybridRetrievalRequest, config: AIRetrievalConfigRevision, candidates: readonly AIHybridFusedCandidate[]): Promise<{ kind: "READY"; candidates: AIHybridFusedCandidate[]; space: RerankSpace | null } | { kind: "FAILURE" }> {
    if (config.rerankModelConfigId === null) return { kind: "READY", candidates: [...candidates], space: null };
    const model = this.requireModel(config.rerankModelConfigId, "RERANK");
    const provider = this.dependencies.providers.getById(model.providerConfigId);
    if (!provider || !provider.enabled) throw new AIHybridRetrievalError("AI_HYBRID_CONFIG_INVALID", "The configured reranker Provider is not enabled.");
    const inputs: AIHybridFusedCandidate[] = [];
    let bytes = Buffer.byteLength(request.query, "utf8");
    for (const candidate of candidates) {
      const nextBytes = Buffer.byteLength(candidate.chunkId, "utf8") + Buffer.byteLength(candidate.text, "utf8");
      if (inputs.length >= config.rerankCandidateLimit || bytes + nextBytes > MAX_RERANK_INPUT_BYTES) break;
      inputs.push(candidate);
      bytes += nextBytes;
    }
    if (!inputs.length) return { kind: "FAILURE" };
    try {
      this.assertExecutionContext(request.providerExecutionContext);
      const result = await this.dependencies.gateway.rerank(
        { capability: "RERANK", attempts: [model.id] },
        { requestId: request.requestId, query: request.query, candidates: inputs.map((candidate) => ({ id: candidate.chunkId, text: candidate.text })), topK: inputs.length },
        {
          signal: request.providerExecutionContext.signal,
          timeoutMs: request.providerExecutionContext.timeoutMs,
          circuitPolicy: request.providerExecutionContext.circuitPolicy,
        },
      );
      this.recordAttempts(request.providerExecutionContext.costOperationId, result.attempts, result.value.usage);
      if (result.attempts.length !== 1 || !attemptMatchesRerankSpace(result.attempts[0], model, provider.revision)) return { kind: "FAILURE" };
      if (result.value.results.length !== inputs.length) return { kind: "FAILURE" };
      const inputIds = new Set(inputs.map((candidate) => candidate.chunkId));
      const seen = new Set<string>();
      for (const [index, item] of result.value.results.entries()) {
        if (!inputIds.has(item.candidateId) || seen.has(item.candidateId) || item.rank !== index + 1 || !Number.isFinite(item.score)) return { kind: "FAILURE" };
        seen.add(item.candidateId);
      }
      if (seen.size !== inputs.length) return { kind: "FAILURE" };
      const byId = new Map(inputs.map((candidate) => [candidate.chunkId, candidate]));
      const reranked = result.value.results.map((item) => ({ ...byId.get(item.candidateId)!, rerankRank: item.rank, rerankScore: item.score }));
      const remaining = candidates.filter((candidate) => !seen.has(candidate.chunkId));
      return { kind: "READY", candidates: [...reranked, ...remaining], space: { model, providerConfigId: model.providerConfigId, providerConfigRevision: provider.revision } };
    } catch (error) {
      if (isAIProviderGatewayError(error)) {
        this.recordAttempts(request.providerExecutionContext.costOperationId, error.attempts, emptyUsage());
        return { kind: "FAILURE" };
      }
      if (error instanceof AIHybridRetrievalError) throw error;
      return { kind: "FAILURE" };
    }
  }

  private finalFence(request: Pick<AIHybridRetrievalRequest, "subjectKey">, config: AIRetrievalConfigRevision, initialOriginSet: readonly string[], m7a: readonly M7ASelection[], m7b: readonly AIEmbeddingProjectionRevision[], rerank: RerankSpace | null, candidates: readonly AIHybridFusedCandidate[]): { ok: true } | { ok: false; reason: AIHybridSafeReason } {
    let currentOrigins: M7ASelection["origin"][];
    try {
      currentOrigins = this.listEligibleOrigins(request.subjectKey);
    } catch {
      return { ok: false, reason: "RETRIEVAL_SCOPE_CHANGED" };
    }
    if (!sameStringArray(initialOriginSet, originSetFingerprint(currentOrigins))) return { ok: false, reason: "RETRIEVAL_SCOPE_CHANGED" };
    const currentConfig = this.dependencies.configs.getById(config.retrievalConfigId);
    if (!currentConfig || currentConfig.currentRevision !== config.revision || !currentConfig.enabled || this.dependencies.configs.getRevision(config.retrievalConfigId, config.revision)?.revision !== config.revision || config.fusionAlgorithmKey !== AI_RETRIEVAL_FUSION_ALGORITHM_KEY || config.fusionAlgorithmRevision !== AI_RETRIEVAL_FUSION_ALGORITHM_REVISION) return { ok: false, reason: "RETRIEVAL_CONFIG_CHANGED" };
    for (const selection of m7a) {
      const status = this.dependencies.m7aHealth.getProjectionStatus(selection.origin);
      if (status.status === "INELIGIBLE") return { ok: false, reason: "SOURCE_INELIGIBLE" };
      if (status.status !== "READY" || status.projectionRevisionId !== selection.projectionRevisionId || status.inputFingerprint === null || status.currentFingerprint === null || status.inputFingerprint !== status.currentFingerprint) return { ok: false, reason: "PROJECTION_CHANGED" };
    }
    for (const revision of m7b) {
      const current = this.dependencies.embeddings.getRevision(revision.id);
      if (!current || current.status !== "READY" || !current.isCurrent || !this.dependencies.embeddingHealth.isRevisionSearchable(current)) return { ok: false, reason: "PROJECTION_CHANGED" };
      const model = this.dependencies.models.getById(current.modelConfigId);
      const provider = this.dependencies.providers.getById(current.providerConfigId);
      if (!model || !provider || model.revision !== current.modelConfigRevision || model.providerConfigId !== current.providerConfigId || model.providerModelId !== current.providerModelId || model.adapterKey !== current.embeddingAdapterKey || model.embeddingDimensions !== current.dimensions || provider.revision !== current.providerConfigRevision || !model.enabled || !provider.enabled) return { ok: false, reason: "MODEL_SPACE_CHANGED" };
    }
    if (rerank) {
      const model = this.dependencies.models.getById(rerank.model.id);
      const provider = this.dependencies.providers.getById(rerank.providerConfigId);
      if (!model || !provider || model.revision !== rerank.model.revision || provider.revision !== rerank.providerConfigRevision || !model.enabled || !provider.enabled) return { ok: false, reason: "MODEL_SPACE_CHANGED" };
    }
    for (const candidate of candidates) {
      if (!candidate.sourceId) continue;
      const source = this.dependencies.sources.getCurrentRevision(candidate.sourceId);
      if (!source || !source.enabled || source.rightsStatus !== "CLEARED") return { ok: false, reason: "SOURCE_INELIGIBLE" };
    }
    return { ok: true };
  }

  private assertExecutionContext(context: AIHybridProviderExecutionContext): void {
    const operation = this.dependencies.accounting.getOperation(context.costOperationId);
    const reservation = this.dependencies.admission.getReservation(context.budgetReservationId);
    if (!operation || operation.costCenter !== "STUDENT_GENERATION" || operation.status !== "OPEN" || !reservation || reservation.operationId !== context.costOperationId || reservation.status !== "EXECUTING") throw new AIHybridRetrievalError("AI_HYBRID_EXECUTION_CONTEXT_INVALID", "The caller Cost Operation and Budget Reservation are not executable.");
  }

  private recordAttempts(operationId: string, attempts: readonly AIProviderAttemptTrace[], usage: NormalizedProviderUsage): void {
    try {
      for (const attempt of attempts) {
        if (!attempt.providerInvoked) continue;
        this.dependencies.accounting.recordAttempt({
          operationId,
          attempt,
          normalizedUsage: usage,
          capability: attempt.capability,
          providerModelId: attempt.providerModelId ?? "unknown",
          at: attempt.startedAt,
          latencyMs: attempt.latencyMs,
        });
      }
    } catch (error) {
      throw new AIHybridRetrievalError("AI_HYBRID_ACCOUNTING_FAILED", "Retrieval provider usage could not be recorded safely.", {}, { cause: error });
    }
  }

  private requireModel(id: string, capability: AIModelConfig["capability"]): AIModelConfig {
    const model = this.dependencies.models.getById(id);
    if (!model || model.capability !== capability) throw new AIHybridRetrievalError("AI_HYBRID_CONFIG_INVALID", `The configured ${capability} Model is invalid.`);
    return model;
  }

  private finishPack(input: {
    request: AIHybridRetrievalRequest;
    config: AIRetrievalConfigRevision;
    mode: "HYBRID" | "LEXICAL_ONLY";
    degraded: boolean;
    safeReason: AIHybridSafeReason | null;
    eligibleOriginIdentities?: readonly AIHybridOriginIdentity[];
    m7aSelections?: readonly M7ASelection[];
    m7aRevisionIds: readonly string[];
    m7bRevisions: readonly AIEmbeddingProjectionRevision[];
    lexical: readonly AIHybridLexicalRankedCandidate[];
    semantic: readonly AIHybridSemanticRankedCandidate[];
    ordered: readonly AIHybridFusedCandidate[];
    rerankSpace: RerankSpace | null;
    candidateCounts?: Partial<AIHybridRetrievalTrace["candidateCounts"]>;
  }): AIEvidencePack {
    const evidence = selectEvidence({ candidates: input.ordered, config: input.config });
    const safeReason = input.safeReason ?? evidence.safeReason;
    const sufficient = evidence.sufficient;
    const items = sufficient ? evidence.items : [];
    const trace = this.trace({
      request: input.request,
      config: input.config,
      m7aRevisionIds: input.m7aRevisionIds,
      eligibleOriginIdentities: input.eligibleOriginIdentities ?? [],
      m7aSelections: input.m7aSelections ?? [],
      m7bRevisions: input.m7bRevisions,
      lexical: input.lexical,
      semantic: input.semantic,
      ordered: input.ordered,
      items,
      degraded: input.degraded,
      safeReason,
      rerankSpace: input.rerankSpace,
      candidateCounts: input.candidateCounts,
    });
    return {
      evidencePackId: this.idFactory(),
      requestId: input.request.requestId,
      subjectKey: input.request.subjectKey,
      retrievalConfigId: configId(input.config),
      retrievalConfigRevision: input.config.revision,
      fusionAlgorithmKey: input.config.fusionAlgorithmKey,
      fusionAlgorithmRevision: input.config.fusionAlgorithmRevision,
      mode: input.mode,
      degraded: input.degraded,
      safeReason,
      embeddingModelConfigId: input.config.embeddingModelConfigId,
      embeddingModelConfigRevision: input.m7bRevisions[0]?.modelConfigRevision ?? null,
      embeddingProviderConfigId: input.m7bRevisions[0]?.providerConfigId ?? null,
      embeddingProviderConfigRevision: input.m7bRevisions[0]?.providerConfigRevision ?? null,
      rerankModelConfigId: input.rerankSpace?.model.id ?? null,
      rerankModelConfigRevision: input.rerankSpace?.model.revision ?? null,
      rerankProviderConfigId: input.rerankSpace?.providerConfigId ?? null,
      rerankProviderConfigRevision: input.rerankSpace?.providerConfigRevision ?? null,
      candidateCounts: trace.candidateCounts,
      evidenceByteCount: sufficient ? evidence.evidenceByteCount : 0,
      sufficient,
      status: sufficient ? "SUFFICIENT" : "INSUFFICIENT",
      items,
      trace,
    };
  }

  private insufficientPack(request: AIHybridRetrievalRequest, config: AIRetrievalConfigRevision, reason: AIHybridSafeReason, m7aRevisionIds: readonly string[], m7bRevisionIds: readonly string[], lexicalCount: number, semanticCount: number): AIEvidencePack {
    return this.finishPack({ request, config, mode: "HYBRID", degraded: false, safeReason: reason, m7aRevisionIds, m7bRevisions: m7bRevisionIds.map((id) => this.dependencies.embeddings.getRevision(id)).filter((revision): revision is AIEmbeddingProjectionRevision => revision !== null), lexical: [], semantic: [], ordered: [], rerankSpace: null, candidateCounts: { lexical: lexicalCount, semantic: semanticCount } });
  }

  private emptyPack(request: AIHybridRetrievalRequest, config: AIRetrievalConfigRevision, reason: AIHybridSafeReason): AIEvidencePack {
    return this.finishPack({ request, config, mode: "HYBRID", degraded: false, safeReason: reason, m7aRevisionIds: [], m7bRevisions: [], lexical: [], semantic: [], ordered: [], rerankSpace: null });
  }

  private trace(input: {
    request: AIHybridRetrievalRequest;
    config: AIRetrievalConfigRevision;
    m7aRevisionIds: readonly string[];
    m7bRevisions: readonly AIEmbeddingProjectionRevision[];
    lexical: readonly AIHybridLexicalRankedCandidate[];
    semantic: readonly AIHybridSemanticRankedCandidate[];
    ordered: readonly AIHybridFusedCandidate[];
    items: readonly AIHybridEvidenceItem[];
    degraded: boolean;
    safeReason: AIHybridSafeReason | null;
    eligibleOriginIdentities?: readonly AIHybridOriginIdentity[];
    m7aSelections?: readonly M7ASelection[];
    rerankSpace: RerankSpace | null;
    candidateCounts?: Partial<AIHybridRetrievalTrace["candidateCounts"]>;
  }): AIHybridRetrievalTrace {
    return {
      retrievalConfigId: configId(input.config),
      retrievalConfigRevision: input.config.revision,
      fusionAlgorithmKey: input.config.fusionAlgorithmKey,
      fusionAlgorithmRevision: input.config.fusionAlgorithmRevision,
      m7aProjectionRevisionIds: [...input.m7aRevisionIds],
      eligibleOriginIdentities: (input.eligibleOriginIdentities ?? []).map((origin) => ({ ...origin })),
      m7aProjectionRefs: (input.m7aSelections ?? []).map((selection): AIHybridM7AProjectionRef => ({
        ...selection.origin,
        projectionSetId: selection.projectionSetId,
        projectionRevisionId: selection.projectionRevisionId,
      })),
      m7bEmbeddingProjectionRevisionIds: input.m7bRevisions.map((revision) => revision.id),
      embeddingModelConfigId: input.config.embeddingModelConfigId,
      embeddingModelConfigRevision: input.m7bRevisions[0]?.modelConfigRevision ?? null,
      embeddingProviderConfigId: input.m7bRevisions[0]?.providerConfigId ?? null,
      embeddingProviderConfigRevision: input.m7bRevisions[0]?.providerConfigRevision ?? null,
      rerankModelConfigId: input.rerankSpace?.model.id ?? null,
      rerankModelConfigRevision: input.rerankSpace?.model.revision ?? null,
      rerankProviderConfigId: input.rerankSpace?.providerConfigId ?? null,
      rerankProviderConfigRevision: input.rerankSpace?.providerConfigRevision ?? null,
      candidateCounts: {
        lexical: input.candidateCounts?.lexical ?? input.lexical.length,
        semantic: input.candidateCounts?.semantic ?? input.semantic.length,
        fused: input.candidateCounts?.fused ?? input.ordered.length,
        reranked: input.candidateCounts?.reranked ?? input.ordered.filter((candidate) => candidate.rerankRank !== null).length,
        evidence: input.candidateCounts?.evidence ?? input.items.length,
      },
      selectedChunkIds: input.items.map((item) => item.chunkId),
      rankedSignals: input.ordered.map((candidate) => ({ chunkId: candidate.chunkId, lexicalRank: candidate.lexicalRank, semanticRank: candidate.semanticRank, cosineSimilarity: candidate.cosineSimilarity, fusionScoreUnits: candidate.fusionScoreUnits, rerankRank: candidate.rerankRank, rerankScore: candidate.rerankScore })),
      degraded: input.degraded,
      safeReason: input.safeReason,
    };
  }

  private mapQueryError(error: unknown): AIHybridRetrievalError {
    if (error instanceof AIHybridRetrievalError) return error;
    return new AIHybridRetrievalError("AI_HYBRID_INVALID", "The retrieval query is invalid.", {}, { cause: error });
  }
}

export function createAIHybridRetrievalService(
  database: ContentDatabase,
  dependencies: Omit<AIHybridRetrievalServiceDependencies, "database" | "configs" | "models" | "providers" | "m7aHealth" | "lexical" | "embeddings" | "embeddingHealth" | "vectors" | "sources"> & Partial<Pick<AIHybridRetrievalServiceDependencies, "configs" | "models" | "providers" | "m7aHealth" | "lexical" | "embeddings" | "embeddingHealth" | "vectors" | "sources">>,
): HybridRetrievalService {
  const models = dependencies.models ?? new SQLiteAIModelConfigRepository(database);
  const embeddingHealth = dependencies.embeddingHealth ?? new AIEmbeddingProjectionHealthService(database, { models });
  const vectors = dependencies.vectors ?? new SQLiteAIVectorIndexAdapter(database, { isRevisionSearchable: (revision: AIEmbeddingProjectionRevision) => embeddingHealth.isRevisionSearchable(revision) });
  return new HybridRetrievalService({
    ...dependencies,
    database,
    configs: dependencies.configs ?? new SQLiteAIRetrievalConfigRepository(database),
    models,
    providers: dependencies.providers ?? new SQLiteAIProviderConfigRepository(database),
    m7aHealth: dependencies.m7aHealth ?? new AIRetrievalProjectionHealthService(database),
    lexical: dependencies.lexical ?? new SQLiteAILexicalRetrievalAdapter(database),
    embeddings: dependencies.embeddings ?? new SQLiteAIEmbeddingProjectionRepository(database),
    embeddingHealth,
    vectors,
    sources: dependencies.sources ?? new SQLiteAIKnowledgeSourceRepository(database),
  });
}

function lexicalCandidate(candidate: AILexicalCandidate): AIHybridChunkCandidate {
  return {
    chunkId: candidate.chunkId,
    m7aProjectionRevisionId: candidate.projectionRevisionId,
    m7bEmbeddingProjectionRevisionId: null,
    subjectKey: candidate.subjectKey,
    originKind: candidate.originKind,
    originId: candidate.originId,
    originRevision: candidate.originRevision,
    originContentRevision: candidate.originContentRevision,
    sourceId: candidate.sourceId,
    sourceRevision: candidate.sourceRevision,
    sourceType: candidate.sourceType,
    trustTier: candidate.trustTier,
    sourceItemId: candidate.sourceItemId,
    sourceItemOrder: candidate.sourceItemOrder,
    questionId: candidate.questionId,
    questionRevision: candidate.questionRevision,
    variantId: candidate.variantId,
    variantRevision: candidate.variantRevision,
    text: candidate.text,
    language: candidate.language,
    provenance: safeProvenance(candidate.provenance),
    originMetadata: safeOriginMetadata(candidate.originMetadata),
  };
}

function embeddingCandidate(candidate: import("../embedding/contracts").AIEmbeddingVectorCandidate): AIHybridChunkCandidate {
  return {
    chunkId: candidate.chunkId,
    m7aProjectionRevisionId: candidate.chunkProjectionRevisionId,
    m7bEmbeddingProjectionRevisionId: candidate.embeddingProjectionRevisionId,
    subjectKey: candidate.subjectKey,
    originKind: candidate.originKind,
    originId: candidate.originId,
    originRevision: candidate.originRevision,
    originContentRevision: candidate.originContentRevision,
    sourceId: candidate.sourceId,
    sourceRevision: candidate.sourceRevision,
    sourceType: candidate.sourceType,
    trustTier: candidate.trustTier,
    sourceItemId: candidate.sourceItemId,
    sourceItemOrder: candidate.sourceItemOrder,
    questionId: candidate.questionId,
    questionRevision: candidate.questionRevision,
    variantId: candidate.variantId,
    variantRevision: candidate.variantRevision,
    text: candidate.text,
    language: candidate.language,
    provenance: safeProvenance(candidate.provenance),
    originMetadata: safeOriginMetadata(candidate.originMetadata),
  };
}

function sameEmbeddingSpace(left: EmbeddingSpace, right: EmbeddingSpace): boolean {
  return left.model.id === right.model.id && left.model.revision === right.model.revision && left.providerConfigId === right.providerConfigId && left.providerConfigRevision === right.providerConfigRevision && left.providerModelId === right.providerModelId && left.adapterKey === right.adapterKey && left.dimensions === right.dimensions;
}

function attemptMatchesSpace(attempt: AIProviderAttemptTrace, space: EmbeddingSpace, modelConfigId: string): boolean {
  return attempt.providerInvoked && attempt.status === "SUCCEEDED" && attempt.modelConfigId === modelConfigId && attempt.modelConfigRevision === space.model.revision && attempt.providerConfigId === space.providerConfigId && attempt.providerConfigRevision === space.providerConfigRevision && attempt.providerModelId === space.providerModelId && attempt.adapterKey === space.adapterKey;
}

function attemptMatchesRerankSpace(attempt: AIProviderAttemptTrace, model: AIModelConfig, providerRevision: number): boolean {
  return attempt.providerInvoked && attempt.status === "SUCCEEDED" && attempt.modelConfigId === model.id && attempt.modelConfigRevision === model.revision && attempt.providerConfigId === model.providerConfigId && attempt.providerConfigRevision === providerRevision && attempt.providerModelId === model.providerModelId && attempt.adapterKey === model.adapterKey;
}

function emptyUsage(): NormalizedProviderUsage {
  return { inputTokens: null, outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null };
}

function configId(config: AIRetrievalConfigRevision): string {
  return config.retrievalConfigId;
}

function isRetrievalQueryEmpty(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "AI_RETRIEVAL_QUERY_EMPTY";
}

function compareOrigins(left: M7ASelection["origin"], right: M7ASelection["origin"]): number {
  return originKindRank(left.originKind) - originKindRank(right.originKind) || left.originId.localeCompare(right.originId) || left.subjectKey.localeCompare(right.subjectKey);
}

function originKindRank(kind: M7ASelection["origin"]["originKind"]): number {
  return kind === "KNOWLEDGE_PACKAGE" ? 0 : 1;
}

function originSetFingerprint(origins: readonly M7ASelection["origin"][]): string[] {
  return origins.map((origin) => `${origin.originKind}\u0000${origin.subjectKey}\u0000${origin.originId}`).sort();
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function safeOriginMetadata(value: unknown): Readonly<Record<string, unknown>> {
  return boundedJsonObject(value, "Retrieved origin metadata");
}

function safeProvenance(value: unknown): AIKnowledgeDocumentProvenance | null {
  if (value === null) return null;
  return boundedJsonObject(value, "Retrieved provenance") as AIKnowledgeDocumentProvenance;
}

function boundedJsonObject(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AIHybridRetrievalError("AI_HYBRID_PROVENANCE_INVALID", `${label} is invalid.`);
  try {
    const copy = structuredClone(value) as Record<string, unknown>;
    const serialized = JSON.stringify(copy);
    if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > MAX_PROVENANCE_BYTES) throw new Error("bounded provenance exceeded");
    return copy;
  } catch (error) {
    if (error instanceof AIHybridRetrievalError) throw error;
    throw new AIHybridRetrievalError("AI_HYBRID_PROVENANCE_INVALID", `${label} is invalid.`, {}, { cause: error });
  }
}
