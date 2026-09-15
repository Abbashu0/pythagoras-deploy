import {
  AI_PROVIDER_HTTP_LIMITS,
  type AIProviderHttpRequest,
  type AIProviderHttpResponse,
  type AIProviderHttpTransport,
  type OutboundTargetPolicy,
} from "./transport";
import { AIProviderAdapterError } from "./errors";
import type {
  NormalizedProviderUsage,
  ProviderAdapterExecutionContext,
} from "./contracts";

export const AI_GENERATION_MAX_REQUEST_BYTES = 512 * 1024;
export const AI_GENERATION_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export interface GenerationProtocolDependencies {
  outboundPolicy: OutboundTargetPolicy;
  transport: AIProviderHttpTransport;
}

export async function requestGenerationProtocol(
  dependencies: GenerationProtocolDependencies,
  context: ProviderAdapterExecutionContext,
  request: AIProviderHttpRequest,
): Promise<AIProviderHttpResponse> {
  if (!context.providerBaseUrl) throw new AIProviderAdapterError("CONFIGURATION");
  try {
    const target = await dependencies.outboundPolicy.validate(context.providerBaseUrl);
    return await dependencies.transport.request(target, {
      ...request,
      pathAndQuery: normaliseProtocolPath(
        context.providerBaseUrl,
        request.pathAndQuery,
      ),
    });
  } catch (error) {
    if (error instanceof AIProviderAdapterError) throw error;
    throw new AIProviderAdapterError(
      context.signal.aborted ? "CANCELLED" : "UNAVAILABLE",
    );
  }
}

export function assertGenerationRequestSize(payload: string): void {
  if (Buffer.byteLength(payload, "utf8") > AI_GENERATION_MAX_REQUEST_BYTES) {
    throw new AIProviderAdapterError("INVALID_REQUEST");
  }
}

export function throwForGenerationHttpStatus(
  response: AIProviderHttpResponse,
): void {
  if (response.status === 401 || response.status === 403) {
    throw new AIProviderAdapterError("AUTHENTICATION", {
      fallbackEligible: false,
    });
  }
  if (response.status === 408) throw new AIProviderAdapterError("TIMEOUT");
  if (response.status === 429) throw new AIProviderAdapterError("RATE_LIMITED");
  if (response.status >= 500 && response.status <= 599) {
    throw new AIProviderAdapterError("UNAVAILABLE");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new AIProviderAdapterError("INVALID_REQUEST", {
      fallbackEligible: false,
    });
  }
}

export async function drainGenerationBody(
  body: AsyncIterable<Uint8Array>,
): Promise<void> {
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > AI_PROVIDER_HTTP_LIMITS.maxResponseBodyBytes) break;
  }
}

export interface SseFrame {
  event: string | null;
  data: string;
}

export async function* parseGenerationSse(
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<SseFrame> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    if (signal.aborted) throw new AIProviderAdapterError("CANCELLED");
    buffer += decoder.decode(chunk, { stream: true });
    if (
      Buffer.byteLength(buffer, "utf8") >
      AI_PROVIDER_HTTP_LIMITS.maxStreamFrameBytes * 2
    ) {
      throw new AIProviderAdapterError("BAD_RESPONSE", {
        fallbackEligible: false,
      });
    }
    let boundary = buffer.match(/\r?\n\r?\n/u);
    while (boundary?.index !== undefined) {
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      const parsed = parseSseFrame(frame);
      if (parsed) yield parsed;
      boundary = buffer.match(/\r?\n\r?\n/u);
    }
  }
  const tail = buffer.trim();
  if (tail) {
    const parsed = parseSseFrame(tail);
    if (parsed) yield parsed;
  }
}

export function parseJsonObject(data: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(data);
    if (!isRecord(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new AIProviderAdapterError("BAD_RESPONSE", {
      fallbackEligible: false,
    });
  }
}

export function emptyUsage(): NormalizedProviderUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cacheHitInputTokens: null,
    cacheMissInputTokens: null,
  };
}

export function mergeUsage(
  previous: NormalizedProviderUsage,
  next: NormalizedProviderUsage,
): NormalizedProviderUsage {
  return {
    inputTokens: next.inputTokens ?? previous.inputTokens,
    outputTokens: next.outputTokens ?? previous.outputTokens,
    reasoningTokens: next.reasoningTokens ?? previous.reasoningTokens,
    cacheHitInputTokens: next.cacheHitInputTokens ?? previous.cacheHitInputTokens,
    cacheMissInputTokens:
      next.cacheMissInputTokens ?? previous.cacheMissInputTokens,
  };
}

export function providerUsage(value: unknown): NormalizedProviderUsage | null {
  if (!isRecord(value)) return null;
  const outputDetails = isRecord(value.output_tokens_details)
    ? value.output_tokens_details
    : null;
  const completionDetails = isRecord(value.completion_tokens_details)
    ? value.completion_tokens_details
    : null;
  const promptDetails = isRecord(value.prompt_tokens_details)
    ? value.prompt_tokens_details
    : null;
  return {
    inputTokens: safeToken(value.input_tokens ?? value.prompt_tokens),
    outputTokens: safeToken(value.output_tokens ?? value.completion_tokens),
    reasoningTokens: safeToken(
      outputDetails?.reasoning_tokens ?? completionDetails?.reasoning_tokens,
    ),
    cacheHitInputTokens: safeToken(
      promptDetails?.cached_tokens ?? value.cache_read_input_tokens,
    ),
    cacheMissInputTokens: safeToken(value.cache_creation_input_tokens),
  };
}

export function providerId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 240
    ? value
    : undefined;
}

export function appendText(text: string, outputBytes: number): number {
  const next = outputBytes + Buffer.byteLength(text, "utf8");
  if (next > AI_GENERATION_MAX_OUTPUT_BYTES) {
    throw new AIProviderAdapterError("BAD_RESPONSE", {
      fallbackEligible: false,
    });
  }
  return next;
}

export function mapFinishReason(
  value: unknown,
): "STOP" | "LENGTH" | "CONTENT_FILTER" | "OTHER" {
  if (value === "stop" || value === "end_turn" || value === "stop_sequence") {
    return "STOP";
  }
  if (value === "length" || value === "max_tokens") return "LENGTH";
  if (value === "content_filter" || value === "refusal") {
    return "CONTENT_FILTER";
  }
  return "OTHER";
}

function parseSseFrame(frame: string): SseFrame | null {
  const lines = frame.split(/\r?\n/gu);
  const event = lines
    .find((line) => line.startsWith("event:"))
    ?.slice("event:".length)
    .trim() ?? null;
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data ? { event, data } : null;
}

/** Prevent a pasted `/v1` prefix from becoming `/v1/v1/messages`. */
function normaliseProtocolPath(baseUrl: string, pathAndQuery: string): string {
  let basePath = "";
  try {
    basePath = new URL(baseUrl).pathname.replace(/\/+$/u, "").toLowerCase();
  } catch {
    return pathAndQuery;
  }
  const requested = pathAndQuery.replace(/^\/+/, "");
  const requestedLower = requested.toLowerCase();
  if (basePath.endsWith(`/${requestedLower}`)) return "";
  if (basePath.endsWith("/v1") && requestedLower.startsWith("v1/")) {
    return requested.slice(3);
  }
  return requested;
}

function safeToken(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
