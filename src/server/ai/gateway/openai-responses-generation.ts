import {
  AI_OPENAI_RESPONSES_GENERATION_ADAPTER_KEY,
  createProviderOutboundPolicy,
} from "./protocol";
import {
  NativeOpenAICompatibleHttpTransport,
} from "./openai-compatible-generation";
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

export interface OpenAIResponsesGenerationAdapterDependencies {
  outboundPolicy: OutboundTargetPolicy;
  transport?: AIProviderHttpTransport;
}

export class OpenAIResponsesGenerationAdapter {
  readonly adapterKey = AI_OPENAI_RESPONSES_GENERATION_ADAPTER_KEY;
  readonly capability = "GENERATION" as const;
  private readonly dependencies: GenerationProtocolDependencies;

  constructor(input: OpenAIResponsesGenerationAdapterDependencies) {
    this.dependencies = {
      outboundPolicy: input.outboundPolicy,
      transport: input.transport ?? new NativeOpenAICompatibleHttpTransport(),
    };
  }

  async *generate(
    request: GenerationProviderRequest,
    context: ProviderAdapterExecutionContext,
  ): AsyncIterable<ProviderGenerationStreamEvent> {
    const reasoningEffort = request.reasoningEffort === undefined || request.reasoningEffort === "AUTO"
      ? undefined
      : request.reasoningEffort;
    if (reasoningEffort !== undefined && !["LOW", "MEDIUM", "HIGH"].includes(reasoningEffort)) {
      throw new AIProviderAdapterError("INVALID_REQUEST", { fallbackEligible: false });
    }
    const payload = JSON.stringify({
      model: request.providerModelId,
      input: request.messages.flatMap(serializeResponsesInput),
      ...(request.instructions ? { instructions: request.instructions } : {}),
      ...(request.maxOutputTokens === undefined
        ? {}
        : { max_output_tokens: request.maxOutputTokens }),
      ...(reasoningEffort === undefined
        ? {}
        : { reasoning: { effort: reasoningEffort.toLowerCase() } }),
      ...(request.temperature === undefined
        ? {}
        : { temperature: request.temperature }),
      ...(request.tools === undefined
        ? {}
        : {
            tools: request.tools.map((tool) => ({
              type: "function",
              name: tool.function.name,
              ...(tool.function.description === undefined
                ? {}
                : { description: tool.function.description }),
              parameters: tool.function.parameters,
            })),
            tool_choice: "auto",
          }),
      stream: true,
    });
    assertGenerationRequestSize(payload);

    const response = await requestGenerationProtocol(
      this.dependencies,
      context,
      {
        method: "POST",
        pathAndQuery: "responses",
        headers: {
          Authorization: `Bearer ${context.credential}`,
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
    let responseRequestId: string | undefined;
    let finishReason: "STOP" | "LENGTH" | "CONTENT_FILTER" | "TOOL_USE" | "OTHER" = "OTHER";
    let latestUsage = emptyUsage();
    let outputBytes = 0;
    const toolBuffers = new Map<string, { callId: string; name?: string; arguments: string }>();
    let sawToolCall = false;

    for await (const frame of parseGenerationSse(response.body, context.signal)) {
      if (frame.data === "[DONE]") {
        completed = true;
        break;
      }
      const value = parseJsonObject(frame.data);
      const responseValue = isRecord(value.response) ? value.response : null;
      responseRequestId =
        providerId(value.id) ?? providerId(responseValue?.id) ?? responseRequestId;
      if (!started) {
        started = true;
        yield { type: "STARTED", providerRequestId: responseRequestId };
      }

      const usage = providerUsage(value.usage ?? responseValue?.usage);
      if (usage) {
        latestUsage = mergeUsage(latestUsage, usage);
        yield { type: "USAGE", usage: latestUsage };
      }

      const eventType = typeof value.type === "string" ? value.type : "";
      if (eventType === "response.output_item.added" || eventType === "response.output_item.done") {
        const item = isRecord(value.item) ? value.item : null;
        if (item?.type === "function_call") {
          const key = providerId(item.id) ?? providerId(item.call_id) ?? `tool-call-${toolBuffers.size}`;
          const callId = providerId(item.call_id) ?? key;
          const name = typeof item.name === "string" ? item.name : undefined;
          const fullArguments = typeof item.arguments === "string" ? item.arguments : "";
          const previous = toolBuffers.get(key)?.arguments ?? "";
          const argumentsDelta = fullArguments.startsWith(previous)
            ? fullArguments.slice(previous.length)
            : previous.length === 0
              ? fullArguments
              : "";
          toolBuffers.set(key, { callId, ...(name === undefined ? {} : { name }), arguments: fullArguments || previous });
          if (name !== undefined || argumentsDelta || item.call_id !== undefined) {
            sawToolCall = true;
            yield {
              type: "TOOL_CALL_DELTA",
              callId,
              index: toolBuffers.size - 1,
              ...(name === undefined ? {} : { name }),
              argumentsDelta,
            };
          }
        }
      }
      if (eventType === "response.function_call_arguments.delta" || eventType === "response.function_call_arguments.done") {
        const key = providerId(value.item_id) ?? providerId(value.call_id) ?? `tool-call-${toolBuffers.size}`;
        const previous = toolBuffers.get(key)?.arguments ?? "";
        const existing = toolBuffers.get(key);
        const callId = existing?.callId ?? providerId(value.call_id) ?? key;
        const name = existing?.name;
        const fullArguments = eventType.endsWith(".done") && typeof value.arguments === "string"
          ? value.arguments
          : null;
        const incoming = fullArguments ?? (typeof value.delta === "string" ? value.delta : "");
        const argumentsDelta = fullArguments !== null
          ? fullArguments.startsWith(previous)
            ? fullArguments.slice(previous.length)
            : previous.length === 0
              ? fullArguments
              : ""
          : incoming;
        toolBuffers.set(key, { callId, ...(name === undefined ? {} : { name }), arguments: fullArguments ?? `${previous}${incoming}` });
        if (argumentsDelta || value.call_id !== undefined || value.item_id !== undefined) {
          sawToolCall = true;
          yield {
            type: "TOOL_CALL_DELTA",
            callId,
            index: [...toolBuffers.keys()].indexOf(key),
            ...(name === undefined ? {} : { name }),
            argumentsDelta,
          };
        }
      }
      const reasoningEvent = eventType.startsWith("response.reasoning") &&
        (eventType.endsWith(".delta") || eventType.endsWith(".added"));
      const reasoningText = reasoningEvent
        ? extractReasoningText(value)
        : "";
      const toolArgumentsEvent = eventType.startsWith("response.function_call_arguments.");
      if (reasoningText) {
        outputBytes = appendText(reasoningText, outputBytes);
        yield { type: "REASONING_DELTA", text: reasoningText };
      } else if (!eventType.startsWith("response.reasoning") && !toolArgumentsEvent) {
        const text = typeof value.delta === "string"
          ? value.delta
          : typeof value.text === "string"
            ? value.text
            : "";
        if (text) {
          outputBytes = appendText(text, outputBytes);
          yield { type: "TEXT_DELTA", text };
        }
      }

      if (
        value.type === "response.completed" ||
        value.type === "response.done" ||
        value.type === "response.incomplete"
      ) {
        completed = true;
        const incompleteDetails = isRecord(responseValue?.incomplete_details)
          ? responseValue.incomplete_details
          : null;
        const output = Array.isArray(responseValue?.output) ? responseValue.output : [];
        const responseHasToolCall = output.some((item) => isRecord(item) && item.type === "function_call");
        finishReason = sawToolCall || responseHasToolCall
          ? "TOOL_USE"
          : mapFinishReason(
              incompleteDetails?.reason ??
                (responseValue?.status === "completed" ? "stop" : responseValue?.status),
            );
      }
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
      providerRequestId: responseRequestId,
    };
  }
}

export function createOpenAIResponsesGenerationAdapter(
  outboundPolicy: OutboundTargetPolicy = createProviderOutboundPolicy(),
) {
  return new OpenAIResponsesGenerationAdapter({ outboundPolicy });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractReasoningText(value: Record<string, unknown>): string {
  const part = isRecord(value.part) ? value.part : null;
  const summary = typeof value.summary === "string" ? value.summary : "";
  const text = typeof value.text === "string" ? value.text : "";
  const delta = typeof value.delta === "string" ? value.delta : "";
  const partText = typeof part?.text === "string" ? part.text : "";
  const partSummary = typeof part?.summary === "string" ? part.summary : "";
  return delta || text || partText || partSummary || summary;
}

function serializeResponsesInput(
  message: GenerationProviderRequest["messages"][number],
): Record<string, unknown>[] {
  if (message.role === "tool") {
    return [{
      type: "function_call_output",
      call_id: message.toolCallId,
      output: message.content,
    }];
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    const items: Record<string, unknown>[] = [];
    if (message.content) items.push({ role: "assistant", content: message.content });
    for (const toolCall of message.toolCalls) {
      items.push({
        type: "function_call",
        call_id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      });
    }
    return items;
  }
  return [{ role: message.role, content: message.content }];
}
