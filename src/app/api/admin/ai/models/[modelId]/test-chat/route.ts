import type { NextRequest } from "next/server";
import {
  AI_OPENAI_COMPATIBLE_GENERATION_ADAPTER_KEY,
  AIProviderGateway,
  ProviderAdapterRegistry,
  createProviderOutboundPolicy,
  createOpenAICompatibleGenerationAdapter,
  isAIProviderGatewayError,
} from "@/server/ai/gateway";
import { assertAITrustedMutation, aiApiError, aiJson, readAIJson, requireAIAdmin } from "../../../_shared";
import { SQLiteAIModelConfigRepository } from "@/server/ai/model-registry";
import { SQLiteAIProviderConfigRepository } from "@/server/ai/configuration";
import { createLocalAISecretStore } from "@/server/ai/secrets";
import { getContentDatabase } from "@/server/content";
import { v7 as uuidv7 } from "uuid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_MESSAGES = 32;
const MAX_MESSAGE_BYTES = 64 * 1024;
const TEST_TIMEOUT_MS = 60_000;

export async function POST(request: NextRequest, context: { params: Promise<{ modelId: string }> }) {
  try {
    requireAIAdmin(request);
    assertAITrustedMutation(request);
    const { modelId } = await context.params;
    const body = await readAIJson(request, MAX_BODY_BYTES);
    const messages = parseMessages(body.messages);
    const database = getContentDatabase();
    const model = new SQLiteAIModelConfigRepository(database).getById(modelId);
    if (!model) return aiJson({ ok: false, code: "AI_MODEL_NOT_FOUND" }, { status: 404 });
    if (model.capability !== "GENERATION") return aiJson({ ok: false, code: "AI_MODEL_CAPABILITY_UNSUPPORTED" }, { status: 409 });
    if (model.adapterKey !== AI_OPENAI_COMPATIBLE_GENERATION_ADAPTER_KEY) return aiJson({ ok: false, code: "AI_MODEL_ADAPTER_UNSUPPORTED" }, { status: 409 });
    if (!model.enabled) return aiJson({ ok: false, code: "AI_MODEL_DISABLED" }, { status: 409 });

    const outboundPolicy = createProviderOutboundPolicy();
    const gateway = new AIProviderGateway({
      providerConfigs: new SQLiteAIProviderConfigRepository(database),
      modelConfigs: new SQLiteAIModelConfigRepository(database),
      secrets: createLocalAISecretStore(database),
      adapters: new ProviderAdapterRegistry([createOpenAICompatibleGenerationAdapter(outboundPolicy)]),
    }, { defaultTimeoutMs: TEST_TIMEOUT_MS, maxTimeoutMs: TEST_TIMEOUT_MS });
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    const gatewayStream = gateway.generate({ capability: "GENERATION", attempts: [model.id] }, { requestId: uuidv7(), messages, stream: true, maxOutputTokens: model.maxOutputTokens ?? undefined }, { signal: abortController.signal, timeoutMs: TEST_TIMEOUT_MS });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        void (async () => {
          try {
            for await (const event of gatewayStream.events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch (error) {
            const code = isAIProviderGatewayError(error) ? error.code : "UNKNOWN";
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "SAFE_ERROR", code })}\n\n`));
          } finally {
            request.signal.removeEventListener("abort", abort);
            controller.close();
          }
        })();
      },
      cancel() {
        abortController.abort();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    if (error instanceof Error && error.message === "AI_TEST_CHAT_MESSAGES_INVALID") return aiJson({ ok: false, code: error.message }, { status: 400 });
    return aiApiError(error);
  }
}

function parseMessages(value: unknown): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MESSAGES) throw new Error("AI_TEST_CHAT_MESSAGES_INVALID");
  const messages = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("AI_TEST_CHAT_MESSAGES_INVALID");
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "system" && role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim() || Buffer.byteLength(content, "utf8") > MAX_MESSAGE_BYTES) throw new Error("AI_TEST_CHAT_MESSAGES_INVALID");
    return { role: role as "system" | "user" | "assistant", content };
  });
  if (Buffer.byteLength(JSON.stringify(messages), "utf8") > MAX_BODY_BYTES) throw new Error("AI_TEST_CHAT_MESSAGES_INVALID");
  return messages;
}
