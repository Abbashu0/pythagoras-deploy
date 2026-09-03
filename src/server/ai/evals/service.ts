import type { ContentDatabase } from "../../content/database";
import { isAIAccountingError, SQLiteAIAccountingRepository, type AICostOperation, type AIOperationCostSummary, type AIUsageCostRecord } from "../economics";
import type {
  AIEvalBaselineComparison,
  AIEvalCaseResult,
  AIEvalCaseRevision,
  AIEvalDimension,
  AIEvalDimensionAggregate,
  AIEvalGateResult,
  AIEvalGraderResult,
  AIEvalObservation,
  AIEvalRun,
  AIEvalRunScoreReport,
  AIEvalSuiteRevision,
  AIEvalSuiteRepository,
  AIEvalCaseRepository,
  AIEvalRunRepository,
} from "./contracts";
import { AIEvalError } from "./errors";
import { createDefaultAIEvalGraderRegistry, assertSupportedDeterministicGrader } from "./graders";
import { SQLiteAIEvalCaseRepository, SQLiteAIEvalSuiteRepository } from "./configuration";
import { SQLiteAIEvalRunRepository } from "./runs";
import {
  fingerprintAIEvalCandidate,
  fingerprintAIEvalManifest,
  hashEvalOutput,
  normalizeAIEvalCandidateSnapshot,
  normalizeAIEvalObservation,
} from "./validation";
import type { AIEvalGraderRegistry } from "./contracts";

export interface AIEvalRunServiceDependencies {
  suites?: AIEvalSuiteRepository;
  cases?: AIEvalCaseRepository;
  runs?: AIEvalRunRepository;
  graders?: AIEvalGraderRegistry;
  accounting?: AIEvalAccountingReader;
}

export interface AIEvalAccountingReader {
  getOperation(id: string): AICostOperation | null;
  getOperationCostSummary(id: string): AIOperationCostSummary;
  listUsageCostRecords(operationId: string): AIUsageCostRecord[];
}

/** M9A orchestration for deterministic observations and gates. It has no Provider execution path. */
export class AIEvalRunService {
  private readonly suites: AIEvalSuiteRepository;
  private readonly cases: AIEvalCaseRepository;
  private readonly runs: AIEvalRunRepository;
  private readonly graders: AIEvalGraderRegistry;
  private readonly accounting: AIEvalAccountingReader;

  constructor(private readonly database: ContentDatabase, dependencies: AIEvalRunServiceDependencies = {}) {
    this.suites = dependencies.suites ?? new SQLiteAIEvalSuiteRepository(database);
    this.cases = dependencies.cases ?? new SQLiteAIEvalCaseRepository(database);
    this.runs = dependencies.runs ?? new SQLiteAIEvalRunRepository(database);
    this.graders = dependencies.graders ?? createDefaultAIEvalGraderRegistry();
    this.accounting = dependencies.accounting ?? new SQLiteAIAccountingRepository(database);
  }

  createRun(input: {
    id: string;
    suiteId: string;
    suiteRevision: number;
    candidateSnapshot: unknown;
    baselineRunId?: string | null;
    createdAt: number;
  }): AIEvalRun {
    const suite = this.requireSuiteRevision(input.suiteId, input.suiteRevision);
    if (!suite.enabled) throw new AIEvalError("AI_EVAL_RUN_INVALID", "An Eval Run cannot start from a disabled Suite revision.");
    const candidateSnapshot = normalizeAIEvalCandidateSnapshot(input.candidateSnapshot);
    const manifestFingerprint = fingerprintAIEvalManifest(suite.caseManifest);
    const candidateFingerprint = fingerprintAIEvalCandidate(candidateSnapshot);
    return this.runs.create({ id: input.id, suiteId: input.suiteId, suiteRevision: input.suiteRevision, manifestFingerprint, candidateSnapshot, candidateFingerprint, baselineRunId: input.baselineRunId ?? null, createdAt: input.createdAt });
  }

  startRun(id: string, now: number): AIEvalRun {
    return this.runs.transition({ id, expectedStatus: "CREATED", status: "RUNNING", startedAt: now, updatedAt: now });
  }

  beginScoring(id: string, now: number): AIEvalRun {
    return this.runs.transition({ id, expectedStatus: "RUNNING", status: "SCORING", scoredAt: null, updatedAt: now });
  }

  recordObservationAndGrade(input: unknown, createdAt: number): { result: AIEvalCaseResult; graders: readonly AIEvalGraderResult[] } {
    const observation = normalizeAIEvalObservation(input);
    const run = this.requireRun(observation.runId);
    if (run.status !== "RUNNING") throw new AIEvalError("AI_EVAL_RUN_NOT_SCORABLE", "Eval observations may only be recorded while a Run is RUNNING.");
    const suite = this.requireSuiteRevision(run.suiteId, run.suiteRevision);
    const manifest = suite.caseManifest.find((entry) => entry.caseId === observation.caseId);
    if (!manifest) throw new AIEvalError("AI_EVAL_CASE_NOT_IN_SUITE", "The observed Eval Case is not part of the pinned Suite manifest.");
    if (manifest.caseRevision !== observation.caseRevision) throw new AIEvalError("AI_EVAL_CASE_REVISION_MISMATCH", "The observed Eval Case revision does not match the pinned manifest.");
    const caseRevision = this.cases.getRevision(observation.caseId, observation.caseRevision);
    if (!caseRevision) throw new AIEvalError("AI_EVAL_CASE_REVISION_MISMATCH", "The observed Eval Case revision is unavailable.");
    if (caseRevision.subjectKey !== suite.subjectKey || observation.observedSubjectKey !== suite.subjectKey) throw new AIEvalError("AI_EVAL_CASE_REVISION_MISMATCH", "The observed Eval Case subject does not match the Suite subject.");
    const costNano = this.resolveCanonicalCost(run, observation.costOperationId);
    const resultInput = this.resultInput(observation, caseRevision, createdAt);
    const graderInputs = suite.graderConfigs.filter((config) => config.required || suite.requiredDimensions.some((dimension) => dimension.dimension === config.dimension && dimension.mode === "DETERMINISTICALLY_GRADED"));
    try {
      return this.database.client.transaction(() => {
        const result = this.runs.insertCaseResult(resultInput);
        const graders: AIEvalGraderResult[] = [];
        for (const config of graderInputs) {
          const grader = assertSupportedDeterministicGrader(this.graders, config.graderKey, config.graderRevision);
          if (grader.dimension !== config.dimension) throw new AIEvalError("AI_EVAL_GRADER_UNSUPPORTED", "The configured Eval grader dimension is not supported by its code identity.");
          const draft = grader.grade({ caseRevision, observation, context: { costNano } });
          graders.push(this.runs.insertGraderResult({ ...draft, caseResultId: result.id, createdAt }));
        }
        return { result, graders };
      }).immediate();
    } catch (error) {
      if (error instanceof AIEvalError) throw error;
      throw new AIEvalError("AI_EVAL_RUN_INVALID", "The Eval observation could not be recorded.", {}, error);
    }
  }

  /** Record an already trusted internal observation without running code-owned graders. */
  recordObservation(input: unknown, createdAt: number): AIEvalCaseResult {
    const observation = normalizeAIEvalObservation(input);
    const run = this.requireRun(observation.runId);
    if (run.status !== "RUNNING") throw new AIEvalError("AI_EVAL_RUN_NOT_SCORABLE", "Eval observations may only be recorded while a Run is RUNNING.");
    const suite = this.requireSuiteRevision(run.suiteId, run.suiteRevision);
    const manifest = suite.caseManifest.find((entry) => entry.caseId === observation.caseId);
    if (!manifest || manifest.caseRevision !== observation.caseRevision) throw new AIEvalError("AI_EVAL_CASE_REVISION_MISMATCH", "The observed Eval Case does not match the pinned manifest.");
    const caseRevision = this.cases.getRevision(observation.caseId, observation.caseRevision);
    if (!caseRevision || caseRevision.subjectKey !== suite.subjectKey || observation.observedSubjectKey !== suite.subjectKey) throw new AIEvalError("AI_EVAL_CASE_REVISION_MISMATCH", "The observed Eval Case subject is invalid.");
    return this.runs.insertCaseResult(this.resultInput(observation, caseRevision, createdAt));
  }

  completeRun(id: string, now: number): { run: AIEvalRun; report: AIEvalRunScoreReport; baseline: AIEvalBaselineComparison | null } {
    const current = this.requireRun(id);
    if (current.status !== "SCORING") throw new AIEvalError("AI_EVAL_RUN_NOT_SCORABLE", "Only a SCORING Eval Run can be completed.");
    const suite = this.requireSuiteRevision(current.suiteId, current.suiteRevision);
    const caseResults = this.runs.listCaseResults(id);
    const aggregates = this.buildAggregates(current, suite, caseResults);
    const gates = this.buildAbsoluteGates(current, suite, caseResults, aggregates);
    const baseline = this.compareBaseline(current, suite, aggregates);
    const allGates = [...gates, ...(baseline ? this.baselineGates(current.id, baseline) : [])];
    const recommendation = allGates.some((gate) => gate.verdict === "BLOCKED") ? "BLOCKED" : allGates.some((gate) => gate.verdict === "INCOMPLETE") ? "INCOMPLETE" : "PASS_RECOMMENDED";
    const report: AIEvalRunScoreReport = { aggregates, gates: allGates, recommendation };
    const run = this.database.client.transaction(() => {
      for (const aggregate of aggregates) this.runs.insertDimensionAggregate(aggregate);
      for (const gate of allGates) this.runs.insertGateResult(gate);
      return this.runs.transition({ id, expectedStatus: "SCORING", status: "COMPLETED", recommendation, safeFailureCode: recommendation === "PASS_RECOMMENDED" ? null : recommendation === "BLOCKED" ? "EVAL_GATE_BLOCKED" : "EVAL_RESULTS_INCOMPLETE", scoredAt: now, completedAt: now, updatedAt: now });
    }).immediate();
    return { run, report, baseline };
  }

  failRun(id: string, now: number, safeFailureCode = "EVAL_RUN_FAILED"): AIEvalRun {
    const run = this.requireRun(id);
    if (run.status === "CREATED") return this.runs.transition({ id, expectedStatus: "CREATED", status: "FAILED", safeFailureCode, completedAt: now, updatedAt: now });
    if (run.status === "RUNNING") return this.runs.transition({ id, expectedStatus: "RUNNING", status: "FAILED", safeFailureCode, completedAt: now, updatedAt: now });
    if (run.status === "SCORING") return this.runs.transition({ id, expectedStatus: "SCORING", status: "FAILED", safeFailureCode, completedAt: now, updatedAt: now });
    throw new AIEvalError("AI_EVAL_RUN_INVALID", "A terminal Eval Run cannot be failed again.");
  }

  cancelRun(id: string, now: number): AIEvalRun {
    const run = this.requireRun(id);
    if (run.status === "CREATED") return this.runs.transition({ id, expectedStatus: "CREATED", status: "CANCELLED", safeFailureCode: "EVAL_RUN_CANCELLED", completedAt: now, updatedAt: now });
    if (run.status === "RUNNING") return this.runs.transition({ id, expectedStatus: "RUNNING", status: "CANCELLED", safeFailureCode: "EVAL_RUN_CANCELLED", completedAt: now, updatedAt: now });
    if (run.status === "SCORING") return this.runs.transition({ id, expectedStatus: "SCORING", status: "CANCELLED", safeFailureCode: "EVAL_RUN_CANCELLED", completedAt: now, updatedAt: now });
    throw new AIEvalError("AI_EVAL_RUN_INVALID", "A terminal Eval Run cannot be cancelled again.");
  }

  private buildAggregates(run: AIEvalRun, suite: AIEvalSuiteRevision, results: readonly AIEvalCaseResult[]): AIEvalDimensionAggregate[] {
    const dimensions = new Set<AIEvalDimension>([
      ...suite.requiredDimensions.map((requirement) => requirement.dimension),
      ...suite.graderConfigs.map((config) => config.dimension),
    ]);
    return [...dimensions].sort().map((dimension) => {
      const requirement = suite.requiredDimensions.find((candidate) => candidate.dimension === dimension);
      if (requirement?.mode === "JUDGE_REQUIRED") {
        return { runId: run.id, dimension, applicableCaseCount: 0, passedCaseCount: 0, failedCaseCount: 0, scoreUnits: null, blockingFailureCount: 0 };
      }
      const requiredGraders = suite.graderConfigs.filter((config) => config.dimension === dimension && config.required);
      const configuredGraderIdentities = new Set(suite.graderConfigs.filter((config) => config.dimension === dimension).map((config) => `${config.graderKey}@${config.graderRevision}`));
      const caseScores: number[] = [];
      let passedCaseCount = 0;
      let failedCaseCount = 0;
      let blockingFailureCount = 0;
      for (const result of results) {
        const graderResults = this.runs.listGraderResults(result.id).filter((grader) => grader.dimension === dimension && configuredGraderIdentities.has(`${grader.graderKey}@${grader.graderRevision}`));
        blockingFailureCount += graderResults.filter((grader) => grader.blocking && grader.verdict === "FAIL").length;
        const relevant = requiredGraders.length === 0
          ? graderResults
          : graderResults.filter((grader) => requiredGraders.some((config) => config.graderKey === grader.graderKey && config.graderRevision === grader.graderRevision));
        if (relevant.length === 0 || relevant.some((grader) => grader.verdict === "NOT_APPLICABLE")) continue;
        if (requiredGraders.length > 0 && relevant.length < requiredGraders.length) continue;
        const score = Math.floor(relevant.reduce((sum, grader) => sum + grader.scoreUnits, 0) / relevant.length);
        caseScores.push(score);
        if (relevant.every((grader) => grader.verdict === "PASS")) passedCaseCount += 1; else failedCaseCount += 1;
      }
      const scoreUnits = caseScores.length > 0 ? Math.floor(caseScores.reduce((sum, score) => sum + score, 0) / caseScores.length) : null;
      return { runId: run.id, dimension, applicableCaseCount: caseScores.length, passedCaseCount, failedCaseCount, scoreUnits, blockingFailureCount: requirement?.mode === "NOT_APPLICABLE" ? 0 : blockingFailureCount };
    });
  }

  private buildAbsoluteGates(run: AIEvalRun, suite: AIEvalSuiteRevision, results: readonly AIEvalCaseResult[], aggregates: readonly AIEvalDimensionAggregate[]): AIEvalGateResult[] {
    const gates: AIEvalGateResult[] = [];
    const manifestComplete = results.length === suite.caseManifest.length
      && suite.caseManifest.every((entry) => results.some((result) => result.caseId === entry.caseId && result.caseRevision === entry.caseRevision && result.ordinal === entry.ordinal));
    gates.push({ runId: run.id, gateKey: "MANIFEST_RESULTS_COMPLETE", verdict: manifestComplete ? "PASS" : "INCOMPLETE", observedValue: results.length, thresholdValue: suite.caseManifest.length, safeReasonCode: manifestComplete ? "MANIFEST_COMPLETE" : "MANIFEST_RESULT_MISSING" });
    for (const requirement of suite.requiredDimensions) {
      if (requirement.mode === "NOT_APPLICABLE") continue;
      const aggregate = aggregates.find((candidate) => candidate.dimension === requirement.dimension);
      const complete = !!aggregate && aggregate.applicableCaseCount === suite.caseManifest.length && aggregate.scoreUnits !== null;
      gates.push({ runId: run.id, gateKey: `REQUIRED_${requirement.dimension}`, verdict: complete ? "PASS" : "INCOMPLETE", observedValue: aggregate?.scoreUnits ?? null, thresholdValue: null, safeReasonCode: complete ? "REQUIRED_DIMENSION_COMPLETE" : requirement.mode === "JUDGE_REQUIRED" ? "JUDGE_RESULT_MISSING" : "DETERMINISTIC_RESULT_MISSING" });
    }
    for (const minimum of suite.gateConfig.minimumScores) {
      const aggregate = aggregates.find((candidate) => candidate.dimension === minimum.dimension);
      const verdict = !aggregate || aggregate.scoreUnits === null || aggregate.applicableCaseCount !== suite.caseManifest.length ? "INCOMPLETE" : aggregate.scoreUnits < minimum.scoreUnits ? "BLOCKED" : "PASS";
      gates.push({ runId: run.id, gateKey: `MIN_SCORE_${minimum.dimension}`, verdict, observedValue: aggregate?.scoreUnits ?? null, thresholdValue: minimum.scoreUnits, safeReasonCode: verdict === "PASS" ? "SCORE_MEETS_THRESHOLD" : verdict === "BLOCKED" ? "SCORE_BELOW_THRESHOLD" : "SCORE_MISSING" });
    }
    if (suite.gateConfig.requireSecurityPass) {
      const security = aggregates.find((candidate) => candidate.dimension === "SECURITY");
      const verdict = !security || security.applicableCaseCount !== suite.caseManifest.length ? "INCOMPLETE" : security.blockingFailureCount > 0 || security.failedCaseCount > 0 ? "BLOCKED" : "PASS";
      gates.push({ runId: run.id, gateKey: "SECURITY_REQUIRED", verdict, observedValue: security?.scoreUnits ?? null, thresholdValue: 1_000_000, safeReasonCode: verdict === "PASS" ? "SECURITY_PASSED" : verdict === "BLOCKED" ? "SECURITY_FAILURE" : "SECURITY_RESULT_MISSING" });
    }
    const security = aggregates.find((candidate) => candidate.dimension === "SECURITY");
    if (security && security.blockingFailureCount > 0) gates.push({ runId: run.id, gateKey: "SECURITY_BLOCKING_FAILURE", verdict: "BLOCKED", observedValue: security.blockingFailureCount, thresholdValue: 0, safeReasonCode: "SECURITY_FAILURE" });
    if (suite.gateConfig.maximumCostNano !== null) {
      const cost = this.resolveRunCost(run, results);
      const verdict = cost === null ? "INCOMPLETE" : cost > suite.gateConfig.maximumCostNano ? "BLOCKED" : "PASS";
      gates.push({ runId: run.id, gateKey: "MAX_COST_NANO", verdict, observedValue: cost, thresholdValue: suite.gateConfig.maximumCostNano, safeReasonCode: verdict === "PASS" ? "COST_WITHIN_LIMIT" : verdict === "BLOCKED" ? "COST_LIMIT_EXCEEDED" : "COST_NOT_AVAILABLE" });
    }
    if (suite.gateConfig.maximumLatencyMs !== null) {
      const latencyValues = results.map((result) => result.elapsedLatencyMs);
      const latency = results.length === suite.caseManifest.length && latencyValues.every((value): value is number => value !== null) ? sumSafeIntegers(latencyValues) : null;
      const verdict = latency === null ? "INCOMPLETE" : latency > suite.gateConfig.maximumLatencyMs ? "BLOCKED" : "PASS";
      gates.push({ runId: run.id, gateKey: "MAX_LATENCY_MS", verdict, observedValue: latency, thresholdValue: suite.gateConfig.maximumLatencyMs, safeReasonCode: verdict === "PASS" ? "LATENCY_WITHIN_LIMIT" : verdict === "BLOCKED" ? "LATENCY_LIMIT_EXCEEDED" : "LATENCY_NOT_AVAILABLE" });
    }
    return gates;
  }

  private compareBaseline(run: AIEvalRun, suite: AIEvalSuiteRevision, candidateAggregates: readonly AIEvalDimensionAggregate[]): AIEvalBaselineComparison | null {
    if (!run.baselineRunId && suite.baselineMode === "OPTIONAL") return null;
    if (!run.baselineRunId) return { comparable: false, recommendation: "INCOMPLETE", regressions: [], safeReasonCode: "BASELINE_REQUIRED" };
    if (run.baselineRunId === run.id) return { comparable: false, recommendation: "INCOMPLETE", regressions: [], safeReasonCode: "BASELINE_SELF_REFERENCE" };
    const baseline = this.runs.getById(run.baselineRunId);
    if (!baseline || baseline.status !== "COMPLETED" || baseline.recommendation !== "PASS_RECOMMENDED" || baseline.suiteId !== run.suiteId || baseline.suiteRevision !== run.suiteRevision || baseline.manifestFingerprint !== run.manifestFingerprint) return { comparable: false, recommendation: "INCOMPLETE", regressions: [], safeReasonCode: "BASELINE_NOT_COMPARABLE" };
    const candidateResults = this.runs.listCaseResults(run.id);
    const baselineResults = this.runs.listCaseResults(baseline.id);
    const candidateIdentities = graderIdentities(candidateResults, this.runs);
    const baselineIdentities = graderIdentities(baselineResults, this.runs);
    if (!sameSet(candidateIdentities, baselineIdentities)) return { comparable: false, recommendation: "INCOMPLETE", regressions: [], safeReasonCode: "BASELINE_GRADERS_NOT_COMPARABLE" };
    const baselineAggregates = this.runs.listDimensionAggregates(baseline.id);
    const regressions: Array<{ dimension: AIEvalDimension; baselineScoreUnits: number; candidateScoreUnits: number; maximumRegressionUnits: number }> = [];
    for (const permitted of suite.permittedRegressionDeltas) {
      const before = baselineAggregates.find((aggregate) => aggregate.dimension === permitted.dimension)?.scoreUnits;
      const after = candidateAggregates.find((aggregate) => aggregate.dimension === permitted.dimension)?.scoreUnits;
      if (before === null || before === undefined || after === null || after === undefined) return { comparable: false, recommendation: "INCOMPLETE", regressions: [], safeReasonCode: "BASELINE_SCORE_MISSING" };
      if (before - after > permitted.maximumRegressionUnits) regressions.push({ dimension: permitted.dimension, baselineScoreUnits: before, candidateScoreUnits: after, maximumRegressionUnits: permitted.maximumRegressionUnits });
    }
    return { comparable: true, recommendation: regressions.length > 0 ? "BLOCKED" : "PASS_RECOMMENDED", regressions, safeReasonCode: regressions.length > 0 ? "REGRESSION_LIMIT_EXCEEDED" : "REGRESSION_WITHIN_LIMIT" };
  }

  private baselineGates(runId: string, comparison: AIEvalBaselineComparison): AIEvalGateResult[] {
    return [{ runId, gateKey: "BASELINE_COMPARISON", verdict: comparison.recommendation === "PASS_RECOMMENDED" ? "PASS" : comparison.recommendation === "BLOCKED" ? "BLOCKED" : "INCOMPLETE", observedValue: comparison.regressions.length, thresholdValue: 0, safeReasonCode: comparison.safeReasonCode }];
  }

  private resolveCanonicalCost(run: AIEvalRun, costOperationId: string | null): number | null {
    if (costOperationId === null) return null;
    const operation = this.accounting.getOperation(costOperationId);
    const suite = this.requireSuiteRevision(run.suiteId, run.suiteRevision);
    if (!operation || operation.costCenter !== "EVALS" || operation.evalRunId !== run.id || operation.opaquePrincipalRef !== null || operation.conversationId !== null || operation.responseId !== null || operation.jobId !== null || operation.idempotencyKey !== null || operation.subjectKey !== suite.subjectKey) throw new AIEvalError("AI_EVAL_RUN_INVALID", "The Eval observation cost operation is not owned by this Eval Run.");
    if (operation.status === "OPEN" || operation.completedAt === null) return null;
    try {
      const records = this.accounting.listUsageCostRecords(costOperationId);
      if (records.length === 0 || records.some((record) => record.operationId !== costOperationId || record.costCompleteness !== "COMPLETE" || record.completedAt === null)) return null;
      return this.costSummary(costOperationId);
    } catch (error) {
      if (isAIAccountingError(error)) return null;
      throw error;
    }
  }

  private resolveRunCost(run: AIEvalRun, results: readonly AIEvalCaseResult[]): number | null {
    const operationIds = [...new Set(results.map((result) => result.costOperationId).filter((value): value is string => value !== null))];
    if (operationIds.length === 0) return null;
    let total = BigInt(0);
    for (const id of operationIds) {
      const value = this.resolveCanonicalCost(run, id);
      if (value === null) return null;
      total += BigInt(value);
    }
    if (total < BigInt(0) || total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(total);
  }

  private costSummary(operationId: string): number | null {
    const totals = this.accounting.getOperationCostSummary(operationId).totals;
    if (totals.length !== 1 || totals[0] === undefined || !Number.isSafeInteger(totals[0].totalNano) || totals[0].totalNano < 0) return null;
    return totals[0].totalNano;
  }

  private resultInput(observation: AIEvalObservation, caseRevision: AIEvalCaseRevision, createdAt: number): Omit<AIEvalCaseResult, "id"> {
    return { runId: observation.runId, caseId: observation.caseId, caseRevision: observation.caseRevision, ordinal: this.manifestOrdinal(observation.runId, observation.caseId), observedSubjectKey: observation.observedSubjectKey, observedStatus: observation.observedStatus, finishReason: observation.finishReason, outputSha256: hashEvalOutput(observation.outputText), outputByteSize: observation.outputBytes, evidence: observation.evidence, retrievalStatus: observation.retrievalStatus, elapsedLatencyMs: observation.elapsedLatencyMs, costOperationId: observation.costOperationId, privacyClass: caseRevision.privacyClass, createdAt };
  }

  private manifestOrdinal(runId: string, caseId: string): number {
    const run = this.requireRun(runId);
    const suite = this.requireSuiteRevision(run.suiteId, run.suiteRevision);
    const entry = suite.caseManifest.find((candidate) => candidate.caseId === caseId);
    if (!entry) throw new AIEvalError("AI_EVAL_CASE_NOT_IN_SUITE", "The Eval Case is not in the pinned manifest.");
    return entry.ordinal;
  }

  private requireRun(id: string): AIEvalRun {
    const run = this.runs.getById(id);
    if (!run) throw new AIEvalError("AI_EVAL_NOT_FOUND", "The Eval Run was not found.");
    return run;
  }

  private requireSuiteRevision(id: string, revision: number): AIEvalSuiteRevision {
    const suite = this.suites.getRevision(id, revision);
    if (!suite) throw new AIEvalError("AI_EVAL_NOT_FOUND", "The Eval Suite revision was not found.");
    return suite;
  }
}

function graderIdentities(results: readonly AIEvalCaseResult[], runs: AIEvalRunRepository): Set<string> {
  const identities = new Set<string>();
  for (const result of results) for (const grader of runs.listGraderResults(result.id)) identities.add(`${grader.dimension}:${grader.graderKey}@${grader.graderRevision}`);
  return identities;
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function sumSafeIntegers(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(total + value)) return null;
    total += value;
  }
  return total;
}
