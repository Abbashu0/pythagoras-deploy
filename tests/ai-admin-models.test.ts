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

  async request(
    _target: ValidatedOutboundTarget,
    request: Parameters<AIProviderHttpTransport["request"]>[1],
  ): Promise<AIProviderHttpResponse> {
    this.targets.push(_target);
    this.requests.push(request);
    const path = request.pathAndQuery;
    const body = path === "responses"
      ? [
          'data: {"type":"response.created","response":{"id":"responses-1","status":"in_progress"}}\n\n',
          'data: {"type":"response.output_text.delta","delta":"OK"}\n\n',
          'data: {"type":"response.completed","response":{"id":"responses-1","status":"completed","usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
        ].join("")
      : path === "v1/messages"
        ? [
            'event: message_start\ndata: {"type":"message_start","message":{"id":"anthropic-1","usage":{"input_tokens":1}}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"OK"}}\n\n',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
            'event: message_stop\ndata: {"type":"message_stop"}\n\n',
          ].join("")
        : [
            'data: {"id":"chat-1","choices":[{"delta":{}}]}\n\n',
            'data: {"id":"chat-1","choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
            "data: [DONE]\n\n",
          ].join("");
    return {
      status: this.responseStatus,
      headers: { "content-type": "text/event-stream" },
      body: bytes(body),
    };
  }
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
  const service = AIAdminDirectService.forDatabase(database, {
    secrets: createLocalAISecretStore(database, {
      masterKey: TEST_MASTER_KEY,
      clock: () => 1_900_000_000_100,
    }),
    outboundPolicy,
    transport,
    clock: () => 1_900_000_000_200,
  });
  return {
    root,
    database,
    actor,
    service,
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
) {
  return fixtureValue.service.createModel({
    providerId,
    providerModelId,
    contextWindowTokens: 8192,
    maxOutputTokens: 1024,
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
