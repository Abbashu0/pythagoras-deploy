import { createHash } from "node:crypto";

import {
  AI_TUTOR_CITATION_PROTOCOL_KEY,
  AI_TUTOR_CITATION_PROTOCOL_REVISION,
  AI_TUTOR_GROUNDING_PROTOCOL_KEY,
  AI_TUTOR_GROUNDING_PROTOCOL_REVISION,
} from "../tutor/configuration";
import {
  AI_EVAL_BASELINE_MODES,
  AI_EVAL_CASE_ORIGINS,
  AI_EVAL_DIMENSION_MODES,
  AI_EVAL_DIMENSIONS,
  AI_EVAL_EXPECTED_STATUSES,
  AI_EVAL_MAX_CASE_INPUT_BYTES,
  AI_EVAL_MAX_CASE_MANIFEST_ITEMS,
  AI_EVAL_MAX_GRADER_CONFIGS,
  AI_EVAL_MAX_LITERAL_EXPECTATIONS,
  AI_EVAL_MAX_SECURITY_MARKERS,
  AI_EVAL_MAX_SOURCE_REFERENCES,
  AI_EVAL_PRIVACY_CLASSES,
  AI_EVAL_SOURCE_REFERENCE_KINDS,
  AI_EVAL_SCORE_SCALE,
  type AIEvalAccountingBasis,
  type AIEvalAccountingBasisOperation,
  type AIEvalCandidateSnapshot,
  type AIEvalCaseContent,
  type AIEvalCaseManifestEntry,
  type AIEvalDeidentificationProof,
  type AIEvalDimensionRequirement,
  type AIEvalEvidenceOriginReference,
  type AIEvalGateConfig,
  type AIEvalGraderConfig,
  type AIEvalObservation,
  type AIEvalRegressionDelta,
  type AIEvalSourceRevisionReference,
  type AIEvalSuiteContent,
} from "./contracts";
import { AIEvalError } from "./errors";
import type { AITutorCitationMapItem } from "../tutor/preflight/contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_PATTERN = /^[a-z][a-z0-9._-]{0,159}$/u;
const SUITE_KEY_PATTERN = /^[a-z][a-z0-9.-]{0,119}$/u;
const SUBJECT_PATTERN = /^[a-z][a-z0-9-]{0,79}$/u;
const SAFE_CONFIG_KEY_PATTERN = /^[a-z][a-z0-9.-]{0,119}$/u;
const GRADER_KEY_PATTERN = /^[a-z][a-z0-9.-]{0,119}$/u;
const CITATION_PATTERN = /^\[E[1-9][0-9]*\]$/u;
const MAX_DESCRIPTION_LENGTH = 1_000;
const MAX_DISPLAY_NAME_LENGTH = 200;
const MAX_LITERAL_LENGTH = 512;
const MAX_MARKER_LENGTH = 512;

export function normalizeAIEvalSuiteContent(value: unknown): AIEvalSuiteContent {
  const record = plainObject(value, "Eval Suite content");
  exactKeys(record, [
    "key", "subjectKey", "displayName", "enabled", "caseManifest", "requiredDimensions",
    "graderConfigs", "gateConfig", "permittedRegressionDeltas", "baselineMode", "supplementaryJudgeConfig",
  ], "Eval Suite content");
  const content: AIEvalSuiteContent = {
    key: text(record.key, "key", SUITE_KEY_PATTERN, 120),
    subjectKey: text(record.subjectKey, "subjectKey", SUBJECT_PATTERN, 80),
    displayName: boundedText(record.displayName, "displayName", MAX_DISPLAY_NAME_LENGTH),
    enabled: booleanValue(record.enabled, "enabled"),
    caseManifest: normalizeCaseManifest(record.caseManifest),
    requiredDimensions: normalizeDimensionRequirements(record.requiredDimensions),
    graderConfigs: normalizeGraderConfigs(record.graderConfigs),
    gateConfig: normalizeGateConfig(record.gateConfig),
    permittedRegressionDeltas: normalizeRegressionDeltas(record.permittedRegressionDeltas),
    baselineMode: enumValue(record.baselineMode, AI_EVAL_BASELINE_MODES, "baselineMode"),
    supplementaryJudgeConfig: normalizeJudgeConfig(record.supplementaryJudgeConfig),
  };
  validateSuiteGraderModes(content);
  return content;
}

export function normalizeAIEvalCaseContent(value: unknown): AIEvalCaseContent {
  const record = plainObject(value, "Eval Case content");
  exactKeys(record, [
    "key", "subjectKey", "displayName", "description", "inputText", "origin", "privacyClass",
    "deidentificationProof", "expectedStatus", "allowedFinishReasons", "requiredOutputLiterals",
    "forbiddenOutputLiterals", "requiredEvidenceOrigins", "forbiddenEvidenceOrigins",
    "requiredCitationLabels", "minimumEvidenceItemCount", "securityLeakageMarkers",
    "maximumOutputBytes", "sourceRevisionReferences", "enabled",
  ], "Eval Case content");
  const content: AIEvalCaseContent = {
    key: text(record.key, "key", KEY_PATTERN, 160),
    subjectKey: text(record.subjectKey, "subjectKey", SUBJECT_PATTERN, 80),
    displayName: boundedText(record.displayName, "displayName", MAX_DISPLAY_NAME_LENGTH),
    description: nullableBoundedText(record.description, "description", MAX_DESCRIPTION_LENGTH),
    inputText: boundedNonEmptyText(record.inputText, "inputText", AI_EVAL_MAX_CASE_INPUT_BYTES),
    origin: enumValue(record.origin, AI_EVAL_CASE_ORIGINS, "origin"),
    privacyClass: enumValue(record.privacyClass, AI_EVAL_PRIVACY_CLASSES, "privacyClass"),
    deidentificationProof: normalizeDeidentificationProof(record.deidentificationProof),
    expectedStatus: enumValue(record.expectedStatus, AI_EVAL_EXPECTED_STATUSES, "expectedStatus"),
    allowedFinishReasons: normalizeFinishReasons(record.allowedFinishReasons),
    requiredOutputLiterals: normalizeLiterals(record.requiredOutputLiterals, "requiredOutputLiterals"),
    forbiddenOutputLiterals: normalizeLiterals(record.forbiddenOutputLiterals, "forbiddenOutputLiterals"),
    requiredEvidenceOrigins: normalizeEvidenceOrigins(record.requiredEvidenceOrigins, "requiredEvidenceOrigins"),
    forbiddenEvidenceOrigins: normalizeEvidenceOrigins(record.forbiddenEvidenceOrigins, "forbiddenEvidenceOrigins"),
    requiredCitationLabels: normalizeCitationLabels(record.requiredCitationLabels),
    minimumEvidenceItemCount: boundedInteger(record.minimumEvidenceItemCount, "minimumEvidenceItemCount", 0, 50),
    securityLeakageMarkers: normalizeLiterals(record.securityLeakageMarkers, "securityLeakageMarkers", MAX_MARKER_LENGTH, AI_EVAL_MAX_SECURITY_MARKERS),
    maximumOutputBytes: nullableInteger(record.maximumOutputBytes, "maximumOutputBytes", 1, 524_288),
    sourceRevisionReferences: normalizeSourceReferences(record.sourceRevisionReferences),
    enabled: booleanValue(record.enabled, "enabled"),
  };
  if (content.requiredOutputLiterals.some((literal) => content.forbiddenOutputLiterals.includes(literal))) invalid("Output literal expectations conflict.");
  if (content.requiredEvidenceOrigins.some((required) => content.forbiddenEvidenceOrigins.some((forbidden) => sameEvidenceOrigin(required, forbidden)))) invalid("Evidence origin expectations conflict.");
  if (content.requiredCitationLabels.length > 0 && content.expectedStatus !== "COMPLETED") invalid("Citation expectations require a completed Eval Case.");
  if (content.origin === "DEIDENTIFIED_REGRESSION") {
    if (content.privacyClass !== "DEIDENTIFIED_REGRESSION" || !content.deidentificationProof) invalid("A regression Case requires explicit de-identification proof.");
    if (content.sourceRevisionReferences.length === 0) invalid("A regression Case requires a safe source revision reference.");
  } else if (content.deidentificationProof !== null) {
    invalid("De-identification proof is reserved for regression Cases.");
  }
  if (content.origin === "SYNTHETIC" && content.privacyClass !== "SYNTHETIC_PUBLIC_SAFE") invalid("Synthetic Cases require public-safe privacy classification.");
  if (content.origin === "CURATED" && content.privacyClass !== "INTERNAL_CURATED") invalid("Curated Cases require internal-curated privacy classification.");
  return content;
}

export function normalizeAIEvalCandidateSnapshot(value: unknown): AIEvalCandidateSnapshot {
  const record = plainObject(value, "Eval candidate snapshot");
  exactKeys(record, ["tutorConfig", "globalPolicy", "subjectPolicy", "contextPolicy", "retrievalConfig", "generationModel", "generationProvider", "embeddingSpace", "rerank", "groundingProtocol", "citationProtocol"], "Eval candidate snapshot");
  const candidate: AIEvalCandidateSnapshot = {
    tutorConfig: normalizeIdentity(record.tutorConfig, "tutorConfig"),
    globalPolicy: normalizeIdentity(record.globalPolicy, "globalPolicy"),
    subjectPolicy: normalizeIdentity(record.subjectPolicy, "subjectPolicy"),
    contextPolicy: normalizeIdentity(record.contextPolicy, "contextPolicy"),
    retrievalConfig: normalizeIdentity(record.retrievalConfig, "retrievalConfig"),
    generationModel: normalizeIdentity(record.generationModel, "generationModel"),
    generationProvider: normalizeIdentity(record.generationProvider, "generationProvider"),
    embeddingSpace: record.embeddingSpace === null ? null : normalizeEmbeddingSpace(record.embeddingSpace),
    rerank: record.rerank === null ? null : normalizeRerankIdentity(record.rerank),
    groundingProtocol: normalizeProtocol(record.groundingProtocol, "groundingProtocol", AI_TUTOR_GROUNDING_PROTOCOL_KEY, AI_TUTOR_GROUNDING_PROTOCOL_REVISION),
    citationProtocol: normalizeProtocol(record.citationProtocol, "citationProtocol", AI_TUTOR_CITATION_PROTOCOL_KEY, AI_TUTOR_CITATION_PROTOCOL_REVISION),
  };
  return candidate;
}

export function fingerprintAIEvalCandidate(snapshot: AIEvalCandidateSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot), "utf8").digest("hex");
}

export function fingerprintAIEvalManifest(manifest: readonly AIEvalCaseManifestEntry[]): string {
  return createHash("sha256").update(JSON.stringify(manifest), "utf8").digest("hex");
}

export function normalizeAIEvalObservation(value: unknown): AIEvalObservation {
  const record = plainObject(value, "Eval observation");
  exactKeys(record, [
    "runId", "caseId", "caseRevision", "observedSubjectKey", "observedStatus", "finishReason",
    "outputText", "citationMap", "evidence", "retrievalStatus", "outputBytes", "elapsedLatencyMs",
    "costOperationId", "groundingProtocolKey", "groundingProtocolRevision", "citationProtocolKey", "citationProtocolRevision",
  ], "Eval observation");
  const outputText = boundedOutputText(record.outputText, "outputText", 524_288);
  const outputBytes = boundedInteger(record.outputBytes, "outputBytes", 0, 524_288);
  if (Buffer.byteLength(outputText, "utf8") !== outputBytes) invalid("Eval observation output byte size is inconsistent.");
  return {
    runId: uuid(record.runId, "runId"),
    caseId: uuid(record.caseId, "caseId"),
    caseRevision: boundedInteger(record.caseRevision, "caseRevision", 1, Number.MAX_SAFE_INTEGER),
    observedSubjectKey: text(record.observedSubjectKey, "observedSubjectKey", SUBJECT_PATTERN, 80),
    observedStatus: enumValue(record.observedStatus, ["COMPLETED", "BLOCKED", "FAILED", "CANCELLED"] as const, "observedStatus"),
    finishReason: record.finishReason === null ? null : enumValue(record.finishReason, ["STOP", "LENGTH", "CONTENT_FILTER", "OTHER", "FAILED", "CANCELLED"] as const, "finishReason"),
    outputText,
    citationMap: normalizeCitationMap(record.citationMap),
    evidence: normalizeEvidenceOrigins(record.evidence, "evidence"),
    retrievalStatus: enumValue(record.retrievalStatus, ["SUFFICIENT", "INSUFFICIENT", "NOT_APPLICABLE"] as const, "retrievalStatus"),
    outputBytes,
    elapsedLatencyMs: nullableInteger(record.elapsedLatencyMs, "elapsedLatencyMs", 0, 8_640_000_000_000),
    costOperationId: record.costOperationId === null ? null : uuid(record.costOperationId, "costOperationId"),
    groundingProtocolKey: boundedText(record.groundingProtocolKey, "groundingProtocolKey", 120),
    groundingProtocolRevision: boundedInteger(record.groundingProtocolRevision, "groundingProtocolRevision", 1, Number.MAX_SAFE_INTEGER),
    citationProtocolKey: boundedText(record.citationProtocolKey, "citationProtocolKey", 120),
    citationProtocolRevision: boundedInteger(record.citationProtocolRevision, "citationProtocolRevision", 1, Number.MAX_SAFE_INTEGER),
  };
}

export function hashEvalOutput(outputText: string): string {
  return createHash("sha256").update(outputText, "utf8").digest("hex");
}

export function fingerprintAIEvalAccountingBasis(input: Omit<AIEvalAccountingBasis, "fingerprint">): string {
  const canonical = canonicalAccountingBasis(input);
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

export function normalizeAIEvalAccountingBasis(value: unknown): AIEvalAccountingBasis {
  const record = plainObject(value, "Eval accounting basis");
  exactKeys(record, ["version", "operations", "currency", "totalNano", "fingerprint"], "Eval accounting basis");
  if (record.version !== 1) invalid("Eval accounting basis version is unsupported.");
  if (!Array.isArray(record.operations) || record.operations.length < 1 || record.operations.length > AI_EVAL_MAX_CASE_MANIFEST_ITEMS) invalid("Eval accounting basis operations are invalid.");
  const operationIds = new Set<string>();
  const operations = record.operations.map((item) => {
    const operation = plainObject(item, "Eval accounting basis operation");
    exactKeys(operation, ["operationId", "records"], "Eval accounting basis operation");
    const operationId = boundedNonEmptyText(operation.operationId, "Eval accounting basis operation ID", 120);
    if (operationIds.has(operationId)) invalid("Eval accounting basis operation IDs must be unique.");
    operationIds.add(operationId);
    if (!Array.isArray(operation.records) || operation.records.length < 1 || operation.records.length > AI_EVAL_MAX_CASE_MANIFEST_ITEMS) invalid("Eval accounting basis records are invalid.");
    const recordIds = new Set<string>();
    const records = operation.records.map((item) => {
      const usage = plainObject(item, "Eval accounting basis usage record");
      exactKeys(usage, ["recordId", "correctionIds"], "Eval accounting basis usage record");
      const recordId = boundedNonEmptyText(usage.recordId, "Eval accounting basis usage record ID", 120);
      if (recordIds.has(recordId)) invalid("Eval accounting basis usage record IDs must be unique.");
      recordIds.add(recordId);
      if (!Array.isArray(usage.correctionIds) || usage.correctionIds.length > AI_EVAL_MAX_CASE_MANIFEST_ITEMS) invalid("Eval accounting basis corrections are invalid.");
      const correctionIdentities = new Set<string>();
      for (const correctionId of usage.correctionIds) {
        if (typeof correctionId !== "string" || correctionIdentities.has(correctionId)) invalid("Eval accounting basis correction IDs must be unique.");
        correctionIdentities.add(correctionId);
      }
      const correctionIds = usage.correctionIds.map((correctionId) => boundedNonEmptyText(correctionId, "Eval accounting basis correction ID", 120));
      return { recordId, correctionIds };
    });
    return { operationId, records };
  });
  const currency = text(record.currency, "Eval accounting basis currency", /^[A-Z]{3}$/u, 3);
  const totalNano = boundedInteger(record.totalNano, "Eval accounting basis total", 0, Number.MAX_SAFE_INTEGER);
  const fingerprint = text(record.fingerprint, "Eval accounting basis fingerprint", /^[0-9a-f]{64}$/u, 64);
  const normalized = { version: 1 as const, operations, currency, totalNano, fingerprint };
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > 1_048_576) invalid("Eval accounting basis exceeds its safe size bound.");
  if (fingerprintAIEvalAccountingBasis({ version: 1, operations, currency, totalNano }) !== fingerprint) invalid("Eval accounting basis fingerprint is invalid.");
  return structuredClone(normalized);
}

function canonicalAccountingBasis(input: Omit<AIEvalAccountingBasis, "fingerprint">): { version: 1; operations: AIEvalAccountingBasisOperation[]; currency: string; totalNano: number } {
  return {
    version: 1,
    operations: [...input.operations]
      .map((operation) => ({
        operationId: operation.operationId,
        records: [...operation.records]
          .map((record) => ({ recordId: record.recordId, correctionIds: [...record.correctionIds].sort() }))
          .sort((left, right) => left.recordId.localeCompare(right.recordId)),
      }))
      .sort((left, right) => left.operationId.localeCompare(right.operationId)),
    currency: input.currency,
    totalNano: input.totalNano,
  };
}

function normalizeCaseManifest(value: unknown): AIEvalCaseManifestEntry[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > AI_EVAL_MAX_CASE_MANIFEST_ITEMS) invalid("Eval Suite Case manifest is invalid.");
  const ordinals = new Set<number>();
  const caseIds = new Set<string>();
  const result = value.map((item, index) => {
    const record = plainObject(item, "Eval Suite Case manifest entry");
    exactKeys(record, ["ordinal", "caseId", "caseRevision"], "Eval Suite Case manifest entry");
    const ordinal = boundedInteger(record.ordinal, "case ordinal", 1, AI_EVAL_MAX_CASE_MANIFEST_ITEMS);
    const caseId = uuid(record.caseId, "caseId");
    if (ordinal !== index + 1 || ordinals.has(ordinal) || caseIds.has(caseId)) invalid("Eval Suite Case manifest ordinals and Cases must be unique and contiguous.");
    ordinals.add(ordinal);
    caseIds.add(caseId);
    return { ordinal, caseId, caseRevision: boundedInteger(record.caseRevision, "caseRevision", 1, Number.MAX_SAFE_INTEGER) };
  });
  return result;
}

function normalizeDimensionRequirements(value: unknown): AIEvalDimensionRequirement[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > AI_EVAL_DIMENSIONS.length) invalid("Required Eval dimensions are invalid.");
  const seen = new Set<string>();
  return value.map((item) => {
    const record = plainObject(item, "Eval dimension requirement");
    exactKeys(record, ["dimension", "mode"], "Eval dimension requirement");
    const dimension = enumValue(record.dimension, AI_EVAL_DIMENSIONS, "dimension");
    if (seen.has(dimension)) invalid("Eval dimensions must be unique.");
    seen.add(dimension);
    return { dimension, mode: enumValue(record.mode, AI_EVAL_DIMENSION_MODES, "dimension mode") };
  });
}

function normalizeGraderConfigs(value: unknown): AIEvalGraderConfig[] {
  if (!Array.isArray(value) || value.length > AI_EVAL_MAX_GRADER_CONFIGS) invalid("Eval grader configuration is invalid.");
  const seen = new Set<string>();
  return value.map((item) => {
    const record = plainObject(item, "Eval grader configuration");
    exactKeys(record, ["graderKey", "graderRevision", "dimension", "required"], "Eval grader configuration");
    const graderKey = text(record.graderKey, "graderKey", GRADER_KEY_PATTERN, 120);
    const graderRevision = boundedInteger(record.graderRevision, "graderRevision", 1, Number.MAX_SAFE_INTEGER);
    const identity = `${graderKey}@${graderRevision}`;
    if (seen.has(identity)) invalid("Eval grader identities must be unique.");
    seen.add(identity);
    return { graderKey, graderRevision, dimension: enumValue(record.dimension, AI_EVAL_DIMENSIONS, "grader dimension"), required: booleanValue(record.required, "grader required") };
  });
}

function normalizeGateConfig(value: unknown): AIEvalGateConfig {
  const record = plainObject(value, "Eval gate configuration");
  exactKeys(record, ["minimumScores", "maximumCostNano", "maximumLatencyMs", "requireSecurityPass"], "Eval gate configuration");
  const minimumScoresValue = record.minimumScores;
  if (!Array.isArray(minimumScoresValue) || minimumScoresValue.length > AI_EVAL_DIMENSIONS.length) invalid("Eval minimum score gates are invalid.");
  const dimensions = new Set<string>();
  const minimumScores = minimumScoresValue.map((item) => {
    const itemRecord = plainObject(item, "Eval minimum score gate");
    exactKeys(itemRecord, ["dimension", "scoreUnits"], "Eval minimum score gate");
    const dimension = enumValue(itemRecord.dimension, AI_EVAL_DIMENSIONS, "minimum score dimension");
    if (dimensions.has(dimension)) invalid("Eval minimum score dimensions must be unique.");
    dimensions.add(dimension);
    return { dimension, scoreUnits: boundedInteger(itemRecord.scoreUnits, "minimum score units", 0, AI_EVAL_SCORE_SCALE) };
  });
  return {
    minimumScores,
    maximumCostNano: nullableInteger(record.maximumCostNano, "maximumCostNano", 0, Number.MAX_SAFE_INTEGER),
    maximumLatencyMs: nullableInteger(record.maximumLatencyMs, "maximumLatencyMs", 0, 8_640_000_000_000),
    requireSecurityPass: booleanValue(record.requireSecurityPass, "requireSecurityPass"),
  };
}

function normalizeRegressionDeltas(value: unknown): AIEvalRegressionDelta[] {
  if (!Array.isArray(value) || value.length > AI_EVAL_DIMENSIONS.length) invalid("Eval regression deltas are invalid.");
  const seen = new Set<string>();
  return value.map((item) => {
    const record = plainObject(item, "Eval regression delta");
    exactKeys(record, ["dimension", "maximumRegressionUnits"], "Eval regression delta");
    const dimension = enumValue(record.dimension, AI_EVAL_DIMENSIONS, "regression dimension");
    if (seen.has(dimension)) invalid("Eval regression dimensions must be unique.");
    seen.add(dimension);
    return { dimension, maximumRegressionUnits: boundedInteger(record.maximumRegressionUnits, "maximumRegressionUnits", 0, AI_EVAL_SCORE_SCALE) };
  });
}

function normalizeJudgeConfig(value: unknown): { referenceKey: string; revision: number } | null {
  if (value === null) return null;
  const record = plainObject(value, "supplementaryJudgeConfig");
  exactKeys(record, ["referenceKey", "revision"], "supplementaryJudgeConfig");
  return { referenceKey: text(record.referenceKey, "referenceKey", SAFE_CONFIG_KEY_PATTERN, 120), revision: boundedInteger(record.revision, "judge revision", 1, Number.MAX_SAFE_INTEGER) };
}

function normalizeDeidentificationProof(value: unknown): AIEvalDeidentificationProof | null {
  if (value === null) return null;
  const record = plainObject(value, "deidentificationProof");
  exactKeys(record, ["approved", "methodKey", "reviewerReference"], "deidentificationProof");
  if (record.approved !== true) invalid("De-identification proof must be explicitly approved.");
  return { approved: true, methodKey: text(record.methodKey, "de-identification method", SAFE_CONFIG_KEY_PATTERN, 120), reviewerReference: boundedText(record.reviewerReference, "reviewerReference", 240) };
}

function normalizeFinishReasons(value: unknown): AIEvalCaseContent["allowedFinishReasons"] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) invalid("Allowed finish reasons are invalid.");
  const allowed = ["STOP", "LENGTH", "CONTENT_FILTER", "OTHER"] as const;
  const seen = new Set<string>();
  return value.map((item) => {
    const reason = enumValue(item, allowed, "allowed finish reason");
    if (seen.has(reason)) invalid("Allowed finish reasons must be unique.");
    seen.add(reason);
    return reason;
  });
}

function normalizeLiterals(value: unknown, field: string, maximum = MAX_LITERAL_LENGTH, count = AI_EVAL_MAX_LITERAL_EXPECTATIONS): string[] {
  if (!Array.isArray(value) || value.length > count) invalid(`${field} is invalid.`);
  const seen = new Set<string>();
  return value.map((item) => {
    const literal = boundedNonEmptyText(item, field, maximum);
    if (seen.has(literal)) invalid(`${field} must not contain duplicates.`);
    seen.add(literal);
    return literal;
  });
}

function normalizeEvidenceOrigins(value: unknown, field: string): AIEvalEvidenceOriginReference[] {
  if (!Array.isArray(value) || value.length > AI_EVAL_MAX_SOURCE_REFERENCES) invalid(`${field} is invalid.`);
  const seen = new Set<string>();
  return value.map((item) => {
    const record = plainObject(item, field);
    exactKeys(record, ["originKind", "originId", "subjectKey"], field);
    const originKind = enumValue(record.originKind, ["KNOWLEDGE_PACKAGE", "QUESTION_PACKAGE"] as const, `${field} origin kind`);
    const originId = boundedNonEmptyText(record.originId, `${field} originId`, 240);
    const subjectKey = text(record.subjectKey, `${field} subjectKey`, SUBJECT_PATTERN, 80);
    const identity = `${originKind}:${originId}:${subjectKey}`;
    if (seen.has(identity)) invalid(`${field} contains duplicates.`);
    seen.add(identity);
    return { originKind, originId, subjectKey };
  });
}

function normalizeCitationLabels(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) invalid("requiredCitationLabels is invalid.");
  const seen = new Set<string>();
  return value.map((item) => {
    if (typeof item !== "string" || !CITATION_PATTERN.test(item) || seen.has(item)) invalid("Citation labels are invalid or duplicated.");
    seen.add(item);
    return item;
  });
}

function normalizeSourceReferences(value: unknown): AIEvalSourceRevisionReference[] {
  if (!Array.isArray(value) || value.length > AI_EVAL_MAX_SOURCE_REFERENCES) invalid("sourceRevisionReferences is invalid.");
  const seen = new Set<string>();
  return value.map((item) => {
    const record = plainObject(item, "source revision reference");
    exactKeys(record, ["kind", "id", "revision"], "source revision reference");
    const kind = enumValue(record.kind, AI_EVAL_SOURCE_REFERENCE_KINDS, "source reference kind");
    const id = boundedNonEmptyText(record.id, "source reference id", 240);
    const revision = boundedInteger(record.revision, "source reference revision", 1, Number.MAX_SAFE_INTEGER);
    const identity = `${kind}:${id}:${revision}`;
    if (seen.has(identity)) invalid("sourceRevisionReferences contains duplicates.");
    seen.add(identity);
    return { kind, id, revision };
  });
}

function normalizeCitationMap(value: unknown): readonly AITutorCitationMapItem[] {
  if (!Array.isArray(value) || value.length > 50) invalid("citationMap is invalid.");
  const labels = new Set<string>();
  return structuredClone(value.map((item) => {
    const record = plainObject(item, "citationMap item");
    exactKeys(record, ["label", "ordinal", "chunkId", "m7aProjectionRevisionId", "m7bEmbeddingProjectionRevisionId", "originKind", "originId", "questionId", "questionRevision"], "citationMap item");
    if (typeof record.label !== "string" || !CITATION_PATTERN.test(record.label) || labels.has(record.label)) invalid("citationMap labels are invalid or duplicated.");
    const ordinal = boundedInteger(record.ordinal, "citationMap ordinal", 1, 50);
    const chunkId = boundedNonEmptyText(record.chunkId, "citationMap chunkId", 240);
    const m7aProjectionRevisionId = boundedNonEmptyText(record.m7aProjectionRevisionId, "citationMap M7A revision", 240);
    const m7bEmbeddingProjectionRevisionId = record.m7bEmbeddingProjectionRevisionId === null ? null : boundedNonEmptyText(record.m7bEmbeddingProjectionRevisionId, "citationMap M7B revision", 240);
    const originKind = enumValue(record.originKind, ["KNOWLEDGE_PACKAGE", "QUESTION_PACKAGE"] as const, "citationMap origin kind");
    const originId = boundedNonEmptyText(record.originId, "citationMap originId", 240);
    const questionId = record.questionId === null ? null : boundedNonEmptyText(record.questionId, "citationMap questionId", 240);
    const questionRevision = record.questionRevision === null ? null : boundedInteger(record.questionRevision, "citationMap question revision", 1, Number.MAX_SAFE_INTEGER);
    if ((questionId === null) !== (questionRevision === null)) invalid("citationMap Question identity is incomplete.");
    labels.add(record.label);
    return { label: record.label, ordinal, chunkId, m7aProjectionRevisionId, m7bEmbeddingProjectionRevisionId, originKind, originId, questionId, questionRevision };
  })) as unknown as readonly AITutorCitationMapItem[];
}

function normalizeIdentity(value: unknown, field: string): { id: string; revision: number } {
  const record = plainObject(value, field);
  exactKeys(record, ["id", "revision"], field);
  return { id: uuid(record.id, `${field}.id`), revision: boundedInteger(record.revision, `${field}.revision`, 1, Number.MAX_SAFE_INTEGER) };
}

function normalizeEmbeddingSpace(value: unknown): AIEvalCandidateSnapshot["embeddingSpace"] {
  const record = plainObject(value, "embeddingSpace");
  exactKeys(record, ["projectionRevisionId", "modelConfigId", "modelConfigRevision"], "embeddingSpace");
  return { projectionRevisionId: boundedNonEmptyText(record.projectionRevisionId, "projectionRevisionId", 240), modelConfigId: uuid(record.modelConfigId, "embedding model id"), modelConfigRevision: boundedInteger(record.modelConfigRevision, "embedding model revision", 1, Number.MAX_SAFE_INTEGER) };
}

function normalizeRerankIdentity(value: unknown): NonNullable<AIEvalCandidateSnapshot["rerank"]> {
  const record = plainObject(value, "rerank");
  exactKeys(record, ["modelConfigId", "modelConfigRevision", "providerConfigId", "providerConfigRevision"], "rerank");
  return { modelConfigId: uuid(record.modelConfigId, "rerank model id"), modelConfigRevision: boundedInteger(record.modelConfigRevision, "rerank model revision", 1, Number.MAX_SAFE_INTEGER), providerConfigId: uuid(record.providerConfigId, "rerank provider id"), providerConfigRevision: boundedInteger(record.providerConfigRevision, "rerank provider revision", 1, Number.MAX_SAFE_INTEGER) };
}

function normalizeProtocol(value: unknown, field: string, expectedKey: string, expectedRevision: number): { key: string; revision: number } {
  const record = plainObject(value, field);
  exactKeys(record, ["key", "revision"], field);
  if (record.key !== expectedKey || record.revision !== expectedRevision) invalid(`${field} is unsupported.`);
  return { key: expectedKey, revision: expectedRevision };
}

function validateSuiteGraderModes(content: AIEvalSuiteContent): void {
  const modes = new Map(content.requiredDimensions.map((requirement) => [requirement.dimension, requirement.mode]));
  for (const grader of content.graderConfigs) {
    if (modes.get(grader.dimension) !== "DETERMINISTICALLY_GRADED") invalid("A deterministic grader requires a deterministic dimension.");
  }
  for (const requirement of content.requiredDimensions) {
    if (requirement.mode === "DETERMINISTICALLY_GRADED" && !content.graderConfigs.some((grader) => grader.dimension === requirement.dimension && grader.required)) invalid("Every required deterministic dimension needs a required grader.");
  }
  const securityReq = content.requiredDimensions.find((r) => r.dimension === "SECURITY");
  if (securityReq?.mode === "JUDGE_REQUIRED") {
    invalid("The SECURITY dimension cannot be JUDGE_REQUIRED.");
  }
  const judgeRequiredCount = content.requiredDimensions.filter((r) => r.mode === "JUDGE_REQUIRED").length;
  if (judgeRequiredCount > 0 && content.supplementaryJudgeConfig === null) {
    invalid("A Suite with JUDGE_REQUIRED dimensions requires a supplementaryJudgeConfig.");
  }
  if (judgeRequiredCount === 0 && content.supplementaryJudgeConfig !== null) {
    invalid("A Suite with no JUDGE_REQUIRED dimensions must not specify a supplementaryJudgeConfig.");
  }
}

function sameEvidenceOrigin(left: AIEvalEvidenceOriginReference, right: AIEvalEvidenceOriginReference): boolean {
  return left.originKind === right.originKind && left.originId === right.originId && left.subjectKey === right.subjectKey;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], field: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) invalid(`${field} fields are invalid.`);
}

function plainObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(`${field} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(`${field} must be a plain object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, pattern: RegExp, maximum: number): string {
  const result = boundedText(value, field, maximum);
  if (!pattern.test(result)) invalid(`${field} is invalid.`);
  return result;
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") invalid(`${field} is invalid.`);
  const result = value.normalize("NFKC").trim();
  if (!result || result.length > maximum) invalid(`${field} is invalid.`);
  return result;
}

function boundedNonEmptyText(value: unknown, field: string, maximumBytes: number): string {
  if (typeof value !== "string") invalid(`${field} is invalid.`);
  const result = value.normalize("NFKC").trim();
  if (!result || Buffer.byteLength(result, "utf8") > maximumBytes) invalid(`${field} is invalid.`);
  return result;
}

function boundedOutputText(value: unknown, field: string, maximumBytes: number): string {
  if (typeof value !== "string") invalid(`${field} is invalid.`);
  const result = value;
  if (Buffer.byteLength(result, "utf8") > maximumBytes) invalid(`${field} is invalid.`);
  return result;
}

function nullableBoundedText(value: unknown, field: string, maximum: number): string | null {
  return value === null ? null : boundedText(value, field, maximum);
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(`${field} is invalid.`);
  return value;
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid(`${field} is invalid.`);
  return value as number;
}

function nullableInteger(value: unknown, field: string, minimum: number, maximum: number): number | null {
  return value === null ? null : boundedInteger(value, field, minimum, maximum);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) invalid(`${field} is invalid.`);
  return value as T;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid(`${field} is invalid.`);
  return value;
}

function invalid(message: string): never {
  throw new AIEvalError("AI_EVAL_INVALID", message);
}
