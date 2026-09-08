import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_OPENAI_COMPATIBLE_GENERATION_ADAPTER_KEY,
  OpenAICompatibleGenerationAdapter,
  type AIProviderHttpTransport,
  type AIProviderHttpResponse,
  type ValidatedOutboundTarget,
  type ProviderGenerationStreamEvent,
} from "../src/server/ai/gateway";
import type { GenerationProviderRequest } from "../src/server/ai/gateway";

const target: ValidatedOutboundTarget = { url: "https://provider.example/v1", hostname: "provider.example", port: 443, resolvedAddresses: ["93.184.216.34"] };

class FakeTransport implements AIProviderHttpTransport {
  requestValue: Parameters<AIProviderHttpTransport["request"]>[1] | null = null;
  async request(_target: ValidatedOutboundTarget, request: Parameters<AIProviderHttpTransport["request"]>[1]): Promise<AIProviderHttpResponse> {
    this.requestValue = request;
    const body = [
      'data: {"id":"req-1","choices":[{"delta":{"content":"hello"}}]}',
      'data: {"id":"req-1","usage":{"prompt_tokens":12,"completion_tokens":3,"completion_tokens_details":{"reasoning_tokens":1}}}',
      'data: {"id":"req-1","choices":[{"finish_reason":"stop","delta":{}}],"usage":{"prompt_tokens":12,"completion_tokens":3}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    return { status: 200, headers: { "content-type": "text/event-stream" }, body: bytes(body) };
  }
}

const request: GenerationProviderRequest = { requestId: "request-1", providerModelId: "model-1", messages: [{ role: "user", content: "question" }], stream: true, maxOutputTokens: 40 };

test("OpenAI-compatible Generation adapter normalizes bounded SSE without leaking credentials", async () => {
  const transport = new FakeTransport();
  const adapter = new OpenAICompatibleGenerationAdapter({ transport, outboundPolicy: { validate: async (url) => ({ ...target, url: typeof url === "string" ? url : url.toString() }) } });
  const events: ProviderGenerationStreamEvent[] = [];
  for await (const event of adapter.generate(request, { signal: new AbortController().signal, credential: "TOP_SECRET_ADAPTER_KEY", providerBaseUrl: target.url, timeoutMs: 5_000 })) events.push(event);
  assert.equal(adapter.adapterKey, AI_OPENAI_COMPATIBLE_GENERATION_ADAPTER_KEY);
  assert.deepEqual(events.map((event) => event.type), ["STARTED", "TEXT_DELTA", "USAGE", "USAGE", "COMPLETED"]);
  assert.equal(events.find((event) => event.type === "TEXT_DELTA")?.text, "hello");
  const usage = events.find((event) => event.type === "COMPLETED");
  assert.equal(usage?.type, "COMPLETED");
  if (usage?.type === "COMPLETED") assert.deepEqual(usage.usage, { inputTokens: 12, outputTokens: 3, reasoningTokens: 1, cacheHitInputTokens: null, cacheMissInputTokens: null });
  assert.equal(transport.requestValue?.method, "POST");
  assert.equal(transport.requestValue?.pathAndQuery, "chat/completions");
  assert.equal(transport.requestValue?.headers?.Authorization, "Bearer TOP_SECRET_ADAPTER_KEY");
  assert.equal(new TextDecoder().decode(transport.requestValue?.body), "{\"model\":\"model-1\",\"messages\":[{\"role\":\"user\",\"content\":\"question\"}],\"max_tokens\":40,\"stream\":true,\"stream_options\":{\"include_usage\":true}}" );
  assert.equal(JSON.stringify(events).includes("TOP_SECRET_ADAPTER_KEY"), false);
});

function bytes(text: string): AsyncIterable<Uint8Array> {
  return (async function* () { yield new TextEncoder().encode(text); })();
}
