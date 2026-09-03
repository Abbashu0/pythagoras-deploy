import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import {
  aiEvalCaseResults,
  aiEvalDimensionAggregates,
  aiEvalGateResults,
  aiEvalGraderResults,
  aiEvalRuns,
  aiEvalSuiteCaseRefs,
  aiEvalSuiteRevisions,
  type AIEvalCaseResultRow,
  type AIEvalDimensionAggregateRow,
  type AIEvalGateResultRow,
  type AIEvalGraderResultRow,
  type AIEvalRunRow,
} from "../../content/schema";
import type {
  AIEvalCaseResult,
  AIEvalCandidateSnapshot,
  AIEvalDimensionAggregate,
  AIEvalGateResult,
  AIEvalGraderResult,
  AIEvalRun,
  AIEvalRunRepository,
  AIEvalRunStatus,
} from "./contracts";
import { AIEvalError } from "./errors";
import { fingerprintAIEvalCandidate, fingerprintAIEvalManifest, normalizeAIEvalCandidateSnapshot } from "./validation";

const TERMINAL_RUN_STATUSES = new Set<AIEvalRunStatus>(["COMPLETED", "FAILED", "CANCELLED"]);
const TRANSITIONS: Readonly<Record<AIEvalRunStatus, readonly AIEvalRunStatus[]>> = {
  CREATED: ["RUNNING", "FAILED", "CANCELLED"],
  RUNNING: ["SCORING", "FAILED", "CANCELLED"],
  SCORING: ["COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

/** Durable append-only Eval execution record repository. It never executes a target or judge. */
export class SQLiteAIEvalRunRepository implements AIEvalRunRepository {
  constructor(private readonly database: ContentDatabase) {}

  getById(id: string): AIEvalRun | null {
    const row = this.database.db.select().from(aiEvalRuns).where(eq(aiEvalRuns.id, id)).get();
    return row ? runFromRow(row) : null;
  }

  create(input: {
    id: string;
    suiteId: string;
    suiteRevision: number;
    manifestFingerprint: string;
    candidateSnapshot: AIEvalCandidateSnapshot;
    candidateFingerprint: string;
    baselineRunId: string | null;
    createdAt: number;
  }): AIEvalRun {
    const candidateSnapshot = normalizeAIEvalCandidateSnapshot(input.candidateSnapshot);
    if (!isSha256(input.manifestFingerprint) || !isSha256(input.candidateFingerprint) || fingerprintAIEvalCandidate(candidateSnapshot) !== input.candidateFingerprint) throw new AIEvalError("AI_EVAL_RUN_INVALID", "Eval Run fingerprints are invalid.");
    const suiteRevision = this.database.db.select({ id: aiEvalSuiteRevisions.id }).from(aiEvalSuiteRevisions).where(and(eq(aiEvalSuiteRevisions.suiteId, input.suiteId), eq(aiEvalSuiteRevisions.revision, input.suiteRevision))).get();
    if (!suiteRevision) throw new AIEvalError("AI_EVAL_RUN_INVALID", "The Eval Run Suite revision does not exist.");
    const manifest = this.database.db.select({ ordinal: aiEvalSuiteCaseRefs.ordinal, caseId: aiEvalSuiteCaseRefs.caseId, caseRevision: aiEvalSuiteCaseRefs.caseRevision }).from(aiEvalSuiteCaseRefs).where(eq(aiEvalSuiteCaseRefs.suiteRevisionId, suiteRevision.id)).orderBy(asc(aiEvalSuiteCaseRefs.ordinal)).all();
    if (fingerprintAIEvalManifest(manifest) !== input.manifestFingerprint) throw new AIEvalError("AI_EVAL_RUN_INVALID", "The Eval Run manifest fingerprint does not match its Suite revision.");
    if (input.baselineRunId === input.id || (input.baselineRunId !== null && !this.getById(input.baselineRunId))) throw new AIEvalError("AI_EVAL_RUN_INVALID", "The Eval Run baseline reference is invalid.");
    if (!Number.isSafeInteger(input.suiteRevision) || input.suiteRevision < 1 || !Number.isSafeInteger(input.createdAt) || input.createdAt < 0) throw new AIEvalError("AI_EVAL_RUN_INVALID", "Eval Run identity metadata is invalid.");
    try {
      this.database.db.insert(aiEvalRuns).values({
        id: input.id,
        suiteId: input.suiteId,
        suiteRevision: input.suiteRevision,
        manifestFingerprint: input.manifestFingerprint,
        candidateSnapshot: structuredClone(candidateSnapshot),
        candidateFingerprint: input.candidateFingerprint,
        baselineRunId: input.baselineRunId,
        status: "CREATED",
        recommendation: null,
        safeFailureCode: null,
        createdAt: input.createdAt,
        startedAt: null,
        scoredAt: null,
        completedAt: null,
        updatedAt: input.createdAt,
      }).run();
    } catch (error) {
      throw new AIEvalError("AI_EVAL_RUN_INVALID", "The Eval Run could not be created.", {}, error);
    }
    const run = this.getById(input.id);
    if (!run) throw new AIEvalError("AI_EVAL_RUN_INVALID", "The Eval Run could not be read after creation.");
    return run;
  }

  transition(input: {
    id: string;
    expectedStatus: AIEvalRunStatus;
    status: AIEvalRunStatus;
    recommendation?: AIEvalRun["recommendation"];
    safeFailureCode?: string | null;
    startedAt?: number | null;
    scoredAt?: number | null;
    completedAt?: number | null;
    updatedAt: number;
  }): AIEvalRun {
    const current = this.database.db.select().from(aiEvalRuns).where(eq(aiEvalRuns.id, input.id)).get();
    if (!current) throw new AIEvalError("AI_EVAL_NOT_FOUND", "The Eval Run was not found.");
    if (current.status !== input.expectedStatus || !TRANSITIONS[current.status].includes(input.status)) throw new AIEvalError("AI_EVAL_RUN_INVALID", "The Eval Run lifecycle transition is invalid.");
    if (TERMINAL_RUN_STATUSES.has(current.status)) throw new AIEvalError("AI_EVAL_RUN_INVALID", "A terminal Eval Run cannot be reopened.");
    assertTimestamp(input.updatedAt, "updatedAt");
    for (const [field, value] of [["startedAt", input.startedAt], ["scoredAt", input.scoredAt], ["completedAt", input.completedAt]] as const) {
      if (value !== undefined && value !== null) assertTimestamp(value, field);
    }
    if (input.status === "COMPLETED" && input.recommendation === undefined) throw new AIEvalError("AI_EVAL_RUN_INVALID", "A completed Eval Run requires a recommendation.");
    if (input.status !== "COMPLETED" && input.recommendation !== undefined && input.recommendation !== null) throw new AIEvalError("AI_EVAL_RUN_INVALID", "Only a completed Eval Run may carry a recommendation.");
    try {
      const row = this.database.db.update(aiEvalRuns).set({
        status: input.status,
        recommendation: input.recommendation === undefined ? current.recommendation : input.recommendation,
        safeFailureCode: input.safeFailureCode === undefined ? current.safeFailureCode : input.safeFailureCode,
        startedAt: input.startedAt === undefined ? current.startedAt : input.startedAt,
        scoredAt: input.scoredAt === undefined ? current.scoredAt : input.scoredAt,
        completedAt: input.completedAt === undefined ? current.completedAt : input.completedAt,
        updatedAt: input.updatedAt,
      }).where(and(eq(aiEvalRuns.id, input.id), eq(aiEvalRuns.status, input.expectedStatus))).returning().get();
      if (!row) throw new AIEvalError("AI_EVAL_RUN_INVALID", "The Eval Run changed before its lifecycle transition.");
      return runFromRow(row);
    } catch (error) {
      if (error instanceof AIEvalError) throw error;
      throw new AIEvalError("AI_EVAL_RUN_INVALID", "The Eval Run lifecycle transition failed.", {}, error);
    }
  }

  insertCaseResult(input: Omit<AIEvalCaseResult, "id"> & { id?: string }): AIEvalCaseResult {
    const id = input.id ?? uuidv7();
    if (!isSha256(input.outputSha256) || !Number.isSafeInteger(input.outputByteSize) || input.outputByteSize < 0 || input.outputByteSize > 524_288) throw new AIEvalError("AI_EVAL_RUN_INVALID", "The Eval Case result output metadata is invalid.");
    const run = this.database.db.select({ status: aiEvalRuns.status }).from(aiEvalRuns).where(eq(aiEvalRuns.id, input.runId)).get();
    if (!run || run.status !== "RUNNING") throw new AIEvalError("AI_EVAL_RUN_NOT_SCORABLE", "Eval Case results can only be inserted while a Run is RUNNING.");
    try {
      this.database.db.insert(aiEvalCaseResults).values({
        id,
        runId: input.runId,
        caseId: input.caseId,
        caseRevision: input.caseRevision,
        ordinal: input.ordinal,
        observedSubjectKey: input.observedSubjectKey,
        observedStatus: input.observedStatus,
        finishReason: input.finishReason,
        outputSha256: input.outputSha256,
        outputByteSize: input.outputByteSize,
        evidence: [...input.evidence],
        retrievalStatus: input.retrievalStatus,
        elapsedLatencyMs: input.elapsedLatencyMs,
        costOperationId: input.costOperationId,
        privacyClass: input.privacyClass,
        createdAt: input.createdAt,
      }).run();
    } catch (error) {
      throw new AIEvalError("AI_EVAL_DUPLICATE_RESULT", "The Eval Case result could not be appended.", {}, error);
    }
    const row = this.database.db.select().from(aiEvalCaseResults).where(eq(aiEvalCaseResults.id, id)).get();
    if (!row) throw new AIEvalError("AI_EVAL_RUN_INVALID", "The Eval Case result could not be read after insertion.");
    return caseResultFromRow(row);
  }

  listCaseResults(runId: string): AIEvalCaseResult[] {
    return this.database.db.select().from(aiEvalCaseResults).where(eq(aiEvalCaseResults.runId, runId)).orderBy(asc(aiEvalCaseResults.ordinal), asc(aiEvalCaseResults.id)).all().map(caseResultFromRow);
  }

  insertGraderResult(input: Omit<AIEvalGraderResult, "id"> & { id?: string }): AIEvalGraderResult {
    const id = input.id ?? uuidv7();
    if (!Number.isSafeInteger(input.scoreUnits) || input.scoreUnits < 0 || input.scoreUnits > 1_000_000) throw new AIEvalError("AI_EVAL_RUN_INVALID", "The Eval grader score is invalid.");
    const parent = this.database.db.select({ runId: aiEvalCaseResults.runId, runStatus: aiEvalRuns.status, suiteId: aiEvalRuns.suiteId, suiteRevision: aiEvalRuns.suiteRevision })
      .from(aiEvalCaseResults)
      .innerJoin(aiEvalRuns, eq(aiEvalCaseResults.runId, aiEvalRuns.id))
      .where(eq(aiEvalCaseResults.id, input.caseResultId))
      .get();
    if (!parent || parent.runStatus !== "RUNNING") throw new AIEvalError("AI_EVAL_RUN_NOT_SCORABLE", "Deterministic Eval graders can only be inserted while a Run is RUNNING.");
    const suiteRevision = this.database.db.select({ graderConfigs: aiEvalSuiteRevisions.graderConfigs, requiredDimensions: aiEvalSuiteRevisions.requiredDimensions })
      .from(aiEvalSuiteRevisions)
      .where(and(eq(aiEvalSuiteRevisions.suiteId, parent.suiteId), eq(aiEvalSuiteRevisions.revision, parent.suiteRevision)))
      .get();
    if (!suiteRevision || !isConfiguredDeterministicGrader(suiteRevision.graderConfigs, suiteRevision.requiredDimensions, input)) throw new AIEvalError("AI_EVAL_GRADER_UNSUPPORTED", "The deterministic Eval grader is not configured for the pinned Suite dimension.");
    try {
      this.database.db.insert(aiEvalGraderResults).values({ ...input, id }).run();
    } catch (error) {
      throw new AIEvalError("AI_EVAL_DUPLICATE_RESULT", "The deterministic Eval grader result could not be appended.", {}, error);
    }
    const row = this.database.db.select().from(aiEvalGraderResults).where(eq(aiEvalGraderResults.id, id)).get();
    if (!row) throw new AIEvalError("AI_EVAL_RUN_INVALID", "The deterministic Eval grader result could not be read after insertion.");
    return graderResultFromRow(row);
  }

  listGraderResults(caseResultId: string): AIEvalGraderResult[] {
    return this.database.db.select().from(aiEvalGraderResults).where(eq(aiEvalGraderResults.caseResultId, caseResultId)).orderBy(asc(aiEvalGraderResults.dimension), asc(aiEvalGraderResults.graderKey), asc(aiEvalGraderResults.graderRevision)).all().map(graderResultFromRow);
  }

  insertDimensionAggregate(input: AIEvalDimensionAggregate): AIEvalDimensionAggregate {
    try {
      this.database.db.insert(aiEvalDimensionAggregates).values(input).run();
    } catch (error) {
      throw new AIEvalError("AI_EVAL_DUPLICATE_RESULT", "The Eval dimension aggregate could not be appended.", {}, error);
    }
    return input;
  }

  listDimensionAggregates(runId: string): AIEvalDimensionAggregate[] {
    return this.database.db.select().from(aiEvalDimensionAggregates).where(eq(aiEvalDimensionAggregates.runId, runId)).orderBy(asc(aiEvalDimensionAggregates.dimension)).all().map(aggregateFromRow);
  }

  insertGateResult(input: AIEvalGateResult): AIEvalGateResult {
    try {
      this.database.db.insert(aiEvalGateResults).values(input).run();
    } catch (error) {
      throw new AIEvalError("AI_EVAL_DUPLICATE_RESULT", "The Eval gate result could not be appended.", {}, error);
    }
    return input;
  }

  listGateResults(runId: string): AIEvalGateResult[] {
    return this.database.db.select().from(aiEvalGateResults).where(eq(aiEvalGateResults.runId, runId)).orderBy(asc(aiEvalGateResults.gateKey)).all().map(gateFromRow);
  }
}

function runFromRow(row: AIEvalRunRow): AIEvalRun {
  return {
    id: row.id,
    suiteId: row.suiteId,
    suiteRevision: row.suiteRevision,
    manifestFingerprint: row.manifestFingerprint,
    candidateSnapshot: normalizeAIEvalCandidateSnapshot(row.candidateSnapshot),
    candidateFingerprint: row.candidateFingerprint,
    baselineRunId: row.baselineRunId,
    status: row.status,
    recommendation: row.recommendation,
    safeFailureCode: row.safeFailureCode,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    scoredAt: row.scoredAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  };
}

function caseResultFromRow(row: AIEvalCaseResultRow): AIEvalCaseResult {
  return {
    id: row.id,
    runId: row.runId,
    caseId: row.caseId,
    caseRevision: row.caseRevision,
    ordinal: row.ordinal,
    observedSubjectKey: row.observedSubjectKey,
    observedStatus: row.observedStatus,
    finishReason: row.finishReason as AIEvalCaseResult["finishReason"],
    outputSha256: row.outputSha256,
    outputByteSize: row.outputByteSize,
    evidence: structuredClone(row.evidence),
    retrievalStatus: row.retrievalStatus as AIEvalCaseResult["retrievalStatus"],
    elapsedLatencyMs: row.elapsedLatencyMs,
    costOperationId: row.costOperationId,
    privacyClass: row.privacyClass,
    createdAt: row.createdAt,
  };
}

function graderResultFromRow(row: AIEvalGraderResultRow): AIEvalGraderResult {
  return { id: row.id, caseResultId: row.caseResultId, dimension: row.dimension, graderKey: row.graderKey, graderRevision: row.graderRevision, verdict: row.verdict, scoreUnits: row.scoreUnits, safeReasonCode: row.safeReasonCode, blocking: row.blocking, createdAt: row.createdAt };
}

function aggregateFromRow(row: AIEvalDimensionAggregateRow): AIEvalDimensionAggregate {
  return { runId: row.runId, dimension: row.dimension, applicableCaseCount: row.applicableCaseCount, passedCaseCount: row.passedCaseCount, failedCaseCount: row.failedCaseCount, scoreUnits: row.scoreUnits, blockingFailureCount: row.blockingFailureCount };
}

function gateFromRow(row: AIEvalGateResultRow): AIEvalGateResult {
  return { runId: row.runId, gateKey: row.gateKey, verdict: row.verdict, observedValue: row.observedValue, thresholdValue: row.thresholdValue, safeReasonCode: row.safeReasonCode };
}

function isSha256(value: string): boolean {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new AIEvalError("AI_EVAL_RUN_INVALID", `The Eval Run ${field} timestamp is invalid.`);
}

function isConfiguredDeterministicGrader(
  graderConfigs: unknown,
  requiredDimensions: unknown,
  input: Pick<AIEvalGraderResult, "dimension" | "graderKey" | "graderRevision">,
): boolean {
  if (!Array.isArray(graderConfigs) || !Array.isArray(requiredDimensions)) return false;
  const configured = graderConfigs.some((config) => isRecord(config)
    && config.graderKey === input.graderKey
    && config.graderRevision === input.graderRevision
    && config.dimension === input.dimension);
  const deterministic = requiredDimensions.some((requirement) => isRecord(requirement)
    && requirement.dimension === input.dimension
    && requirement.mode === "DETERMINISTICALLY_GRADED");
  return configured && deterministic;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
