import {
  AI_TELEMETRY_EVENT_TYPES,
  AI_TELEMETRY_EVENT_VERSION,
  AI_TELEMETRY_FAILURE_CODES,
  AI_TELEMETRY_FEEDBACK_REASON_CODES,
  AI_TELEMETRY_FEEDBACK_SURFACES,
  AI_TELEMETRY_FEEDBACK_TYPES,
  AI_TELEMETRY_MEMORY_ACTIONS,
  AI_TELEMETRY_MEMORY_KINDS,
  AI_TELEMETRY_MEMORY_ORIGINS,
  AI_TELEMETRY_MEMORY_SCOPES,
  AI_TELEMETRY_PRIVACY_CLASSES,
  AI_TELEMETRY_TERMINAL_STATUSES,
  AI_TELEMETRY_VALIDATION_STATUSES,
  type AIFeedbackInput,
  type AITelemetryEventInput,
  type AITelemetryEventType,
  type AITelemetryMemoryAction,
} from "./contracts";

export const AI_TELEMETRY_MAX_EVENT_ID_BYTES = 240;
export const AI_TELEMETRY_MAX_DEDUPE_KEY_BYTES = 240;
export const AI_TELEMETRY_MAX_DURATION_MS = 8_640_000_000_000;
export const AI_TELEMETRY_MAX_COUNT = 1_000_000;
export const AI_TELEMETRY_MAX_TIME_RANGE_MS = 366 * 86_400_000;

const MAX_TIMESTAMP = 8_640_000_000_000_000;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,240}$/u;
const PRINCIPAL_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;
const SUBJECT_PATTERN = /^[a-z0-9-]{1,80}$/u;
const BUCKET_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const BUCKET_MONTH_PATTERN = /^\d{4}-\d{2}$/u;
const BUCKET_WEEK_PATTERN = /^\d{4}-W\d{2}$/u;

export function validateTelemetryEventInput(input: AITelemetryEventInput): Required<Pick<AITelemetryEventInput, "eventVersion" | "privacyClass">> & AITelemetryEventInput {
  if (!input || typeof input !== "object") throw new Error("Telemetry event input is invalid.");
  if (!AI_TELEMETRY_EVENT_TYPES.includes(input.eventType as AITelemetryEventType)) throw new Error("Telemetry event type is unsupported.");
  const eventVersion = input.eventVersion ?? AI_TELEMETRY_EVENT_VERSION;
  const privacyClass = input.privacyClass ?? "DEIDENTIFIED_METADATA";
  if (eventVersion !== AI_TELEMETRY_EVENT_VERSION || !AI_TELEMETRY_PRIVACY_CLASSES.includes(privacyClass)) throw new Error("Telemetry event version or privacy class is invalid.");
  boundedText(input.dedupeKey, AI_TELEMETRY_MAX_DEDUPE_KEY_BYTES, "Telemetry event dedupe key");
  if (input.id !== undefined) boundedText(input.id, AI_TELEMETRY_MAX_EVENT_ID_BYTES, "Telemetry event id");
  if (input.principalRef !== undefined && input.principalRef !== null && !PRINCIPAL_PATTERN.test(input.principalRef)) throw new Error("Telemetry principal reference is invalid.");
  nullableId(input.subjectKey, "Telemetry subject key", SUBJECT_PATTERN);
  for (const [name, value] of Object.entries({
    conversationId: input.conversationId,
    responseId: input.responseId,
    responseTraceId: input.responseTraceId,
    retrievalTraceId: input.retrievalTraceId,
    costOperationId: input.costOperationId,
    modelConfigId: input.modelConfigId,
    providerConfigId: input.providerConfigId,
    tutorConfigId: input.tutorConfigId,
    contextPolicyId: input.contextPolicyId,
    retrievalConfigId: input.retrievalConfigId,
    memoryPolicyId: input.memoryPolicyId,
    memoryId: input.memoryId,
  })) nullableId(value, `Telemetry ${name}`, ID_PATTERN);
  for (const [name, value] of Object.entries({
    modelConfigRevision: input.modelConfigRevision,
    providerConfigRevision: input.providerConfigRevision,
    tutorConfigRevision: input.tutorConfigRevision,
    contextPolicyRevision: input.contextPolicyRevision,
    retrievalConfigRevision: input.retrievalConfigRevision,
    memoryPolicyRevision: input.memoryPolicyRevision,
    memoryRevision: input.memoryRevision,
  })) nullablePositiveInteger(value, `Telemetry ${name}`);
  if (input.failureCode !== undefined && input.failureCode !== null && !AI_TELEMETRY_FAILURE_CODES.includes(input.failureCode)) throw new Error("Telemetry failure code is unsupported.");
  for (const [name, value] of Object.entries({
    durationMs: input.durationMs,
    providerLatencyMs: input.providerLatencyMs,
    firstTokenLatencyMs: input.firstTokenLatencyMs,
  })) nullableBoundedInteger(value, 0, AI_TELEMETRY_MAX_DURATION_MS, `Telemetry ${name}`);
  for (const [name, value] of Object.entries({
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    reasoningTokens: input.reasoningTokens,
    knownCostNano: input.knownCostNano,
  })) nullableBoundedInteger(value, 0, Number.MAX_SAFE_INTEGER, `Telemetry ${name}`);
  for (const [name, value] of Object.entries({
    retrievalCandidateCount: input.retrievalCandidateCount,
    retrievalSelectedEvidenceCount: input.retrievalSelectedEvidenceCount,
  })) nullableBoundedInteger(value, 0, AI_TELEMETRY_MAX_COUNT, `Telemetry ${name}`);
  if (input.retrievalRerankerUsed !== undefined && input.retrievalRerankerUsed !== null && typeof input.retrievalRerankerUsed !== "boolean") throw new Error("Telemetry reranker flag is invalid.");
  if (input.memoryScope !== undefined && input.memoryScope !== null && !AI_TELEMETRY_MEMORY_SCOPES.includes(input.memoryScope)) throw new Error("Telemetry Memory scope is unsupported.");
  if (input.memoryKind !== undefined && input.memoryKind !== null && !AI_TELEMETRY_MEMORY_KINDS.includes(input.memoryKind)) throw new Error("Telemetry Memory kind is unsupported.");
  if (input.memoryOrigin !== undefined && input.memoryOrigin !== null && !AI_TELEMETRY_MEMORY_ORIGINS.includes(input.memoryOrigin)) throw new Error("Telemetry Memory origin is unsupported.");
  if (input.memoryAction !== undefined && input.memoryAction !== null && !AI_TELEMETRY_MEMORY_ACTIONS.includes(input.memoryAction as AITelemetryMemoryAction)) throw new Error("Telemetry Memory action is unsupported.");
  if (!Number.isSafeInteger(input.occurredAt) || input.occurredAt < 0 || input.occurredAt > MAX_TIMESTAMP) throw new Error("Telemetry timestamp is invalid.");
  return { ...input, eventVersion, privacyClass };
}

export function validateFeedbackInput(input: AIFeedbackInput): void {
  if (!input || typeof input !== "object") throw new Error("Feedback input is invalid.");
  boundedText(input.dedupeKey, AI_TELEMETRY_MAX_DEDUPE_KEY_BYTES, "Feedback dedupe key");
  boundedText(input.responseId, AI_TELEMETRY_MAX_EVENT_ID_BYTES, "Feedback response id");
  if (!PRINCIPAL_PATTERN.test(input.principalRef)) throw new Error("Feedback principal reference is invalid.");
  if (!AI_TELEMETRY_FEEDBACK_TYPES.includes(input.feedbackType)) throw new Error("Feedback type is unsupported.");
  if (input.reasonCode !== undefined && input.reasonCode !== null && !AI_TELEMETRY_FEEDBACK_REASON_CODES.includes(input.reasonCode)) throw new Error("Feedback reason code is unsupported.");
  const surface = input.sourceSurface ?? "TUTOR";
  if (!AI_TELEMETRY_FEEDBACK_SURFACES.includes(surface)) throw new Error("Feedback source surface is unsupported.");
  if (!Number.isSafeInteger(input.occurredAt) || input.occurredAt < 0 || input.occurredAt > MAX_TIMESTAMP) throw new Error("Feedback timestamp is invalid.");
}

export function validateReadRange(input: { from: number; to: number; subjectKey?: string }): void {
  if (!Number.isSafeInteger(input.from) || !Number.isSafeInteger(input.to) || input.from < 0 || input.to < input.from || input.to - input.from > AI_TELEMETRY_MAX_TIME_RANGE_MS) throw new Error("Telemetry read range is invalid.");
  if (input.subjectKey !== undefined && !SUBJECT_PATTERN.test(input.subjectKey)) throw new Error("Telemetry read subject is invalid.");
}

export function utcBuckets(at: number): { day: string; week: string; month: string } {
  if (!Number.isSafeInteger(at) || at < 0 || at > MAX_TIMESTAMP) throw new Error("Telemetry timestamp is invalid.");
  const date = new Date(at);
  const day = date.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  const week = `${thursday.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
  if (!BUCKET_DAY_PATTERN.test(day) || !BUCKET_MONTH_PATTERN.test(month) || !BUCKET_WEEK_PATTERN.test(week)) throw new Error("Telemetry UTC bucket is invalid.");
  return { day, week, month };
}

function boundedText(value: string, maxBytes: number, label: string): void {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > maxBytes || !ID_PATTERN.test(value)) throw new Error(`${label} is invalid.`);
}

function nullableId(value: unknown, label: string, pattern: RegExp): void {
  if (value !== undefined && value !== null && (typeof value !== "string" || !pattern.test(value))) throw new Error(`${label} is invalid.`);
}

function nullablePositiveInteger(value: unknown, label: string): void {
  if (value !== undefined && value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > Number.MAX_SAFE_INTEGER)) throw new Error(`${label} is invalid.`);
}

function nullableBoundedInteger(value: unknown, min: number, max: number, label: string): void {
  if (value !== undefined && value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)) throw new Error(`${label} is invalid.`);
}
