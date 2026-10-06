import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { v7 as uuidv7 } from "uuid";
import { InstructionTokenService, officialCounter } from "../src/server/ai/policy/instruction-token-service";
import { AIInstructionAdminService } from "../src/server/ai/policy/instruction-admin-service";
import { AIAdminDirectService } from "../src/server/ai/admin-direct-service";
import { SQLiteAIProviderConfigRepository } from "../src/server/ai/configuration";
import { AIAgent1RuntimeService } from "../src/server/ai/agent-1-runtime/service";
import { AI_SECRET_KEY_BYTES, createLocalAISecretStore } from "../src/server/ai/secrets";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth";
import type { AdminActor } from "../src/server/admin-auth/contracts";
import type { AIProviderApiFormat } from "../src/lib/ai-provider-format";
import type { InstructionSection } from "../src/lib/ai-instruction-sections";
import { compileInstructionSections, instructionBytes } from "../src/lib/ai-instruction-sections";
import { openContentDatabase } from "../src/server/content";
import type { AIProviderHttpTransport, AIProviderHttpRequest, OutboundTargetPolicy } from "../src/server/ai/gateway";
const section = (title = "الهوية"): InstructionSection => ({ id: uuidv7(), title, body: "تعليمات عربية <rules>نص</rules>", description: "NO_DESCRIPTION_SENT", enabled: true });
const outbound: OutboundTargetPolicy = { validate: async (url) => ({ url: String(url), hostname: new URL(String(url)).hostname, port: 443, resolvedAddresses: ["93.184.216.34"] }) };
async function fixture(format: AIProviderApiFormat = "OPENAI_RESPONSES", baseUrl = "https://api.openai.com/v1", mode: "ok" | "fail" | "invalid" | "huge" = "ok") {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-token-count-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory: path.join(process.cwd(), "drizzle") });
  const owner = new SQLiteAdminIdentityRepository(database).createInitialOwner({ id: uuidv7(), email: `${uuidv7()}@example.test`, displayName: "Token fixture", passwordHash: "fixture", createdAt: 1_900_000_000_000 });
  const actor: AdminActor = { actorUserId: owner.id, actorRole: "OWNER" };
  const secrets = createLocalAISecretStore(database, { masterKey: Buffer.alloc(AI_SECRET_KEY_BYTES, 0x51), clock: () => 1_900_000_000_001 });
  const admin = AIAdminDirectService.forDatabase(database, { secrets, outboundPolicy: outbound, clock: () => 1_900_000_000_010 });
  const provider = await admin.createProvider({ displayName: "Token provider", baseUrl, apiFormat: format, apiKey: "fixture-only-key", actor });
  const model = admin.createModel({ providerId: provider.id, providerModelId: "fixture-model", contextWindowTokens: 32768, maxOutputTokens: 2048, inputModalities: ["TEXT"], actor });
  const runtime = new AIAgent1RuntimeService(database, { adminService: admin, now: () => 1_900_000_000_020 });
  runtime.saveRoute({ actor, expectedRevision: 0, primaryModelConfigId: model.id, fallbackModelConfigIds: [] });
  const requests: AIProviderHttpRequest[] = [];
  const transport: AIProviderHttpTransport = { async request(_target, request) {
    requests.push(request);
    const payload = JSON.parse(new TextDecoder().decode(request.body));
    const json = mode === "huge" ? "x".repeat(9000) : mode === "invalid" ? JSON.stringify({ input_tokens: "wrong" }) : JSON.stringify({ input_tokens: instructionBytes(payload.instructions ?? payload.system) + 4 });
    return { status: mode === "fail" ? 429 : 200, headers: {}, body: (async function* () { yield new TextEncoder().encode(json); })() };
  } };
  let now = 1_900_000_000_030;
  const counter = new InstructionTokenService(database, { secrets, transport, outboundPolicy: outbound, now: () => now });
  return { root, database, actor, admin, provider, model, secrets, runtime, counter, requests, tick: () => { now += 61_000; }, close() { database.close(); rmSync(root, { recursive: true, force: true }); } };
}
test("Official Responses count is exact for framed instructions-only input; never generates", async () => {
  const f = await fixture();
  try {
    const sections = [section(), section("الدور"), { ...section("معطلة"), enabled: false }];
    const result = await f.counter.count(sections);
    assert.equal(result.total.precision, "exact"); assert.equal(result.total.method, "openai-input-tokens"); assert.equal(result.total.tokens, instructionBytes(compileInstructionSections(sections).text) + 4);
    assert.equal(result.sections[2].tokens, 0); assert.equal(f.requests.length, 3); assert.equal(result.basis.modelId, f.model.id); assert.equal(result.scope, "instructions-only-api-input");
    for (const request of f.requests) { assert.equal(request.pathAndQuery, "responses/input_tokens"); const body = JSON.parse(new TextDecoder().decode(request.body)); assert.deepEqual(body.input, []); assert.equal(body.model, "fixture-model"); assert.equal(Object.hasOwn(body, "max_output_tokens"), false); assert.ok(!body.instructions.includes("NO_DESCRIPTION_SENT")); }
    assert.equal((f.database.client.prepare("SELECT count(*) n FROM ai_conversation_responses").get() as { n: number }).n, 0);
    assert.equal((f.database.client.prepare("SELECT count(*) n FROM ai_telemetry_events").get() as { n: number }).n, 0);
  } finally { f.close(); }
});
test("Cache reuses unchanged sections; body edit recounts one section and complete prompt; descriptions do not recount", async () => {
  const f = await fixture();
  try {
    const sections = [section(), section("الثانية")];
    await f.counter.count(sections); assert.equal(f.requests.length, 3);
    await f.counter.count(sections.map((entry) => ({ ...entry, description: "changed metadata" }))); assert.equal(f.requests.length, 3);
    await f.counter.count([sections[0], { ...sections[1], body: "new body" }]); assert.equal(f.requests.length, 5);
    f.tick(); await f.counter.count(sections); assert.equal(f.requests.length, 8);
  } finally { f.close(); }
});
test("Counts change basis after model/provider revision or secret rotation", async () => {
  const f = await fixture();
  try {
    const sections = [section()]; const a = await f.counter.count(sections);
    f.admin.updateModel({ modelId: f.model.id, expectedRevision: 1, providerModelId: "fixture-model-v2", contextWindowTokens: 32768, maxOutputTokens: 2048, inputModalities: ["TEXT"], actor: f.actor });
    const b = await f.counter.count(sections); assert.notEqual(b.basis.key, a.basis.key); assert.equal(f.requests.length, 2);
    const provider = f.admin.setProviderEnabled({ providerId: f.provider.id, enabled: false, expectedRevision: f.provider.revision, actor: f.actor });
    f.admin.setProviderEnabled({ providerId: f.provider.id, enabled: true, expectedRevision: provider.revision, actor: f.actor });
    const c = await f.counter.count(sections); assert.notEqual(c.basis.key, b.basis.key); assert.equal(f.requests.length, 3);
    await f.secrets.rotate({ credentialRef: new SQLiteAIProviderConfigRepository(f.database).getById(f.provider.id)!.credentialRef!, secret: "fixture-rotated", actor: { type: "ADMIN", actorUserId: f.actor.actorUserId } });
    const d = await f.counter.count(sections); assert.notEqual(d.basis.key, c.basis.key); assert.equal(f.requests.length, 4);
  } finally { f.close(); }
});
test("Generic compatible Chat and custom Responses endpoints use labelled estimate without network", async () => {
  for (const format of ["OPENAI_CHAT_COMPLETIONS", "OPENAI_RESPONSES"] as const) {
    const f = await fixture(format, "https://provider.example/v1");
    try { const result = await f.counter.count([section()]); assert.equal(result.total.precision, "estimated"); assert.equal(result.total.method, "utf8-estimate-v1"); assert.equal(f.requests.length, 0); assert.equal(result.total.reason, "NO_STANDARD_COUNTER"); } finally { f.close(); }
  }
});
test("Anthropic uses official count_tokens but labels provider-documented estimate", async () => {
  const f = await fixture("ANTHROPIC_MESSAGES", "https://api.anthropic.com");
  try { const result = await f.counter.count([section()]); assert.equal(result.total.method, "anthropic-count-tokens"); assert.equal(result.total.precision, "estimated"); assert.equal(f.requests[0].pathAndQuery, "v1/messages/count_tokens"); const body = JSON.parse(new TextDecoder().decode(f.requests[0].body)); assert.deepEqual(body.messages, [{ role: "user", content: "." }]); assert.ok(body.system); assert.ok(f.requests[0].headers?.["x-api-key"]); } finally { f.close(); }
});
for (const mode of ["fail", "invalid", "huge"] as const) test(`Optional native counter ${mode} falls back without blocking publication`, async () => {
  const f = await fixture("OPENAI_RESPONSES", "https://api.openai.com/v1", mode);
  try { const sections = [section()]; const result = await f.counter.count(sections); assert.equal(result.total.method, "utf8-estimate-v1"); assert.equal(result.total.precision, "estimated"); const revision = new AIInstructionAdminService(f.database, () => 1_900_000_000_040).publish({ sections, enabled: true, expectedRevision: 0, actor: f.actor }); assert.equal(revision.revision, 1); } finally { f.close(); }
});
test("Cancellation is respected, no cancelled result is cached", async () => {
  const f = await fixture();
  try { const controller = new AbortController(); controller.abort(); await assert.rejects(() => f.counter.count([section()], controller.signal), { name: "AbortError" }); assert.equal(f.requests.length, 0); } finally { f.close(); }
});
test("Legacy counting hashes/counts exact saved bytes without adding a synthetic heading", async () => {
  const f = await fixture();
  try { const revision = new AIInstructionAdminService(f.database).repository.create({ id: uuidv7(), actor: f.actor, now: 1_900_000_000_040, content: { key: "legacy", scope: "GLOBAL", subjectKey: null, displayName: "legacy", instructions: "<rules>مرحبا</rules>\n", enabled: true } }); const result = await f.counter.countRevision(revision); const body = JSON.parse(new TextDecoder().decode(f.requests[0].body)); assert.equal(body.instructions, revision.instructions); assert.equal(result.compiledBytes, instructionBytes(revision.instructions)); } finally { f.close(); }
});
test("Counter allowlist never infers a public native endpoint from a lookalike/custom URL", () => {
  assert.equal(officialCounter("OPENAI_RESPONSES", "https://api.openai.com/v1"), "openai");
  for (const url of ["http://api.openai.com/v1", "https://api.openai.com.evil/v1", "https://api.openai.com/v1?redirect=x", "https://user:secret@api.openai.com/v1", "https://api.openai.com/proxy"]) assert.equal(officialCounter("OPENAI_RESPONSES", url), null);
});
