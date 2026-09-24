import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import { createLocalAISecretStore } from "../secrets";
import {
  AIProviderGateway,
  AnthropicMessagesGenerationAdapter,
  createProviderOutboundPolicy,
  isAIProviderGatewayError,
  OpenAICompatibleGenerationAdapter,
  OpenAIResponsesGenerationAdapter,
  ProviderAdapterRegistry,
  type AIProviderHttpTransport,
  type GenerationMessage,
  type OutboundTargetPolicy,
} from "../gateway";
import { type AISecretStoreAdapter } from "../secrets";
import { SQLiteAIProviderConfigRepository } from "../configuration";
import { SQLiteAIModelConfigRepository } from "../model-registry";
import { AIAgent1RuntimeService } from "./service";

export type Agent1DevChatErrorCode =
  | "AGENT_1_DISABLED"
  | "AGENT_1_NOT_READY"
  | "CHAT_INVALID"
  | "CHAT_TOO_LARGE"
  | "PROVIDER_FAILED"
  | "RESPONSE_TOO_LARGE"
  | "CANCELLED";

export class Agent1DevChatError extends Error {
  constructor(
    readonly code: Agent1DevChatErrorCode,
    readonly providerCode?: string,
  ) {
    super("The temporary Agent 1 chat could not be completed.");
    this.name = "Agent1DevChatError";
  }
}

export interface Agent1DevChatServiceOptions {
  outboundPolicy?: OutboundTargetPolicy;
  transport?: AIProviderHttpTransport;
  secrets?: AISecretStoreAdapter;
  runtimeService?: AIAgent1RuntimeService;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

export interface Agent1DevChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const AGENT_1_DEV_CHAT_MAX_MESSAGES = 32;
export const AGENT_1_DEV_CHAT_MAX_TOTAL_BYTES = 48 * 1_024;
const MAX_MESSAGE_BYTES = 32 * 1_024;
const MAX_RESPONSE_BYTES = 64 * 1_024;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 2_048;

/**
 * Development-only, request-scoped Agent 1 execution. It reads the current
 * operator-owned route and uses the canonical Gateway, but never writes chat,
 * accounting, or telemetry records.
 */
export class Agent1DevChatService {
  private readonly models: SQLiteAIModelConfigRepository;
  private readonly providers: SQLiteAIProviderConfigRepository;
  private readonly runtime: AIAgent1RuntimeService;
  private readonly outboundPolicy: OutboundTargetPolicy;
  private readonly secrets: AISecretStoreAdapter;

  constructor(
    private readonly database: ContentDatabase,
    private readonly options: Agent1DevChatServiceOptions = {},
  ) {
    this.models = new SQLiteAIModelConfigRepository(database);
    this.providers = new SQLiteAIProviderConfigRepository(database);
    this.runtime = options.runtimeService ?? AIAgent1RuntimeService.forDatabase(database);
    this.outboundPolicy = options.outboundPolicy ?? createProviderOutboundPolicy();
    this.secrets = options.secrets ?? createLocalAISecretStore(database);
  }

  static forDatabase(
    database: ContentDatabase,
    options: Agent1DevChatServiceOptions = {},
  ): Agent1DevChatService {
    return new Agent1DevChatService(database, options);
  }

  async chat(
    input: { messages: unknown },
    options: { signal?: AbortSignal } = {},
  ): Promise<{ reply: string }> {
    const messages = validateMessages(input.messages);
    const route = this.runtime.getSnapshot();
    if (!route.config.enabled) throw new Agent1DevChatError("AGENT_1_DISABLED");
    if (!route.primary?.ready || !route.config.primaryModelConfigId) {
      throw new Agent1DevChatError("AGENT_1_NOT_READY");
    }

    const selectedIds = [
      route.config.primaryModelConfigId,
      ...route.config.fallbackModelConfigIds,
    ];
    const selectedModels = selectedIds.flatMap((id, index) => {
      const readiness = route.models.find((model) => model.id === id);
      const model = this.models.getById(id);
      const provider = model ? this.providers.getById(model.providerConfigId) : null;
      if (
        !readiness?.ready ||
        !model ||
        model.capability !== "GENERATION" ||
        !model.enabled ||
        !model.supportsStreaming ||
        !provider?.enabled ||
        !provider.credentialRef
      ) {
        if (index === 0) throw new Agent1DevChatError("AGENT_1_NOT_READY");
        return [];
      }
      return [{ id, model, provider }];
    });
    if (selectedModels.length === 0 || selectedModels[0]?.id !== selectedIds[0]) {
      throw new Agent1DevChatError("AGENT_1_NOT_READY");
    }

    const attempts = selectedModels.map(({ id }) => id);
    const configuredOutputLimits = selectedModels
      .map(({ model }) => model.maxOutputTokens)
      .filter((value): value is number =>
        value !== null && Number.isSafeInteger(value) && value > 0,
      );
    const maxOutputTokens = Math.min(
      this.options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      ...configuredOutputLimits,
    );
    const expectedIdentities = Object.fromEntries(
      selectedModels.map(({ id, model, provider }) => [
        id,
        {
          modelConfigId: model.id,
          modelConfigRevision: model.revision,
          providerConfigId: provider.id,
          providerConfigRevision: provider.revision,
          providerModelId: model.providerModelId,
          adapterKey: model.adapterKey,
        },
      ]),
    );

    const gateway = new AIProviderGateway(
      {
        providerConfigs: this.providers,
        modelConfigs: this.models,
        secrets: this.secrets,
        adapters: new ProviderAdapterRegistry([
          new OpenAICompatibleGenerationAdapter({
            outboundPolicy: this.outboundPolicy,
            transport: this.options.transport,
          }),
          new OpenAIResponsesGenerationAdapter({
            outboundPolicy: this.outboundPolicy,
            transport: this.options.transport,
          }),
          new AnthropicMessagesGenerationAdapter({
            outboundPolicy: this.outboundPolicy,
            transport: this.options.transport,
          }),
        ]),
      },
      {
        defaultTimeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxTimeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      },
    );

    const execution = gateway.generate(
      { capability: "GENERATION", attempts },
      {
        requestId: uuidv7(),
        messages,
        maxOutputTokens,
        stream: true,
      },
      {
        signal: options.signal,
        timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        expectedIdentities,
      },
    );

    let reply = "";
    let responseBytes = 0;
    try {
      for await (const event of execution.events) {
        if (event.type === "TEXT_DELTA") {
          responseBytes += Buffer.byteLength(event.text, "utf8");
          if (responseBytes > MAX_RESPONSE_BYTES) {
            throw new Agent1DevChatError("RESPONSE_TOO_LARGE");
          }
          reply += event.text;
        } else if (event.type === "MEMORY_COMMAND" || event.type === "TOOL_CALL_DELTA") {
          throw new Agent1DevChatError("PROVIDER_FAILED");
        }
      }
    } catch (error) {
      if (error instanceof Agent1DevChatError) throw error;
      if (options.signal?.aborted) throw new Agent1DevChatError("CANCELLED");
      if (isAIProviderGatewayError(error)) {
        throw new Agent1DevChatError("PROVIDER_FAILED", error.code);
      }
      throw new Agent1DevChatError("PROVIDER_FAILED");
    }

    if (!reply.trim()) throw new Agent1DevChatError("PROVIDER_FAILED", "EMPTY_RESPONSE");
    return { reply };
  }
}

function validateMessages(value: unknown): GenerationMessage[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > AGENT_1_DEV_CHAT_MAX_MESSAGES
  ) {
    throw new Agent1DevChatError("CHAT_INVALID");
  }

  let totalBytes = 0;
  const messages = value.map((item): GenerationMessage => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Agent1DevChatError("CHAT_INVALID");
    }
    const record = item as Record<string, unknown>;
    if (
      (record.role !== "user" && record.role !== "assistant") ||
      typeof record.content !== "string" ||
      !record.content.trim()
    ) {
      throw new Agent1DevChatError("CHAT_INVALID");
    }
    const bytes = Buffer.byteLength(record.content, "utf8");
    if (bytes > MAX_MESSAGE_BYTES) throw new Agent1DevChatError("CHAT_TOO_LARGE");
    totalBytes += bytes;
    if (totalBytes > AGENT_1_DEV_CHAT_MAX_TOTAL_BYTES) {
      throw new Agent1DevChatError("CHAT_TOO_LARGE");
    }
    return {
      role: record.role,
      content: record.content,
    };
  });

  if (messages[messages.length - 1]?.role !== "user") {
    throw new Agent1DevChatError("CHAT_INVALID");
  }
  return messages;
}
