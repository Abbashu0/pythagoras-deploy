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
        .flatMap(serializeAnthropicMessage),
      ...(request.instructions ? { system: request.instructions } : {}),
      ...(request.temperature === undefined
        ? {}
        : { temperature: request.temperature }),
      ...(request.tools === undefined
        ? {}
        : {
            tools: request.tools.map((tool) => ({
              name: tool.function.name,
              ...(tool.function.description === undefined
                ? {}
                : { description: tool.function.description }),
              input_schema: tool.function.parameters,
            })),
            tool_choice: { type: "auto" },
          }),
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
    let finishReason: "STOP" | "LENGTH" | "CONTENT_FILTER" | "TOOL_USE" | "OTHER" = "OTHER";
    let latestUsage = emptyUsage();
    let outputBytes = 0;
    const toolBlocks = new Map<number, { callId: string; name: string; arguments: string }>();

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
      if (value.type === "content_block_start" && isRecord(value.content_block) && value.content_block.type === "tool_use") {
        const index = typeof value.index === "number" && Number.isSafeInteger(value.index) && value.index >= 0 ? value.index : toolBlocks.size;
        const callId = typeof value.content_block.id === "string" && value.content_block.id.length > 0
          ? value.content_block.id
          : `tool-call-${index}`;
        const name = typeof value.content_block.name === "string" ? value.content_block.name : "python";
        const input = isRecord(value.content_block.input) && Object.keys(value.content_block.input).length > 0
          ? JSON.stringify(value.content_block.input)
          : "";
        toolBlocks.set(index, { callId, name, arguments: input });
        yield {
          type: "TOOL_CALL_DELTA",
          callId,
          index,
          name,
          argumentsDelta: input,
        };
      }
      if (
        value.type === "content_block_delta" &&
        isRecord(value.delta) &&
        value.delta.type === "thinking_delta" &&
        typeof value.delta.thinking === "string"
      ) {
        outputBytes = appendText(value.delta.thinking, outputBytes);
        yield { type: "REASONING_DELTA", text: value.delta.thinking };
      } else if (
        value.type === "content_block_delta" &&
        isRecord(value.delta) &&
        value.delta.type === "input_json_delta" &&
        typeof value.delta.partial_json === "string"
      ) {
        const index = typeof value.index === "number" && Number.isSafeInteger(value.index) && value.index >= 0 ? value.index : 0;
        const tool = toolBlocks.get(index);
        if (tool) {
          tool.arguments += value.delta.partial_json;
          yield {
            type: "TOOL_CALL_DELTA",
            callId: tool.callId,
            index,
            name: tool.name,
            argumentsDelta: value.delta.partial_json,
          };
        }
      } else if (
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

function serializeAnthropicMessage(
  message: GenerationProviderRequest["messages"][number],
): Record<string, unknown>[] {
  if (message.role === "tool") {
    return [{
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
      }],
    }];
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    const content: Record<string, unknown>[] = [];
    if (message.content) content.push({ type: "text", text: message.content });
    for (const toolCall of message.toolCalls) {
      let input: unknown = {};
      try {
        input = JSON.parse(toolCall.arguments);
      } catch {
        input = {};
      }
      content.push({ type: "tool_use", id: toolCall.id, name: toolCall.name, input });
    }
    return [{ role: "assistant", content }];
  }
  return [{ role: message.role, content: message.content }];
}
