import { v7 as uuidv7 } from "uuid";

import {
  describeAIReasoningControl,
  isAIReasoningEffort,
  type AIReasoningControl,
  type AIReasoningEffort,
} from "../../lib/ai-reasoning";
import type {
  AIProviderConfig,
} from "./configuration";
import {
  SQLiteAIProviderConfigRepository,
} from "./configuration";
import type { AIModelConfig } from "./model-registry";
import { SQLiteAIModelConfigRepository } from "./model-registry";
import {
  AIProviderGateway,
  AnthropicMessagesGenerationAdapter,
  OpenAIResponsesGenerationAdapter,
  OpenAICompatibleGenerationAdapter,
  ProviderAdapterRegistry,
  createProviderOutboundPolicy,
  isAIProviderGatewayError,
  type AIProviderErrorCode,
  type AIProviderHttpTransport,
  type NormalizedProviderUsage,
  type OutboundTargetPolicy,
} from "./gateway";
import type { ContentDatabase } from "../content/database";
import { createLocalAISecretStore } from "./secrets";
import type { AISecretStoreAdapter } from "./secrets";

export const EPHEMERAL_MODEL_CHAT_ERROR_CODES = [
  "AI_EPHEMERAL_CHAT_INVALID",
  "AI_EPHEMERAL_MODEL_NOT_FOUND",
  "AI_EPHEMERAL_MODEL_UNAVAILABLE",
  "AI_EPHEMERAL_PROVIDER_NOT_READY",
  "AI_EPHEMERAL_REASONING_UNSUPPORTED",
  "AI_EPHEMERAL_CHAT_FAILED",
] as const;

export type EphemeralModelChatErrorCode =
  (typeof EPHEMERAL_MODEL_CHAT_ERROR_CODES)[number];

export class EphemeralModelChatError extends Error {
  constructor(
    readonly code: EphemeralModelChatErrorCode,
    readonly providerErrorCode?: AIProviderErrorCode,
  ) {
    super("The temporary Model chat could not be completed.");
    this.name = "EphemeralModelChatError";
  }
}

export function isEphemeralModelChatError(
  value: unknown,
): value is EphemeralModelChatError {
  return value instanceof EphemeralModelChatError;
}

export interface EphemeralModelChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface EphemeralModelChatInput {
  modelId: string;
  messages: unknown;
  reasoningEffort?: unknown;
}

export interface EphemeralModelChatUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  cachedInputTokens: number | null;
  cacheMissInputTokens: number | null;
}

export interface EphemeralModelChatResult {
  text: string;
  usage: EphemeralModelChatUsage;
  latencyMs: number | null;
  reasoningControl: AIReasoningControl;
}

export interface EphemeralModelChatServiceOptions {
  secrets?: AISecretStoreAdapter;
  outboundPolicy?: OutboundTargetPolicy;
  transport?: AIProviderHttpTransport;
  clock?: () => number;
}

const MAX_CHAT_MESSAGES = 32;
const MAX_CHAT_MESSAGE_BYTES = 32 * 1024;
const MAX_CHAT_TOTAL_BYTES = 48 * 1024;
const MAX_CHAT_OUTPUT_BYTES = 512 * 1024;
const CHAT_TIMEOUT_MS = 60_000;

/**
 * The intentionally small, side-effect-free execution boundary for the
 * Admin's temporary raw-Model chat. It resolves one exact Model and invokes
 * the normal protocol Gateway without circuit, accounting, telemetry,
 * Conversation, Memory, Context, fallback, or retry dependencies.
 */
export class EphemeralModelChatService {
  private readonly providers: SQLiteAIProviderConfigRepository;
  private readonly models: SQLiteAIModelConfigRepository;
  private readonly secrets: AISecretStoreAdapter;
  private readonly outboundPolicy: OutboundTargetPolicy;
  private readonly transport?: AIProviderHttpTransport;
  private readonly clock: () => number;

  constructor(
    database: ContentDatabase,
    options: EphemeralModelChatServiceOptions = {},
  ) {
    this.providers = new SQLiteAIProviderConfigRepository(database);
    this.models = new SQLiteAIModelConfigRepository(database);
    this.secrets = options.secrets ?? createLocalAISecretStore(database);
    this.outboundPolicy = options.outboundPolicy ?? createProviderOutboundPolicy();
    this.transport = options.transport;
    this.clock = options.clock ?? Date.now;
  }

  static forDatabase(
    database: ContentDatabase,
    options: EphemeralModelChatServiceOptions = {},
  ): EphemeralModelChatService {
    return new EphemeralModelChatService(database, options);
  }

  async chat(
    input: EphemeralModelChatInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<EphemeralModelChatResult> {
    const model = this.models.getById(input.modelId);
    if (!model) {
      throw new EphemeralModelChatError("AI_EPHEMERAL_MODEL_NOT_FOUND");
    }
    const provider = this.providers.getById(model.providerConfigId);
    if (!provider) {
      throw new EphemeralModelChatError("AI_EPHEMERAL_MODEL_UNAVAILABLE");
    }
    this.assertReady(model, provider);

    const messages = validateMessages(input.messages);
    const reasoningEffort = validateReasoningEffort(input.reasoningEffort);
    const reasoningControl = describeAIReasoningControl({
      supportsReasoning: model.supportsReasoning,
      apiFormat: provider.apiFormat,
    });
    assertReasoningAllowed(reasoningControl, reasoningEffort);

    const startedAt = this.clock();
    const gateway = new AIProviderGateway(
      {
        providerConfigs: this.providers,
        modelConfigs: this.models,
        secrets: this.secrets,
        adapters: new ProviderAdapterRegistry([
          new OpenAICompatibleGenerationAdapter({
            outboundPolicy: this.outboundPolicy,
            transport: this.transport,
          }),
          new OpenAIResponsesGenerationAdapter({
            outboundPolicy: this.outboundPolicy,
            transport: this.transport,
          }),
          new AnthropicMessagesGenerationAdapter({
            outboundPolicy: this.outboundPolicy,
            transport: this.transport,
          }),
        ]),
      },
      {
        defaultTimeoutMs: CHAT_TIMEOUT_MS,
        maxTimeoutMs: CHAT_TIMEOUT_MS,
        clock: this.clock,
      },
    );
    const stream = gateway.generate(
      { capability: "GENERATION", attempts: [model.id] },
      {
        requestId: uuidv7(),
        messages,
        maxOutputTokens: Math.min(model.maxOutputTokens ?? 4096, 4096),
        ...(reasoningEffort === "AUTO"
          ? {}
          : { reasoningEffort }),
        stream: true,
      },
      {
        signal: options.signal,
        timeoutMs: CHAT_TIMEOUT_MS,
        expectedIdentity: {
          modelConfigId: model.id,
          modelConfigRevision: model.revision,
          providerConfigId: provider.id,
          providerConfigRevision: provider.revision,
          providerModelId: model.providerModelId,
          adapterKey: model.adapterKey,
        },
      },
    );

    let text = "";
    let outputBytes = 0;
    let latestUsage: NormalizedProviderUsage | null = null;
    try {
      for await (const event of stream.events) {
        if (event.type === "TEXT_DELTA") {
          outputBytes += Buffer.byteLength(event.text, "utf8");
          if (outputBytes > MAX_CHAT_OUTPUT_BYTES) {
            throw new EphemeralModelChatError(
              "AI_EPHEMERAL_CHAT_FAILED",
              "BAD_RESPONSE",
            );
          }
          text += event.text;
        } else if (event.type === "MEMORY_COMMAND") {
          // This boundary is deliberately raw-Model-only. A future adapter
          // emitting an Agent-1 command must fail closed rather than allowing
          // the temporary chat to carry hidden Memory semantics.
          throw new EphemeralModelChatError(
            "AI_EPHEMERAL_CHAT_FAILED",
            "INVALID_REQUEST",
          );
        } else if (event.type === "USAGE" || event.type === "COMPLETED") {
          latestUsage = event.usage;
        }
      }
      await stream.trace;
    } catch (error) {
      const trace = await stream.trace;
      if (error instanceof EphemeralModelChatError) throw error;
      const attempt = trace[trace.length - 1];
      const providerErrorCode = isAIProviderGatewayError(error)
        ? error.code
        : attempt?.errorCode ?? "UNKNOWN";
      throw new EphemeralModelChatError(
        "AI_EPHEMERAL_CHAT_FAILED",
        providerErrorCode,
      );
    }

    return {
      text,
      usage: usageDto(latestUsage),
      latencyMs: boundedDuration(this.clock() - startedAt),
      reasoningControl,
    };
  }

  private assertReady(model: AIModelConfig, provider: AIProviderConfig): void {
    if (
      model.capability !== "GENERATION" ||
      !model.enabled ||
      !model.supportsStreaming
    ) {
      throw new EphemeralModelChatError("AI_EPHEMERAL_MODEL_UNAVAILABLE");
    }
    if (!provider.enabled || !provider.credentialRef) {
      throw new EphemeralModelChatError("AI_EPHEMERAL_PROVIDER_NOT_READY");
    }
    const metadata = this.secrets.getMetadata(provider.credentialRef);
    if (!metadata || metadata.status !== "ACTIVE") {
      throw new EphemeralModelChatError("AI_EPHEMERAL_PROVIDER_NOT_READY");
    }
  }
}

function validateMessages(value: unknown): EphemeralModelChatMessage[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CHAT_MESSAGES) {
    throw new EphemeralModelChatError("AI_EPHEMERAL_CHAT_INVALID");
  }
  let totalBytes = 0;
  const messages: EphemeralModelChatMessage[] = [];
  for (const item of value) {
    if (!isRecord(item) || (item.role !== "user" && item.role !== "assistant")) {
      throw new EphemeralModelChatError("AI_EPHEMERAL_CHAT_INVALID");
    }
    if (
      typeof item.content !== "string" ||
      (item.role === "user" && !item.content.trim())
    ) {
      throw new EphemeralModelChatError("AI_EPHEMERAL_CHAT_INVALID");
    }
    const bytes = Buffer.byteLength(item.content, "utf8");
    if (bytes > MAX_CHAT_MESSAGE_BYTES) {
      throw new EphemeralModelChatError("AI_EPHEMERAL_CHAT_INVALID");
    }
    totalBytes += bytes;
    if (totalBytes > MAX_CHAT_TOTAL_BYTES) {
      throw new EphemeralModelChatError("AI_EPHEMERAL_CHAT_INVALID");
    }
    messages.push({ role: item.role, content: item.content });
  }
  if (messages[messages.length - 1]?.role !== "user") {
    throw new EphemeralModelChatError("AI_EPHEMERAL_CHAT_INVALID");
  }
  return messages;
}

function validateReasoningEffort(value: unknown): AIReasoningEffort {
  if (value === undefined) return "AUTO";
  if (!isAIReasoningEffort(value)) {
    throw new EphemeralModelChatError("AI_EPHEMERAL_CHAT_INVALID");
  }
  return value;
}

function assertReasoningAllowed(
  control: AIReasoningControl,
  effort: AIReasoningEffort,
): void {
  if (effort === "AUTO") return;
  if (!control.options.includes(effort)) {
    throw new EphemeralModelChatError("AI_EPHEMERAL_REASONING_UNSUPPORTED");
  }
}

function usageDto(usage: NormalizedProviderUsage | null): EphemeralModelChatUsage {
  const inputTokens = usage?.inputTokens ?? null;
  const outputTokens = usage?.outputTokens ?? null;
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      inputTokens !== null && outputTokens !== null
        ? inputTokens + outputTokens
        : null,
    reasoningTokens: usage?.reasoningTokens ?? null,
    cachedInputTokens: usage?.cacheHitInputTokens ?? null,
    cacheMissInputTokens: usage?.cacheMissInputTokens ?? null,
  };
}

function boundedDuration(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.round(value), 24 * 60 * 60 * 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
