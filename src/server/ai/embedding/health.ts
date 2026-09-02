import type { ContentDatabase } from "../../content/database";
import type { AIModelConfigRepository } from "../model-registry";
import {
  AIRetrievalProjectionHealthService,
  SQLiteAIRetrievalProjectionRepository,
} from "../retrieval";
import type {
  AIEmbeddingProjectionHealth,
  AIEmbeddingProjectionRepository,
  AIEmbeddingProjectionRevision,
  AIEmbeddingVectorIndexAdapter,
} from "./contracts";
import { AIEmbeddingError } from "./errors";
import { SQLiteAIEmbeddingProjectionRepository } from "./sqlite-projection-repository";
import { SQLiteAIVectorIndexAdapter } from "./vector-index";

export interface AIEmbeddingProjectionHealthOptions {
  m7aProjections?: SQLiteAIRetrievalProjectionRepository;
  m7aHealth?: AIRetrievalProjectionHealthService;
  projections?: AIEmbeddingProjectionRepository;
  vectorIndex?: AIEmbeddingVectorIndexAdapter;
  models?: AIModelConfigRepository;
  isRevisionSearchable?: (revision: AIEmbeddingProjectionRevision) => boolean;
}

/** Safe semantic projection status; vectors and M7A text are never returned. */
export class AIEmbeddingProjectionHealthService {
  private readonly m7aProjections: SQLiteAIRetrievalProjectionRepository;
  private readonly m7aHealth: AIRetrievalProjectionHealthService;
  private readonly projections: AIEmbeddingProjectionRepository;
  private readonly vectorIndex: AIEmbeddingVectorIndexAdapter;

  constructor(
    private readonly database: ContentDatabase,
    private readonly options: AIEmbeddingProjectionHealthOptions = {},
  ) {
    this.m7aProjections = options.m7aProjections ?? new SQLiteAIRetrievalProjectionRepository(database);
    this.m7aHealth = options.m7aHealth ?? new AIRetrievalProjectionHealthService(database);
    this.projections = options.projections ?? new SQLiteAIEmbeddingProjectionRepository(database);
    this.vectorIndex = options.vectorIndex ?? new SQLiteAIVectorIndexAdapter(database, {
      isRevisionSearchable: (revision) => this.isRevisionSearchable(revision),
    });
  }

  getHealth(input: { embeddingProjectionSetId: string }): AIEmbeddingProjectionHealth {
    const set = this.projections.getSetById(input.embeddingProjectionSetId);
    if (!set) return emptyHealth(null);
    const current = this.projections.getCurrentRevision(set.id);
    const latest = this.projections.listRevisions(set.id).at(-1) ?? null;
    const candidate = current ?? latest;
    if (!candidate) return emptyHealth(set.subjectKey, set.id);
    return this.buildHealth(set, candidate, false, current !== null);
  }

  getHealthForRevision(revisionId: string): AIEmbeddingProjectionHealth {
    const revision = this.projections.getRevision(revisionId);
    if (!revision) throw new AIEmbeddingError("AI_EMBEDDING_PROJECTION_NOT_FOUND", "The embedding projection revision was not found.");
    const set = this.projections.getSetById(revision.embeddingProjectionSetId);
    if (!set) throw new AIEmbeddingError("AI_EMBEDDING_PROJECTION_NOT_FOUND", "The embedding projection set was not found.");
    return this.buildHealth(set, revision, true);
  }

  isRevisionSearchable(revision: AIEmbeddingProjectionRevision): boolean {
    if (this.options.isRevisionSearchable) return this.options.isRevisionSearchable(revision);
    return revision.status === "READY" && revision.isCurrent && this.isM7AExactReady(revision) && this.isConfigCurrent(revision);
  }

  private buildHealth(
    set: { id: string; subjectKey: string },
    candidate: AIEmbeddingProjectionRevision,
    exactRevision: boolean,
    hasCurrentRevision = false,
  ): AIEmbeddingProjectionHealth {
    const m7aStatus = this.m7aStatus(candidate);
    const coverage = this.vectorIndex.getCoverage({
      projectionRevisionId: candidate.id,
      chunkProjectionRevisionId: candidate.chunkProjectionRevisionId,
      chunkCount: candidate.chunkCount,
    });
    const configCurrent = this.isConfigCurrent(candidate);
    const m7aExactReady = this.isM7AExactReady(candidate);
    let status: AIEmbeddingProjectionHealth["status"];
    if (m7aStatus === "INELIGIBLE") {
      status = "INELIGIBLE";
    } else if (exactRevision) {
      status = candidate.status === "BUILDING"
        ? "BUILDING"
        : candidate.status === "FAILED"
          ? "FAILED"
          : candidate.status === "READY" && candidate.isCurrent && m7aStatus === "READY" && m7aExactReady && configCurrent && coverage.complete
            ? "READY"
            : candidate.status === "READY"
              ? "STALE"
              : "MISSING";
    } else {
      status = !hasCurrentRevision
        ? candidate.status === "BUILDING"
          ? "BUILDING"
          : candidate.status === "FAILED"
            ? "FAILED"
            : "MISSING"
        : m7aStatus !== "READY" || !m7aExactReady || !configCurrent || !coverage.complete
          ? "STALE"
          : "READY";
    }
    return {
      subjectKey: set.subjectKey,
      embeddingProjectionSetId: set.id,
      embeddingProjectionRevisionId: candidate.id,
      chunkProjectionRevisionId: candidate.chunkProjectionRevisionId,
      modelConfigId: candidate.modelConfigId,
      modelConfigRevision: candidate.modelConfigRevision,
      providerConfigId: candidate.providerConfigId,
      providerConfigRevision: candidate.providerConfigRevision,
      dimensions: candidate.dimensions,
      chunkCount: coverage.chunkCount,
      vectorCount: coverage.vectorCount,
      missingVectorCount: coverage.missingVectorCount,
      orphanVectorCount: coverage.orphanVectorCount,
      coverage: coverage.chunkCount === 0 ? 1 : Math.min(1, coverage.vectorCount / coverage.chunkCount),
      jobId: candidate.jobId,
      jobStatus: this.jobStatus(candidate.jobId),
      status,
    };
  }

  private m7aStatus(revision: AIEmbeddingProjectionRevision): string {
    const set = this.m7aProjections.getSetById(revision.chunkProjectionSetId);
    if (!set) return "MISSING";
    return this.m7aHealth.getProjectionStatus({ originKind: set.originKind, originId: set.originId, subjectKey: set.subjectKey }).status;
  }

  private isM7AExactReady(revision: AIEmbeddingProjectionRevision): boolean {
    const set = this.m7aProjections.getSetById(revision.chunkProjectionSetId);
    if (!set) return false;
    const status = this.m7aHealth.getProjectionStatus({ originKind: set.originKind, originId: set.originId, subjectKey: set.subjectKey });
    const current = this.m7aProjections.getCurrentRevision(set.id);
    return status.status === "READY" && current?.id === revision.chunkProjectionRevisionId && current.inputFingerprint === revision.chunkProjectionInputFingerprint && current.chunkCount === revision.chunkCount;
  }

  private isConfigCurrent(revision: AIEmbeddingProjectionRevision): boolean {
    const model = this.options.models?.getById(revision.modelConfigId) ?? this.readModel(revision.modelConfigId);
    if (!model) return false;
    const provider = this.database.client.prepare("select id, revision, enabled from ai_provider_configs where id = ?").get(revision.providerConfigId) as { id: string; revision: number; enabled: number } | undefined;
    return model.revision === revision.modelConfigRevision && model.providerConfigId === revision.providerConfigId && model.providerModelId === revision.providerModelId && model.adapterKey === revision.embeddingAdapterKey && model.embeddingDimensions === revision.dimensions && model.enabled && model.capability === "EMBEDDING" && provider?.revision === revision.providerConfigRevision && Boolean(provider.enabled);
  }

  private readModel(id: string): { revision: number; providerConfigId: string; providerModelId: string; adapterKey: string; embeddingDimensions: number | null; enabled: boolean; capability: string } | null {
    const row = this.database.client.prepare("select revision, provider_config_id, provider_model_id, adapter_key, embedding_dimensions, enabled, capability from ai_model_configs where id = ?").get(id) as { revision: number; provider_config_id: string; provider_model_id: string; adapter_key: string; embedding_dimensions: number | null; enabled: number; capability: string } | undefined;
    return row ? { revision: Number(row.revision), providerConfigId: row.provider_config_id, providerModelId: row.provider_model_id, adapterKey: row.adapter_key, embeddingDimensions: row.embedding_dimensions === null ? null : Number(row.embedding_dimensions), enabled: Boolean(row.enabled), capability: row.capability } : null;
  }

  private jobStatus(jobId: string): string | null {
    const row = this.database.client.prepare("select status from ai_jobs where id = ?").get(jobId) as { status: string } | undefined;
    return row?.status ?? null;
  }
}

export function createAIEmbeddingProjectionHealthService(database: ContentDatabase, options: AIEmbeddingProjectionHealthOptions = {}): AIEmbeddingProjectionHealthService {
  return new AIEmbeddingProjectionHealthService(database, options);
}

function emptyHealth(subjectKey: string | null, embeddingProjectionSetId: string | null = null): AIEmbeddingProjectionHealth {
  return {
    subjectKey: subjectKey ?? "",
    embeddingProjectionSetId,
    embeddingProjectionRevisionId: null,
    chunkProjectionRevisionId: null,
    modelConfigId: null,
    modelConfigRevision: null,
    providerConfigId: null,
    providerConfigRevision: null,
    dimensions: null,
    chunkCount: 0,
    vectorCount: 0,
    missingVectorCount: 0,
    orphanVectorCount: 0,
    coverage: 0,
    jobId: null,
    jobStatus: null,
    status: "MISSING",
  };
}
