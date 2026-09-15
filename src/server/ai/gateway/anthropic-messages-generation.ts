import {
  AI_ANTHROPIC_MESSAGES_GENERATION_ADAPTER_KEY,
  createProviderOutboundPolicy,
} from "./protocol";
import { NativeOpenAICompatibleHttpTransport } from "./openai-compatible-generation";
import {
  type AIProviderHttpTransport,
  type OutboundTargetPolicy,
} from "./transport";
import { AIProviderAdapterError } from "./errors";
import type {
  GenerationProviderRequest,
  ProviderAdapterExecutionContext,
  ProviderGenerationStreamEvent,
} from "./contracts";
import {
  appendText,
  assertGenerationRequestSize,
  drainGenerationBody,
  emptyUsage,
  mapFinishReason,
  mergeUsage,
  parseGenerationSse,
  parseJsonObject,
  providerId,
  providerUsage,
  requestGenerationProtocol,
  throwForGenerationHttpStatus,
  type GenerationProtocolDependencies,
} from "./generation-protocols";

export interface AnthropicMessagesGenerationAdapterDependencies {
  outboundPolicy: OutboundTargetPolicy;
  transport?: AIProviderHttpTransport;
}

export class AnthropicMessagesGenerationAdapter {
  readonly adapterKey = AI_ANTHROPIC_MESSAGES_GENERATION_ADAPTER_KEY;
  readonly capability = "GENERATION" as const;
  private readonly dependencies: GenerationProtocolDependencies;

  constructor(input: AnthropicMessagesGenerationAdapterDependencies) {
    this.dependencies = {
      outboundPolicy: input.outboundPolicy,
      transport: input.transport ?? new NativeOpenAICompatibleHttpTransport(),
    };
  }

  async *generate(
    request: GenerationProviderRequest,
    context: ProviderAdapterExecutionContext,
  ): AsyncIterable<ProviderGenerationStreamEvent> {
    if (request.reasoningEffort !== undefined && request.reasoningEffort !== "AUTO") {
      throw new AIProviderAdapterError("INVALID_REQUEST", { fallbackEligible: false });
    }
    const payload = JSON.stringify({
      model: request.providerModelId,
      max_tokens: request.maxOutputTokens ?? 16,
      messages: request.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({ role: message.role, content: message.content })),
      ...(request.instructions ? { system: request.instructions } : {}),
      ...(request.temperature === undefined
        ? {}
        : { temperature: request.temperature }),
      stream: true,
    });
    assertGenerationRequestSize(payload);

    const response = await requestGenerationProtocol(
      this.dependencies,
      context,
      {
        method: "POST",
        pathAndQuery: "v1/messages",
        headers: {
          "x-api-key": context.credential,
          "anthropic-version": "2023-06-01",
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        },
        body: Buffer.from(payload, "utf8"),
        signal: context.signal,
        timeoutMs: context.timeoutMs,
      },
    );

    try {
      throwForGenerationHttpStatus(response);
    } catch (error) {
      await drainGenerationBody(response.body);
      throw error;
    }

    let started = false;
    let completed = false;
    let providerRequestId: string | undefined;
    let finishReason: "STOP" | "LENGTH" | "CONTENT_FILTER" | "OTHER" = "OTHER";
    let latestUsage = emptyUsage();
    let outputBytes = 0;

    for await (const frame of parseGenerationSse(response.body, context.signal)) {
      if (frame.data === "[DONE]") {
        completed = true;
        break;
      }
      const value = parseJsonObject(frame.data);
      if (!started) {
        started = true;
        providerRequestId = isRecord(value.message)
          ? providerId(value.message.id)
          : undefined;
        yield { type: "STARTED", providerRequestId };
      }

      if (value.type === "message_start" && isRecord(value.message)) {
        providerRequestId = providerId(value.message.id) ?? providerRequestId;
        const usage = providerUsage(value.message.usage);
        if (usage) {
          latestUsage = mergeUsage(latestUsage, usage);
          yield { type: "USAGE", usage: latestUsage };
        }
      }
      if (
        value.type === "content_block_delta" &&
        isRecord(value.delta) &&
        value.delta.type === "text_delta" &&
        typeof value.delta.text === "string"
      ) {
        outputBytes = appendText(value.delta.text, outputBytes);
        yield { type: "TEXT_DELTA", text: value.delta.text };
      }
      if (value.type === "message_delta") {
        if (isRecord(value.delta)) {
          finishReason = mapFinishReason(value.delta.stop_reason);
        }
        const usage = providerUsage(value.usage);
        if (usage) {
          latestUsage = mergeUsage(latestUsage, usage);
          yield { type: "USAGE", usage: latestUsage };
        }
      }
      if (value.type === "message_stop") completed = true;
    }

    if (!started || !completed) {
      throw new AIProviderAdapterError("BAD_RESPONSE", {
        fallbackEligible: false,
      });
    }
    yield {
      type: "COMPLETED",
      finishReason,
      usage: latestUsage,
      providerRequestId,
    };
  }
}

export function createAnthropicMessagesGenerationAdapter(
  outboundPolicy: OutboundTargetPolicy = createProviderOutboundPolicy(),
) {
  return new AnthropicMessagesGenerationAdapter({ outboundPolicy });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
