import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { v7 as uuidv7 } from "uuid";
import { NextRequest } from "next/server";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import { SQLiteAdminIdentityRepository, type AdminActor } from "../src/server/admin-auth";
import { AIAdminDirectService } from "../src/server/ai/admin-direct-service";
import { AI_SECRET_KEY_BYTES, createLocalAISecretStore } from "../src/server/ai/secrets";
import { SQLiteAIModelConfigRepository } from "../src/server/ai/model-registry";
import { SQLiteAIProviderConfigRepository } from "../src/server/ai/configuration";
import { AIProviderGateway, OpenAICompatibleGenerationAdapter, ProviderAdapterRegistry, type AIProviderHttpTransport } from "../src/server/ai/gateway";
import { AIAgent1RuntimeService } from "../src/server/ai/agent-1-runtime/service";
import { Agent1DevChatService } from "../src/server/ai/agent-1-runtime/ephemeral-chat-service";
import { Agent1ActivityStore } from "../src/server/ai/agent-1-runtime/activity-store";
import { Agent1InstructionConformanceService } from "../src/server/ai/agent-1-runtime/instruction-conformance-service";
import { Agent1ConformanceRepository } from "../src/server/ai/agent-1-runtime/instruction-conformance-repository";
import { composeAgent1Instructions, captureAgent1Instructions } from "../src/server/ai/agent-1-runtime/instruction-envelope";
import { agent1FrameworkContract, agent1Hash } from "../src/server/ai/agent-1-runtime/framework-contract";
import { classifyAgent1InstructionTransport } from "../src/server/ai/agent-1-runtime/instruction-transport";
import { Agent1IdentityOutputPolicy } from "../src/server/ai/agent-1-runtime/output-policy";
import { canExecuteAgent1Model } from "../src/server/ai/agent-1-runtime/instruction-qualification";
import { AIInstructionAdminService } from "../src/server/ai/policy/instruction-admin-service";
import { assertDevAgent1Fields } from "../src/app/api/dev/ai/agent-1/_shared";
import { POST as PROBE } from "../src/app/api/admin/local/ai/agent-1/conformance/route";
import { conformanceOutbound, conformanceTransport, qualifyAgent1Fixture } from "./helpers/agent-1-conformance";

const timestamp = 1_900_500_000_000;
const masterKey = Buffer.alloc(AI_SECRET_KEY_BYTES, 0x73);
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-authority-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory: path.join(process.cwd(), "drizzle") });
  const owner = new SQLiteAdminIdentityRepository(database).createInitialOwner({ id: uuidv7(), email: `${uuidv7()}@example.test`, displayName: "Authority Owner", passwordHash: "fixture-only", createdAt: timestamp });
  const actor: AdminActor = { actorUserId: owner.id, actorRole: "OWNER" };
  const secrets = createLocalAISecretStore(database, { masterKey, clock: () => timestamp + 10 });
  const admin = AIAdminDirectService.forDatabase(database, { secrets, outboundPolicy: conformanceOutbound, clock: () => timestamp + 20 });
  const runtime = new AIAgent1RuntimeService(database, { adminService: admin, now: () => timestamp + 50 });
  return { root, database, actor, secrets, admin, runtime, close() { database.close(); rmSync(root, { recursive: true, force: true }); } };
}
type Fixture = ReturnType<typeof fixture>;
async function add(f: Fixture, providerModelId = "candidate", baseUrl = "https://provider.example/v1") {
  const provider = await f.admin.createProvider({ displayName: `Provider ${uuidv7()}`, baseUrl, apiFormat: "OPENAI_CHAT_COMPLETIONS", apiKey: "SECRET_NOT_IN_EVIDENCE", actor: f.actor });
  const model = await f.admin.createModel({ providerId: provider.id, providerModelId, contextWindowTokens: 16384, maxOutputTokens: 2048, inputModalities: ["TEXT"], actor: f.actor });
  return { model, provider };
}
function probe(f: Fixture, modelId: string, transport: AIProviderHttpTransport = conformanceTransport()) {
  const model = new SQLiteAIModelConfigRepository(f.database).getById(modelId)!;
  const provider = new SQLiteAIProviderConfigRepository(f.database).getById(model.providerConfigId)!;
  return new Agent1InstructionConformanceService(f.database, { secrets: f.secrets, outboundPolicy: conformanceOutbound, transport, now: () => timestamp + 100 }).probe({ modelConfigId: modelId, expectedModelRevision: model.revision, expectedProviderRevision: provider.revision, actor: f.actor });
}
async function exhaust(events: AsyncIterable<unknown>) { for await (const _event of events) { /* exhaust */ } }
function replies(onRequest?: (model: string, instructions: string) => boolean): AIProviderHttpTransport {
  return { async request(_target, request) {
    const body = JSON.parse(new TextDecoder().decode(request.body));
    const high = body.messages.find((item: { role: string }) => item.role === "system" || item.role === "developer");
    const fail = onRequest?.(body.model, high.content);
    return { status: fail ? 429 : 200, headers: { "content-type": "text/event-stream" }, body: (async function* () {
      yield Buffer.from(fail ? "{}" : 'data: {"choices":[{"delta":{"content":"Pi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    })() };
  } };
}

test("Framework/General composition is deterministic, owned, versioned, and has no dynamic prefix metadata", () => {
  const general = { policyId: "policy-one", revision: 1, instructions: "Call the application Athena." };
  const first = composeAgent1Instructions({ general });
  const second = composeAgent1Instructions({ general: { ...general, policyId: "policy-two", revision: 2 } });
  assert.equal(first.instructions, second.instructions);
  assert.equal(first.hash, second.hash);
  assert.deepEqual(first.layers.map(layer => layer.kind), ["FRAMEWORK", "GENERAL"]);
  assert.equal(first.metadata.generalRevision, 1);
  assert.equal(first.metadata.generalCompiledHash, agent1Hash(general.instructions));
  assert.equal(first.metadata.frameworkHash, agent1FrameworkContract().hash);
  assert.equal(agent1FrameworkContract().version, 1);
  assert.equal(agent1FrameworkContract().hash, agent1Hash(agent1FrameworkContract().text));
  assert.equal(first.instructions.includes("policy-one"), false);
  assert.ok(first.instructions.indexOf("FRAMEWORK_BEGIN") < first.instructions.indexOf("GENERAL_BEGIN"));
  assert.ok(Object.isFrozen(first.layers[0]));
  assert.notEqual(agent1FrameworkContract("FutureName").hash, agent1FrameworkContract().hash);
  assert.equal(composeAgent1Instructions({}).layers.length, 1);
  assert.throws(() => composeAgent1Instructions({ general, probeGeneral: "other" }));
});
test("Published authoring bytes and descriptions stay separate from Framework and captured envelope", () => {
  const f = fixture();
  try {
    const policy = new AIInstructionAdminService(f.database, () => timestamp + 60);
    const first = policy.publish({ sections: [{ id: uuidv7(), title: "Name", description: "PRIVATE_ADMIN_DESCRIPTION", body: "Application name is Pi", enabled: true }], enabled: true, expectedRevision: 0, actor: f.actor });
    const envelope = captureAgent1Instructions(f.database);
    assert.equal(envelope.metadata.generalRevision, 1);
    assert.ok(envelope.instructions.includes(first.instructions));
    assert.equal(envelope.instructions.includes("PRIVATE_ADMIN_DESCRIPTION"), false);
    assert.equal(policy.repository.getRevision(first.policyId, 1)?.instructions, first.instructions);
    assert.equal(first.instructions.includes("PYTHAGORAS_FRAMEWORK"), false);
    policy.publish({ sections: [{ id: uuidv7(), title: "Name", body: "AnotherName", description: "", enabled: true }], enabled: true, expectedRevision: 1, actor: f.actor });
    assert.equal(envelope.metadata.generalRevision, 1);
    assert.equal(captureAgent1Instructions(f.database).metadata.generalRevision, 2);
  } finally { f.close(); }
});
for (const [mode, status, calls] of [["compliant", "PASS", 3], ["ignore", "FAIL", 1], ["user-wins", "FAIL", 1], ["identity", "FAIL", 2], ["error", "ERROR", 1], ["large", "ERROR", 1]] as const) {
  test(`Conformance ${mode} => ${status}; normalized evidence only, no student records`, async () => {
    const f = fixture();
    try {
      const { model } = await add(f);
      const requests: Record<string, unknown>[] = [];
      const before = f.runtime.getSnapshot().config;
      const result = await probe(f, model.id, conformanceTransport(mode, body => requests.push(body)));
      assert.equal(result.status, status);
      assert.equal(result.qualified, status === "PASS");
      assert.equal(requests.length, calls);
      assert.deepEqual(f.runtime.getSnapshot().config, before);
      const row = f.database.client.prepare("select * from ai_agent_instruction_conformance").get();
      const stored = JSON.stringify(row);
      for (const forbidden of ["PiProbe_", "Other_", "PRIVATE_RAW_REASONING", "IGNORED_HIGH_AUTHORITY", "Foundation", "SECRET_NOT_IN_EVIDENCE", "RAW_PRIVATE_ERROR", "PYTHAGORAS_FRAMEWORK"]) assert.equal(stored.includes(forbidden), false, forbidden);
      const studentRows = f.database.client.prepare("select count(*) as count from ai_conversations").get() as { count: number };
      assert.equal(studentRows.count, 0);
      assert.equal(f.database.client.prepare("select count(*) as count from ai_telemetry_events").get() && (f.database.client.prepare("select count(*) as count from ai_telemetry_events").get() as { count: number }).count, 0);
      assert.throws(() => f.database.client.exec("update ai_agent_instruction_conformance set status = 'PASS'"), /immutable/u);
    } finally { f.close(); }
  });
}
test("Known OmniRoute DeepSeek Web cannot be strict-qualified by a lucky flattened reply", async () => {
  const f = fixture();
  try {
    const { model } = await add(f, "ds-web/deepseek-v4-flash-think", "http://localhost:20128/v1");
    let invoked = 0;
    // A hosted-web adapter has only one user-level prompt. Lucky obedience is not hierarchy.
    const flat = [{ role: "system", content: "You are helpful." }, { role: "user", content: "second question" }].map(item => item.content).join("\n\n");
    assert.equal(flat, "You are helpful.\n\nsecond question");
    const service = new Agent1InstructionConformanceService(f.database);
    const result = service.getAuthority(model.id);
    await assert.rejects(probe(f, model.id, conformanceTransport("compliant", () => { invoked++; })), /توافق|التطوير/u);
    assert.equal(invoked, 0);
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.assuranceTier, "DEVELOPMENT_FLATTENED");
    assert.equal(result.qualified, false);
    assert.equal(result.source, null);
    assert.equal(new Agent1ConformanceRepository(f.database).latest(model.id), null);
  } finally { f.close(); }
});
for (const change of ["model", "provider", "credential", "transport", "suite"] as const) {
  test(`${change} change invalidates prior conformance PASS`, async () => {
    const f = fixture();
    try {
      const { model, provider } = await add(f);
      await qualifyAgent1Fixture(f, model.id);
      if (change === "model") { f.admin.setModelEnabled({ modelId: model.id, enabled: false, expectedRevision: model.revision, actor: f.actor }); }
      if (change === "provider") { f.admin.setProviderEnabled({ providerId: provider.id, enabled: false, expectedRevision: provider.revision, actor: f.actor }); }
      if (change === "credential") { await f.secrets.rotate({ credentialRef: new SQLiteAIProviderConfigRepository(f.database).getById(provider.id)!.credentialRef!, secret: "ROTATED_SECRET", actor: { type: "ADMIN", actorUserId: f.actor.actorUserId } }); }
      if (change === "transport") f.database.client.prepare("update ai_provider_configs set base_url = ? where id = ?").run("https://other.example/v1", provider.id);
      if (change === "suite") {
        const repo = new Agent1ConformanceRepository(f.database);
        const previous = repo.latest(model.id)!;
        repo.append({ ...previous, conformanceVersion: 999, createdAt: previous.createdAt + 1 });
      }
      const current = new Agent1InstructionConformanceService(f.database).getAuthority(model.id);
      assert.equal(current.status, "STALE");
      assert.equal(current.qualified, false);
    } finally { f.close(); }
  });
}
test("Concurrent model edit during probing never certifies the new revision", async () => {
  const f = fixture();
  try {
    const { model } = await add(f);
    let modified = false;
    const result = await probe(f, model.id, conformanceTransport("compliant", () => {
      if (!modified) { modified = true; f.admin.setModelEnabled({ modelId: model.id, enabled: false, expectedRevision: model.revision, actor: f.actor }); }
    }));
    assert.equal(result.status, "STALE");
    assert.equal(result.qualified, false);
    assert.equal(new Agent1ConformanceRepository(f.database).latest(model.id)?.modelRevision, model.revision);
  } finally { f.close(); }
});
test("A later FAIL replaces historical PASS; cancelled probe is ERROR and cannot retain eligibility", async () => {
  const f = fixture();
  try {
    const { model } = await add(f);
    await qualifyAgent1Fixture(f, model.id);
    assert.equal((await probe(f, model.id, conformanceTransport("ignore"))).status, "FAIL");
    assert.equal(new Agent1InstructionConformanceService(f.database).getAuthority(model.id).qualified, false);
    await qualifyAgent1Fixture(f, model.id);
    const provider = new SQLiteAIProviderConfigRepository(f.database).getById(model.providerConfigId)!;
    const controller = new AbortController(); controller.abort();
    let invoked = false;
    const result = await new Agent1InstructionConformanceService(f.database, { secrets: f.secrets, outboundPolicy: conformanceOutbound, transport: conformanceTransport("compliant", () => { invoked = true; }) }).probe({ modelConfigId: model.id, expectedModelRevision: model.revision, expectedProviderRevision: provider.revision, actor: f.actor, signal: controller.signal });
    assert.equal(result.status, "ERROR");
    assert.equal(result.reason, "CANCELLED");
    assert.equal(result.qualified, false);
    assert.equal(invoked, false);
  } finally { f.close(); }
});
for (const initial of ["UNKNOWN", "FAIL", "ERROR", "STALE"] as const) {
  test(`${initial} Primary remains rejected by STRICT_AGENT regardless of development environment`, async () => {
    const f = fixture();
    try {
      const { model } = await add(f);
      if (initial === "FAIL") await probe(f, model.id, conformanceTransport("ignore"));
      if (initial === "ERROR") await probe(f, model.id, conformanceTransport("error"));
      if (initial === "STALE") { await qualifyAgent1Fixture(f, model.id); f.database.client.prepare("update ai_model_configs set revision = revision + 1 where id = ?").run(model.id); }
      f.runtime.saveRoute({ expectedRevision: 0, actor: f.actor, primaryModelConfigId: model.id, fallbackModelConfigIds: [] });
      assert.equal(f.runtime.getSnapshot().primary?.instructionAuthority?.status, initial);
      assert.equal(f.runtime.getSnapshot().canEnable, false);
      assert.throws(() => f.runtime.setEnabled({ actor: f.actor, enabled: true, expectedRevision: 1 }), /authority|اختبار|المسار|النموذج|التعليمات|الإعداد/u);
      assert.equal(canExecuteAgent1Model(f.runtime.getSnapshot().primary!, "STRICT_AGENT", "development"), false);
      assert.equal(canExecuteAgent1Model(f.runtime.getSnapshot().primary!, "STRICT_AGENT", "production"), false);
    } finally { f.close(); }
  });
}
test("Development fallback uses READY unprobed native model with the same envelope and truthful diagnostics", async () => {
  const previousEnvironment = process.env.NODE_ENV; Object.assign(process.env, { NODE_ENV: "development" });
  const f = fixture();
  try {
    const primary = await add(f, "primary");
    const unknown = await add(f, "unknown-fallback");
    const fallback = await add(f, "qualified-fallback");
    await qualifyAgent1Fixture(f, primary.model.id); await qualifyAgent1Fixture(f, fallback.model.id);
    f.runtime.saveRoute({ actor: f.actor, expectedRevision: 0, primaryModelConfigId: primary.model.id, fallbackModelConfigIds: [unknown.model.id, fallback.model.id] });
    f.runtime.setEnabled({ actor: f.actor, expectedRevision: 1, enabled: true });
    const activity = new Agent1ActivityStore();
    const actual: { model: string; instructions: string }[] = [];
    const service = new Agent1DevChatService(f.database, { secrets: f.secrets, runtimeService: f.runtime, outboundPolicy: conformanceOutbound, activity, transport: replies((model, instructions) => { actual.push({ model, instructions }); return model === "primary"; }) });
    await exhaust(service.stream({ messages: [{ role: "user", content: "مرحبا" }] }));
    assert.deepEqual(actual.map(item => item.model), ["primary", "unknown-fallback"]);
    assert.equal(actual[0].instructions, actual[1].instructions);
    assert.equal(activity.snapshot().recent[0].instructions?.frameworkHash, agent1FrameworkContract().hash);
    assert.equal(activity.snapshot().recent[0].instructions?.plannedModels.length, 3);
    assert.equal(activity.snapshot().recent[0].instructions?.plannedModels[1].conformanceRecordId, null);
    assert.equal(activity.snapshot().recent[0].instructions?.plannedModels[1].qualification, null);
    assert.equal(JSON.stringify(activity.snapshot()).includes("PYTHAGORAS_FRAMEWORK"), false);
  } finally { f.close(); if (previousEnvironment === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: previousEnvironment }); }
});
test("Chat adapter role mapping is server-opt-in, model-specific, and leaves generic default unchanged", async () => {
  const f = fixture();
  try {
    const { model } = await add(f);
    const seen: string[] = [];
    const gateway = new AIProviderGateway({ modelConfigs: new SQLiteAIModelConfigRepository(f.database), providerConfigs: new SQLiteAIProviderConfigRepository(f.database), secrets: f.secrets, adapters: new ProviderAdapterRegistry([new OpenAICompatibleGenerationAdapter({ outboundPolicy: conformanceOutbound, transport: { async request(target, request) {
      seen.push(JSON.parse(new TextDecoder().decode(request.body)).messages[0].role);
      return replies().request(target, request);
    } } })]) });
    const input = { requestId: uuidv7(), instructions: "Server instructions", messages: [{ role: "user" as const, content: "hello" }], stream: true };
    await exhaust(gateway.generate({ capability: "GENERATION", attempts: [model.id] }, input).events);
    await exhaust(gateway.generate({ capability: "GENERATION", attempts: [model.id] }, input, { instructionRolesByModel: { [model.id]: "developer" } }).events);
    assert.deepEqual(seen, ["system", "developer"]);
    await assert.rejects(exhaust(gateway.generate({ capability: "GENERATION", attempts: [model.id] }, input, { instructionRolesByModel: { other: "developer" } }).events));
    assert.deepEqual(seen, ["system", "developer"]);
  } finally { f.close(); }
});
test("Transport classifier uses native channels and never equates API labels to PASS", () => {
  const model = { providerModelId: "gpt-5" };
  assert.equal(classifyAgent1InstructionTransport(model, { apiFormat: "OPENAI_CHAT_COMPLETIONS", baseUrl: "https://api.openai.com/v1" }).channel, "CHAT_DEVELOPER");
  assert.equal(classifyAgent1InstructionTransport(model, { apiFormat: "OPENAI_CHAT_COMPLETIONS", baseUrl: "https://compatible.example/v1" }).channel, "CHAT_SYSTEM");
  assert.equal(classifyAgent1InstructionTransport(model, { apiFormat: "OPENAI_RESPONSES", baseUrl: "https://api.openai.com/v1" }).channel, "RESPONSES_INSTRUCTIONS");
  assert.equal(classifyAgent1InstructionTransport(model, { apiFormat: "ANTHROPIC_MESSAGES", baseUrl: "https://api.anthropic.com" }).channel, "ANTHROPIC_SYSTEM");
});
test("Student cannot select instructions, revisions, conformance, Framework, or privilege role", () => {
  for (const key of ["instructions", "instructionRevision", "instructionConformanceStatus", "frameworkEnabled", "instructionRole", "modelConfigId", "generationInputsByModel", "assuranceTier", "qualification", "executionBoundary", "developmentOnly", "framingVersion"]) assert.throws(() => assertDevAgent1Fields({ messages: [], [key]: "client-controlled" }, ["messages"]));
});
test("Output identity boundary rejects contextual self-identification, not educational mentions/quotations", () => {
  const policy = new Agent1IdentityOutputPolicy();
  const context = { requestId: "request", instructions: composeAgent1Instructions({}).metadata, providerId: "provider", modelConfigId: "model", infrastructureAliases: ["DeepSeek", "Gemini", "Claude", "GPT-5"], discloseInfrastructureIdentity: false };
  for (const text of ["I am DeepSeek, not Pi.", "أنا DeepSeek", "أنا نموذج Claude.", "My identity is Gemini.", "مرحبًا! أنا DeepSeek.", "I'm GPT-5."]) assert.equal(policy.evaluate(context, text).action, "DENY", text);
  for (const text of ["What is DeepSeek?", "DeepSeek is a model.", "أنا Pi.", 'An example is "I am DeepSeek".', "```\nI am DeepSeek\n```", "أنا أشرح لك Gemini."]) assert.equal(policy.evaluate(context, text).action, "ALLOW", text);
  assert.equal(policy.evaluate({ ...context, discloseInfrastructureIdentity: true }, "I am DeepSeek").action, "ALLOW");
});
test("Admin conformance endpoint rejects cross-origin and client-owned statuses, uses server actor", async () => {
  const f = fixture();
  const global = globalThis as typeof globalThis & { __pythagorasContentDatabase?: ContentDatabase };
  const previous = global.__pythagorasContentDatabase;
  const previousKey = process.env.PYTHAGORAS_AI_MASTER_KEY;
  process.env.PYTHAGORAS_AI_MASTER_KEY = masterKey.toString("hex");
  global.__pythagorasContentDatabase = f.database;
  try {
    const { model, provider } = await add(f, "ds-web/deepseek-v4-flash-think", "http://localhost:20128/v1");
    const payload = { modelConfigId: model.id, expectedModelRevision: model.revision, expectedProviderRevision: provider.revision };
    const headers = { Host: "localhost:3000", Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" };
    const make = (body: unknown, extra: Record<string, string> = {}) => new NextRequest("http://localhost:3000/api/admin/local/ai/agent-1/conformance", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    assert.equal((await PROBE(make(payload, { Origin: "https://attacker.example" }))).status, 403);
    for (const key of ["actorId", "status", "instructions", "instructionRole", "frameworkEnabled"]) assert.equal((await PROBE(make({ ...payload, [key]: "client" }))).status, 400);
    assert.equal((await PROBE(make({ ...payload, expectedModelRevision: model.revision + 1 }))).status, 409);
    const response = await PROBE(make(payload));
    assert.equal(response.status, 409);
    assert.equal(new Agent1ConformanceRepository(f.database).latest(model.id), null);
  } finally {
    global.__pythagorasContentDatabase = previous;
    if (previousKey === undefined) delete process.env.PYTHAGORAS_AI_MASTER_KEY; else process.env.PYTHAGORAS_AI_MASTER_KEY = previousKey;
    f.close();
  }
});
