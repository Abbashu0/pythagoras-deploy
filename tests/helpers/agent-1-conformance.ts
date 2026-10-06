import assert from "node:assert/strict";
import type { ContentDatabase } from "../../src/server/content/database";
import type { AdminActor } from "../../src/server/admin-auth/contracts";
import { Agent1InstructionConformanceService } from "../../src/server/ai/agent-1-runtime/instruction-conformance-service";
import { SQLiteAIModelConfigRepository } from "../../src/server/ai/model-registry";
import { SQLiteAIProviderConfigRepository } from "../../src/server/ai/configuration";
import type { AISecretStoreAdapter } from "../../src/server/ai/secrets";
import type { AIProviderHttpTransport, OutboundTargetPolicy } from "../../src/server/ai/gateway";

export const conformanceOutbound: OutboundTargetPolicy = { validate: async (url) => ({ url: String(url), hostname: "provider.example", port: 443, resolvedAddresses: ["93.184.216.34"] }) };
export function conformanceTransport(mode: "compliant" | "ignore" | "user-wins" | "identity" | "error" | "large" = "compliant", onRequest?: (body: Record<string, unknown>) => void): AIProviderHttpTransport {
  return { async request(_target, request) {
    const body = JSON.parse(new TextDecoder().decode(request.body)) as Record<string, unknown>;
    onRequest?.(body);
    const messages = body.messages as { role: string; content: string }[];
    const high = messages.find(message => message.role === "system" || message.role === "developer")?.content;
    assert.ok(high);
    assert.ok(high.includes("PYTHAGORAS_FRAMEWORK_BEGIN"));
    assert.ok(high.includes("PYTHAGORAS_GENERAL_BEGIN"));
    assert.ok(Number(body.max_tokens) <= 96);
    const expected = high.match(/PiProbe_[a-f0-9]+/u)?.[0];
    assert.ok(expected);
    const user = messages.find(message => message.role === "user")?.content;
    const output = mode === "ignore" ? "IGNORED_HIGH_AUTHORITY" : mode === "user-wins" ? user?.match(/Other_[a-f0-9]+/u)?.[0] ?? "USER_OVERRIDE" : mode === "identity" && /isolated application identity test/u.test(high) ? "I am Foundation" : mode === "large" ? "x".repeat(1025) : expected;
    const response = mode === "error" ? '{"error":"RAW_PRIVATE_ERROR"}' : [
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "PRIVATE_RAW_REASONING" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: output }, finish_reason: "stop" }] })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    return { status: mode === "error" ? 503 : 200, headers: { "content-type": "text/event-stream" }, body: (async function* () { yield Buffer.from(response); })() };
  } };
}
export async function qualifyAgent1Fixture(fixture: { database: ContentDatabase; actor: AdminActor; secrets: AISecretStoreAdapter }, modelConfigId: string) {
  const model = new SQLiteAIModelConfigRepository(fixture.database).getById(modelConfigId)!;
  const provider = new SQLiteAIProviderConfigRepository(fixture.database).getById(model.providerConfigId)!;
  const result = await new Agent1InstructionConformanceService(fixture.database, { secrets: fixture.secrets, outboundPolicy: conformanceOutbound, transport: conformanceTransport() }).probe({ modelConfigId, expectedModelRevision: model.revision, expectedProviderRevision: provider.revision, actor: fixture.actor });
  assert.equal(result.status, "PASS");
  assert.equal(result.qualified, true);
}
