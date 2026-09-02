import { createHash } from "node:crypto";
import type { ContentDatabase } from "../../content/database";
import {
  AI_RETRIEVAL_DEFAULT_BATCH_SIZE,
  AI_RETRIEVAL_MAX_BATCH_SIZE,
  AI_RETRIEVAL_MAX_CHUNK_BYTES,
  AI_RETRIEVAL_NORMALIZER_KEY,
  AI_RETRIEVAL_NORMALIZER_REVISION,
  AI_RETRIEVAL_STRATEGY_KEY,
  AI_RETRIEVAL_STRATEGY_REVISION,
  type AIChunkSourceItem,
  type AIRetrievalBatchResult,
  type AIRetrievalBuildOptions,
  type AIRetrievalBuildResult,
  type AIRetrievalChunk,
  type AIRetrievalOriginInput,
  type AIRetrievalProjectionRevision,
  type AIRetrievalProjectionSet,
  type AIRetrievalSourceCursor,
  type AIChunkingStrategyRegistry,
} from "./contracts";
import { AIRetrievalError } from "./errors";
import { normalizeRetrievalText } from "./normalization";
import { AIRetrievalSourceReader } from "./source-reader";
import { DefaultAIChunkingStrategyRegistry } from "./strategy-registry";
import { SQLiteAIRetrievalProjectionRepository } from "./sqlite-repository";

export interface AIRetrievalBuildSession {
  projectionSet: AIRetrievalProjectionSet;
  projectionRevision: AIRetrievalProjectionRevision;
  inputFingerprint: string;
  reused: boolean;
}

export interface AIRetrievalBuilderOptions {
  sourceReader?: AIRetrievalSourceReader;
  repository?: SQLiteAIRetrievalProjectionRepository;
  strategies?: AIChunkingStrategyRegistry;
  failureInjector?: (persistedBatchCount: number) => void;
}

/** Explicit, bounded M7A projection builder. It is resumable but does not enqueue durable Jobs. */
export class AIChunkProjectionBuilder {
  private readonly sourceReader: AIRetrievalSourceReader;
  private readonly repository: SQLiteAIRetrievalProjectionRepository;
  private readonly strategies: AIChunkingStrategyRegistry;

  constructor(
    private readonly database: ContentDatabase,
    private readonly options: AIRetrievalBuilderOptions = {},
  ) {
    this.sourceReader = options.sourceReader ?? new AIRetrievalSourceReader(database);
    this.repository = options.repository ?? new SQLiteAIRetrievalProjectionRepository(database);
    this.strategies = options.strategies ?? new DefaultAIChunkingStrategyRegistry();
  }

  startBuild(input: AIRetrievalBuildOptions): AIRetrievalBuildSession {
    const batchSize = normalizeBatchSize(input.batchSize);
    const strategy = this.strategies.get(AI_RETRIEVAL_STRATEGY_KEY, AI_RETRIEVAL_STRATEGY_REVISION);
    const origin = this.sourceReader.loadOrigin(input);
    if (!origin.eligible) throw new AIRetrievalError("AI_RETRIEVAL_SOURCE_INELIGIBLE", "The requested retrieval origin is not currently eligible.");
    const inputFingerprint = this.sourceReader.computeFingerprint(origin, batchSize, {
      strategyKey: strategy.key,
      strategyRevision: strategy.revision,
      normalizerKey: AI_RETRIEVAL_NORMALIZER_KEY,
      normalizerRevision: AI_RETRIEVAL_NORMALIZER_REVISION,
    });
    const projectionSet = this.repository.getOrCreateSet({
      originKind: input.originKind,
      originId: input.originId,
      subjectKey: input.subjectKey,
      strategyKey: strategy.key,
      normalizerKey: AI_RETRIEVAL_NORMALIZER_KEY,
      now: Date.now(),
    });
    const current = this.repository.getCurrentRevision(projectionSet.id);
    if (current && current.status === "READY" && current.inputFingerprint === inputFingerprint && current.strategyRevision === strategy.revision && current.normalizerRevision === AI_RETRIEVAL_NORMALIZER_REVISION) {
      return { projectionSet, projectionRevision: current, inputFingerprint, reused: true };
    }
    if (current && current.status === "BUILDING" && current.inputFingerprint === inputFingerprint && current.strategyRevision === strategy.revision && current.normalizerRevision === AI_RETRIEVAL_NORMALIZER_REVISION) {
      return { projectionSet, projectionRevision: current, inputFingerprint, reused: false };
    }
    const revisions = this.repository.listRevisions(projectionSet.id);
    const nextRevision = Math.max(0, ...revisions.map((revision) => revision.revision)) + 1;
    const projectionRevision = this.repository.createRevision({
      projectionSetId: projectionSet.id,
      revision: nextRevision,
      inputFingerprint,
      strategyKey: strategy.key,
      strategyRevision: strategy.revision,
      normalizerKey: AI_RETRIEVAL_NORMALIZER_KEY,
      normalizerRevision: AI_RETRIEVAL_NORMALIZER_REVISION,
      now: Date.now(),
    });
    return { projectionSet, projectionRevision, inputFingerprint, reused: false };
  }

  build(input: AIRetrievalBuildOptions): AIRetrievalBuildResult {
    const session = this.startBuild(input);
    if (session.reused) return this.result(session, true);
    try {
      let batch = this.processNextBatch(session.projectionRevision.id, input.batchSize);
      while (!batch.done) {
        if (this.options.failureInjector) this.options.failureInjector(this.repository.getRevision(session.projectionRevision.id)?.batchCount ?? 0);
        batch = this.processNextBatch(session.projectionRevision.id, input.batchSize);
      }
      if (this.options.failureInjector) this.options.failureInjector(this.repository.getRevision(session.projectionRevision.id)?.batchCount ?? 0);
      const activated = this.finalize(session.projectionRevision.id);
      return this.result({ ...session, projectionRevision: activated }, false);
    } catch (error) {
      const safeCode = error instanceof AIRetrievalError ? error.code : "AI_RETRIEVAL_PROJECTION_FAILED";
      this.repository.markFailed(session.projectionRevision.id, safeCode, Date.now());
      throw error instanceof AIRetrievalError ? error : new AIRetrievalError("AI_RETRIEVAL_PROJECTION_FAILED", "The retrieval projection build failed safely.", {}, { cause: error });
    }
  }

  processNextBatch(projectionRevisionId: string, requestedBatchSize = AI_RETRIEVAL_DEFAULT_BATCH_SIZE): AIRetrievalBatchResult {
    const revision = this.repository.getRevision(projectionRevisionId);
    if (!revision || revision.status !== "BUILDING") throw new AIRetrievalError("AI_RETRIEVAL_PROJECTION_NOT_FOUND", "The retrieval projection revision is not building.");
    if (revision.sourceCursor?.kind === "DONE") return { projectionRevisionId, processedItems: 0, insertedChunks: 0, done: true, cursor: { kind: "DONE" } };
    const projectionSet = this.repository.getSetById(revision.projectionSetId);
    if (!projectionSet) throw new AIRetrievalError("AI_RETRIEVAL_PROJECTION_NOT_FOUND", "The retrieval projection set was not found.");
    const origin = this.sourceReader.loadOrigin({ originKind: projectionSet.originKind, originId: projectionSet.originId, subjectKey: projectionSet.subjectKey });
    if (!origin.eligible) throw new AIRetrievalError("AI_RETRIEVAL_SOURCE_INELIGIBLE", "The retrieval origin is no longer eligible.");
    const batchSize = normalizeBatchSize(requestedBatchSize);
    const batch = this.sourceReader.readBatch(origin, revision.sourceCursor ?? { kind: "START" }, batchSize);
    let nextOrdinal = this.repository.countChunks(projectionRevisionId) + 1;
    const chunks: AIRetrievalChunk[] = [];
    const strategy = this.strategies.get(revision.strategyKey, revision.strategyRevision);
    for (const item of batch.items) {
      const drafts = strategy.build(item);
      for (const draft of drafts) {
        const textBytes = Buffer.byteLength(draft.text, "utf8");
        if (textBytes < 1 || textBytes > AI_RETRIEVAL_MAX_CHUNK_BYTES) throw new AIRetrievalError("AI_RETRIEVAL_PROJECTION_FAILED", "The deterministic chunk strategy exceeded its hard text bound.");
        chunks.push({
          chunkId: chunkId(item, draft, nextOrdinal, revision),
          projectionRevisionId,
          subjectKey: item.subjectKey,
          originKind: item.originKind,
          originId: item.originId,
          originRevision: item.originRevision,
          originContentRevision: item.originContentRevision,
          sourceId: item.sourceId,
          sourceRevision: item.sourceRevision,
          sourceType: item.sourceType,
          trustTier: item.trustTier,
          artifactSha256: item.artifactSha256,
          sourceItemId: item.sourceItemId,
          sourceItemOrder: item.sourceItemOrder,
          questionId: item.questionId,
          questionRevision: item.questionRevision,
          variantId: item.variantId,
          variantRevision: item.variantRevision,
          chunkOrdinal: nextOrdinal,
          text: draft.text,
          textHash: createHash("sha256").update(draft.text).digest("hex"),
          language: item.language,
          provenance: item.provenance,
          originMetadata: { ...item.originMetadata, sourceUnitIds: draft.sourceUnitIds, sourceUnitParts: draft.sourceUnitParts },
          strategyKey: revision.strategyKey,
          strategyRevision: revision.strategyRevision,
          normalizerKey: revision.normalizerKey,
          normalizerRevision: revision.normalizerRevision,
          createdAt: Date.now(),
        });
        nextOrdinal += 1;
      }
    }
    const cursor = batch.done ? { kind: "DONE" } as const : batch.cursor;
    return this.repository.persistBatch({
      revisionId: projectionRevisionId,
      chunks,
      cursor,
      batchCount: revision.batchCount + 1,
      chunkCount: nextOrdinal - 1,
      processedItems: batch.processedItems,
      now: Date.now(),
    });
  }

  finalize(projectionRevisionId: string): AIRetrievalProjectionRevision {
    const revision = this.repository.getRevision(projectionRevisionId);
    if (!revision) throw new AIRetrievalError("AI_RETRIEVAL_PROJECTION_NOT_FOUND", "The retrieval projection revision was not found.");
    const projectionSet = this.repository.getSetById(revision.projectionSetId);
    if (!projectionSet) throw new AIRetrievalError("AI_RETRIEVAL_PROJECTION_NOT_FOUND", "The retrieval projection set was not found.");
    const origin = this.sourceReader.loadOrigin({ originKind: projectionSet.originKind, originId: projectionSet.originId, subjectKey: projectionSet.subjectKey });
    if (!origin.eligible) throw new AIRetrievalError("AI_RETRIEVAL_SOURCE_INELIGIBLE", "The retrieval origin is no longer eligible for activation.");
    const currentFingerprint = this.sourceReader.computeFingerprint(origin, AI_RETRIEVAL_DEFAULT_BATCH_SIZE, {
      strategyKey: revision.strategyKey,
      strategyRevision: revision.strategyRevision,
      normalizerKey: revision.normalizerKey,
      normalizerRevision: revision.normalizerRevision,
    });
    if (currentFingerprint !== revision.inputFingerprint) throw new AIRetrievalError("AI_RETRIEVAL_INPUT_CHANGED", "Canonical retrieval input changed during the build.");
    return this.repository.finalizeReady(projectionRevisionId, Date.now());
  }

  private result(session: AIRetrievalBuildSession, reused: boolean): AIRetrievalBuildResult {
    return { projectionSetId: session.projectionSet.id, projectionRevisionId: session.projectionRevision.id, revision: session.projectionRevision.revision, status: session.projectionRevision.status, inputFingerprint: session.inputFingerprint, chunkCount: this.repository.countChunks(session.projectionRevision.id), reused };
  }
}

export function createAIChunkProjectionBuilder(database: ContentDatabase, options: AIRetrievalBuilderOptions = {}): AIChunkProjectionBuilder {
  return new AIChunkProjectionBuilder(database, options);
}

function normalizeBatchSize(value?: number): number {
  const size = value ?? AI_RETRIEVAL_DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(size) || size < 1 || size > AI_RETRIEVAL_MAX_BATCH_SIZE) throw new AIRetrievalError("AI_RETRIEVAL_INVALID", "Retrieval projection batch size is outside the safe bound.");
  return size;
}

function chunkId(item: AIChunkSourceItem, draft: { sourceUnitIds: string[]; sourceUnitParts: Array<{ unitId: string; part: number; totalParts: number }> }, ordinal: number, revision: AIRetrievalProjectionRevision): string {
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    originKind: item.originKind,
    originId: item.originId,
    originRevision: item.originRevision,
    originContentRevision: item.originContentRevision,
    sourceId: item.sourceId,
    sourceRevision: item.sourceRevision,
    artifactSha256: item.artifactSha256,
    sourceItemId: item.sourceItemId,
    sourceItemOrder: item.sourceItemOrder,
    questionId: item.questionId,
    questionRevision: item.questionRevision,
    variantId: item.variantId,
    variantRevision: item.variantRevision,
    sourceUnitIds: draft.sourceUnitIds,
    sourceUnitParts: draft.sourceUnitParts,
    chunkOrdinal: ordinal,
    strategyKey: revision.strategyKey,
    strategyRevision: revision.strategyRevision,
    normalizerKey: revision.normalizerKey,
    normalizerRevision: revision.normalizerRevision,
  })).digest("hex");
}
