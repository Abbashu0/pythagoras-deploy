import { createHash } from "node:crypto";

import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import {
  AIAdmissionError,
  AIBudgetAdmissionService,
  createAIAdmissionRequestFingerprint,
  type AIAdmissionPlan,
  type AIAdmissionResult,
} from "../admission";
import type { AIProviderConfigRepository, AIProviderConfig } from "../configuration";
import {
  AIProviderGateway,
  AIProviderGatewayError,
  type EmbeddingProviderResult,
  type NormalizedProviderUsage,
} from "../gateway";
import { AICostAccountingService } from "../economics";
import type { AIModelConfigRepository, AIModelConfig } from "../model-registry";
import {
  AIJobError,
  AIJobExecutionError,
  AIJobQueueService,
  type AIJobExecutionContext,
} from "../operations/jobs";
import {
  AIRetrievalProjectionHealthService,
  SQLiteAIRetrievalProjectionRepository,
  type AIRetrievalChunk,
  type AIRetrievalProjectionRevision,
  type AIRetrievalProjectionSet,
} from "../retrieval";
import type { AISecretStoreAdapter } from "../secrets";
import type {
  AIEmbeddingBuildInput,
  AIEmbeddingBuildResult,
  AIEmbeddingCostEstimator,
  AIEmbeddingJobPayload,
  AIEmbeddingProjectionRevision,
  AIEmbeddingProjectionSet,
  AIEmbeddingProjectionRepository,
  AIEmbeddingVector,
  AIEmbeddingVectorIndexAdapter,
  AIEmbeddingSourceCursor,
} from "./contracts";
import {
  AI_EMBEDDING_DEFAULT_BATCH_SIZE,
  AI_EMBEDDING_JOB_KIND,
  AI_EMBEDDING_JOB_PAYLOAD_VERSION,
  AI_EMBEDDING_MAX_BATCH_BYTES,
  AI_EMBEDDING_MAX_BATCH_SIZE,
  AI_EMBEDDING_MAX_DIMENSIONS,
  AI_EMBEDDING_SYSTEM_PRINCIPAL,
  AI_EMBEDDING_VECTOR_CODEC_KEY,
  AI_EMBEDDING_VECTOR_CODEC_REVISION,
  AI_EMBEDDING_VECTOR_INDEX_ADAPTER_KEY,
} from "./contracts";
import { Float32LEEmbeddingVectorCodec, type AIEmbeddingVectorCodec } from "./codec";
import { AIEmbeddingError } from "./errors";
import { validateAIEmbeddingJobPayload } from "./job";
import { SQLiteAIEmbeddingProjectionRepository } from "./sqlite-projection-repository";
import { SQLiteAIVectorIndexAdapter } from "./vector-index";
import { ProviderAdapterRegistry } from "../gateway/adapter-registry";

const MAX_TIMESTAMP = 8_640_000_000_000_000;

export interface AIEmbeddingProjectionServiceDependencies {
  m7aProjections?: SQLiteAIRetrievalProjectionRepository;
  m7aHealth?: AIRetrievalProjectionHealthService;
  projections?: AIEmbeddingProjectionRepository;
  vectorIndex?: AIEmbeddingVectorIndexAdapter;
  models: AIModelConfigRepository;
  providers: AIProviderConfigRepository;
  secrets: AISecretStoreAdapter;
  adapters: Pick<ProviderAdapterRegistry, "require">;
  gateway: AIProviderGateway;
  jobs: AIJobQueueService;
  admission: AIBudgetAdmissionService;
  accounting: AICostAccountingService;
  costEstimator: AIEmbeddingCostEstimator;
  codec?: AIEmbeddingVectorCodec;
  clock?: () => number;
  idFactory?: () => string;
}

interface ResolvedM7A {
  set: AIRetrievalProjectionSet;
  revision: AIRetrievalProjectionRevision;
  chunkCount: number;
  chunkBytes: number;
  originRevision: number | null;
}

interface ResolvedEmbeddingSpace {
  model: AIModelConfig;
  provider: AIProviderConfig;
}

/** M7B service: one embedding model, one pinned M7A revision, durable Job execution. */
export class AIEmbeddingProjectionService {
  private readonly m7aProjections: SQLiteAIRetrievalProjectionRepository;
  private readonly m7aHealth: AIRetrievalProjectionHealthService;
  private readonly projections: AIEmbeddingProjectionRepository;
  private readonly vectorIndex: AIEmbeddingVectorIndexAdapter;
  private readonly codec: AIEmbeddingVectorCodec;
  private readonly clock: () => number;
  private readonly idFactory: () => string;

  constructor(
    private readonly database: ContentDatabase,
    private readonly dependencies: AIEmbeddingProjectionServiceDependencies,
  ) {
    this.m7aProjections = dependencies.m7aProjections ?? new SQLiteAIRetrievalProjectionRepository(database);
    this.m7aHealth = dependencies.m7aHealth ?? new AIRetrievalProjectionHealthService(database);
    this.projections = dependencies.projections ?? new SQLiteAIEmbeddingProjectionRepository(database);
    this.codec = dependencies.codec ?? new Float32LEEmbeddingVectorCodec();
    this.vectorIndex = dependencies.vectorIndex ?? new SQLiteAIVectorIndexAdapter(database, {
      codec: this.codec,
      isRevisionSearchable: (revision) => this.isRevisionSearchable(revision),
    });
    this.clock = dependencies.clock ?? Date.now;
    this.idFactory = dependencies.idFactory ?? uuidv7;
  }

  startBuild(input: AIEmbeddingBuildInput): AIEmbeddingBuildResult {
    const now = this.safeNow();
    const batchSize = normalizeBatchSize(input.batchSize);
    const maxAttempts = normalizePositive(input.maxAttempts ?? 3, "maxAttempts", 100);
    const m7a = this.resolveM7A(input.chunkProjectionSetId, input.subjectKey);
    const space = this.resolveEmbeddingSpace(input.modelConfigId);
    const set = this.projections.getOrCreateSet({
      subjectKey: input.subjectKey,
      chunkProjectionSetId: m7a.set.id,
      modelConfigId: space.model.id,
      vectorCodecKey: this.codec.key,
      vectorCodecRevision: this.codec.revision,
      vectorIndexAdapterKey: AI_EMBEDDING_VECTOR_INDEX_ADAPTER_KEY,
      now,
    });
    const inputFingerprint = embeddingInputFingerprint(set, m7a.revision, m7a.chunkCount, space, this.codec, AI_EMBEDDING_VECTOR_INDEX_ADAPTER_KEY);
    const current = this.projections.getCurrentRevision(set.id);
    const currentCoverage = current
      ? this.vectorIndex.getCoverage({ projectionRevisionId: current.id, chunkProjectionRevisionId: current.chunkProjectionRevisionId, chunkCount: current.chunkCount })
      : null;
    if (current && currentCoverage?.complete && current.inputFingerprint === inputFingerprint && matchesPinnedSpace(current, m7a, space, this.codec, AI_EMBEDDING_VECTOR_INDEX_ADAPTER_KEY)) {
      return buildResult(current, true);
    }
    const compatibleBuilding = this.projections.getCompatibleBuildingRevision({ projectionSetId: set.id, inputFingerprint });
    if (compatibleBuilding) return this.resumeResult(compatibleBuilding);

    let estimate: ReturnType<AIEmbeddingCostEstimator["estimate"]>;
    try {
      estimate = this.dependencies.costEstimator.estimate({
        model: space.model,
        provider: space.provider,
        chunkCount: m7a.chunkCount,
        chunkBytes: m7a.chunkBytes,
        batchSize,
        maxAttempts,
        at: now,
      });
    } catch (error) {
      if (error instanceof AIEmbeddingError) throw error;
      throw new AIEmbeddingError("AI_EMBEDDING_COST_INVALID", "The embedding cost estimate is unavailable.", {}, { cause: error });
    }
    const costEstimate = {
      currency: estimate.currency,
      maxCostNano: estimate.maxCostNano,
      estimateBasis: estimate.estimateBasis,
      modelConfigId: estimate.modelConfigId ?? space.model.id,
      modelConfigRevision: estimate.modelConfigRevision ?? space.model.revision,
      rateCardId: estimate.rateCardId ?? null,
      rateCardRevision: estimate.rateCardRevision ?? null,
    } as const;
    const revisionId = this.idFactory();
    const jobId = this.idFactory();
    const costOperationId = this.idFactory();
    const admissionIdempotencyKey = `ai.embedding.${revisionId}`;
    const admissionBase: Omit<AIAdmissionPlan, "requestFingerprint"> = {
      principalRef: AI_EMBEDDING_SYSTEM_PRINCIPAL,
      budgetPolicyId: input.budgetPolicyId,
      budgetPolicyRevision: input.budgetPolicyRevision,
      rateLimitPolicyId: input.rateLimitPolicyId,
      rateLimitPolicyRevision: input.rateLimitPolicyRevision,
      budgetPeriod: input.budgetPeriod,
      costOperationId,
      costEstimate,
      idempotencyKey: admissionIdempotencyKey,
    };
    const admissionRequestFingerprint = createAIAdmissionRequestFingerprint(admissionBase);
    const payload: AIEmbeddingJobPayload = {
      embeddingProjectionRevisionId: revisionId,
      chunkProjectionRevisionId: m7a.revision.id,
      chunkProjectionInputFingerprint: m7a.revision.inputFingerprint,
      chunkCount: m7a.chunkCount,
      modelConfigId: space.model.id,
      modelConfigRevision: space.model.revision,
      providerConfigId: space.provider.id,
      providerConfigRevision: space.provider.revision,
      providerModelId: space.model.providerModelId,
      embeddingAdapterKey: space.model.adapterKey,
      dimensions: space.model.embeddingDimensions!,
      vectorCodecKey: this.codec.key,
      vectorCodecRevision: this.codec.revision,
      vectorIndexAdapterKey: AI_EMBEDDING_VECTOR_INDEX_ADAPTER_KEY,
      batchSize,
      budgetPolicyId: input.budgetPolicyId,
      budgetPolicyRevision: input.budgetPolicyRevision,
      rateLimitPolicyId: input.rateLimitPolicyId,
      rateLimitPolicyRevision: input.rateLimitPolicyRevision,
      budgetPeriodStart: input.budgetPeriod.startAt,
      budgetPeriodEnd: input.budgetPeriod.endAt,
      costOperationId,
      admissionIdempotencyKey,
      admissionRequestFingerprint,
      costEstimate,
      circuitPolicyId: input.circuitPolicy?.policyId ?? null,
      circuitPolicyRevision: input.circuitPolicy?.policyRevision ?? null,
    };
    const nextRevision = Math.max(0, ...this.projections.listRevisions(set.id).map((revision) => revision.revision)) + 1;
    try {
      return this.database.client.transaction(() => {
        const currentInside = this.projections.getCurrentRevision(set.id);
        const currentCoverageInside = currentInside
          ? this.vectorIndex.getCoverage({ projectionRevisionId: currentInside.id, chunkProjectionRevisionId: currentInside.chunkProjectionRevisionId, chunkCount: currentInside.chunkCount })
          : null;
        if (currentInside && currentCoverageInside?.complete && currentInside.inputFingerprint === inputFingerprint && matchesPinnedSpace(currentInside, m7a, space, this.codec, AI_EMBEDDING_VECTOR_INDEX_ADAPTER_KEY)) return buildResult(currentInside, true);
        const buildingInside = this.projections.getCompatibleBuildingRevision({ projectionSetId: set.id, inputFingerprint });
        if (buildingInside) return this.resumeResult(buildingInside);
        this.dependencies.accounting.createOperation({
          costCenter: "KNOWLEDGE_INDEXING",
          idempotencyKey: admissionIdempotencyKey,
          opaquePrincipalRef: AI_EMBEDDING_SYSTEM_PRINCIPAL,
          subjectKey: input.subjectKey,
          conversationId: null,
          responseId: null,
          jobId,
          evalRunId: null,
          knowledgeRevision: m7a.set.originKind === "KNOWLEDGE_PACKAGE" ? m7a.originRevision : null,
          status: "OPEN",
          startedAt: now,
          completedAt: null,
        }, costOperationId);
        this.dependencies.jobs.enqueueInTransaction({
          id: jobId,
          kind: AI_EMBEDDING_JOB_KIND,
          payloadVersion: AI_EMBEDDING_JOB_PAYLOAD_VERSION,
          payload: payload as unknown as Record<string, unknown>,
          dedupeKey: `ai.embedding.${revisionId}`,
          costCenter: "KNOWLEDGE_INDEXING",
          costOperationId,
          priority: "NORMAL",
          maxAttempts,
          timeoutMs: input.timeoutMs,
          leaseDurationMs: input.leaseDurationMs,
          scheduledAt: now,
        }, now);
        const revision = this.projections.createRevision({
          id: revisionId,
          embeddingProjectionSetId: set.id,
          revision: nextRevision,
          subjectKey: input.subjectKey,
          chunkProjectionSetId: m7a.set.id,
          chunkProjectionRevisionId: m7a.revision.id,
          chunkProjectionInputFingerprint: m7a.revision.inputFingerprint,
          chunkCount: m7a.chunkCount,
          modelConfigId: space.model.id,
          modelConfigRevision: space.model.revision,
          providerConfigId: space.provider.id,
          providerConfigRevision: space.provider.revision,
          providerModelId: space.model.providerModelId,
          embeddingAdapterKey: space.model.adapterKey,
          dimensions: space.model.embeddingDimensions!,
          vectorCodecKey: this.codec.key,
          vectorCodecRevision: this.codec.revision,
          vectorIndexAdapterKey: AI_EMBEDDING_VECTOR_INDEX_ADAPTER_KEY,
          inputFingerprint,
          jobId,
          costOperationId,
          now,
        });
        return buildResult(revision, false);
      }).immediate();
    } catch (error) {
      const racedReady = this.projections.getCurrentRevision(set.id);
      const racedReadyCoverage = racedReady
        ? this.vectorIndex.getCoverage({ projectionRevisionId: racedReady.id, chunkProjectionRevisionId: racedReady.chunkProjectionRevisionId, chunkCount: racedReady.chunkCount })
        : null;
      if (racedReady && racedReadyCoverage?.complete && racedReady.inputFingerprint === inputFingerprint && matchesPinnedSpace(racedReady, m7a, space, this.codec, AI_EMBEDDING_VECTOR_INDEX_ADAPTER_KEY)) return buildResult(racedReady, true);
      const racedBuilding = this.projections.getCompatibleBuildingRevision({ projectionSetId: set.id, inputFingerprint });
      if (racedBuilding) return this.resumeResult(racedBuilding);
      throw error;
    }
  }

  async executeJob(payload: AIEmbeddingJobPayload, context: AIJobExecutionContext): Promise<void> {
    const normalized = validateAIEmbeddingJobPayload(payload);
    const revision = this.projections.getRevision(normalized.embeddingProjectionRevisionId);
    if (!revision) throw new AIJobExecutionError("AI_EMBEDDING_PROJECTION_NOT_FOUND", false);
    if (revision.status === "READY") {
      this.reconcileCompletedJob(revision);
      return;
    }
    if (revision.status !== "BUILDING") throw new AIJobExecutionError("AI_EMBEDDING_PROJECTION_FAILED", false);
    assertRevisionPayload(revision, normalized, context);
    try {
      this.assertM7ARevision(revision);
      this.assertPinnedConfiguration(revision);
    } catch (error) {
      if (error instanceof AIEmbeddingError) {
        this.failTerminal(revision, error.code, null);
        throw new AIJobExecutionError(error.code, false);
      }
      throw error;
    }
    let admission: AIAdmissionResult;
    try {
      admission = this.dependencies.admission.admit(admissionPlanFromPayload(normalized));
    } catch (error) {
      if (!(error instanceof AIAdmissionError)) throw error;
      const retryable = error.code === "AI_RATE_LIMITED";
      if (retryable && context.attempt.attemptNumber < context.job.maxAttempts) throw new AIJobExecutionError(error.code, true);
      this.failTerminal(revision, `AI_${error.code}`, null);
      throw new AIJobExecutionError(error.code, false);
    }
    const reservation = this.dependencies.admission.startExecution(admission.reservation.id, this.safeNow());
    try {
      await this.processBatches(normalized, context, reservation.id);
      const ready = this.activate(normalized.embeddingProjectionRevisionId, context);
      if (ready.status !== "READY") throw new AIEmbeddingError("AI_EMBEDDING_PROJECTION_FAILED", "The embedding projection did not become READY.");
      this.dependencies.accounting.completeOperation(revision.costOperationId, "OPEN", "COMPLETED", this.safeNow());
      this.dependencies.admission.settle(reservation.id, this.safeNow());
    } catch (error) {
      if (error instanceof AIJobError && error.code === "AI_JOB_LEASE_LOST") throw error;
      if (error instanceof AIJobExecutionError) throw error;
      if (error instanceof AIEmbeddingError) {
        this.failTerminal(revision, error.code, reservation.id);
        throw new AIJobExecutionError(error.code, false);
      }
      throw error;
    }
  }

  isRevisionSearchable(revision: AIEmbeddingProjectionRevision): boolean {
    try {
      if (revision.status !== "READY" || !revision.isCurrent) return false;
      this.assertM7ARevision(revision);
      this.assertPinnedConfiguration(revision);
      return true;
    } catch {
      return false;
    }
  }

  private async processBatches(payload: AIEmbeddingJobPayload, context: AIJobExecutionContext, reservationId: string): Promise<void> {
    while (true) {
      context.checkLease();
      context.heartbeat();
      const revision = this.requireBuildingRevision(payload.embeddingProjectionRevisionId);
      if (revision.sourceCursor?.kind === "DONE") return;
      this.assertM7ARevision(revision);
      this.assertPinnedConfiguration(revision);
      const after = revision.sourceCursor?.kind === "CHUNK"
        ? { chunkOrdinal: revision.sourceCursor.chunkOrdinal, chunkId: revision.sourceCursor.chunkId }
        : undefined;
      const page = this.m7aProjections.listChunksPage({ revisionId: payload.chunkProjectionRevisionId, after, limit: payload.batchSize });
      if (!page.length) {
        if (revision.vectorCount !== payload.chunkCount) throw new AIEmbeddingError("AI_EMBEDDING_COVERAGE_INVALID", "The M7A chunk count changed during embedding.");
        this.persistCursor(payload.embeddingProjectionRevisionId, { kind: "DONE" }, context);
        continue;
      }
      const totalBytes = page.reduce((total, chunk) => total + Buffer.byteLength(chunk.text, "utf8"), 0);
      if (totalBytes > AI_EMBEDDING_MAX_BATCH_BYTES) throw new AIEmbeddingError("AI_EMBEDDING_INVALID", "The embedding batch exceeds the aggregate byte bound.");
      const done = page.length < payload.batchSize;
      const cursor: AIEmbeddingSourceCursor = done ? { kind: "DONE" } : { kind: "CHUNK", chunkOrdinal: page[page.length - 1].chunkOrdinal, chunkId: page[page.length - 1].chunkId };
      const allKnown = page.every((chunk) => this.vectorIndex.getVector({ projectionRevisionId: payload.embeddingProjectionRevisionId, chunkProjectionRevisionId: payload.chunkProjectionRevisionId, chunkId: chunk.chunkId }));
      if (allKnown) {
        this.persistCursor(payload.embeddingProjectionRevisionId, cursor, context);
        continue;
      }
      context.checkLease();
      const result = await this.invokeProvider(payload, page.map((chunk) => chunk.text), context, reservationId);
      const afterProvider = this.requireBuildingRevision(payload.embeddingProjectionRevisionId);
      this.assertM7ARevision(afterProvider);
      this.assertPinnedConfiguration(afterProvider);
      const vectors = this.encodeProviderVectors(payload, page, result);
      this.persistVectors(payload, vectors, cursor, context);
    }
  }

  private async invokeProvider(payload: AIEmbeddingJobPayload, inputs: string[], context: AIJobExecutionContext, reservationId: string): Promise<EmbeddingProviderResult> {
    try {
      const result = await this.dependencies.gateway.embed(
        { capability: "EMBEDDING", attempts: [payload.modelConfigId] },
        { requestId: `${context.job.id}:batch:${context.attempt.attemptNumber}:${Date.now()}`, inputs, inputType: "DOCUMENT" },
        {
          signal: context.signal,
          timeoutMs: Math.min(context.job.timeoutMs, 120_000),
          circuitPolicy: payload.circuitPolicyId === null ? undefined : { policyId: payload.circuitPolicyId, policyRevision: payload.circuitPolicyRevision! },
        },
      );
      this.recordAttempts(payload.costOperationId, result.attempts, result.value.usage);
      context.checkLease();
      return result.value;
    } catch (error) {
      if (!(error instanceof AIProviderGatewayError)) throw error;
      this.recordAttempts(payload.costOperationId, error.attempts, emptyUsage());
      context.checkLease();
      const retryable = error.retryable && ["RATE_LIMITED", "TIMEOUT", "UNAVAILABLE", "CIRCUIT_OPEN"].includes(error.code);
      if (retryable && context.attempt.attemptNumber < context.job.maxAttempts) throw new AIJobExecutionError(`AI_PROVIDER_${error.code}`, true);
      const revision = this.requireBuildingRevision(payload.embeddingProjectionRevisionId);
      this.failTerminal(revision, `AI_PROVIDER_${error.code}`, reservationId);
      throw new AIJobExecutionError(`AI_PROVIDER_${error.code}`, false);
    }
  }

  private encodeProviderVectors(payload: AIEmbeddingJobPayload, chunks: readonly AIRetrievalChunk[], result: EmbeddingProviderResult): AIEmbeddingVector[] {
    if (result.dimensions !== payload.dimensions || result.vectors.length !== chunks.length) throw new AIEmbeddingError("AI_EMBEDDING_VECTOR_INVALID", "The embedding Provider returned a vector batch with the wrong shape.");
    return result.vectors.map((values, index) => {
      const encoded = this.codec.encode(values, payload.dimensions);
      return {
        embeddingProjectionRevisionId: payload.embeddingProjectionRevisionId,
        chunkProjectionRevisionId: payload.chunkProjectionRevisionId,
        chunkId: chunks[index].chunkId,
        subjectKey: chunks[index].subjectKey,
        dimensions: payload.dimensions,
        vectorBlob: encoded.blob,
        vectorHash: encoded.hash,
        norm: encoded.norm,
        createdAt: this.safeNow(),
      };
    });
  }

  private persistVectors(payload: AIEmbeddingJobPayload, vectors: readonly AIEmbeddingVector[], cursor: AIEmbeddingSourceCursor, context: AIJobExecutionContext): void {
    this.database.client.transaction(() => {
      this.dependencies.jobs.assertLeaseInTransaction(context.lease);
      const revision = this.requireBuildingRevision(payload.embeddingProjectionRevisionId);
      this.assertM7ARevision(revision);
      this.assertPinnedConfiguration(revision);
      this.vectorIndex.persistBatch({ projectionRevisionId: revision.id, vectors });
      this.dependencies.jobs.assertLeaseInTransaction(context.lease);
      const coverage = this.vectorIndex.getCoverage({ projectionRevisionId: revision.id, chunkProjectionRevisionId: revision.chunkProjectionRevisionId, chunkCount: revision.chunkCount });
      this.projections.advanceBatch({ revisionId: revision.id, sourceCursor: cursor, batchCount: revision.batchCount + 1, vectorCount: coverage.vectorCount, now: this.safeNow() });
    }).immediate();
  }

  private persistCursor(revisionId: string, cursor: AIEmbeddingSourceCursor, context: AIJobExecutionContext): void {
    this.database.client.transaction(() => {
      this.dependencies.jobs.assertLeaseInTransaction(context.lease);
      const revision = this.requireBuildingRevision(revisionId);
      this.assertM7ARevision(revision);
      this.assertPinnedConfiguration(revision);
      this.projections.advanceBatch({ revisionId, sourceCursor: cursor, batchCount: revision.batchCount + 1, vectorCount: revision.vectorCount, now: this.safeNow() });
    }).immediate();
  }

  private activate(revisionId: string, context: AIJobExecutionContext): AIEmbeddingProjectionRevision {
    return this.database.client.transaction(() => {
      this.dependencies.jobs.assertLeaseInTransaction(context.lease);
      const revision = this.requireBuildingRevision(revisionId);
      this.assertM7ARevision(revision);
      this.assertPinnedConfiguration(revision);
      const coverage = this.vectorIndex.getCoverage({ projectionRevisionId: revision.id, chunkProjectionRevisionId: revision.chunkProjectionRevisionId, chunkCount: revision.chunkCount });
      if (!coverage.complete) throw new AIEmbeddingError("AI_EMBEDDING_COVERAGE_INVALID", "The embedding projection does not have exact vector coverage.");
      const activated = this.projections.finalizeReady(revisionId, this.safeNow());
      this.dependencies.jobs.assertLeaseInTransaction(context.lease);
      return activated;
    }).immediate();
  }

  private recordAttempts(operationId: string, attempts: readonly import("../gateway").AIProviderAttemptTrace[], usage: NormalizedProviderUsage): void {
    for (const attempt of attempts) {
      if (!attempt.providerInvoked) continue;
      this.dependencies.accounting.recordAttempt({
        operationId,
        attempt,
        normalizedUsage: usage,
        capability: "EMBEDDING",
        providerModelId: attempt.providerModelId ?? "unknown",
        at: attempt.startedAt,
        latencyMs: attempt.latencyMs,
      });
    }
  }

  private failTerminal(revision: AIEmbeddingProjectionRevision, safeErrorCode: string, reservationId: string | null): void {
    if (revision.status === "BUILDING") this.projections.markFailed(revision.id, safeErrorCode, this.safeNow());
    const operation = this.dependencies.accounting.getOperation(revision.costOperationId);
    if (operation?.status === "OPEN") this.dependencies.accounting.completeOperation(revision.costOperationId, "OPEN", "FAILED", this.safeNow());
    if (reservationId) this.dependencies.admission.settle(reservationId, this.safeNow());
  }

  private reconcileCompletedJob(revision: AIEmbeddingProjectionRevision): void {
    const operation = this.dependencies.accounting.getOperation(revision.costOperationId);
    if (operation?.status === "OPEN") this.dependencies.accounting.completeOperation(revision.costOperationId, "OPEN", "COMPLETED", this.safeNow());
    const reservation = this.database.client.prepare("select id, status from ai_budget_reservations where operation_id=?").get(revision.costOperationId) as { id: string; status: string } | undefined;
    if (reservation && ["EXECUTING", "RECONCILIATION_REQUIRED"].includes(reservation.status)) this.dependencies.admission.settle(reservation.id, this.safeNow());
  }

  private resolveM7A(chunkProjectionSetId: string, subjectKey: string): ResolvedM7A {
    const set = this.m7aProjections.getSetById(chunkProjectionSetId);
    if (!set || set.subjectKey !== subjectKey) throw new AIEmbeddingError("AI_EMBEDDING_M7A_NOT_READY", "The requested M7A projection set is not in the requested subject scope.");
    const status = this.m7aHealth.getProjectionStatus({ originKind: set.originKind, originId: set.originId, subjectKey });
    const revision = this.m7aProjections.getCurrentRevision(set.id);
    if (status.status !== "READY" || !revision || revision.id !== status.projectionRevisionId || revision.status !== "READY" || !revision.isCurrent) throw new AIEmbeddingError("AI_EMBEDDING_M7A_NOT_READY", "The exact M7A projection is not current and fresh.");
    const stats = this.m7aProjections.getChunkStats(revision.id);
    if (stats.chunkCount !== revision.chunkCount) throw new AIEmbeddingError("AI_EMBEDDING_M7A_NOT_READY", "The M7A projection chunk count is inconsistent.");
    return { set, revision, chunkCount: stats.chunkCount, chunkBytes: stats.totalBytes, originRevision: stats.originRevision };
  }

  private assertM7ARevision(revision: AIEmbeddingProjectionRevision): ResolvedM7A {
    const resolved = this.resolveM7A(revision.chunkProjectionSetId, revision.subjectKey);
    if (resolved.revision.id !== revision.chunkProjectionRevisionId || resolved.revision.inputFingerprint !== revision.chunkProjectionInputFingerprint || resolved.chunkCount !== revision.chunkCount) throw new AIEmbeddingError("AI_EMBEDDING_CONFIG_CHANGED", "The pinned M7A projection changed during embedding.");
    return resolved;
  }

  private resolveEmbeddingSpace(modelConfigId: string): ResolvedEmbeddingSpace {
    const model = this.dependencies.models.getById(modelConfigId);
    if (!model || !model.enabled || model.capability !== "EMBEDDING" || model.embeddingDimensions === null || !Number.isSafeInteger(model.embeddingDimensions) || model.embeddingDimensions < 1 || model.embeddingDimensions > AI_EMBEDDING_MAX_DIMENSIONS) throw new AIEmbeddingError("AI_EMBEDDING_MODEL_INVALID", "The selected Model configuration is not an enabled embedding model with safe dimensions.");
    const provider = this.dependencies.providers.getById(model.providerConfigId);
    if (!provider || !provider.enabled || !provider.credentialRef) throw new AIEmbeddingError("AI_EMBEDDING_PROVIDER_INVALID", "The selected Provider configuration is not active for embedding.");
    const metadata = this.dependencies.secrets.getMetadata(provider.credentialRef);
    if (!metadata || metadata.status !== "ACTIVE") throw new AIEmbeddingError("AI_EMBEDDING_PROVIDER_INVALID", "The selected Provider credential is not active.");
    try { this.dependencies.adapters.require(model.adapterKey, "EMBEDDING"); } catch (error) { throw new AIEmbeddingError("AI_EMBEDDING_ADAPTER_INVALID", "The selected embedding adapter is not registered.", {}, { cause: error }); }
    return { model, provider };
  }

  private assertPinnedConfiguration(revision: AIEmbeddingProjectionRevision): ResolvedEmbeddingSpace {
    const space = this.resolveEmbeddingSpace(revision.modelConfigId);
    if (space.model.revision !== revision.modelConfigRevision || space.model.providerConfigId !== revision.providerConfigId || space.model.providerModelId !== revision.providerModelId || space.model.adapterKey !== revision.embeddingAdapterKey || space.model.embeddingDimensions !== revision.dimensions || space.provider.revision !== revision.providerConfigRevision) throw new AIEmbeddingError("AI_EMBEDDING_CONFIG_CHANGED", "The embedding Model or Provider configuration changed from the pinned space.");
    return space;
  }

  private requireBuildingRevision(id: string): AIEmbeddingProjectionRevision {
    const revision = this.projections.getRevision(id);
    if (!revision || revision.status !== "BUILDING") throw new AIEmbeddingError("AI_EMBEDDING_PROJECTION_CONFLICT", "The embedding projection revision is no longer buildable.");
    return revision;
  }

  private resumeResult(revision: AIEmbeddingProjectionRevision): AIEmbeddingBuildResult {
    return buildResult(revision, false);
  }

  private safeNow(): number {
    const now = this.clock();
    if (!Number.isSafeInteger(now) || now < 0 || now > MAX_TIMESTAMP) throw new AIEmbeddingError("AI_EMBEDDING_INVALID", "The embedding operation timestamp is invalid.");
    return now;
  }
}

export function createAIEmbeddingProjectionService(database: ContentDatabase, dependencies: AIEmbeddingProjectionServiceDependencies): AIEmbeddingProjectionService {
  return new AIEmbeddingProjectionService(database, dependencies);
}

function buildResult(revision: AIEmbeddingProjectionRevision, reused: boolean): AIEmbeddingBuildResult {
  return {
    embeddingProjectionSetId: revision.embeddingProjectionSetId,
    embeddingProjectionRevisionId: revision.id,
    revision: revision.revision,
    status: revision.status,
    chunkProjectionRevisionId: revision.chunkProjectionRevisionId,
    modelConfigId: revision.modelConfigId,
    modelConfigRevision: revision.modelConfigRevision,
    providerConfigId: revision.providerConfigId,
    providerConfigRevision: revision.providerConfigRevision,
    dimensions: revision.dimensions,
    vectorCount: revision.vectorCount,
    jobId: revision.jobId,
    costOperationId: revision.costOperationId,
    reused,
  };
}

function embeddingInputFingerprint(
  set: AIEmbeddingProjectionSet,
  m7a: AIRetrievalProjectionRevision,
  chunkCount: number,
  space: ResolvedEmbeddingSpace,
  codec: AIEmbeddingVectorCodec,
  vectorIndexAdapterKey: string,
): string {
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    embeddingProjectionSetId: set.id,
    subjectKey: set.subjectKey,
    chunkProjectionSetId: m7a.projectionSetId,
    chunkProjectionRevisionId: m7a.id,
    chunkProjectionInputFingerprint: m7a.inputFingerprint,
    chunkCount,
    modelConfigId: space.model.id,
    modelConfigRevision: space.model.revision,
    providerConfigId: space.provider.id,
    providerConfigRevision: space.provider.revision,
    providerModelId: space.model.providerModelId,
    embeddingAdapterKey: space.model.adapterKey,
    dimensions: space.model.embeddingDimensions,
    vectorCodecKey: codec.key,
    vectorCodecRevision: codec.revision,
    vectorIndexAdapterKey,
  })).digest("hex");
}

function matchesPinnedSpace(revision: AIEmbeddingProjectionRevision, m7a: ResolvedM7A, space: ResolvedEmbeddingSpace, codec: AIEmbeddingVectorCodec, vectorIndexAdapterKey: string): boolean {
  return revision.chunkProjectionSetId === m7a.set.id && revision.chunkProjectionRevisionId === m7a.revision.id && revision.chunkProjectionInputFingerprint === m7a.revision.inputFingerprint && revision.chunkCount === m7a.chunkCount && revision.modelConfigId === space.model.id && revision.modelConfigRevision === space.model.revision && revision.providerConfigId === space.provider.id && revision.providerConfigRevision === space.provider.revision && revision.providerModelId === space.model.providerModelId && revision.embeddingAdapterKey === space.model.adapterKey && revision.dimensions === space.model.embeddingDimensions && revision.vectorCodecKey === codec.key && revision.vectorCodecRevision === codec.revision && revision.vectorIndexAdapterKey === vectorIndexAdapterKey;
}

function assertRevisionPayload(revision: AIEmbeddingProjectionRevision, payload: AIEmbeddingJobPayload, context: AIJobExecutionContext): void {
  if (revision.jobId !== context.job.id || revision.costOperationId !== payload.costOperationId || revision.chunkProjectionRevisionId !== payload.chunkProjectionRevisionId || revision.chunkProjectionInputFingerprint !== payload.chunkProjectionInputFingerprint || revision.chunkCount !== payload.chunkCount || revision.modelConfigId !== payload.modelConfigId || revision.modelConfigRevision !== payload.modelConfigRevision || revision.providerConfigId !== payload.providerConfigId || revision.providerConfigRevision !== payload.providerConfigRevision || revision.providerModelId !== payload.providerModelId || revision.embeddingAdapterKey !== payload.embeddingAdapterKey || revision.dimensions !== payload.dimensions || revision.vectorCodecKey !== payload.vectorCodecKey || revision.vectorCodecRevision !== payload.vectorCodecRevision || revision.vectorIndexAdapterKey !== payload.vectorIndexAdapterKey) throw new AIEmbeddingError("AI_EMBEDDING_JOB_PAYLOAD_INVALID", "The embedding Job payload does not match its projection revision.");
}

function admissionPlanFromPayload(payload: AIEmbeddingJobPayload): AIAdmissionPlan {
  const planWithoutFingerprint: Omit<AIAdmissionPlan, "requestFingerprint"> = {
    principalRef: AI_EMBEDDING_SYSTEM_PRINCIPAL,
    budgetPolicyId: payload.budgetPolicyId,
    budgetPolicyRevision: payload.budgetPolicyRevision,
    rateLimitPolicyId: payload.rateLimitPolicyId,
    rateLimitPolicyRevision: payload.rateLimitPolicyRevision,
    budgetPeriod: { startAt: payload.budgetPeriodStart, endAt: payload.budgetPeriodEnd },
    costOperationId: payload.costOperationId,
    costEstimate: payload.costEstimate,
    idempotencyKey: payload.admissionIdempotencyKey,
  };
  const requestFingerprint = createAIAdmissionRequestFingerprint(planWithoutFingerprint);
  if (requestFingerprint !== payload.admissionRequestFingerprint) throw new AIEmbeddingError("AI_EMBEDDING_JOB_PAYLOAD_INVALID", "The embedding Job admission fingerprint is invalid.");
  return { ...planWithoutFingerprint, requestFingerprint };
}

function normalizeBatchSize(value?: number): number {
  return normalizePositive(value ?? AI_EMBEDDING_DEFAULT_BATCH_SIZE, "batchSize", AI_EMBEDDING_MAX_BATCH_SIZE);
}

function normalizePositive(value: number, field: string, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new AIEmbeddingError("AI_EMBEDDING_INVALID", `${field} is outside the safe bound.`);
  return value;
}

function emptyUsage(): NormalizedProviderUsage {
  return { inputTokens: null, outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null };
}
