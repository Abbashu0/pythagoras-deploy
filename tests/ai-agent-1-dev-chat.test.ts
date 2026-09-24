import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import { Agent1DevPairingRegistry } from "../src/server/ai/agent-1-runtime/dev-pairing";
import {
  Agent1DevChatError,
  Agent1DevChatService,
} from "../src/server/ai/agent-1-runtime/ephemeral-chat-service";
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

  constructor(private readonly primaryModelId: string) {}

  async request(
    _target: Parameters<AIProviderHttpTransport["request"]>[0],
    request: AIProviderHttpRequest,
  ): Promise<AIProviderHttpResponse> {
    const body = request.body
      ? JSON.parse(new TextDecoder().decode(request.body)) as { model?: string }
      : {};
    const modelId = body.model ?? "";
    this.requestedModels.push(modelId);
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
        'data: {"id":"dev-chat","choices":[{"delta":{"content":"رد مؤقت"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2}}\n\n',
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

test("one-time development pairing expires, rate-limits, and authorizes only bounded memory sessions", () => {
  let now = BASE_TIME;
  const registry = new Agent1DevPairingRegistry({
    now: () => now,
    createCode: () => "0123456789abcdefabcd",
    createToken: () => "t".repeat(48),
  });

  const issued = registry.issueCode();
  assert.equal(issued.expiresAt, BASE_TIME + 120_000);
  const paired = registry.redeemCode(issued.code);
  assert.equal(paired.ok, true);
  if (!paired.ok) return;

  assert.equal(registry.redeemCode(issued.code).ok, false);
  for (let request = 0; request < 32; request += 1) {
    assert.equal(registry.authorizeRequest(paired.token), true);
  }
  assert.equal(registry.authorizeRequest(paired.token), false);

  const secondPairing = registry.issueCode();
  const secondSession = registry.redeemCode(secondPairing.code);
  assert.equal(secondSession.ok, true);
  if (!secondSession.ok) return;
  registry.revokeSession(secondSession.token);
  assert.equal(registry.authorizeRequest(secondSession.token), false);

  const expiring = registry.issueCode();
  now += 120_001;
  assert.equal(registry.redeemCode(expiring.code).ok, false);
});

test("mobile inference is development-only and the request cannot choose a model", () => {
  assert.equal(isDevMobileChatEnabled("development"), true);
  assert.equal(isDevMobileChatEnabled("production"), false);
  assert.equal(isDevMobileChatEnabled("test"), false);
  assert.throws(() => assertDevAgent1Fields({ messages: [], modelId: "client-choice" }, ["messages"]));
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
    const service = Agent1DevChatService.forDatabase(f.database, {
      runtimeService: f.runtime,
      secrets: f.secrets,
      outboundPolicy,
      transport,
      timeoutMs: 2_000,
    });
    const result = await service.chat({
      messages: [{ role: "user", content: "مرحبا" }],
    });

    assert.deepEqual(Object.keys(result), ["reply"]);
    assert.equal(result.reply, "رد مؤقت");
    assert.deepEqual(transport.requestedModels, ["test-primary", "test-fallback"]);
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
      service.chat({ messages: [{ role: "user", content: "مرحبا" }] }),
      (error: unknown) => error instanceof Agent1DevChatError && error.code === "AGENT_1_DISABLED",
    );
    await assert.rejects(
      service.chat({ messages: [{ role: "assistant", content: "رد" }] }),
      (error: unknown) => error instanceof Agent1DevChatError && error.code === "CHAT_INVALID",
    );
  } finally {
    f.close();
  }
});
