import type {
  AIModelCapability,
  AIModelConfigRepository,
} from "../model-registry";
import type {
  AIProviderConfigRepository,
} from "../configuration";
import type { AISecretStoreAdapter } from "../secrets";
import type { AICircuitBreaker } from "../circuit-breaker/contracts";

export const AI_PROVIDER_ERROR_CODES = [
  "CONFIGURATION",
  "CIRCUIT_OPEN",
  "AUTHENTICATION",
  "INVALID_REQUEST",
  "CAPABILITY_MISMATCH",
  "RATE_LIMITED",
  "TIMEOUT",
  "UNAVAILABLE",
  "BAD_RESPONSE",
  "CANCELLED",
  "SECRET_UNAVAILABLE",
  "UNKNOWN",
] as const;

export type AIProviderErrorCode = (typeof AI_PROVIDER_ERROR_CODES)[number];

export const AI_PROVIDER_ATTEMPT_STATUSES = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "TIMEOUT",
  "SKIPPED",
] as const;

export type AIProviderAttemptStatus =
  (typeof AI_PROVIDER_ATTEMPT_STATUSES)[number];

export interface NormalizedProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheHitInputTokens: number | null;
  cacheMissInputTokens: number | null;
}

export type GenerationMessageRole = "system" | "user" | "assistant";

/** Provider-neutral structural limits shared by planning and Gateway validation. */
export const AI_GATEWAY_MAX_GENERATION_MESSAGES = 128;
export const AI_GATEWAY_MAX_GENERATION_MESSAGE_BYTES = 256 * 1_024;
export const AI_GATEWAY_MAX_GENERATION_INSTRUCTIONS_BYTES = 256 * 1_024;
export const AI_GATEWAY_MAX_MEMORY_COMMAND_BYTES = 16 * 1_024;

export interface GenerationMessage {
  role: GenerationMessageRole;
  content: string;
}

export interface GenerationProviderRequest {
  requestId: string;
  providerModelId: string;
  instructions?: string;
  messages: readonly GenerationMessage[];
  /** Maximum generated-token ceiling, including provider-reported hidden reasoning usage. */
  maxOutputTokens?: number;
  reasoningEffort?: string;
  temperature?: number;
  stream: boolean;
}

/** Internal server request. The provider model identity is resolved by the Gateway. */
export interface GenerationGatewayRequest {
  requestId: string;
  instructions?: string;
  messages: readonly GenerationMessage[];
  /** Maximum generated-token ceiling that the adapter must enforce, including hidden reasoning usage. */
  maxOutputTokens?: number;
  reasoningEffort?: string;
  temperature?: number;
  stream: boolean;
}

export const GENERATION_FINISH_REASONS = [
  "STOP",
  "LENGTH",
  "CONTENT_FILTER",
  "OTHER",
] as const;

export type GenerationFinishReason = (typeof GENERATION_FINISH_REASONS)[number];

/** Adapter-facing events. Provider request identity is allowed only at this boundary. */
export type ProviderGenerationStreamEvent =
  | {
      type: "STARTED";
      providerRequestId?: string;
    }
  | {
      type: "TEXT_DELTA";
      text: string;
    }
  | {
      type: "MEMORY_COMMAND";
      command: Readonly<Record<string, unknown>>;
    }
  | {
      type: "USAGE";
      usage: NormalizedProviderUsage;
    }
  | {
      type: "COMPLETED";
      finishReason: GenerationFinishReason;
      usage: NormalizedProviderUsage;
      providerRequestId?: string;
    };

/** Gateway-facing Product stream. Provider attempt identity is deliberately absent. */
export type GatewayGenerationStreamEvent =
  | {
      type: "STARTED";
    }
  | {
      type: "TEXT_DELTA";
      text: string;
    }
  | {
      type: "MEMORY_COMMAND";
      command: Readonly<Record<string, unknown>>;
    }
  | {
      type: "USAGE";
      usage: NormalizedProviderUsage;
    }
  | {
      type: "COMPLETED";
      finishReason: GenerationFinishReason;
      usage: NormalizedProviderUsage;
    };

export interface EmbeddingProviderRequest {
  requestId: string;
  providerModelId: string;
  inputs: readonly string[];
  inputType: "QUERY" | "DOCUMENT";
}

export interface EmbeddingGatewayRequest {
  requestId: string;
  inputs: readonly string[];
  inputType: "QUERY" | "DOCUMENT";
}

export interface EmbeddingProviderResult {
  vectors: readonly (readonly number[])[];
  dimensions: number;
  usage: NormalizedProviderUsage;
  providerRequestId?: string;
}

export interface RerankCandidate {
  id: string;
  text: string;
}

export interface RerankProviderRequest {
  requestId: string;
  providerModelId: string;
  query: string;
  candidates: readonly RerankCandidate[];
  topK: number;
}

export interface RerankGatewayRequest {
  requestId: string;
  query: string;
  candidates: readonly RerankCandidate[];
  topK: number;
}

export interface RerankResultItem {
  candidateId: string;
  score: number;
  rank: number;
}

export interface RerankProviderResult {
  results: readonly RerankResultItem[];
  usage: NormalizedProviderUsage;
  providerRequestId?: string;
}

export interface ProviderAdapterExecutionContext {
  signal: AbortSignal;
  /** Plaintext is request-scoped and must never enter traces, errors, or logs. */
  credential: string;
  /** Canonical Provider URL resolved by the server; clients cannot supply it. */
  providerBaseUrl?: string;
  timeoutMs: number;
}

export interface GenerationProviderAdapter {
  readonly adapterKey: string;
  readonly capability: "GENERATION";
  generate(
    request: GenerationProviderRequest,
    context: ProviderAdapterExecutionContext,
  ): AsyncIterable<ProviderGenerationStreamEvent>;
}

export interface EmbeddingProviderAdapter {
  readonly adapterKey: string;
  readonly capability: "EMBEDDING";
  embed(
    request: EmbeddingProviderRequest,
    context: ProviderAdapterExecutionContext,
  ): Promise<EmbeddingProviderResult>;
}

export interface RerankerProviderAdapter {
  readonly adapterKey: string;
  readonly capability: "RERANK";
  rerank(
    request: RerankProviderRequest,
    context: ProviderAdapterExecutionContext,
  ): Promise<RerankProviderResult>;
}

export type AIProviderAdapter =
  | GenerationProviderAdapter
  | EmbeddingProviderAdapter
  | RerankerProviderAdapter;

/** Spelling retained as a descriptive alias for callers that use the gerund form. */
export type RerankingProviderAdapter = RerankerProviderAdapter;

export interface AIModelSelectionPlan {
  capability: AIModelCapability;
  /** Ordered server-owned model configuration IDs. */
  attempts: readonly string[];
}

export interface AIProviderAttemptTrace {
  gatewayRequestId: string;
  capability: AIModelCapability;
  attemptIndex: number;
  modelConfigId: string;
  modelConfigRevision: number | null;
  providerConfigId: string | null;
  providerConfigRevision: number | null;
  adapterKey: string | null;
  providerModelId: string | null;
  startedAt: number;
  completedAt: number | null;
  latencyMs: number | null;
  status: AIProviderAttemptStatus;
  providerInvoked: boolean;
  errorCode?: AIProviderErrorCode;
  providerRequestId?: string;
}

/**
 * Server-owned identity captured by a runtime plan. It deliberately excludes
 * credential references and secret versions; those remain Gateway-owned
 * operational details.
 */
export interface AIProviderAttemptIdentity {
  modelConfigId: string;
  modelConfigRevision: number;
  providerConfigId: string;
  providerConfigRevision: number;
  providerModelId: string;
  adapterKey: string;
}

export interface AIProviderGatewayStream {
  events: AsyncIterable<GatewayGenerationStreamEvent>;
  /** Resolves after the stream ends, including a failed stream. */
  trace: Promise<readonly AIProviderAttemptTrace[]>;
}

export interface AIProviderGatewayUnaryResult<T> {
  value: T;
  attempts: readonly AIProviderAttemptTrace[];
}

export interface AIProviderGatewayDependencies {
  providerConfigs: AIProviderConfigRepository;
  modelConfigs: AIModelConfigRepository;
  secrets: AISecretStoreAdapter;
  adapters: {
    require(adapterKey: string, capability: AIModelCapability): AIProviderAdapter;
  };
  circuitBreaker?: AICircuitBreaker;
}

export interface AIProviderGatewayOperationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Exact server-owned Model/Provider identity pinned by the runtime plan. */
  expectedIdentity?: Readonly<AIProviderAttemptIdentity>;
  /** Exact identity for each ordered fallback attempt, keyed by Model Config ID. */
  expectedIdentities?: Readonly<Record<string, Readonly<AIProviderAttemptIdentity>>>;
  /** Server-owned exact Circuit Breaker Policy reference; clients must never provide this. */
  circuitPolicy?: {
    policyId: string;
    policyRevision: number;
  };
}

export interface AIProviderGatewayOptions {
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  clock?: () => number;
  gatewayRequestIdFactory?: () => string;
}
