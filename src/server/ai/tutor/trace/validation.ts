import { AI_TUTOR_CITATION_PROTOCOL_KEY, AI_TUTOR_CITATION_PROTOCOL_REVISION, AI_TUTOR_GROUNDING_PROTOCOL_KEY, AI_TUTOR_GROUNDING_PROTOCOL_REVISION } from "../configuration";
import { AI_RETRIEVAL_FUSION_ALGORITHM_KEY, AI_RETRIEVAL_FUSION_ALGORITHM_REVISION } from "../../retrieval-config";
import { AI_TUTOR_TRACE_ORIGIN_KINDS, AI_TUTOR_TRACE_PROJECTION_KINDS, type AITutorTraceCreateInput, type AITutorTraceEvidenceRefCreate, type AITutorTraceProjectionRefCreate } from "./contracts";
import { AITutorTraceError } from "./errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,240}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const PRINCIPAL_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;

export function validateTraceCreateInput(input: AITutorTraceCreateInput): void {
  const trace = input.trace;
  for (const [field, value] of Object.entries({
    id: trace.id,
    responseId: trace.responseId,
    conversationId: trace.conversationId,
    tutorConfigId: trace.tutorConfigId,
    contextSnapshotId: trace.contextSnapshotId,
    retrievalConfigId: trace.retrievalConfigId,
    generationModelConfigId: trace.generationModelConfigId,
    generationProviderConfigId: trace.generationProviderConfigId,
    costOperationId: trace.costOperationId,
    budgetReservationId: trace.budgetReservationId,
    budgetPolicyId: trace.budgetPolicyId,
    rateLimitPolicyId: trace.rateLimitPolicyId,
  })) {
    uuid(value, field);
  }
  if (!PRINCIPAL_PATTERN.test(trace.principalRef)) invalid("Trace principal identity is invalid.");
  if (!SAFE_ID_PATTERN.test(trace.subjectKey) || !SAFE_ID_PATTERN.test(trace.providerModelId) || !SAFE_ID_PATTERN.test(trace.adapterKey)) invalid("Trace safe identity is invalid.");
  positive(trace.tutorConfigRevision, "tutorConfigRevision");
  positive(trace.contextSnapshotFingerprint.length, "contextSnapshotFingerprint");
  hash(trace.contextSnapshotFingerprint, "contextSnapshotFingerprint");
  positive(trace.retrievalConfigRevision, "retrievalConfigRevision");
  if (trace.fusionAlgorithmKey !== AI_RETRIEVAL_FUSION_ALGORITHM_KEY || trace.fusionAlgorithmRevision !== AI_RETRIEVAL_FUSION_ALGORITHM_REVISION) invalid("Trace fusion identity is unsupported.");
  positive(trace.generationModelConfigRevision, "generationModelConfigRevision");
  positive(trace.generationProviderConfigRevision, "generationProviderConfigRevision");
  positive(trace.budgetPolicyRevision, "budgetPolicyRevision");
  positive(trace.rateLimitPolicyRevision, "rateLimitPolicyRevision");
  if (trace.groundingProtocolKey !== AI_TUTOR_GROUNDING_PROTOCOL_KEY || trace.groundingProtocolRevision !== AI_TUTOR_GROUNDING_PROTOCOL_REVISION) invalid("Trace grounding identity is unsupported.");
  if (trace.citationProtocolKey !== AI_TUTOR_CITATION_PROTOCOL_KEY || trace.citationProtocolRevision !== AI_TUTOR_CITATION_PROTOCOL_REVISION) invalid("Trace citation identity is unsupported.");
  hash(trace.planFingerprint, "planFingerprint");
  if (trace.status !== "PLANNED" || trace.safeErrorCode !== null || trace.completedAt !== null) invalid("A new Tutor Trace must start PLANNED.");
  timestamp(trace.createdAt, "createdAt");
  timestamp(trace.updatedAt, "updatedAt");
  if (trace.updatedAt < trace.createdAt) invalid("Trace timestamps are invalid.");
  if (input.projectionRefs.length > 200 || input.evidenceRefs.length > 50) invalid("Trace reference bounds are invalid.");
  validateProjectionRefs(input.projectionRefs);
  validateEvidenceRefs(input.evidenceRefs);
}

function validateProjectionRefs(refs: readonly AITutorTraceProjectionRefCreate[]): void {
  const seen = new Set<string>();
  for (const ref of refs) {
    exactKeys(ref, ["projectionKind", "projectionRevisionId"], "Trace projection reference");
    if (!AI_TUTOR_TRACE_PROJECTION_KINDS.includes(ref.projectionKind) || !SAFE_ID_PATTERN.test(ref.projectionRevisionId)) invalid("Trace projection reference is invalid.");
    const identity = `${ref.projectionKind}:${ref.projectionRevisionId}`;
    if (seen.has(identity)) invalid("Trace projection references are duplicated.");
    seen.add(identity);
  }
}

function validateEvidenceRefs(refs: readonly AITutorTraceEvidenceRefCreate[]): void {
  const ordinals = new Set<number>();
  const labels = new Set<string>();
  for (const ref of refs) {
    exactKeys(ref, ["ordinal", "citationLabel", "chunkId", "m7aProjectionRevisionId", "m7bEmbeddingProjectionRevisionId", "originKind", "originId", "questionId", "questionRevision"], "Trace evidence reference");
    positive(ref.ordinal, "evidence ordinal");
    if (ref.ordinal > 50 || ref.citationLabel !== `[E${ref.ordinal}]` || ordinals.has(ref.ordinal) || labels.has(ref.citationLabel)) invalid("Trace citation reference is invalid or duplicated.");
    if (!SAFE_ID_PATTERN.test(ref.chunkId) || !SAFE_ID_PATTERN.test(ref.m7aProjectionRevisionId) || (ref.m7bEmbeddingProjectionRevisionId !== null && !SAFE_ID_PATTERN.test(ref.m7bEmbeddingProjectionRevisionId)) || !AI_TUTOR_TRACE_ORIGIN_KINDS.includes(ref.originKind) || !SAFE_ID_PATTERN.test(ref.originId)) invalid("Trace evidence reference is invalid.");
    if (ref.questionId !== null && !SAFE_ID_PATTERN.test(ref.questionId)) invalid("Trace Question reference is invalid.");
    if (ref.questionRevision !== null) positive(ref.questionRevision, "questionRevision");
    ordinals.add(ref.ordinal);
    labels.add(ref.citationLabel);
  }
}

function exactKeys(value: unknown, expectedKeys: readonly string[], label: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(`${label} is invalid.`);
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actualKeys.length !== expected.length || actualKeys.some((key, index) => key !== expected[index])) invalid(`${label} fields are invalid.`);
}

function uuid(value: unknown, field: string): void {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid(`${field} is invalid.`);
}

function hash(value: unknown, field: string): void {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) invalid(`${field} is invalid.`);
}

function positive(value: unknown, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid(`${field} is invalid.`);
}

function timestamp(value: unknown, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(`${field} is invalid.`);
}

function invalid(message: string): never {
  throw new AITutorTraceError("AI_TUTOR_TRACE_INVALID", message);
}
