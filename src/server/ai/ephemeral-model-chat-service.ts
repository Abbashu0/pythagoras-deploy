import { v7 as uuidv7 } from "uuid";

import type {
  EphemeralChatMessage,
  EphemeralChatFinishReason,
  EphemeralChatStreamEvent,
  EphemeralChatUsage,
} from "../../lib/ephemeral-chat-contract";
import type { AIProviderConfig } from "./configuration";
import { SQLiteAIProviderConfigRepository } from "./configuration";
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
  type GenerationFinishReason,
  type GenerationMessage,
  type GenerationToolCall,
  type OutboundTargetPolicy,
} from "./gateway";
import type { ContentDatabase } from "../content/database";
import { createLocalAISecretStore } from "./secrets";
import type { AISecretStoreAdapter } from "./secrets";
import {
  executePythonInIsolatedWorker,
  type PythonExecutionResult,
} from "./ephemeral-python/executor";

export const EPHEMERAL_MODEL_CHAT_ERROR_CODES = [
  "AI_EPHEMERAL_CHAT_INVALID",
  "AI_EPHEMERAL_MODEL_NOT_FOUND",
  "AI_EPHEMERAL_MODEL_UNAVAILABLE",
  "AI_EPHEMERAL_PROVIDER_NOT_READY",
  "AI_EPHEMERAL_CHAT_FAILED",
] as const;

export type EphemeralModelChatErrorCode =
  (typeof EPHEMERAL_MODEL_CHAT_ERROR_CODES)[number];

export class EphemeralModelChatError extends Error {
  constructor(
    readonly code: EphemeralModelChatErrorCode,
    readonly providerErrorCode?: AIProviderErrorCode,
    readonly detailCode?: string,
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

export type EphemeralModelChatMessage = EphemeralChatMessage;
export type EphemeralModelChatStreamEvent = EphemeralChatStreamEvent;

export interface EphemeralModelChatInput {
  modelId: string;
  messages: unknown;
  pythonEnabled?: unknown;
}

export interface EphemeralModelChatResult {
  text: string;
  reasoningText: string;
  usage: EphemeralChatUsage;
  latencyMs: number | null;
  finishReason: EphemeralChatFinishReason;
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
export const MAX_PYTHON_CALLS_PER_TURN = 8;
export const MAX_PROVIDER_ROUNDS_PER_TURN = 10;
const MAX_TOOL_ARGUMENT_BYTES = 12 * 1024;

export const EPHEMERAL_PYTHON_TOOL_NAME = "python" as const;
export const EPHEMERAL_PYTHON_TOOL_DEFINITION = Object.freeze({
  type: "function" as const,
  function: {
    name: EPHEMERAL_PYTHON_TOOL_NAME,
    description:
      "Execute isolated Python for exact or numerical computation, symbolic mathematics, verification, statistics, and data manipulation. Each execution is stateless: previous imports, variables, and results are not preserved. Include all imports and recreate all required data in every call. Use Python only when computation improves accuracy.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "Python code to execute.",
        },
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
});

interface PreparedChat {
  model: AIModelConfig;
  provider: AIProviderConfig;
}

/** Side-effect-free raw-Model execution for the Admin diagnostic chat. */
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

  /** Performs all local validation synchronously before response headers exist. */
  stream(
    input: EphemeralModelChatInput,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<EphemeralModelChatStreamEvent> {
    const prepared = this.prepare(input);
    const pythonEnabled = validatePythonEnabled(input.pythonEnabled);
    return this.runStream(
      prepared,
      validateMessages(input.messages),
      pythonEnabled,
      options.signal,
    );
  }

  /** Consumes the same stream for focused server-side tests. */
  async chat(
    input: EphemeralModelChatInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<EphemeralModelChatResult> {
    let text = "";
    let reasoningText = "";
    let usage: EphemeralChatUsage | null = null;
    let latencyMs: number | null = null;
    let finishReason: EphemeralChatFinishReason = "UNKNOWN";
    for await (const event of this.stream(input, options)) {
      if (event.type === "text_delta") text += event.text;
      else if (event.type === "reasoning_delta") reasoningText += event.text;
      else if (event.type === "usage" || event.type === "completed") {
        usage = event.usage;
        if (event.type === "completed") {
          latencyMs = event.latencyMs;
          finishReason = event.finishReason;
        }
      }
    }
    return {
      text,
      reasoningText,
      usage: usage ?? emptyUsageDto(),
      latencyMs,
      finishReason,
    };
  }

  private prepare(input: EphemeralModelChatInput): PreparedChat {
    const model = this.models.getById(input.modelId);
    if (!model) throw new EphemeralModelChatError("AI_EPHEMERAL_MODEL_NOT_FOUND");
    const provider = this.providers.getById(model.providerConfigId);
    if (!provider) throw new EphemeralModelChatError("AI_EPHEMERAL_MODEL_UNAVAILABLE");
    if (model.capability !== "GENERATION" || !model.enabled || !model.supportsStreaming) {
      throw new EphemeralModelChatError("AI_EPHEMERAL_MODEL_UNAVAILABLE");
    }
    if (
      model.maxOutputTokens === null ||
      !Number.isSafeInteger(model.maxOutputTokens) ||
      model.maxOutputTokens < 1 ||
      (model.contextWindowTokens !== null && model.maxOutputTokens > model.contextWindowTokens)
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
    return { model, provider };
  }

  private async *runStream(
    prepared: PreparedChat,
    messages: readonly EphemeralModelChatMessage[],
    pythonEnabled: boolean,
    signal?: AbortSignal,
  ): AsyncGenerator<EphemeralModelChatStreamEvent> {
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
    const startedAt = this.clock();
    let outputBytes = 0;
    let totalUsage: NormalizedProviderUsage | null = null;
    let startedEmitted = false;
    let pythonCalls = 0;
    const history: GenerationMessage[] = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    for (let round = 0; round < MAX_PROVIDER_ROUNDS_PER_TURN; round += 1) {
      const providerStream = gateway.generate(
        { capability: "GENERATION", attempts: [prepared.model.id] },
        {
          requestId: uuidv7(),
          messages: history,
          maxOutputTokens: prepared.model.maxOutputTokens as number,
          ...(pythonEnabled
            ? {
                tools: [EPHEMERAL_PYTHON_TOOL_DEFINITION],
                toolChoice: "AUTO" as const,
              }
            : {}),
          stream: true,
        },
        {
          signal,
          timeoutMs: CHAT_TIMEOUT_MS,
          expectedIdentity: {
            modelConfigId: prepared.model.id,
            modelConfigRevision: prepared.model.revision,
            providerConfigId: prepared.provider.id,
            providerConfigRevision: prepared.provider.revision,
            providerModelId: prepared.model.providerModelId,
            adapterKey: prepared.model.adapterKey,
          },
        },
      );
      const toolCalls = new Map<string, GenerationToolCall & { index: number }>();
      let roundUsage: NormalizedProviderUsage | null = null;
      let finishReason: GenerationFinishReason = "OTHER";

      try {
        for await (const event of providerStream.events) {
          switch (event.type) {
            case "STARTED":
              if (!startedEmitted) {
                startedEmitted = true;
                yield { type: "started" };
              }
              break;
            case "REASONING_DELTA":
              outputBytes = observeOutputBytes(outputBytes, event.text);
              yield { type: "reasoning_delta", text: event.text };
              break;
            case "TEXT_DELTA":
              outputBytes = observeOutputBytes(outputBytes, event.text);
              yield { type: "text_delta", text: event.text };
              break;
            case "TOOL_CALL_DELTA": {
              const current = toolCalls.get(event.callId) ?? {
                id: event.callId,
                name: event.name ?? EPHEMERAL_PYTHON_TOOL_NAME,
                arguments: "",
                index: event.index,
              };
              const next = {
                ...current,
                name: event.name ?? current.name,
                arguments: current.arguments + event.argumentsDelta,
              };
              if (Buffer.byteLength(next.arguments, "utf8") > MAX_TOOL_ARGUMENT_BYTES) {
                throw new EphemeralModelChatError("AI_EPHEMERAL_CHAT_FAILED", "BAD_RESPONSE");
              }
              toolCalls.set(event.callId, next);
              yield {
                type: "tool_call",
                callId: event.callId,
                toolName: next.name,
                argumentsDelta: event.argumentsDelta,
              };
              break;
            }
            case "USAGE":
              roundUsage = event.usage;
              yield { type: "usage", usage: usageDto(addUsage(totalUsage, roundUsage)) };
              break;
            case "COMPLETED":
              roundUsage = event.usage;
              finishReason = event.finishReason;
              break;
            case "MEMORY_COMMAND":
              throw new EphemeralModelChatError("AI_EPHEMERAL_CHAT_FAILED", "INVALID_REQUEST");
          }
        }
        await providerStream.trace;
      } catch (error) {
        const trace = await providerStream.trace;
        if (error instanceof EphemeralModelChatError) throw error;
        const attempt = trace[trace.length - 1];
        const providerErrorCode = isAIProviderGatewayError(error)
          ? error.code
          : attempt?.errorCode ?? "UNKNOWN";
        const detailCode = pythonEnabled && providerErrorCode === "INVALID_REQUEST"
          ? "PYTHON_TOOL_UNSUPPORTED"
          : undefined;
        throw new EphemeralModelChatError("AI_EPHEMERAL_CHAT_FAILED", providerErrorCode, detailCode);
      }

      totalUsage = addUsage(totalUsage, roundUsage);
      const requiresToolRound = finishReason === "TOOL_USE" || toolCalls.size > 0;
      if (requiresToolRound) {
        const calls = [...toolCalls.values()].sort((left, right) => left.index - right.index);
        if (!pythonEnabled || calls.length === 0) {
          throw new EphemeralModelChatError("AI_EPHEMERAL_CHAT_FAILED", "BAD_RESPONSE");
        }
        if (round === MAX_PROVIDER_ROUNDS_PER_TURN - 1 || pythonCalls + calls.length > MAX_PYTHON_CALLS_PER_TURN) {
          throw new EphemeralModelChatError("AI_EPHEMERAL_CHAT_FAILED", undefined, "TOOL_LIMIT");
        }

        history.push({
          role: "assistant",
          content: "",
          toolCalls: calls.map(({ id, name, arguments: toolArguments }) => ({ id, name, arguments: toolArguments })),
        });
        for (const call of calls) {
          pythonCalls += 1;
          const parsed = parsePythonToolArguments(call.name, call.arguments);
          const code = parsed.code ?? "";
          yield {
            type: "tool_started",
            callId: call.id,
            toolName: call.name,
            code,
          };
          let result: PythonExecutionResult;
          try {
            result = parsed.code === null
              ? invalidPythonArgumentsResult(parsed.error ?? "The Python tool arguments were invalid.")
              : await executePythonInIsolatedWorker(parsed.code, { signal });
          } catch (error) {
            result = {
              status: "error",
              errorType: "PythonRuntimeError",
              message: "Python execution failed.",
              durationMs: 0,
            };
          }
          yield pythonResultEvent(call, result);
          history.push({
            role: "tool",
            toolCallId: call.id,
            content: JSON.stringify(toModelPythonResult(result)),
          });
        }
        continue;
      }

      yield {
        type: "completed",
        usage: usageDto(totalUsage),
        latencyMs: boundedDuration(this.clock() - startedAt),
        finishReason: normalizeFinishReason(finishReason),
      };
      return;
    }

    throw new EphemeralModelChatError("AI_EPHEMERAL_CHAT_FAILED", undefined, "TOOL_LIMIT");
  }
}

function parsePythonToolArguments(
  toolName: string,
  value: string,
): { code: string | null; error: string | null } {
  if (toolName !== EPHEMERAL_PYTHON_TOOL_NAME) {
    return { code: null, error: "The requested tool is not available in this chat." };
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || typeof parsed.code !== "string" || Object.keys(parsed).some((key) => key !== "code")) {
      return { code: null, error: "The Python tool arguments must contain only a code string." };
    }
    return { code: parsed.code, error: null };
  } catch {
    return { code: null, error: "The Python tool arguments were not valid JSON." };
  }
}

function invalidPythonArgumentsResult(message: string): PythonExecutionResult {
  return {
    status: "error",
    errorType: "InvalidArgumentsError",
    message,
    durationMs: 0,
  };
}

function pythonResultEvent(
  call: GenerationToolCall,
  result: PythonExecutionResult,
): EphemeralChatStreamEvent {
  return {
    type: "tool_result",
    callId: call.id,
    toolName: call.name,
    status: result.status,
    durationMs: result.durationMs,
    ...(result.stdout === undefined ? {} : { stdout: result.stdout }),
    ...(result.result === undefined ? {} : { result: result.result }),
    ...(result.stderr === undefined ? {} : { stderr: result.stderr }),
    ...(result.errorType === undefined ? {} : { errorType: result.errorType }),
    ...(result.message === undefined ? {} : { message: result.message }),
  };
}

function toModelPythonResult(result: PythonExecutionResult): Record<string, unknown> {
  return {
    status: result.status,
    ...(result.stdout === undefined ? {} : { stdout: result.stdout }),
    ...(result.result === undefined ? {} : { result: result.result }),
    ...(result.stderr === undefined ? {} : { stderr: result.stderr }),
    ...(result.errorType === undefined ? {} : { errorType: result.errorType }),
    ...(result.message === undefined ? {} : { message: result.message }),
    durationMs: result.durationMs,
  };
}

function addUsage(
  previous: NormalizedProviderUsage | null,
  next: NormalizedProviderUsage | null,
): NormalizedProviderUsage | null {
  if (!previous) return next;
  if (!next) return previous;
  return {
    inputTokens: addOptionalToken(previous.inputTokens, next.inputTokens),
    outputTokens: addOptionalToken(previous.outputTokens, next.outputTokens),
    reasoningTokens: addOptionalToken(previous.reasoningTokens, next.reasoningTokens),
    cacheHitInputTokens: addOptionalToken(previous.cacheHitInputTokens, next.cacheHitInputTokens),
    cacheMissInputTokens: addOptionalToken(previous.cacheMissInputTokens, next.cacheMissInputTokens),
  };
}

function addOptionalToken(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  const total = left + right;
  return Number.isSafeInteger(total) ? total : left;
}

function validatePythonEnabled(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "boolean") throw new EphemeralModelChatError("AI_EPHEMERAL_CHAT_INVALID");
  return value;
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
    if (typeof item.content !== "string" || (item.role === "user" && !item.content.trim())) {
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

function observeOutputBytes(current: number, text: string): number {
  const total = current + Buffer.byteLength(text, "utf8");
  if (total > MAX_CHAT_OUTPUT_BYTES) {
    throw new EphemeralModelChatError("AI_EPHEMERAL_CHAT_FAILED", "BAD_RESPONSE");
  }
  return total;
}

function usageDto(usage: NormalizedProviderUsage | null): EphemeralChatUsage {
  const inputTokens = usage?.inputTokens ?? null;
  const outputTokens = usage?.outputTokens ?? null;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
    reasoningTokens: usage?.reasoningTokens ?? null,
    cachedInputTokens: usage?.cacheHitInputTokens ?? null,
    cacheMissInputTokens: usage?.cacheMissInputTokens ?? null,
  };
}

function emptyUsageDto(): EphemeralChatUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    reasoningTokens: null,
    cachedInputTokens: null,
    cacheMissInputTokens: null,
  };
}

function normalizeFinishReason(
  value: GenerationFinishReason,
): EphemeralChatFinishReason {
  if (value === "STOP" || value === "LENGTH" || value === "CONTENT_FILTER" || value === "TOOL_USE") {
    return value;
  }
  return "UNKNOWN";
}

function boundedDuration(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.round(value), 24 * 60 * 60 * 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
