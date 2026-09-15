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
    const payload = JSON.stringify({
      model: request.providerModelId,
      input: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      ...(request.instructions ? { instructions: request.instructions } : {}),
      ...(request.maxOutputTokens === undefined
        ? {}
        : { max_output_tokens: request.maxOutputTokens }),
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
    let finishReason: "STOP" | "LENGTH" | "CONTENT_FILTER" | "OTHER" = "OTHER";
    let latestUsage = emptyUsage();
    let outputBytes = 0;

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

      const text = typeof value.delta === "string"
        ? value.delta
        : typeof value.text === "string"
          ? value.text
          : "";
      if (text) {
        outputBytes = appendText(text, outputBytes);
        yield { type: "TEXT_DELTA", text };
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
        finishReason = mapFinishReason(
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
