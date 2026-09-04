import { createHash } from "node:crypto";

import type { AIMemoryExecutionConfigContent } from "./execution-contracts";
import { AI_MEMORY_CONFIDENCE_SCALE } from "./contracts";
import { AI_MEMORY_EXECUTION_CONFIG_RESOURCE_TYPE } from "./execution-contracts";
import { AIMemoryExecutionConfigError } from "./execution-config-errors";

const KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const SUBJECT_PATTERN = /^[a-z0-9-]{1,80}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const AI_MEMORY_EXECUTION_CONFIG_MAX_TIMEOUT_MS = 120_000;
export const AI_MEMORY_EXECUTION_CONFIG_MAX_OUTPUT_TOKENS = 65_536;
export const AI_MEMORY_EXECUTION_CONFIG_MAX_CANDIDATES = 100;
export const AI_MEMORY_EXECUTION_CONFIG_MAX_MESSAGE_COUNT = 10_000;

export function normalizeAIMemoryExecutionConfigContent(value: unknown): AIMemoryExecutionConfigContent {
  if (!isRecord(value)) invalid("Memory Execution Config must be an object.");
  requireExactKeys(value, [
    "key", "subjectKey", "displayName", "enabled",
    "generationModelConfigId", "generationModelConfigRevision",
    "generationProviderConfigId", "generationProviderConfigRevision",
    "budgetPolicyId", "budgetPolicyRevision",
    "rateLimitPolicyId", "rateLimitPolicyRevision",
    "timeoutMs", "extractionMaxOutputTokens", "compactionMaxOutputTokens",
    "maxExtractionCandidates", "autoApprovalMinConfidenceUnits",
    "compactionTriggerMessageCount", "compactionRetainRecentMessageCount",
  ]);
  const content: AIMemoryExecutionConfigContent = {
    key: key(value.key, "key"),
    subjectKey: subject(value.subjectKey),
    displayName: text(value.displayName, "displayName", 200),
    enabled: booleanValue(value.enabled, "enabled"),
    generationModelConfigId: uuid(value.generationModelConfigId, "generationModelConfigId"),
    generationModelConfigRevision: positive(value.generationModelConfigRevision, "generationModelConfigRevision"),
    generationProviderConfigId: uuid(value.generationProviderConfigId, "generationProviderConfigId"),
    generationProviderConfigRevision: positive(value.generationProviderConfigRevision, "generationProviderConfigRevision"),
    budgetPolicyId: uuid(value.budgetPolicyId, "budgetPolicyId"),
    budgetPolicyRevision: positive(value.budgetPolicyRevision, "budgetPolicyRevision"),
    rateLimitPolicyId: uuid(value.rateLimitPolicyId, "rateLimitPolicyId"),
    rateLimitPolicyRevision: positive(value.rateLimitPolicyRevision, "rateLimitPolicyRevision"),
    timeoutMs: bounded(value.timeoutMs, "timeoutMs", 100, AI_MEMORY_EXECUTION_CONFIG_MAX_TIMEOUT_MS),
    extractionMaxOutputTokens: bounded(value.extractionMaxOutputTokens, "extractionMaxOutputTokens", 1, AI_MEMORY_EXECUTION_CONFIG_MAX_OUTPUT_TOKENS),
    compactionMaxOutputTokens: bounded(value.compactionMaxOutputTokens, "compactionMaxOutputTokens", 1, AI_MEMORY_EXECUTION_CONFIG_MAX_OUTPUT_TOKENS),
    maxExtractionCandidates: bounded(value.maxExtractionCandidates, "maxExtractionCandidates", 1, AI_MEMORY_EXECUTION_CONFIG_MAX_CANDIDATES),
    autoApprovalMinConfidenceUnits: bounded(value.autoApprovalMinConfidenceUnits, "autoApprovalMinConfidenceUnits", 0, AI_MEMORY_CONFIDENCE_SCALE),
    compactionTriggerMessageCount: bounded(value.compactionTriggerMessageCount, "compactionTriggerMessageCount", 2, AI_MEMORY_EXECUTION_CONFIG_MAX_MESSAGE_COUNT),
    compactionRetainRecentMessageCount: bounded(value.compactionRetainRecentMessageCount, "compactionRetainRecentMessageCount", 1, AI_MEMORY_EXECUTION_CONFIG_MAX_MESSAGE_COUNT - 1),
  };
  if (content.compactionTriggerMessageCount <= content.compactionRetainRecentMessageCount) invalid("compactionTriggerMessageCount must exceed compactionRetainRecentMessageCount.");
  return content;
}

export function fingerprintAIMemoryExecutionConfig(config: AIMemoryExecutionConfigContent & { executionConfigId: string; revision: number }): string {
  const value = {
    version: 1,
    resourceType: AI_MEMORY_EXECUTION_CONFIG_RESOURCE_TYPE,
    executionConfigId: config.executionConfigId,
    revision: config.revision,
    key: config.key,
    subjectKey: config.subjectKey,
    displayName: config.displayName,
    enabled: config.enabled,
    generationModelConfigId: config.generationModelConfigId,
    generationModelConfigRevision: config.generationModelConfigRevision,
    generationProviderConfigId: config.generationProviderConfigId,
    generationProviderConfigRevision: config.generationProviderConfigRevision,
    budgetPolicyId: config.budgetPolicyId,
    budgetPolicyRevision: config.budgetPolicyRevision,
    rateLimitPolicyId: config.rateLimitPolicyId,
    rateLimitPolicyRevision: config.rateLimitPolicyRevision,
    timeoutMs: config.timeoutMs,
    extractionMaxOutputTokens: config.extractionMaxOutputTokens,
    compactionMaxOutputTokens: config.compactionMaxOutputTokens,
    maxExtractionCandidates: config.maxExtractionCandidates,
    autoApprovalMinConfidenceUnits: config.autoApprovalMinConfidenceUnits,
    compactionTriggerMessageCount: config.compactionTriggerMessageCount,
    compactionRetainRecentMessageCount: config.compactionRetainRecentMessageCount,
  };
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) invalid("Memory Execution Config fields are invalid.");
}

function key(value: unknown, field: string): string {
  const normalized = text(value, field, 120).toLowerCase();
  if (!KEY_PATTERN.test(normalized)) invalid(`${field} is invalid.`);
  return normalized;
}

function subject(value: unknown): string {
  const normalized = text(value, "subjectKey", 80).toLowerCase();
  if (!SUBJECT_PATTERN.test(normalized)) invalid("subjectKey is invalid.");
  return normalized;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid(`${field} is invalid.`);
  return value;
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") invalid(`${field} must be text.`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > maxLength) invalid(`${field} is invalid.`);
  return normalized;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(`${field} is invalid.`);
  return value;
}

function positive(value: unknown, field: string): number {
  return bounded(value, field, 1, Number.MAX_SAFE_INTEGER);
}

function bounded(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid(`${field} is outside its safe bound.`);
  return value as number;
}

function invalid(message: string): never {
  throw new AIMemoryExecutionConfigError("AI_MEMORY_EXECUTION_CONFIG_INVALID", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
