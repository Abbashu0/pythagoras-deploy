import type { AdminActor } from "../../admin-auth/contracts";
import type { AIConversationFinishReason } from "../conversations";
import type { AITutorCitationMapItem } from "../tutor/preflight/contracts";

export const AI_EVAL_SUITE_RESOURCE_TYPE = "ai.eval-suite" as const;
export const AI_EVAL_CASE_RESOURCE_TYPE = "ai.eval-case" as const;
export const AI_EVAL_EXECUTION_CONFIG_RESOURCE_TYPE = "ai.eval-execution-config" as const;
export const AI_EVAL_JUDGE_CONFIG_RESOURCE_TYPE = "ai.eval-judge-config" as const;

/** Server-owned M9B1 target protocol identities. */
export const AI_EVAL_TARGET_PROTOCOL_KEY = "eval-target-v1" as const;
export const AI_EVAL_TARGET_PROTOCOL_REVISION = 1 as const;
export const AI_EVAL_CLEANUP_PROTOCOL_KEY = "synthetic-c4-cleanup-v1" as const;
export const AI_EVAL_CLEANUP_PROTOCOL_REVISION = 1 as const;
export const AI_EVAL_TARGET_JOB_KIND = "ai.eval.target-execution" as const;
export const AI_EVAL_TARGET_JOB_PAYLOAD_VERSION = 1 as const;

/** Server-owned M9B2 supplementary judge protocol identities. */
export const AI_EVAL_JUDGE_PROTOCOL_KEY = "eval-judge-v1" as const;
export const AI_EVAL_JUDGE_PROTOCOL_REVISION = 1 as const;

export const AI_EVAL_DIMENSIONS = [
  "CORRECTNESS",
  "CURRICULUM_FIDELITY",
  "GROUNDEDNESS",
  "SOURCE_FIDELITY",
  "RELEVANCE",
  "CONCISENESS",
  "INSTRUCTION_FOLLOWING",
  "ARABIC_QUALITY",
  "IRAQI_NATURALNESS",
  "MATHEMATICS_CORRECTNESS",
  "OFF_TOPIC_BEHAVIOR",
  "RETRIEVAL_QUALITY",
  "COST",
  "LATENCY",
  "SECURITY",
] as const;
export type AIEvalDimension = (typeof AI_EVAL_DIMENSIONS)[number];

export const AI_EVAL_DIMENSION_MODES = [
  "DETERMINISTICALLY_GRADED",
  "JUDGE_REQUIRED",
  "NOT_APPLICABLE",
] as const;
export type AIEvalDimensionMode = (typeof AI_EVAL_DIMENSION_MODES)[number];

export const AI_EVAL_CASE_ORIGINS = ["CURATED", "SYNTHETIC", "DEIDENTIFIED_REGRESSION"] as const;
export type AIEvalCaseOrigin = (typeof AI_EVAL_CASE_ORIGINS)[number];

export const AI_EVAL_PRIVACY_CLASSES = [
  "SYNTHETIC_PUBLIC_SAFE",
  "INTERNAL_CURATED",
  "DEIDENTIFIED_REGRESSION",
] as const;
export type AIEvalPrivacyClass = (typeof AI_EVAL_PRIVACY_CLASSES)[number];

export const AI_EVAL_EXPECTED_STATUSES = ["COMPLETED", "BLOCKED", "FAILED", "CANCELLED"] as const;
export type AIEvalExpectedStatus = (typeof AI_EVAL_EXPECTED_STATUSES)[number];

export const AI_EVAL_OBSERVED_STATUSES = ["COMPLETED", "BLOCKED", "FAILED", "CANCELLED"] as const;
export type AIEvalObservedStatus = (typeof AI_EVAL_OBSERVED_STATUSES)[number];

export const AI_EVAL_RESULT_VERDICTS = ["PASS", "FAIL", "NOT_APPLICABLE"] as const;
export type AIEvalResultVerdict = (typeof AI_EVAL_RESULT_VERDICTS)[number];

export const AI_EVAL_RUN_STATUSES = ["CREATED", "RUNNING", "SCORING", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type AIEvalRunStatus = (typeof AI_EVAL_RUN_STATUSES)[number];

export const AI_EVAL_RECOMMENDATIONS = ["PASS_RECOMMENDED", "BLOCKED", "INCOMPLETE"] as const;
export type AIEvalRecommendation = (typeof AI_EVAL_RECOMMENDATIONS)[number];

export const AI_EVAL_GATE_VERDICTS = ["PASS", "BLOCKED", "INCOMPLETE"] as const;
export type AIEvalGateVerdict = (typeof AI_EVAL_GATE_VERDICTS)[number];

export const AI_EVAL_BASELINE_MODES = ["OPTIONAL", "REQUIRED"] as const;
export type AIEvalBaselineMode = (typeof AI_EVAL_BASELINE_MODES)[number];

export const AI_EVAL_SOURCE_REFERENCE_KINDS = ["KNOWLEDGE_PACKAGE", "QUESTION_PACKAGE", "POLICY", "CONFIGURATION", "REGRESSION"] as const;
export type AIEvalSourceReferenceKind = (typeof AI_EVAL_SOURCE_REFERENCE_KINDS)[number];

export const AI_EVAL_GRADER_REGISTRY_KEY = "deterministic-evals-v1" as const;
export const AI_EVAL_GRADER_REGISTRY_REVISION = 1 as const;
export const AI_EVAL_SCORE_SCALE = 1_000_000 as const;
export const AI_EVAL_MAX_CASE_INPUT_BYTES = 64 * 1024;
export const AI_EVAL_MAX_CASE_MANIFEST_ITEMS = 10_000;
export const AI_EVAL_MAX_GRADER_CONFIGS = 100;
export const AI_EVAL_MAX_SOURCE_REFERENCES = 50;
export const AI_EVAL_MAX_LITERAL_EXPECTATIONS = 50;
export const AI_EVAL_MAX_SECURITY_MARKERS = 50;

export interface AIEvalDimensionRequirement {
  dimension: AIEvalDimension;
  mode: AIEvalDimensionMode;
}

export interface AIEvalGraderConfig {
  graderKey: string;
  graderRevision: number;
  dimension: AIEvalDimension;
  required: boolean;
}

export interface AIEvalGateConfig {
  minimumScores: Array<{ dimension: AIEvalDimension; scoreUnits: number }>;
  maximumCostNano: number | null;
  maximumLatencyMs: number | null;
  requireSecurityPass: boolean;
}

export interface AIEvalRegressionDelta {
  dimension: AIEvalDimension;
  maximumRegressionUnits: number;
}

export interface AIEvalDeidentificationProof {
  approved: true;
  methodKey: string;
  reviewerReference: string;
}

export interface AIEvalSourceRevisionReference {
  kind: AIEvalSourceReferenceKind;
  id: string;
  revision: number;
}

export interface AIEvalEvidenceOriginReference {
  originKind: "KNOWLEDGE_PACKAGE" | "QUESTION_PACKAGE";
  originId: string;
  subjectKey: string;
}

export interface AIEvalCaseManifestEntry {
  ordinal: number;
  caseId: string;
  caseRevision: number;
}

export interface AIEvalSuiteContent {
  key: string;
  subjectKey: string;
  displayName: string;
  enabled: boolean;
  caseManifest: AIEvalCaseManifestEntry[];
  requiredDimensions: AIEvalDimensionRequirement[];
  graderConfigs: AIEvalGraderConfig[];
  gateConfig: AIEvalGateConfig;
  permittedRegressionDeltas: AIEvalRegressionDelta[];
  baselineMode: AIEvalBaselineMode;
  supplementaryJudgeConfig: { referenceKey: string; revision: number } | null;
}

export interface AIEvalSuiteRevision extends AIEvalSuiteContent {
  suiteId: string;
  revisionId: string;
  revision: number;
  createdAt: number;
  createdBy: string;
}

export interface AIEvalSuite extends AIEvalSuiteRevision {
  id: string;
  currentRevision: number;
  currentRevisionId: string;
  updatedAt: number;
  updatedBy: string;
}

export interface AIEvalCaseContent {
  key: string;
  subjectKey: string;
  displayName: string;
  description: string | null;
  inputText: string;
  origin: AIEvalCaseOrigin;
  privacyClass: AIEvalPrivacyClass;
  deidentificationProof: AIEvalDeidentificationProof | null;
  expectedStatus: AIEvalExpectedStatus;
  allowedFinishReasons: Exclude<AIConversationFinishReason, "FAILED" | "CANCELLED">[];
  requiredOutputLiterals: string[];
  forbiddenOutputLiterals: string[];
  requiredEvidenceOrigins: AIEvalEvidenceOriginReference[];
  forbiddenEvidenceOrigins: AIEvalEvidenceOriginReference[];
  requiredCitationLabels: string[];
  minimumEvidenceItemCount: number;
  securityLeakageMarkers: string[];
  maximumOutputBytes: number | null;
  sourceRevisionReferences: AIEvalSourceRevisionReference[];
  enabled: boolean;
}

export interface AIEvalCaseRevision extends AIEvalCaseContent {
  caseId: string;
  revisionId: string;
  revision: number;
  createdAt: number;
  createdBy: string;
}

export interface AIEvalCase extends AIEvalCaseRevision {
  id: string;
  currentRevision: number;
  currentRevisionId: string;
  updatedAt: number;
  updatedBy: string;
}

export interface AIEvalCandidateSnapshot {
  tutorConfig: { id: string; revision: number };
  globalPolicy: { id: string; revision: number };
  subjectPolicy: { id: string; revision: number };
  contextPolicy: { id: string; revision: number };
  retrievalConfig: { id: string; revision: number };
  generationModel: { id: string; revision: number };
  generationProvider: { id: string; revision: number };
  embeddingSpace: { projectionRevisionId: string; modelConfigId: string; modelConfigRevision: number } | null;
  rerank: { modelConfigId: string; modelConfigRevision: number; providerConfigId: string; providerConfigRevision: number } | null;
  groundingProtocol: { key: string; revision: number };
  citationProtocol: { key: string; revision: number };
}

export interface AIEvalObservation {
  runId: string;
  caseId: string;
  caseRevision: number;
  observedSubjectKey: string;
  observedStatus: AIEvalObservedStatus;
  finishReason: Exclude<AIConversationFinishReason, "FAILED" | "CANCELLED"> | "FAILED" | "CANCELLED" | null;
  outputText: string;
  citationMap: readonly AITutorCitationMapItem[];
  evidence: readonly AIEvalEvidenceOriginReference[];
  retrievalStatus: "SUFFICIENT" | "INSUFFICIENT" | "NOT_APPLICABLE";
  outputBytes: number;
  elapsedLatencyMs: number | null;
  costOperationId: string | null;
  groundingProtocolKey: string;
  groundingProtocolRevision: number;
  citationProtocolKey: string;
  citationProtocolRevision: number;
}

export interface AIEvalRun {
  id: string;
  suiteId: string;
  suiteRevision: number;
  manifestFingerprint: string;
  candidateSnapshot: AIEvalCandidateSnapshot;
  candidateFingerprint: string;
  baselineRunId: string | null;
  status: AIEvalRunStatus;
  recommendation: AIEvalRecommendation | null;
  safeFailureCode: string | null;
  createdAt: number;
  startedAt: number | null;
  scoredAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface AIEvalExecutionConfigContent {
  key: string;
  subjectKey: string;
  displayName: string;
  enabled: boolean;
  budgetPolicyId: string;
  budgetPolicyRevision: number;
  rateLimitPolicyId: string;
  rateLimitPolicyRevision: number;
  protocolKey: typeof AI_EVAL_TARGET_PROTOCOL_KEY;
  protocolRevision: typeof AI_EVAL_TARGET_PROTOCOL_REVISION;
  targetTimeoutMs: number;
  maxConcurrency: number;
  cleanupProtocolKey: typeof AI_EVAL_CLEANUP_PROTOCOL_KEY;
  cleanupProtocolRevision: typeof AI_EVAL_CLEANUP_PROTOCOL_REVISION;
}

export interface AIEvalExecutionConfigRevision extends AIEvalExecutionConfigContent {
  executionConfigId: string;
  revisionId: string;
  revision: number;
  createdAt: number;
  createdBy: string;
}

export interface AIEvalExecutionConfig extends AIEvalExecutionConfigRevision {
  id: string;
  currentRevision: number;
  currentRevisionId: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

export interface AIEvalExecutionConfigRepository {
  getById(id: string): AIEvalExecutionConfig | null;
  getByKey(key: string): AIEvalExecutionConfig | null;
  getCurrentRevision(id: string): AIEvalExecutionConfigRevision | null;
  getRevision(id: string, revision: number): AIEvalExecutionConfigRevision | null;
  list(): AIEvalExecutionConfig[];
  create(input: { id: string; content: AIEvalExecutionConfigContent; actor: AdminActor; now: number }): AIEvalExecutionConfigRevision;
  appendRevision(input: { id: string; expectedRevision: number; content: AIEvalExecutionConfigContent; actor: AdminActor; now: number }): AIEvalExecutionConfigRevision;
}

export interface AIEvalJudgeConfigContent {
  key: string;
  subjectKey: string;
  displayName: string;
  enabled: boolean;
  modelConfigId: string;
  modelConfigRevision: number;
  providerConfigId: string;
  providerConfigRevision: number;
  budgetPolicyId: string;
  budgetPolicyRevision: number;
  rateLimitPolicyId: string;
  rateLimitPolicyRevision: number;
  protocolKey: typeof AI_EVAL_JUDGE_PROTOCOL_KEY;
  protocolRevision: typeof AI_EVAL_JUDGE_PROTOCOL_REVISION;
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface AIEvalJudgeConfigRevision extends AIEvalJudgeConfigContent {
  judgeConfigId: string;
  revisionId: string;
  revision: number;
  fingerprint: string;
  createdAt: number;
  createdBy: string;
}

export interface AIEvalJudgeConfig extends AIEvalJudgeConfigRevision {
  id: string;
  currentRevision: number;
  currentRevisionId: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

export interface AIEvalJudgeConfigRepository {
  getById(id: string): AIEvalJudgeConfig | null;
  getByKey(key: string): AIEvalJudgeConfig | null;
  getCurrentRevision(id: string): AIEvalJudgeConfigRevision | null;
  getRevision(id: string, revision: number): AIEvalJudgeConfigRevision | null;
  list(): AIEvalJudgeConfig[];
  create(input: { id: string; content: AIEvalJudgeConfigContent; actor: AdminActor; now: number }): AIEvalJudgeConfigRevision;
  appendRevision(input: { id: string; expectedRevision: number; content: AIEvalJudgeConfigContent; actor: AdminActor; now: number }): AIEvalJudgeConfigRevision;
}

export interface AIEvalRunExecutionBinding {
  runId: string;
  executionConfigId: string;
  executionConfigRevision: number;
  executionConfigFingerprint: string;
  createdAt: number;
  createdBy: string;
}

export const AI_EVAL_CASE_EXECUTION_STATUSES = ["PENDING", "RUNNING", "COMPLETED", "BLOCKED", "FAILED", "CANCELLED", "AMBIGUOUS"] as const;
export type AIEvalCaseExecutionStatus = (typeof AI_EVAL_CASE_EXECUTION_STATUSES)[number];
export const AI_EVAL_PROVIDER_INVOCATION_STATES = ["NOT_INVOKED", "INVOKING", "INVOKED_WITH_ACCOUNTING", "AMBIGUOUS"] as const;
export type AIEvalProviderInvocationState = (typeof AI_EVAL_PROVIDER_INVOCATION_STATES)[number];
export const AI_EVAL_TARGET_CLEANUP_STATUSES = ["PENDING", "CLEANED"] as const;
export type AIEvalTargetCleanupStatus = (typeof AI_EVAL_TARGET_CLEANUP_STATUSES)[number];

export const AI_EVAL_JUDGE_EXECUTION_STATUSES = ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "AMBIGUOUS", "INPUT_LOST"] as const;
export type AIEvalJudgeExecutionStatus = (typeof AI_EVAL_JUDGE_EXECUTION_STATUSES)[number];

/** Durable target-execution metadata. It never stores prompts, output, or Evidence text. */
export interface AIEvalCaseExecution {
  id: string;
  /** Durable technical idempotency identity derived from the immutable execution id. */
  readonly idempotencyKey: string;
  runId: string;
  caseId: string;
  caseRevision: number;
  ordinal: number;
  subjectKey: string;
  executionConfigId: string;
  executionConfigRevision: number;
  executionConfigFingerprint: string;
  executionProtocolKey: string;
  executionProtocolRevision: number;
  cleanupProtocolKey: string;
  cleanupProtocolRevision: number;
  /** Durable retry generation for transient admission denials. */
  admissionAttempt: number;
  targetCostOperationId: string | null;
  budgetReservationId: string | null;
  jobId: string | null;
  status: AIEvalCaseExecutionStatus;
  providerInvocationState: AIEvalProviderInvocationState;
  providerInvoked: boolean;
  outputSha256: string | null;
  outputByteSize: number | null;
  finishReason: AIConversationFinishReason | null;
  retrievalStatus: "SUFFICIENT" | "INSUFFICIENT" | "NOT_APPLICABLE" | null;
  candidateFingerprint: string;
  planFingerprint: string | null;
  safeFailureCode: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface AIEvalCaseExecutionRepository {
  getById(id: string): AIEvalCaseExecution | null;
  getForTarget(input: { runId: string; caseId: string; caseRevision: number }): AIEvalCaseExecution | null;
  getByJob(jobId: string): AIEvalCaseExecution | null;
  listForRun(runId: string): AIEvalCaseExecution[];
  create(input: Omit<AIEvalCaseExecution, "id" | "idempotencyKey"> & { id?: string }): AIEvalCaseExecution;
  bindJob(id: string, jobId: string, now: number): AIEvalCaseExecution;
  bindOperation(id: string, targetCostOperationId: string, now: number): AIEvalCaseExecution;
  bindAdmission(id: string, input: { targetCostOperationId: string; budgetReservationId: string }, now: number): AIEvalCaseExecution;
  markRunning(id: string, now: number, maxConcurrency?: number, resetLatency?: boolean): AIEvalCaseExecution;
  markInvoking(id: string, now: number): AIEvalCaseExecution;
  markNotInvoked(id: string, now: number): AIEvalCaseExecution;
  markInvokedWithAccounting(id: string, now: number): AIEvalCaseExecution;
  complete(input: { id: string; providerInvoked: boolean; outputSha256: string; outputByteSize: number; finishReason: AIConversationFinishReason; retrievalStatus: "SUFFICIENT" | "NOT_APPLICABLE"; planFingerprint: string; now: number }): AIEvalCaseExecution;
  block(input: { id: string; retrievalStatus: "INSUFFICIENT"; safeFailureCode: string; now: number }): AIEvalCaseExecution;
  fail(input: { id: string; providerInvoked: boolean; outputSha256?: string | null; outputByteSize?: number | null; finishReason?: AIConversationFinishReason | null; retrievalStatus?: AIEvalCaseExecution["retrievalStatus"]; safeFailureCode: string; now: number }): AIEvalCaseExecution;
  cancel(input: { id: string; providerInvoked: boolean; safeFailureCode: string; now: number }): AIEvalCaseExecution;
  ambiguous(input: { id: string; safeFailureCode: string; now: number }): AIEvalCaseExecution;
  returnToPendingForAdmission(id: string, now: number): AIEvalCaseExecution;
  listPendingTerminalReconciliation(limit: number): AIEvalCaseExecution[];
}

/** Durable, safe metadata for one supplementary LLM Judge execution. */
export interface AIEvalJudgeExecution {
  id: string;
  readonly idempotencyKey: string;
  runId: string;
  caseId: string;
  caseRevision: number;
  ordinal: number;
  subjectKey: string;
  judgeConfigId: string;
  judgeConfigRevision: number;
  judgeConfigFingerprint: string;
  protocolKey: string;
  protocolRevision: number;
  judgeModelConfigId: string;
  judgeModelConfigRevision: number;
  judgeProviderConfigId: string;
  judgeProviderConfigRevision: number;
  judgeCostOperationId: string | null;
  budgetReservationId: string | null;
  status: AIEvalJudgeExecutionStatus;
  providerInvocationState: AIEvalProviderInvocationState;
  providerInvoked: boolean;
  judgeOutputSha256: string | null;
  judgeOutputByteSize: number | null;
  safeFailureCode: string | null;
  latencyMs: number | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface AIEvalJudgeExecutionRepository {
  getById(id: string): AIEvalJudgeExecution | null;
  getForCase(input: { runId: string; caseId: string; caseRevision: number }): AIEvalJudgeExecution | null;
  getByTarget(input: { runId: string; caseId: string; caseRevision: number }): AIEvalJudgeExecution | null;
  listForRun(runId: string): AIEvalJudgeExecution[];
  create(input: Omit<AIEvalJudgeExecution, "id" | "idempotencyKey"> & { id?: string }): AIEvalJudgeExecution;
  bindOperation(id: string, judgeCostOperationId: string, now: number): AIEvalJudgeExecution;
  bindAdmission(id: string, input: { judgeCostOperationId: string; budgetReservationId: string }, now: number): AIEvalJudgeExecution;
  markRunning(id: string, now: number): AIEvalJudgeExecution;
  markInvoking(id: string, now: number): AIEvalJudgeExecution;
  markNotInvoked(id: string, now: number): AIEvalJudgeExecution;
  markInvokedWithAccounting(id: string, now: number): AIEvalJudgeExecution;
  complete(input: { id: string; providerInvoked: boolean; judgeOutputSha256: string; judgeOutputByteSize: number; latencyMs: number; now: number }): AIEvalJudgeExecution;
  fail(input: { id: string; providerInvoked: boolean; judgeOutputSha256?: string | null; judgeOutputByteSize?: number | null; latencyMs?: number | null; safeFailureCode: string; now: number }): AIEvalJudgeExecution;
  cancel(input: { id: string; providerInvoked: boolean; safeFailureCode: string; now: number }): AIEvalJudgeExecution;
  ambiguous(input: { id: string; safeFailureCode: string; now: number }): AIEvalJudgeExecution;
  inputLost(input: { id: string; safeFailureCode: string; now: number }): AIEvalJudgeExecution;
}

export interface AIEvalTargetCleanup {
  id: string;
  caseExecutionId: string;
  syntheticConversationId: string;
  status: AIEvalTargetCleanupStatus;
  safeFailureCode: string | null;
  retryCount: number;
  createdAt: number;
  cleanedAt: number | null;
  updatedAt: number;
}

export interface AIEvalTargetCleanupRepository {
  getByCaseExecutionId(caseExecutionId: string): AIEvalTargetCleanup | null;
  listByCaseExecutionId(caseExecutionId: string): AIEvalTargetCleanup[];
  listPending(input: { runId?: string; limit: number }): AIEvalTargetCleanup[];
  countPending(runId: string): number;
  createInTransaction(input: { id: string; caseExecutionId: string; syntheticConversationId: string; createdAt: number }): AIEvalTargetCleanup;
  markPendingFailure(id: string, safeFailureCode: string, updatedAt: number): AIEvalTargetCleanup;
  markCleaned(id: string, cleanedAt: number): AIEvalTargetCleanup;
}

export interface AIEvalCaseResult {
  id: string;
  runId: string;
  caseId: string;
  caseRevision: number;
  ordinal: number;
  observedSubjectKey: string;
  observedStatus: AIEvalObservedStatus;
  finishReason: AIEvalObservation["finishReason"];
  outputSha256: string;
  outputByteSize: number;
  evidence: readonly AIEvalEvidenceOriginReference[];
  retrievalStatus: AIEvalObservation["retrievalStatus"];
  elapsedLatencyMs: number | null;
  costOperationId: string | null;
  privacyClass: AIEvalPrivacyClass;
  createdAt: number;
}

export interface AIEvalGraderResult {
  id: string;
  caseResultId: string;
  dimension: AIEvalDimension;
  graderKey: string;
  graderRevision: number;
  verdict: AIEvalResultVerdict;
  scoreUnits: number;
  safeReasonCode: string;
  blocking: boolean;
  createdAt: number;
}

export interface AIEvalGraderResultDraft {
  dimension: AIEvalDimension;
  graderKey: string;
  graderRevision: number;
  verdict: AIEvalResultVerdict;
  scoreUnits: number;
  safeReasonCode: string;
  blocking: boolean;
}

export interface AIEvalGraderContext {
  /** Canonical cost resolved from the EVALS Cost Operation, never caller input. */
  costNano: number | null;
}

export interface AIEvalGrader {
  readonly key: string;
  readonly revision: number;
  readonly dimension: AIEvalDimension;
  grade(input: {
    caseRevision: AIEvalCaseRevision;
    observation: AIEvalObservation;
    context: AIEvalGraderContext;
  }): AIEvalGraderResultDraft;
}

export interface AIEvalGraderRegistry {
  get(key: string, revision: number): AIEvalGrader | null;
  supported(): ReadonlyArray<{ graderKey: string; graderRevision: number; dimension: AIEvalDimension }>;
}

export interface AIEvalDimensionAggregate {
  runId: string;
  dimension: AIEvalDimension;
  applicableCaseCount: number;
  passedCaseCount: number;
  failedCaseCount: number;
  scoreUnits: number | null;
  blockingFailureCount: number;
}

export interface AIEvalAccountingBasisRecord {
  recordId: string;
  correctionIds: readonly string[];
}

export interface AIEvalAccountingBasisOperation {
  operationId: string;
  records: readonly AIEvalAccountingBasisRecord[];
}

/** Safe, immutable evidence of the canonical accounting read used by a cost gate. */
export interface AIEvalAccountingBasis {
  version: 1;
  operations: readonly AIEvalAccountingBasisOperation[];
  currency: string;
  totalNano: number;
  fingerprint: string;
}

export type AIEvalAccountingBasisStatus = "CURRENT" | "STALE" | "UNAVAILABLE";

export interface AIEvalAccountingBasisStatusResult {
  status: AIEvalAccountingBasisStatus;
  pinnedFingerprint: string | null;
  currentFingerprint: string | null;
}

export interface AIEvalGateResult {
  runId: string;
  gateKey: string;
  verdict: AIEvalGateVerdict;
  observedValue: number | null;
  thresholdValue: number | null;
  safeReasonCode: string;
  accountingBasis?: AIEvalAccountingBasis | null;
}

export interface AIEvalRunScoreReport {
  aggregates: readonly AIEvalDimensionAggregate[];
  gates: readonly AIEvalGateResult[];
  recommendation: AIEvalRecommendation;
}

export interface AIEvalBaselineComparison {
  comparable: boolean;
  recommendation: AIEvalRecommendation;
  regressions: readonly { dimension: AIEvalDimension; baselineScoreUnits: number; candidateScoreUnits: number; maximumRegressionUnits: number }[];
  safeReasonCode: string;
}

export interface AIEvalSuiteRepository {
  getById(id: string): AIEvalSuite | null;
  getByKey(key: string): AIEvalSuite | null;
  getRevision(id: string, revision: number): AIEvalSuiteRevision | null;
  list(): AIEvalSuite[];
  create(input: { id: string; content: AIEvalSuiteContent; actor: AdminActor; now: number }): AIEvalSuiteRevision;
  appendRevision(input: { id: string; expectedRevision: number; content: AIEvalSuiteContent; actor: AdminActor; now: number }): AIEvalSuiteRevision;
}

export interface AIEvalCaseRepository {
  getById(id: string): AIEvalCase | null;
  getByKey(key: string): AIEvalCase | null;
  getRevision(id: string, revision: number): AIEvalCaseRevision | null;
  list(): AIEvalCase[];
  create(input: { id: string; content: AIEvalCaseContent; actor: AdminActor; now: number }): AIEvalCaseRevision;
  appendRevision(input: { id: string; expectedRevision: number; content: AIEvalCaseContent; actor: AdminActor; now: number }): AIEvalCaseRevision;
}

export interface AIEvalJudgeConfigRepository {
  getById(id: string): AIEvalJudgeConfig | null;
  getByKey(key: string): AIEvalJudgeConfig | null;
  getCurrentRevision(id: string): AIEvalJudgeConfigRevision | null;
  getRevision(id: string, revision: number): AIEvalJudgeConfigRevision | null;
  getRevisionByKey(key: string, revision: number): AIEvalJudgeConfigRevision | null;
  list(): AIEvalJudgeConfig[];
  create(input: { id: string; content: AIEvalJudgeConfigContent; actor: AdminActor; now: number }): AIEvalJudgeConfigRevision;
  appendRevision(input: { id: string; expectedRevision: number; content: AIEvalJudgeConfigContent; actor: AdminActor; now: number }): AIEvalJudgeConfigRevision;
}

export const AI_EVAL_JUDGE_RUBRIC_BANDS = ["EXCELLENT", "PASS", "MARGINAL", "FAIL"] as const;
export type AIEvalJudgeRubricBand = (typeof AI_EVAL_JUDGE_RUBRIC_BANDS)[number];

export interface AIEvalJudgeResult {
  id: string;
  judgeExecutionId: string;
  caseResultId: string;
  runId: string;
  caseId: string;
  caseRevision: number;
  dimension: AIEvalDimension;
  judgeConfigId: string;
  judgeConfigRevision: number;
  protocolKey: string;
  protocolRevision: number;
  judgeModelConfigId: string;
  judgeModelConfigRevision: number;
  judgeProviderConfigId: string;
  judgeProviderConfigRevision: number;
  scoreUnits: number;
  rubricBand: AIEvalJudgeRubricBand;
  safeReasonCode: string;
  createdAt: number;
}

export interface AIEvalJudgeScore {
  dimension: AIEvalDimension;
  scoreUnits: number;
  rubricBand: AIEvalJudgeRubricBand;
}

export interface AIEvalJudgeResponse {
  protocol: typeof AI_EVAL_JUDGE_PROTOCOL_KEY;
  revision: typeof AI_EVAL_JUDGE_PROTOCOL_REVISION;
  scores: readonly AIEvalJudgeScore[];
}

export interface AIEvalJudgeCoverage {
  runId: string;
  expectedCases: number;
  expectedDimensions: number;
  completedExecutions: number;
  nonAmbiguousExecutions: number;
  judgeResults: number;
  complete: boolean;
}

export interface AIEvalRunRepository {
  getById(id: string): AIEvalRun | null;
  create(input: { id: string; suiteId: string; suiteRevision: number; manifestFingerprint: string; candidateSnapshot: AIEvalCandidateSnapshot; candidateFingerprint: string; baselineRunId: string | null; createdAt: number }): AIEvalRun;
  getExecutionBinding(runId: string): AIEvalRunExecutionBinding | null;
  bindExecutionConfig(input: AIEvalRunExecutionBinding): AIEvalRunExecutionBinding;
  transition(input: { id: string; expectedStatus: AIEvalRunStatus; status: AIEvalRunStatus; recommendation?: AIEvalRecommendation | null; safeFailureCode?: string | null; startedAt?: number | null; scoredAt?: number | null; completedAt?: number | null; updatedAt: number }): AIEvalRun;
  insertCaseResult(input: Omit<AIEvalCaseResult, "id"> & { id?: string }): AIEvalCaseResult;
  listCaseResults(runId: string): AIEvalCaseResult[];
  insertGraderResult(input: Omit<AIEvalGraderResult, "id"> & { id?: string }): AIEvalGraderResult;
  listGraderResults(caseResultId: string): AIEvalGraderResult[];
  insertJudgeResult(input: Omit<AIEvalJudgeResult, "id"> & { id?: string }): AIEvalJudgeResult;
  listJudgeResults(caseResultId: string): AIEvalJudgeResult[];
  listJudgeResultsForRun(runId: string): AIEvalJudgeResult[];
  insertDimensionAggregate(input: AIEvalDimensionAggregate): AIEvalDimensionAggregate;
  listDimensionAggregates(runId: string): AIEvalDimensionAggregate[];
  insertGateResult(input: AIEvalGateResult): AIEvalGateResult;
  listGateResults(runId: string): AIEvalGateResult[];
}
