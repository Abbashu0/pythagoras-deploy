import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import {
  Agent1DevChatError,
  Agent1DevChatService,
  type Agent1DevChatStreamEvent,
} from "../src/server/ai/agent-1-runtime/ephemeral-chat-service";
import { createAgent1DevChatStreamResponse } from "../src/server/ai/agent-1-runtime/dev-chat-stream-response";
import { AIAdminDirectService } from "../src/server/ai/admin-direct-service";
import type {
  AIProviderHttpRequest,
  AIProviderHttpResponse,
  AIProviderHttpTransport,
  OutboundTargetPolicy,
} from "../src/server/ai/gateway";
import { AIAgent1RuntimeService } from "../src/server/ai/agent-1-runtime/service";
import { AI_SECRET_KEY_BYTES, createLocalAISecretStore } from "../src/server/ai/secrets";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth";
import type { AdminActor } from "../src/server/admin-auth/contracts";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import { assertDevAgent1Fields, isDevMobileChatEnabled } from "../src/app/api/dev/ai/agent-1/_shared";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const TEST_MASTER_KEY = Buffer.alloc(AI_SECRET_KEY_BYTES, 0x72);
const BASE_TIME = 1_900_400_000_000;

function bytes(value: string): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield new TextEncoder().encode(value);
  })();
}

class FallbackTransport implements AIProviderHttpTransport {
  readonly requestedModels: string[] = [];
  readonly requestBodies: Array<{
    model?: string;
    messages?: Array<{ role?: string; content?: string }>;
  }> = [];

  constructor(private readonly primaryModelId: string) {}

  async request(
    _target: Parameters<AIProviderHttpTransport["request"]>[0],
    request: AIProviderHttpRequest,
  ): Promise<AIProviderHttpResponse> {
    const body = request.body
      ? JSON.parse(new TextDecoder().decode(request.body)) as {
          model?: string;
          messages?: Array<{ role?: string; content?: string }>;
        }
      : {};
    const modelId = body.model ?? "";
    this.requestedModels.push(modelId);
    this.requestBodies.push(body);
    if (modelId === this.primaryModelId) {
      return {
        status: 429,
        headers: { "content-type": "application/json" },
        body: bytes('{"error":{"message":"do not expose provider body"}}'),
      };
    }
    return {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: bytes([
        'data: {"id":"dev-chat","choices":[{"delta":{"reasoning_content":"PRIVATE REASONING MUST NOT LEAVE SERVER"}}]}\n\n',
        'data: {"id":"dev-chat","choices":[{"delta":{"content":"رد "}}]}\n\n',
        'data: {"id":"dev-chat","choices":[{"delta":{"content":"مؤقت"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2}}\n\n',
        "data: [DONE]\n\n",
      ].join("")),
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

interface Fixture {
  database: ContentDatabase;
  root: string;
  actor: AdminActor;
  admin: AIAdminDirectService;
  runtime: AIAgent1RuntimeService;
  secrets: ReturnType<typeof createLocalAISecretStore>;
  close(): void;
}

function fixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-agent-1-dev-chat-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const identity = new SQLiteAdminIdentityRepository(database);
  const owner = identity.createInitialOwner({
    id: uuidv7(),
    email: `agent1-dev-chat-${uuidv7()}@example.test`,
    displayName: "Agent 1 Dev Chat Owner",
    passwordHash: "fixture-only",
    createdAt: BASE_TIME,
  });
  const actor: AdminActor = { actorUserId: owner.id, actorRole: "OWNER" };
  const secrets = createLocalAISecretStore(database, {
    masterKey: TEST_MASTER_KEY,
    clock: () => BASE_TIME + 10,
  });
  const admin = AIAdminDirectService.forDatabase(database, {
    secrets,
    outboundPolicy,
    clock: () => BASE_TIME + 20,
  });
  const runtime = new AIAgent1RuntimeService(database, {
    adminService: admin,
    now: () => BASE_TIME + 100,
  });
  return {
    database,
    root,
    actor,
    admin,
    runtime,
    secrets,
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function addProvider(f: Fixture) {
  return f.admin.createProvider({
    displayName: "Temporary Chat Provider",
    baseUrl: "https://provider.example/v1",
    apiFormat: "OPENAI_CHAT_COMPLETIONS",
    apiKey: "temporary-test-only",
    actor: f.actor,
  });
}

async function addModel(f: Fixture, providerId: string, providerModelId: string) {
  return f.admin.createModel({
    providerId,
    providerModelId,
    contextWindowTokens: 16_384,
    maxOutputTokens: 2_048,
    inputModalities: ["TEXT"],
    actor: f.actor,
  });
}

function aiTableCounts(database: ContentDatabase): Record<string, number> {
  const tables = database.client
    .prepare("select name from sqlite_master where type = 'table' and name like 'ai_%'")
    .all() as Array<{ name: string }>;
  return Object.fromEntries(
    tables
      .filter(({ name }) =>
        /conversation|telemetry|usage_cost|cost_operation|budget_reservation|retrieval_trace|tutor_response_trace|memory/iu.test(name),
      )
      .map(({ name }) => {
      const row = database.client.prepare(`select count(*) as count from "${name}"`).get() as {
        count?: number;
      };
      return [name, Number(row.count ?? 0)];
      }),
  );
}

test("direct mobile chat is development-only and accepts only the server-owned route", () => {
  assert.equal(isDevMobileChatEnabled("development"), true);
  assert.equal(isDevMobileChatEnabled("production"), false);
  assert.equal(isDevMobileChatEnabled("test"), false);
  assert.doesNotThrow(() => assertDevAgent1Fields({ messages: [] }, ["messages"]));
  assert.throws(() => assertDevAgent1Fields({ messages: [], modelId: "client-choice" }, ["messages"]));
  assert.throws(() => assertDevAgent1Fields({ messages: [], instructions: "client prompt" }, ["messages"]));
});

test("development chat response flushes each NDJSON delta before generation completes", async () => {
  let releaseSecondDelta: () => void = () => {};
  const waitingForSecondDelta = new Promise<void>((resolve) => {
    releaseSecondDelta = resolve;
  });
  const response = createAgent1DevChatStreamResponse(
    new AbortController().signal,
    async function* () {
      yield { type: "started" };
      yield { type: "text_delta", text: "الرد " };
      await waitingForSecondDelta;
      yield { type: "text_delta", text: "تدريجي" };
      yield { type: "completed" };
    },
  );

  assert.equal(response.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  const reader = response.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  const first = await reader.read();
  assert.deepEqual(JSON.parse(decoder.decode(first.value)), {
    type: "started",
  });

  const firstText = await reader.read();
  assert.deepEqual(JSON.parse(decoder.decode(firstText.value)), {
    type: "text_delta",
    text: "الرد ",
  });
  releaseSecondDelta();
  const second = await reader.read();
  assert.deepEqual(JSON.parse(decoder.decode(second.value)), {
    type: "text_delta",
    text: "تدريجي",
  });
  const done = await reader.read();
  assert.deepEqual(JSON.parse(decoder.decode(done.value)), { type: "completed" });
  assert.equal((await reader.read()).done, true);
  reader.releaseLock();
});

test("development chat stream error frames never expose provider detail", async () => {
  const response = createAgent1DevChatStreamResponse(
    new AbortController().signal,
    async function* () {
      yield { type: "started" };
      yield { type: "text_delta", text: "جزء" };
      throw new Agent1DevChatError("PROVIDER_FAILED", "private-provider-detail");
    },
  );
  const reader = response.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  await reader.read();
  await reader.read();
  const errorFrame = await reader.read();
  const errorText = decoder.decode(errorFrame.value);
  assert.deepEqual(JSON.parse(errorText), { type: "error", code: "PROVIDER_FAILED" });
  assert.equal(errorText.includes("private-provider-detail"), false);
  assert.equal((await reader.read()).done, true);
  reader.releaseLock();
});

test("cancelling the mobile stream aborts the Agent 1 stream runner", async () => {
  const response = createAgent1DevChatStreamResponse(
    new AbortController().signal,
    async function* (signal) {
      yield { type: "started" };
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  );
  const reader = response.body?.getReader();
  assert.ok(reader);
  await reader.read();
  await reader.cancel();
  assert.equal((await reader.read()).done, true);
  reader.releaseLock();
});

test("Agent 1 temporary chat follows the saved route and creates no chat, accounting, or telemetry rows", async () => {
  const f = fixture();
  try {
    const provider = await addProvider(f);
    const primary = await addModel(f, provider.id, "test-primary");
    const fallback = await addModel(f, provider.id, "test-fallback");
    f.runtime.saveRoute({
      actor: f.actor,
      expectedRevision: 0,
      primaryModelConfigId: primary.id,
      fallbackModelConfigIds: [fallback.id],
    });
    f.runtime.setEnabled({ actor: f.actor, enabled: true, expectedRevision: 1 });

    const before = aiTableCounts(f.database);
    const transport = new FallbackTransport("test-primary");
    const receivedEvents: Agent1DevChatStreamEvent[] = [];
    const textDeltasBeforeCompletion: boolean[] = [];
    let sawCompleted = false;
    const service = Agent1DevChatService.forDatabase(f.database, {
      runtimeService: f.runtime,
      secrets: f.secrets,
      outboundPolicy,
      transport,
      timeoutMs: 2_000,
    });
    for await (const event of service.stream({
      messages: [{ role: "user", content: "مرحبا" }],
    })) {
      if (event.type === "text_delta") textDeltasBeforeCompletion.push(!sawCompleted);
      if (event.type === "completed") sawCompleted = true;
      receivedEvents.push(event);
    }

    assert.deepEqual(receivedEvents, [
      { type: "started" },
      { type: "phase", phase: "thinking" },
      { type: "text_delta", text: "رد " },
      { type: "text_delta", text: "مؤقت" },
      { type: "completed" },
    ]);
    assert.deepEqual(textDeltasBeforeCompletion, [true, true]);
    assert.equal(JSON.stringify(receivedEvents).includes("PRIVATE REASONING MUST NOT LEAVE SERVER"), false);
    assert.deepEqual(transport.requestedModels, ["test-primary", "test-fallback"]);
    assert.equal(transport.requestBodies.length, 2);
    for (const requestBody of transport.requestBodies) {
      const systemMessage = requestBody.messages?.find((message) => message.role === "system");
      assert.ok(systemMessage?.content);
      assert.match(systemMessage.content, /GitHub-Flavored Markdown/u);
      assert.match(systemMessage.content, /inline mathematics in \$\.\.\.\$/u);
      assert.match(systemMessage.content, /display mathematics in \$\$\.\.\.\$\$/u);
      assert.match(systemMessage.content, /outside math delimiters/u);
      assert.match(systemMessage.content, /Do not emit raw HTML/u);
    }
    assert.deepEqual(aiTableCounts(f.database), before);
  } finally {
    f.close();
  }
});

test("temporary Agent 1 chat refuses disabled runtime and malformed history before provider use", async () => {
  const f = fixture();
  try {
    const service = Agent1DevChatService.forDatabase(f.database, {
      runtimeService: f.runtime,
      secrets: f.secrets,
      outboundPolicy,
    });
    await assert.rejects(
      (async () => {
        for await (const _event of service.stream({ messages: [{ role: "user", content: "مرحبا" }] })) {
          // The stream should fail before exposing any event while Agent 1 is disabled.
        }
      })(),
      (error: unknown) => error instanceof Agent1DevChatError && error.code === "AGENT_1_DISABLED",
    );
    await assert.rejects(
      (async () => {
        for await (const _event of service.stream({ messages: [{ role: "assistant", content: "رد" }] })) {
          // Invalid history must be rejected before provider access.
        }
      })(),
      (error: unknown) => error instanceof Agent1DevChatError && error.code === "CHAT_INVALID",
    );
  } finally {
    f.close();
  }
});
