import { AI_KNOWLEDGE_TRUST_TIERS, type AIKnowledgeTrustTier } from "../knowledge/contracts";
import {
  AI_RETRIEVAL_CONFIG_MAX_EVIDENCE_BYTES,
  AI_RETRIEVAL_CONFIG_MAX_EVIDENCE_ITEMS,
  AI_RETRIEVAL_CONFIG_MAX_FUSION_CANDIDATES,
  AI_RETRIEVAL_CONFIG_MAX_LEXICAL_CANDIDATES,
  AI_RETRIEVAL_CONFIG_MAX_RERANK_CANDIDATES,
  AI_RETRIEVAL_CONFIG_MAX_SEMANTIC_CANDIDATES,
  AI_RETRIEVAL_CONFIG_MAX_SOURCE_ITEM_CHUNKS,
  AI_RETRIEVAL_RERANKER_FAILURE_BEHAVIORS,
  AI_RETRIEVAL_SEMANTIC_FAILURE_BEHAVIORS,
  type AIRetrievalConfigContent,
} from "./contracts";
import { AIRetrievalConfigError } from "./errors";

const KEY_PATTERN = /^[a-z][a-z0-9.-]{0,119}$/u;
const SUBJECT_PATTERN = /^[a-z][a-z0-9-]{0,79}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function normalizeAIRetrievalConfigContent(value: unknown): AIRetrievalConfigContent {
  if (!isRecord(value)) invalid("Retrieval Config content must be an object.");
  const allowedTrustTiers = normalizeTrustTiers(value.allowedTrustTiers);
  const content: AIRetrievalConfigContent = {
    key: key(value.key, "key"),
    subjectKey: subject(value.subjectKey),
    displayName: boundedText(value.displayName, "displayName", 200),
    enabled: booleanValue(value.enabled, "enabled"),
    embeddingModelConfigId: uuid(value.embeddingModelConfigId, "embeddingModelConfigId"),
    rerankModelConfigId: value.rerankModelConfigId === null ? null : uuid(value.rerankModelConfigId, "rerankModelConfigId"),
    lexicalCandidateLimit: boundedInteger(value.lexicalCandidateLimit, "lexicalCandidateLimit", 1, AI_RETRIEVAL_CONFIG_MAX_LEXICAL_CANDIDATES),
    semanticCandidateLimit: boundedInteger(value.semanticCandidateLimit, "semanticCandidateLimit", 1, AI_RETRIEVAL_CONFIG_MAX_SEMANTIC_CANDIDATES),
    fusionCandidateLimit: boundedInteger(value.fusionCandidateLimit, "fusionCandidateLimit", 1, AI_RETRIEVAL_CONFIG_MAX_FUSION_CANDIDATES),
    rerankCandidateLimit: boundedInteger(value.rerankCandidateLimit, "rerankCandidateLimit", 1, AI_RETRIEVAL_CONFIG_MAX_RERANK_CANDIDATES),
    evidenceItemLimit: boundedInteger(value.evidenceItemLimit, "evidenceItemLimit", 1, AI_RETRIEVAL_CONFIG_MAX_EVIDENCE_ITEMS),
    rrfConstant: boundedInteger(value.rrfConstant, "rrfConstant", 1, 10_000),
    lexicalWeightUnits: boundedInteger(value.lexicalWeightUnits, "lexicalWeightUnits", 1, 10_000),
    semanticWeightUnits: boundedInteger(value.semanticWeightUnits, "semanticWeightUnits", 1, 10_000),
    minimumFusedScoreUnits: boundedInteger(value.minimumFusedScoreUnits, "minimumFusedScoreUnits", 0, Number.MAX_SAFE_INTEGER),
    minimumEvidenceItemCount: boundedInteger(value.minimumEvidenceItemCount, "minimumEvidenceItemCount", 0, AI_RETRIEVAL_CONFIG_MAX_EVIDENCE_ITEMS),
    maximumEvidencePackBytes: boundedInteger(value.maximumEvidencePackBytes, "maximumEvidencePackBytes", 1, AI_RETRIEVAL_CONFIG_MAX_EVIDENCE_BYTES),
    maxEvidenceChunksPerSourceItem: boundedInteger(value.maxEvidenceChunksPerSourceItem, "maxEvidenceChunksPerSourceItem", 1, AI_RETRIEVAL_CONFIG_MAX_SOURCE_ITEM_CHUNKS),
    allowedTrustTiers,
    semanticFailureBehavior: enumValue(value.semanticFailureBehavior, AI_RETRIEVAL_SEMANTIC_FAILURE_BEHAVIORS, "semanticFailureBehavior"),
    rerankerFailureBehavior: enumValue(value.rerankerFailureBehavior, AI_RETRIEVAL_RERANKER_FAILURE_BEHAVIORS, "rerankerFailureBehavior"),
  };
  if (content.fusionCandidateLimit > content.lexicalCandidateLimit + content.semanticCandidateLimit) invalid("fusionCandidateLimit exceeds the bounded lexical and semantic candidate union.");
  if (content.rerankCandidateLimit > content.fusionCandidateLimit) invalid("rerankCandidateLimit exceeds fusionCandidateLimit.");
  if (content.evidenceItemLimit > content.rerankCandidateLimit) invalid("evidenceItemLimit exceeds rerankCandidateLimit.");
  if (content.minimumEvidenceItemCount > content.evidenceItemLimit) invalid("minimumEvidenceItemCount exceeds evidenceItemLimit.");
  return content;
}

function normalizeTrustTiers(value: unknown): AIKnowledgeTrustTier[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > AI_KNOWLEDGE_TRUST_TIERS.length) invalid("allowedTrustTiers must be a non-empty trust-tier subset.");
  const result: AIKnowledgeTrustTier[] = [];
  for (const item of value) {
    if (!AI_KNOWLEDGE_TRUST_TIERS.includes(item as AIKnowledgeTrustTier) || result.includes(item as AIKnowledgeTrustTier)) invalid("allowedTrustTiers contains an invalid or duplicate tier.");
    result.push(item as AIKnowledgeTrustTier);
  }
  return result;
}

function key(value: unknown, field: string): string {
  const result = boundedText(value, field, 120);
  if (!KEY_PATTERN.test(result)) invalid(`${field} is invalid.`);
  return result;
}

function subject(value: unknown): string {
  const result = boundedText(value, "subjectKey", 80);
  if (!SUBJECT_PATTERN.test(result)) invalid("subjectKey is invalid.");
  return result;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid(`${field} is invalid.`);
  return value;
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") invalid(`${field} is invalid.`);
  const result = value.normalize("NFKC").trim();
  if (!result || result.length > maximum) invalid(`${field} is invalid.`);
  return result;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(`${field} is invalid.`);
  return value;
}

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid(`${field} is invalid.`);
  return value as number;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) invalid(`${field} is invalid.`);
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message: string): never {
  throw new AIRetrievalConfigError("AI_RETRIEVAL_CONFIG_INVALID", message);
}
