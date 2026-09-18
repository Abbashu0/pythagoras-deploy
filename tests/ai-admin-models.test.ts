import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import {
  AIAdminDirectError,
  AIAdminDirectService,
} from "../src/server/ai/admin-direct-service";
import {
  EphemeralModelChatError,
  EphemeralModelChatService,
  MAX_PROVIDER_ROUNDS_PER_TURN,
  MAX_PYTHON_CALLS_PER_TURN,
  type EphemeralModelChatStreamEvent,
} from "../src/server/ai/ephemeral-model-chat-service";
import type {
  AIProviderHttpResponse,
  AIProviderHttpTransport,
  OutboundTargetPolicy,
  ValidatedOutboundTarget,
} from "../src/server/ai/gateway";
import {
  AI_SECRET_KEY_BYTES,
  createLocalAISecretStore,
} from "../src/server/ai/secrets";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth";
import type { AdminActor } from "../src/server/admin-auth/contracts";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const TEST_MASTER_KEY = Buffer.alloc(AI_SECRET_KEY_BYTES, 0x61);

function bytes(value: string): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield new TextEncoder().encode(value);
  })();
}

class ProtocolTransport implements AIProviderHttpTransport {
  requests: Array<Parameters<AIProviderHttpTransport["request"]>[1]> = [];
  targets: ValidatedOutboundTarget[] = [];
  responseStatus = 200;
  includeUsage = true;
  includeFinishReason = true;
  finishReason: "stop" | "length" | "tool_calls" = "stop";
  omitDone = false;
  usageOnlyFinal = false;
  whitespaceOnlyDelta = false;
  reasoningMode: "none" | "openai" | "details" | "responses" | "anthropic" = "none";
  toolMode: "none" | "chat" | "responses" | "anthropic" = "none";
  toolScenario: "none" | "stateless-retry" | "limit" = "none";

  async request(
    _target: ValidatedOutboundTarget,
    request: Parameters<AIProviderHttpTransport["request"]>[1],
  ): Promise<AIProviderHttpResponse> {
    this.targets.push(_target);
    this.requests.push(request);
    const path = request.pathAndQuery;
    if (this.toolScenario !== "none") {
      const payload = request.body
        ? JSON.parse(new TextDecoder().decode(request.body)) as Record<string, unknown>
        : {};
      return {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: bytes(toolScenarioStream(path, payload, this.toolScenario)),
      };
    }
    if (this.toolMode !== "none") {
      const payload = request.body
        ? JSON.parse(new TextDecoder().decode(request.body)) as Record<string, unknown>
        : {};
      const continuation = path === "responses"
        ? Array.isArray(payload.input) && payload.input.some((item) => isRecord(item) && item.type === "function_call_output")
        : path === "v1/messages"
          ? Array.isArray(payload.messages) && payload.messages.some((item) => isRecord(item) && Array.isArray(item.content) && item.content.some((block) => isRecord(block) && block.type === "tool_result"))
          : Array.isArray(payload.messages) && payload.messages.some((item) => isRecord(item) && item.role === "tool");
      return {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: bytes(toolStream(path, continuation)),
      };
    }
    const body = path === "responses"
      ? [
          'data: {"type":"response.created","response":{"id":"responses-1","status":"in_progress"}}\n\n',
          ...(this.reasoningMode === "responses"
            ? ['data: {"type":"response.reasoning_summary_text.delta","delta":"Thought"}\n\n']
            : []),
          'data: {"type":"response.output_text.delta","delta":"OK"}\n\n',
          `data: {"type":"response.completed","response":{"id":"responses-1","status":"completed"${this.includeUsage ? ',"usage":{"input_tokens":1,"output_tokens":1}' : ""}}}\n\n`,
        ].join("")
      : path === "v1/messages"
        ? [
            `event: message_start\ndata: {"type":"message_start","message":{"id":"anthropic-1"${this.includeUsage ? ',"usage":{"input_tokens":1}' : ""}}}\n\n`,
            ...(this.reasoningMode === "anthropic"
              ? ['event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Thought"}}\n\n']
              : []),
            'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"OK"}}\n\n',
            `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}${this.includeUsage ? ',"usage":{"output_tokens":1}' : ""}}\n\n`,
            'event: message_stop\ndata: {"type":"message_stop"}\n\n',
          ].join("")
        : [
            'data: {"id":"chat-1","choices":[{"delta":{}}]}\n\n',
            ...(this.whitespaceOnlyDelta
              ? ['data: {"id":"chat-1","choices":[{"delta":{"content":"   "}}]}\n\n']
              : []),
            ...(this.reasoningMode === "openai"
              ? ['data: {"id":"chat-1","choices":[{"delta":{"reasoning":"Thought"}}]}\n\n']
              : this.reasoningMode === "details"
              ? ['data: {"id":"chat-1","choices":[{"delta":{"reasoning_details":[{"type":"reasoning.encrypted","data":"SECRET"},{"type":"reasoning.future","payload":"ignore"},{"type":"reasoning.text","text":"Thought"}]}}]}\n\n']
                : []),
            `data: {"id":"chat-1","choices":[{"delta":{"content":"OK"}${this.includeFinishReason ? `,"finish_reason":"${this.finishReason}"` : ""}}]${this.includeUsage ? ',"usage":{"prompt_tokens":1,"completion_tokens":1}' : ""}}\n\n`,
            ...(this.usageOnlyFinal
              ? ['data: {"id":"chat-1","choices":[],"provider":"openrouter/free","usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n']
              : []),
            ...(this.omitDone ? [] : ["data: [DONE]\n\n"]),
          ].join("");
    return {
      status: this.responseStatus,
      headers: { "content-type": "text/event-stream" },
      body: bytes(body),
    };
  }
}

function toolStream(path: string, continuation: boolean): string {
  if (continuation) {
    if (path === "responses") {
      return [
        'data: {"type":"response.created","response":{"id":"responses-tool-2","status":"in_progress"}}\n\n',
        'data: {"type":"response.output_text.delta","delta":"5"}\n\n',
        'data: {"type":"response.completed","response":{"id":"responses-tool-2","status":"completed","usage":{"input_tokens":2,"output_tokens":1}}}\n\n',
      ].join("");
    }
    if (path === "v1/messages") {
      return [
        sseJson({ type: "message_start", message: { id: "anthropic-tool-2", usage: { input_tokens: 2 } } }, "message_start"),
        sseJson({ type: "content_block_delta", delta: { type: "text_delta", text: "5" } }, "content_block_delta"),
        sseJson({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }, "message_delta"),
        sseJson({ type: "message_stop" }, "message_stop"),
      ].join("");
    }
    return [
      'data: {"id":"chat-tool-2","choices":[{"delta":{"content":"5"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}\n\n',
      "data: [DONE]\n\n",
    ].join("");
  }
  if (path === "responses") {
    return [
      'data: {"type":"response.created","response":{"id":"responses-tool-1","status":"in_progress"}}\n\n',
      'data: {"type":"response.output_item.added","item":{"type":"function_call","id":"item-1","call_id":"call-1","name":"python","arguments":""}}\n\n',
      'data: {"type":"response.function_call_arguments.delta","item_id":"item-1","delta":"{\\"code\\":\\"2 + "}\n\n',
      'data: {"type":"response.function_call_arguments.done","item_id":"item-1","arguments":"{\\"code\\":\\"2 + 3\\"}"}\n\n',
      'data: {"type":"response.completed","response":{"id":"responses-tool-1","status":"completed","output":[{"type":"function_call","call_id":"call-1","name":"python","arguments":"{\\"code\\":\\"2 + 3\\"}"}]}}\n\n',
    ].join("");
  }
  if (path === "v1/messages") {
    return [
      sseJson({ type: "message_start", message: { id: "anthropic-tool-1", usage: { input_tokens: 1 } } }, "message_start"),
      sseJson({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call-1", name: "python", input: {} } }, "content_block_start"),
      sseJson({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"code":"2 + ' } }, "content_block_delta"),
      sseJson({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '3"}' } }, "content_block_delta"),
      sseJson({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } }, "message_delta"),
      sseJson({ type: "message_stop" }, "message_stop"),
    ].join("");
  }
  return [
    sseJson({
      id: "chat-tool-1",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", function: { name: "python", arguments: '{"code":"2 + ' } }] } }],
    }),
    sseJson({
      id: "chat-tool-1",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '3"}' } }] } }],
    }),
    sseJson({ id: "chat-tool-1", choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
    "data: [DONE]\n\n",
  ].join("");
}

function sseJson(value: Record<string, unknown>, event?: string): string {
  return `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(value)}\n\n`;
}

function toolScenarioStream(
  path: string,
  payload: Record<string, unknown>,
  scenario: "stateless-retry" | "limit",
): string {
  if (path !== "chat/completions") {
    return toolScenarioStream("chat/completions", payload, scenario);
  }
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const toolResultCount = messages.filter(
    (message) => isRecord(message) && message.role === "tool",
  ).length;
  if (scenario === "stateless-retry" && toolResultCount >= 2) {
    return `${sseJson({ id: "scenario-final", choices: [{ delta: { content: "Recovered" }, finish_reason: "stop" }] })}data: [DONE]\n\n`;
  }
  const code = scenario === "limit"
    ? '{"bad":true}'
    : toolResultCount === 0
      ? '{"code":"missing_variable"}'
      : '{"code":"import math\\n2 + 2"}';
  return [
    sseJson({ id: "scenario-tool", choices: [{ delta: { tool_calls: [{ index: 0, id: "scenario-call", function: { name: "python", arguments: code } }] } }] }),
    sseJson({ id: "scenario-tool", choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
    "data: [DONE]\n\n",
  ].join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const outboundPolicy: OutboundTargetPolicy = {
  validate: async (url) => ({
    url: String(url),
    hostname: "provider.example",
    port: 443,
    resolvedAddresses: ["93.184.216.34"],
  }),
};

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-admin-models-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const identity = new SQLiteAdminIdentityRepository(database);
  const user = identity.createInitialOwner({
    id: uuidv7(),
    email: `ai-admin-${uuidv7()}@example.test`,
    displayName: "AI Admin Owner",
    passwordHash: "fixture",
    createdAt: 1_900_000_000_000,
  });
  const actor: AdminActor = { actorUserId: user.id, actorRole: "OWNER" };
  const transport = new ProtocolTransport();
  const secrets = createLocalAISecretStore(database, {
    masterKey: TEST_MASTER_KEY,
    clock: () => 1_900_000_000_100,
  });
  const service = AIAdminDirectService.forDatabase(database, {
    secrets,
    outboundPolicy,
    transport,
    clock: () => 1_900_000_000_200,
  });
  return {
    root,
    database,
    actor,
    service,
    secrets,
    transport,
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function addProvider(
  fixtureValue: ReturnType<typeof fixture>,
  name: string,
  apiFormat: "OPENAI_CHAT_COMPLETIONS" | "OPENAI_RESPONSES" | "ANTHROPIC_MESSAGES" = "OPENAI_CHAT_COMPLETIONS",
) {
  return fixtureValue.service.createProvider({
    displayName: name,
    baseUrl: "https://provider.example/v1",
    apiFormat,
    apiKey: `test-secret-${name}`,
    actor: fixtureValue.actor,
  });
}

async function addModel(
  fixtureValue: ReturnType<typeof fixture>,
  providerId: string,
  providerModelId = "model-name:free",
  maxOutputTokens = 1024,
  contextWindowTokens = 8192,
) {
  return fixtureValue.service.createModel({
    providerId,
    providerModelId,
    contextWindowTokens,
    maxOutputTokens,
    inputModalities: ["TEXT", "IMAGE"],
    actor: fixtureValue.actor,
  });
}

test("local AI Admin creates provider/model directly with safe defaults and exact model IDs", async () => {
  const f = fixture();
  try {
    const provider = await addProvider(f, "OpenRouter");
    assert.equal(provider.key, "openrouter");
    assert.equal(provider.apiFormat, "OPENAI_CHAT_COMPLETIONS");
    assert.equal(provider.credentialConfigured, true);
    assert.equal(JSON.stringify(provider).includes("test-secret-OpenRouter"), false);

    const model = await addModel(f, provider.id, "deepseek/deepseek-v4-flash:free");
    assert.equal(model.providerModelId, "deepseek/deepseek-v4-flash:free");
    assert.equal(model.adapterKey, "openai-compatible-generation-v1");
    assert.deepEqual(model.inputModalities, ["TEXT", "IMAGE"]);
    assert.deepEqual(model.outputModalities, ["TEXT"]);
    assert.equal(model.contextWindowTokens, 8192);
    assert.equal(model.maxOutputTokens, 1024);
  } finally {
    f.close();
  }
});

test("local AI Admin accepts the exact OmniRoute development gateway target", async () => {
  const f = fixture();
  try {
    const provider = await f.service.createProvider({
      displayName: "OmniRoute",
      baseUrl: "http://localhost:20128/v1",
      apiFormat: "OPENAI_CHAT_COMPLETIONS",
      apiKey: "omniroute-local-key",
      actor: f.actor,
    });
    assert.equal(provider.baseUrl, "http://localhost:20128/v1");
    assert.equal(provider.enabled, true);
    assert.equal(provider.credentialConfigured, true);
  } finally {
    f.close();
  }
});

test("API format changes synchronise Generation adapter identity and stale revisions fail closed", async () => {
  const f = fixture();
  try {
    const provider = await addProvider(f, "Protocol Provider");
    const model = await addModel(f, provider.id);
    const changed = f.service.updateProvider({
      providerId: provider.id,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      apiFormat: "ANTHROPIC_MESSAGES",
      expectedRevision: provider.revision,
      actor: f.actor,
    });
    assert.equal(changed.apiFormat, "ANTHROPIC_MESSAGES");
    const synced = f.service.getModel(model.id);
    assert.equal(synced.adapterKey, "anthropic-messages-generation-v1");
    assert.equal(synced.revision, model.revision + 1);
    assert.throws(
      () => f.service.updateModel({
        modelId: model.id,
        providerModelId: model.providerModelId,
        contextWindowTokens: 4096,
        maxOutputTokens: 512,
        inputModalities: ["TEXT"],
        expectedRevision: model.revision,
        actor: f.actor,
      }),
      (error: unknown) => error instanceof AIAdminDirectError && error.code === "AI_ADMIN_REVISION_CONFLICT",
    );
  } finally {
    f.close();
  }
});

test("direct Provider enablement persists the requested boolean exactly once", async () => {
  const f = fixture();
  try {
    const provider = await addProvider(f, "Enablement Provider");
    const disabled = f.service.setProviderEnabled({
      providerId: provider.id,
      enabled: false,
      expectedRevision: provider.revision,
      actor: f.actor,
    });
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.revision, provider.revision + 1);
    assert.equal(f.service.getProvider(provider.id).enabled, false);

    const enabled = f.service.setProviderEnabled({
      providerId: provider.id,
      enabled: true,
      expectedRevision: disabled.revision,
      actor: f.actor,
    });
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.revision, disabled.revision + 1);
    assert.equal(f.service.getProvider(provider.id).enabled, true);
    assert.throws(
      () => f.service.setProviderEnabled({
        providerId: provider.id,
        enabled: false,
        expectedRevision: provider.revision,
        actor: f.actor,
      }),
      (error: unknown) => error instanceof AIAdminDirectError && error.code === "AI_ADMIN_REVISION_CONFLICT",
    );
  } finally {
    f.close();
  }
});

test("all three model tests use the real Gateway protocol boundary without returning generated text", async () => {
  const f = fixture();
  try {
    for (const [index, format] of ([
      "OPENAI_CHAT_COMPLETIONS",
      "OPENAI_RESPONSES",
      "ANTHROPIC_MESSAGES",
    ] as const).entries()) {
      const provider = await addProvider(f, `Protocol ${index}`, format);
      if (format === "ANTHROPIC_MESSAGES") assert.equal(provider.baseUrl, "https://provider.example/");
      const model = await addModel(f, provider.id, `provider/model-${index}`);
      const result = await f.service.testModel(model.id);
      assert.equal(result.ok, true, format);
      assert.equal(typeof result.latencyMs, "number");
      assert.equal(JSON.stringify(result).includes("OK"), false);
    }
    assert.deepEqual(
      f.transport.requests.map((request) => request.pathAndQuery),
      ["chat/completions", "responses", "v1/messages"],
    );
    assert.equal(f.transport.targets.some((target) => target.url.includes("/v1/v1")), false);
    assert.equal(f.transport.requests[0].headers?.Authorization, "Bearer test-secret-Protocol 0");
    assert.equal(f.transport.requests[2].headers?.["x-api-key"], "test-secret-Protocol 2");
    assert.equal(f.transport.requests[2].headers?.Authorization, undefined);
  } finally {
    f.close();
  }
});

test("SQLite trust boundary rejects invalid API formats and model modality JSON", async () => {
  const f = fixture();
  try {
    const provider = await addProvider(f, "Constraint Provider");
    const model = await addModel(f, provider.id);
    assert.throws(() =>
      f.database.client
        .prepare("update ai_provider_configs set api_format = 'NOT_A_PROTOCOL' where id = ?")
        .run(provider.id),
    );
    assert.throws(() =>
      f.database.client
        .prepare("update ai_model_configs set input_modalities = ? where id = ?")
        .run(JSON.stringify(["IMAGE"]), model.id),
    );
    assert.throws(() =>
      f.database.client
        .prepare("update ai_model_configs set input_modalities = ? where id = ?")
        .run(JSON.stringify(["TEXT", "TEXT"]), model.id),
    );
  } finally {
    f.close();
  }
});

test("model diagnostics return a safe mapped failure without provider body or secret", async () => {
  const f = fixture();
  try {
    const provider = await addProvider(f, "Failure Provider");
    const model = await addModel(f, provider.id);
    f.transport.responseStatus = 401;
    const result = await f.service.testModel(model.id);
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "AUTHENTICATION");
    assert.equal(JSON.stringify(result).includes("test-secret-Failure Provider"), false);
  } finally {
    f.close();
  }
});

test("unreferenced model/provider deletion is explicit and refuses provider deletion with models", async () => {
  const f = fixture();
  try {
    const provider = await addProvider(f, "Delete Provider");
    const model = await addModel(f, provider.id);
    await assert.rejects(
      () => f.service.deleteProvider({ providerId: provider.id, expectedRevision: provider.revision, actor: f.actor }),
      (error: unknown) => error instanceof AIAdminDirectError && error.code === "AI_ADMIN_PROVIDER_DELETE_BLOCKED",
    );
    f.service.deleteModel({ modelId: model.id, expectedRevision: model.revision });
    await f.service.deleteProvider({ providerId: provider.id, expectedRevision: provider.revision, actor: f.actor });
    assert.equal(f.service.listProviders().length, 0);
  } finally {
    f.close();
  }
});

test("ephemeral Model chat resolves one exact Provider, serializes bounded multi-turn messages, and normalizes usage", async () => {
  const f = fixture();
  try {
    const chat = EphemeralModelChatService.forDatabase(f.database, {
      secrets: f.secrets,
      outboundPolicy,
      transport: f.transport,
      clock: () => 1_900_000_000_400,
    });
    const messages = [
      { role: "user" as const, content: "First question" },
      { role: "assistant" as const, content: "First answer" },
      { role: "user" as const, content: "Follow-up question" },
    ];
    const untouchedTables = [
      "ai_conversations",
      "ai_conversation_messages",
      "ai_conversation_responses",
      "ai_conversation_response_chunks",
      "ai_memories",
      "ai_memory_mutation_intents",
      "ai_memory_mutation_records",
      "ai_conversation_summary_revisions",
      "ai_retrieval_traces",
      "ai_tutor_response_traces",
      "ai_telemetry_events",
      "ai_cost_operations",
      "ai_usage_cost_records",
      "ai_jobs",
      "ai_circuit_breaker_states",
      "ai_circuit_breaker_events",
    ];
    const countRows = () => Object.fromEntries(
      untouchedTables.map((table) => [
        table,
        (f.database.client.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count,
      ]),
    );
    const before = countRows();

    for (const [index, format] of ([
      "OPENAI_CHAT_COMPLETIONS",
      "OPENAI_RESPONSES",
      "ANTHROPIC_MESSAGES",
    ] as const).entries()) {
      const provider = await addProvider(f, `Ephemeral ${index}`, format);
      const model = await addModel(f, provider.id, `ephemeral/model-${index}`);
      const result = await chat.chat({ modelId: model.id, messages });
      assert.equal(result.text, "OK");
      assert.equal(result.reasoningText, "");
      assert.equal(JSON.stringify(result).includes("test-secret-"), false);
      assert.deepEqual(result.usage, {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        reasoningTokens: null,
        cachedInputTokens: null,
        cacheMissInputTokens: null,
      });

      const request = f.transport.requests.at(-1);
      assert.ok(request?.body);
      const payload = JSON.parse(new TextDecoder().decode(request.body)) as Record<string, unknown>;
      const serializedMessages = format === "OPENAI_RESPONSES" ? payload.input : payload.messages;
      assert.deepEqual(serializedMessages, messages, format);
      assert.equal(payload.model, model.providerModelId);
      assert.equal("instructions" in payload, false);
    }

    f.transport.includeUsage = false;
    const noUsageProvider = await addProvider(f, "Ephemeral No Usage");
    const noUsageModel = await addModel(f, noUsageProvider.id, "ephemeral/no-usage");
    const noUsage = await chat.chat({
      modelId: noUsageModel.id,
      messages: [{ role: "user", content: "No usage please" }],
    });
    assert.deepEqual(noUsage.usage, {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      reasoningTokens: null,
      cachedInputTokens: null,
      cacheMissInputTokens: null,
    });
    assert.deepEqual(countRows(), before);
    assert.equal(f.transport.requests.length, 4);
  } finally {
    f.close();
  }
});

test("ephemeral diagnostic uses the canonical output ceiling and normalizes LENGTH without failing the turn", async () => {
  const f = fixture();
  try {
    const chat = EphemeralModelChatService.forDatabase(f.database, {
      secrets: f.secrets,
      outboundPolicy,
      transport: f.transport,
      clock: () => 1_900_000_000_450,
    });
    const provider = await addProvider(f, "Canonical Ceiling Provider");
    const sixteenK = await addModel(f, provider.id, "ceiling/16k", 16_384, 20_000);
    f.transport.finishReason = "length";
    const lengthResult = await chat.chat({
      modelId: sixteenK.id,
      messages: [{ role: "user", content: "long reasoning" }],
    });
    const sixteenPayload = JSON.parse(new TextDecoder().decode(f.transport.requests.at(-1)!.body)) as Record<string, unknown>;
    assert.equal(sixteenPayload.max_tokens, 16_384);
    assert.equal(lengthResult.finishReason, "LENGTH");
    assert.equal(lengthResult.usage.outputTokens, 1);

    const eighteenK = await addModel(f, provider.id, "ceiling/18k", 18_709, 20_000);
    f.transport.finishReason = "stop";
    const browserAttempt = { modelId: eighteenK.id, messages: [{ role: "user", content: "hi" }], maxOutputTokens: 1 } as unknown as Parameters<typeof chat.chat>[0];
    const stopResult = await chat.chat(browserAttempt);
    const eighteenPayload = JSON.parse(new TextDecoder().decode(f.transport.requests.at(-1)!.body)) as Record<string, unknown>;
    assert.equal(eighteenPayload.max_tokens, 18_709);
    assert.equal(stopResult.finishReason, "STOP");
  } finally {
    f.close();
  }
});

test("ephemeral Model chat streams text and Provider-exposed reasoning without persistence or fallback", async () => {
  const f = fixture();
  try {
    const chat = EphemeralModelChatService.forDatabase(f.database, {
      secrets: f.secrets,
      outboundPolicy,
      transport: f.transport,
      clock: () => 1_900_000_000_500,
    });
    const untouchedTables = ["ai_conversations", "ai_memories", "ai_telemetry_events", "ai_cost_operations", "ai_jobs"];
    const countRows = () => Object.fromEntries(untouchedTables.map((table) => [table, (f.database.client.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count]));
    const before = countRows();
    const modes = [
      ["OPENAI_CHAT_COMPLETIONS", "openai", "chat/reasoning"],
      ["OPENAI_CHAT_COMPLETIONS", "details", "chat/details"],
      ["OPENAI_RESPONSES", "responses", "responses/reasoning"],
      ["ANTHROPIC_MESSAGES", "anthropic", "anthropic/reasoning"],
    ] as const;
    for (const [format, mode, modelId] of modes) {
      const provider = await addProvider(f, `Streaming ${mode}`, format);
      const model = await addModel(f, provider.id, modelId);
      f.transport.reasoningMode = mode;
      const events: EphemeralModelChatStreamEvent[] = [];
      for await (const event of chat.stream({ modelId: model.id, messages: [{ role: "user", content: "Think" }] })) events.push(event);
      assert.equal(events[0]?.type, "started");
      assert.equal(events.some((event) => event.type === "text_delta" && event.text === "OK"), true, mode);
      assert.equal(events.some((event) => event.type === "completed"), true, mode);
      assert.equal(events.filter((event) => event.type === "reasoning_delta").map((event) => event.type === "reasoning_delta" ? event.text : "").join(""), "Thought", mode);
      assert.equal(JSON.stringify(events).includes("SECRET"), false);
      assert.equal(JSON.stringify(await chat.chat({ modelId: model.id, messages: [{ role: "user", content: "Follow up" }] })).includes("test-secret-"), false);
    }
    const noDoneProvider = await addProvider(f, "Streaming No Done");
    const noDoneModel = await addModel(f, noDoneProvider.id, "stream/no-done");
    f.transport.reasoningMode = "openai";
    f.transport.includeUsage = false;
    f.transport.includeFinishReason = false;
    f.transport.omitDone = true;
    f.transport.whitespaceOnlyDelta = true;
    const noDoneEvents: EphemeralModelChatStreamEvent[] = [];
    for await (const event of chat.stream({ modelId: noDoneModel.id, messages: [{ role: "user", content: "No done" }] })) noDoneEvents.push(event);
    assert.equal(noDoneEvents.some((event) => event.type === "text_delta"), true);
    assert.equal(noDoneEvents.some((event) => event.type === "completed"), true);

    const usageOnlyProvider = await addProvider(f, "Streaming Usage Only");
    const usageOnlyModel = await addModel(f, usageOnlyProvider.id, "stream/usage-only");
    f.transport.reasoningMode = "none";
    f.transport.includeUsage = true;
    f.transport.includeFinishReason = true;
    f.transport.omitDone = false;
    f.transport.usageOnlyFinal = true;
    f.transport.whitespaceOnlyDelta = false;
    const usageOnlyEvents: EphemeralModelChatStreamEvent[] = [];
    for await (const event of chat.stream({ modelId: usageOnlyModel.id, messages: [{ role: "user", content: "Usage only" }] })) usageOnlyEvents.push(event);
    assert.deepEqual(usageOnlyEvents.at(-1), {
      type: "completed",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, reasoningTokens: null, cachedInputTokens: null, cacheMissInputTokens: null },
      latencyMs: 0,
      finishReason: "STOP",
    });
    assert.deepEqual(countRows(), before);
    assert.equal(f.transport.requests.length, modes.length * 2 + 2);

    const noCredentialProvider = await addProvider(f, "Missing Credential");
    const noCredentialModel = await addModel(f, noCredentialProvider.id, "missing/credential");
    const credentialRef = (f.database.client.prepare("select credential_ref as credentialRef from ai_provider_configs where id = ?").get(noCredentialProvider.id) as { credentialRef: string }).credentialRef;
    await f.secrets.revoke({ credentialRef, actor: { type: "ADMIN", actorUserId: f.actor.actorUserId } });
    await assert.rejects(
      () => chat.chat({ modelId: noCredentialModel.id, messages: [{ role: "user", content: "Missing" }] }),
      (error: unknown) => error instanceof EphemeralModelChatError && error.code === "AI_EPHEMERAL_PROVIDER_NOT_READY",
    );
  } finally {
    f.close();
  }
});

test("ephemeral Python tool loop uses server-owned automatic tools across supported protocols", async () => {
  const f = fixture();
  try {
    const chat = EphemeralModelChatService.forDatabase(f.database, {
      secrets: f.secrets,
      outboundPolicy,
      transport: f.transport,
      clock: () => 1_900_000_000_600,
    });
    const modes = [
      ["OPENAI_CHAT_COMPLETIONS", "chat"],
      ["OPENAI_RESPONSES", "responses"],
      ["ANTHROPIC_MESSAGES", "anthropic"],
    ] as const;
    for (const [format, toolMode] of modes) {
      const provider = await addProvider(f, `Tool ${toolMode}`, format);
      const model = await addModel(f, provider.id, `tool/${toolMode}`);
      f.transport.toolMode = toolMode;
      const events: EphemeralModelChatStreamEvent[] = [];
      for await (const event of chat.stream({
        modelId: model.id,
        messages: [{ role: "user", content: "Calculate 2 + 3 with Python." }],
        pythonEnabled: true,
      })) events.push(event);
      assert.equal(events.some((event) => event.type === "tool_call"), true, toolMode);
      assert.equal(events.some((event) => event.type === "tool_started" && event.code === "2 + 3"), true, toolMode);
      assert.equal(events.some((event) => event.type === "tool_result" && event.status === "ok" && event.result === "5"), true, toolMode);
      assert.equal(events.some((event) => event.type === "text_delta" && event.text === "5"), true, toolMode);
      assert.equal(events.at(-1)?.type, "completed", toolMode);

      const firstPayload = JSON.parse(new TextDecoder().decode(f.transport.requests.at(-2)!.body)) as Record<string, unknown>;
      assert.ok(firstPayload.tools, toolMode);
      assert.ok(firstPayload.tool_choice, toolMode);
      const secondPayload = JSON.parse(new TextDecoder().decode(f.transport.requests.at(-1)!.body)) as Record<string, unknown>;
      assert.ok(JSON.stringify(secondPayload).includes("function_call_output") || JSON.stringify(secondPayload).includes("tool_result") || JSON.stringify(secondPayload).includes('"role":"tool"'), toolMode);
    }

    f.transport.toolMode = "none";
    const offProvider = await addProvider(f, "Tool Off", "OPENAI_CHAT_COMPLETIONS");
    const offModel = await addModel(f, offProvider.id, "tool/off");
    await chat.chat({
      modelId: offModel.id,
      messages: [{ role: "user", content: "No tool." }],
      pythonEnabled: false,
    });
    const offPayload = JSON.parse(new TextDecoder().decode(f.transport.requests.at(-1)!.body)) as Record<string, unknown>;
    assert.equal("tools" in offPayload, false);
    assert.equal("tool_choice" in offPayload, false);
  } finally {
    f.close();
  }
});

test("stateless Python errors are recoverable through a self-contained retry", async () => {
  const f = fixture();
  try {
    const provider = await addProvider(f, "Stateless Retry");
    const model = await addModel(f, provider.id, "tool/stateless-retry");
    f.transport.toolScenario = "stateless-retry";
    const chat = EphemeralModelChatService.forDatabase(f.database, {
      secrets: f.secrets,
      outboundPolicy,
      transport: f.transport,
    });
    const events: EphemeralModelChatStreamEvent[] = [];
    for await (const event of chat.stream({
      modelId: model.id,
      messages: [{ role: "user", content: "Verify this calculation with Python." }],
      pythonEnabled: true,
    })) events.push(event);
    assert.equal(events.filter((event) => event.type === "tool_result" && event.status === "error").length, 1);
    assert.equal(events.some((event) => event.type === "tool_result" && event.status === "ok" && event.result === "4"), true);
    assert.equal(events.some((event) => event.type === "text_delta" && event.text === "Recovered"), true);
    assert.equal(events.at(-1)?.type, "completed");
  } finally {
    f.close();
  }
});

test("Python and Provider loop limits remain bounded at 8 calls and 10 rounds", async () => {
  assert.equal(MAX_PYTHON_CALLS_PER_TURN, 8);
  assert.equal(MAX_PROVIDER_ROUNDS_PER_TURN, 10);
  const f = fixture();
  try {
    const provider = await addProvider(f, "Tool Limit");
    const model = await addModel(f, provider.id, "tool/limit");
    f.transport.toolScenario = "limit";
    const chat = EphemeralModelChatService.forDatabase(f.database, {
      secrets: f.secrets,
      outboundPolicy,
      transport: f.transport,
    });
    const events: EphemeralModelChatStreamEvent[] = [];
    await assert.rejects(
      async () => {
        for await (const event of chat.stream({
          modelId: model.id,
          messages: [{ role: "user", content: "Keep verifying." }],
          pythonEnabled: true,
        })) events.push(event);
      },
      (error: unknown) => error instanceof EphemeralModelChatError && error.detailCode === "TOOL_LIMIT",
    );
    assert.equal(events.filter((event) => event.type === "tool_result").length, 8);
    assert.equal(f.transport.requests.length, 9);
  } finally {
    f.close();
  }
});
