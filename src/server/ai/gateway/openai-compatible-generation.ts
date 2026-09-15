import { lookup } from "node:dns/promises";
import { AI_PROVIDER_HTTP_LIMITS, StrictOutboundTargetPolicy, type AIProviderHttpResponse, type AIProviderHttpTransport, type OutboundTargetPolicy, type ValidatedOutboundTarget } from "./transport";
import { AIProviderAdapterError } from "./errors";
import type { GenerationProviderRequest, NormalizedProviderUsage, ProviderAdapterExecutionContext, ProviderGenerationStreamEvent } from "./contracts";

export const AI_OPENAI_COMPATIBLE_GENERATION_ADAPTER_KEY = "openai-compatible-generation-v1" as const;
export const AI_OPENAI_COMPATIBLE_GENERATION_MAX_REQUEST_BYTES = 512 * 1024;
export const AI_OPENAI_COMPATIBLE_GENERATION_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export interface OpenAICompatibleGenerationAdapterDependencies {
  outboundPolicy: OutboundTargetPolicy;
  transport?: AIProviderHttpTransport;
}

/**
 * Provider-neutral OpenAI-compatible streaming adapter. Provider-specific
 * policy stays in the canonical Provider URL and the selected adapter key;
 * credentials and URLs are supplied only by the server-owned Gateway.
 */
export class OpenAICompatibleGenerationAdapter {
  readonly adapterKey = AI_OPENAI_COMPATIBLE_GENERATION_ADAPTER_KEY;
  readonly capability = "GENERATION" as const;
  private readonly transport: AIProviderHttpTransport;

  constructor(private readonly dependencies: OpenAICompatibleGenerationAdapterDependencies) {
    this.transport = dependencies.transport ?? new NativeOpenAICompatibleHttpTransport();
  }

  async *generate(request: GenerationProviderRequest, context: ProviderAdapterExecutionContext): AsyncIterable<ProviderGenerationStreamEvent> {
    if (!context.providerBaseUrl) throw new AIProviderAdapterError("CONFIGURATION");
    const reasoningEffort = request.reasoningEffort === undefined || request.reasoningEffort === "AUTO"
      ? undefined
      : request.reasoningEffort;
    if (reasoningEffort !== undefined && !["NONE", "LOW", "MEDIUM", "HIGH"].includes(reasoningEffort)) {
      throw new AIProviderAdapterError("INVALID_REQUEST", { fallbackEligible: false });
    }
    const target = await this.dependencies.outboundPolicy.validate(context.providerBaseUrl);
    const payload = JSON.stringify({
      model: request.providerModelId,
      messages: request.instructions ? [{ role: "system", content: request.instructions }, ...request.messages] : request.messages,
      ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
      ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort.toLowerCase() }),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      stream: true,
      stream_options: { include_usage: true },
    });
    if (Buffer.byteLength(payload, "utf8") > AI_OPENAI_COMPATIBLE_GENERATION_MAX_REQUEST_BYTES) throw new AIProviderAdapterError("INVALID_REQUEST");

    let response: AIProviderHttpResponse;
    try {
      response = await this.transport.request(target, {
        method: "POST",
        pathAndQuery: "chat/completions",
        headers: { Authorization: `Bearer ${context.credential}`, Accept: "text/event-stream", "Content-Type": "application/json" },
        body: Buffer.from(payload, "utf8"),
        signal: context.signal,
        timeoutMs: context.timeoutMs,
      });
    } catch (error) {
      throw mapTransportError(error, context.signal);
    }

    if (response.status === 401 || response.status === 403) { await drain(response.body); throw new AIProviderAdapterError("AUTHENTICATION", { fallbackEligible: false }); }
    if (response.status === 408) { await drain(response.body); throw new AIProviderAdapterError("TIMEOUT"); }
    if (response.status === 429) { await drain(response.body); throw new AIProviderAdapterError("RATE_LIMITED"); }
    if (response.status >= 500 && response.status <= 599) { await drain(response.body); throw new AIProviderAdapterError("UNAVAILABLE"); }
    if (response.status < 200 || response.status >= 300) { await drain(response.body); throw new AIProviderAdapterError("INVALID_REQUEST", { fallbackEligible: false }); }

    let started = false;
    let completed = false;
    let providerRequestId: string | undefined;
    let finishReason: "STOP" | "LENGTH" | "CONTENT_FILTER" | "OTHER" = "OTHER";
    let latestUsage: NormalizedProviderUsage = emptyUsage();
    let outputBytes = 0;

    for await (const data of parseSse(response.body, context.signal)) {
      if (data === "[DONE]") {
        completed = true;
        break;
      }
      let value: unknown;
      try { value = JSON.parse(data); } catch { throw new AIProviderAdapterError("BAD_RESPONSE", { fallbackEligible: false }); }
      if (!isRecord(value)) throw new AIProviderAdapterError("BAD_RESPONSE", { fallbackEligible: false });
      const id = safeProviderId(value.id);
      if (id) providerRequestId = id;
      if (!started) { started = true; yield { type: "STARTED", providerRequestId }; }

      const usage = normalizeUsage(value.usage);
      if (usage) { latestUsage = mergeUsage(latestUsage, usage); yield { type: "USAGE", usage: latestUsage }; }
      const choices = Array.isArray(value.choices) ? value.choices : [];
      const first = choices[0];
      if (isRecord(first)) {
        const delta = isRecord(first.delta) ? first.delta : null;
        const text = delta && typeof delta.content === "string" ? delta.content : "";
        if (text) {
          outputBytes += Buffer.byteLength(text, "utf8");
          if (outputBytes > AI_OPENAI_COMPATIBLE_GENERATION_MAX_OUTPUT_BYTES) throw new AIProviderAdapterError("BAD_RESPONSE", { fallbackEligible: false });
          yield { type: "TEXT_DELTA", text };
        }
        if (typeof first.finish_reason === "string") finishReason = mapFinishReason(first.finish_reason);
      }
    }

    if (!started || !completed) throw new AIProviderAdapterError("BAD_RESPONSE", { fallbackEligible: false });
    yield { type: "COMPLETED", finishReason, usage: latestUsage, providerRequestId };
  }
}

export class NativeOpenAICompatibleHttpTransport implements AIProviderHttpTransport {
  async request(target: ValidatedOutboundTarget, request: Parameters<AIProviderHttpTransport["request"]>[1]): Promise<AIProviderHttpResponse> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, request.timeoutMs);
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    try {
      const base = target.url.endsWith("/") ? target.url : `${target.url}/`;
      const url = new URL(request.pathAndQuery.replace(/^\/+/, ""), base);
      const response = await fetch(url, { method: request.method, headers: request.headers, body: request.body ? Buffer.from(request.body) : undefined, redirect: "error", signal: controller.signal });
      const cleanup = () => { clearTimeout(timer); request.signal.removeEventListener("abort", abort); };
      return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body: response.body ? responseChunks(response.body, cleanup) : emptyBody(cleanup) };
    } catch (error) {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
      if (timedOut) throw new AIProviderAdapterError("TIMEOUT");
      if (request.signal.aborted) throw new AIProviderAdapterError("CANCELLED");
      if (error instanceof AIProviderAdapterError) throw error;
      throw new AIProviderAdapterError("UNAVAILABLE");
    }
  }
}

export function createOpenAICompatibleGenerationAdapter(outboundPolicy: OutboundTargetPolicy = new StrictOutboundTargetPolicy(new NodeDnsAddressResolver())) {
  return new OpenAICompatibleGenerationAdapter({ outboundPolicy });
}

function mapTransportError(error: unknown, signal: AbortSignal): AIProviderAdapterError {
  if (error instanceof AIProviderAdapterError) return error;
  return new AIProviderAdapterError(signal.aborted ? "CANCELLED" : "UNAVAILABLE");
}

async function drain(body: AsyncIterable<Uint8Array>): Promise<void> {
  let bytes = 0;
  for await (const chunk of body) { bytes += chunk.byteLength; if (bytes > AI_PROVIDER_HTTP_LIMITS.maxResponseBodyBytes) break; }
}

async function* responseChunks(body: ReadableStream<Uint8Array>, onDone: () => void): AsyncIterable<Uint8Array> {
  const reader = body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > AI_PROVIDER_HTTP_LIMITS.maxResponseBodyBytes) throw new AIProviderAdapterError("BAD_RESPONSE", { fallbackEligible: false });
      yield next.value;
    }
  } finally { reader.releaseLock(); onDone(); }
}

async function* emptyBody(onDone: () => void): AsyncIterable<Uint8Array> { onDone(); }

async function* parseSse(body: AsyncIterable<Uint8Array>, signal: AbortSignal): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    if (signal.aborted) throw new AIProviderAdapterError("CANCELLED");
    buffer += decoder.decode(chunk, { stream: true });
    if (Buffer.byteLength(buffer, "utf8") > AI_PROVIDER_HTTP_LIMITS.maxStreamFrameBytes * 2) throw new AIProviderAdapterError("BAD_RESPONSE", { fallbackEligible: false });
    let boundaryMatch = buffer.match(/\r?\n\r?\n/u);
    while (boundaryMatch?.index !== undefined) {
      const frame = buffer.slice(0, boundaryMatch.index);
      buffer = buffer.slice(boundaryMatch.index + boundaryMatch[0].length);
      const data = frame.split(/\r?\n/gu).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (data) yield data;
      boundaryMatch = buffer.match(/\r?\n\r?\n/u);
    }
  }
  const tail = buffer.trim();
  if (tail.startsWith("data:")) yield tail.slice(5).trim();
}

function emptyUsage(): NormalizedProviderUsage { return { inputTokens: null, outputTokens: null, reasoningTokens: null, cacheHitInputTokens: null, cacheMissInputTokens: null }; }
function mergeUsage(previous: NormalizedProviderUsage, next: NormalizedProviderUsage): NormalizedProviderUsage { return { inputTokens: next.inputTokens ?? previous.inputTokens, outputTokens: next.outputTokens ?? previous.outputTokens, reasoningTokens: next.reasoningTokens ?? previous.reasoningTokens, cacheHitInputTokens: next.cacheHitInputTokens ?? previous.cacheHitInputTokens, cacheMissInputTokens: next.cacheMissInputTokens ?? previous.cacheMissInputTokens }; }
function normalizeUsage(value: unknown): NormalizedProviderUsage | null { if (!isRecord(value)) return null; const details = isRecord(value.completion_tokens_details) ? value.completion_tokens_details : null; const promptDetails = isRecord(value.prompt_tokens_details) ? value.prompt_tokens_details : null; return { inputTokens: safeToken(value.prompt_tokens), outputTokens: safeToken(value.completion_tokens), reasoningTokens: safeToken(details?.reasoning_tokens), cacheHitInputTokens: safeToken(promptDetails?.cached_tokens), cacheMissInputTokens: null }; }
function safeToken(value: unknown): number | null { return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null; }
function safeProviderId(value: unknown): string | undefined { return typeof value === "string" && value.length > 0 && value.length <= 240 ? value : undefined; }
function mapFinishReason(value: string): "STOP" | "LENGTH" | "CONTENT_FILTER" | "OTHER" { return value === "stop" ? "STOP" : value === "length" ? "LENGTH" : value === "content_filter" ? "CONTENT_FILTER" : "OTHER"; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

class NodeDnsAddressResolver {
  async resolve(hostname: string): Promise<readonly string[]> {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
  }
}
