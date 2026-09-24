import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";
import { NextRequest } from "next/server";

import { PATCH, PUT, GET } from "../src/app/api/admin/local/ai/agent-1/runtime/route";
import { AIAdminDirectService } from "../src/server/ai/admin-direct-service";
import { AIAgent1RuntimeError } from "../src/server/ai/agent-1-runtime/errors";
import { AIAgent1RuntimeService } from "../src/server/ai/agent-1-runtime/service";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth";
import type { AdminActor } from "../src/server/admin-auth/contracts";
import { AI_SECRET_KEY_BYTES, createLocalAISecretStore } from "../src/server/ai/secrets";
import { normalizeAIModelConfigContent, SQLiteAIModelConfigRepository } from "../src/server/ai/model-registry";
import { SQLiteAIProviderConfigRepository } from "../src/server/ai/configuration";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const TEST_MASTER_KEY = Buffer.alloc(AI_SECRET_KEY_BYTES, 0x39);
const BASE_TIME = 1_900_300_000_000;
const localHeaders = {
  Host: "localhost:3000",
  Origin: "http://localhost:3000",
  "Sec-Fetch-Site": "same-origin",
  "Content-Type": "application/json",
};

interface Fixture {
  root: string;
  database: ContentDatabase;
  actor: AdminActor;
  admin: AIAdminDirectService;
  runtime: AIAgent1RuntimeService;
  secrets: ReturnType<typeof createLocalAISecretStore>;
  close(): void;
}

function fixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-agent-1-runtime-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const identity = new SQLiteAdminIdentityRepository(database);
  const user = identity.createInitialOwner({
    id: uuidv7(),
    email: `agent1-${uuidv7()}@example.test`,
    displayName: "Agent 1 Runtime Owner",
    passwordHash: "fixture-only",
    createdAt: BASE_TIME,
  });
  const actor: AdminActor = { actorUserId: user.id, actorRole: "OWNER" };
  const secrets = createLocalAISecretStore(database, {
    masterKey: TEST_MASTER_KEY,
    clock: () => BASE_TIME + 10,
  });
  const admin = AIAdminDirectService.forDatabase(database, {
    secrets,
    clock: () => BASE_TIME + 20,
  });
  const runtime = new AIAgent1RuntimeService(database, {
    adminService: admin,
    now: () => BASE_TIME + 100,
  });
  return {
    root,
    database,
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

async function addProvider(f: Fixture, name: string) {
  return f.admin.createProvider({
    displayName: name,
    baseUrl: "https://provider.example/v1",
    apiFormat: "OPENAI_CHAT_COMPLETIONS",
    apiKey: `secret-only-${name}`,
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

test("Agent 1 starts safely unconfigured and cannot be enabled without a ready primary", () => {
  const f = fixture();
  try {
    const initial = f.runtime.getSnapshot();
    assert.deepEqual(initial.config, {
      enabled: false,
      primaryModelConfigId: null,
      fallbackModelConfigIds: [],
      revision: 0,
      createdAt: null,
      updatedAt: null,
    });
    assert.equal(initial.primary, null);
    assert.equal(initial.execution.connected, false);
    const unchanged = f.runtime.setEnabled({ actor: f.actor, enabled: false, expectedRevision: 0 });
    assert.equal(unchanged.config.revision, 0);
    assert.throws(
      () => f.runtime.setEnabled({ actor: f.actor, enabled: true, expectedRevision: 0 }),
      (error: unknown) => error instanceof AIAgent1RuntimeError && error.code === "AI_AGENT_1_RUNTIME_PRIMARY_REQUIRED",
    );
    assert.equal(f.runtime.getSnapshot().config.revision, 0);
  } finally {
    f.close();
  }
});

test("Agent 1 accepts only existing Generation models and rejects duplicate/oversized chains", async () => {
  const f = fixture();
  try {
    const provider = await addProvider(f, "Chain Provider");
    const primary = await addModel(f, provider.id, "generation-primary");
    const fallback = await addModel(f, provider.id, "generation-fallback");
    const duplicate = [fallback.id, fallback.id];
    assert.throws(
      () => f.runtime.saveRoute({
        actor: f.actor,
        expectedRevision: 0,
        primaryModelConfigId: primary.id,
        fallbackModelConfigIds: duplicate,
      }),
      (error: unknown) => error instanceof AIAgent1RuntimeError && error.code === "AI_AGENT_1_RUNTIME_INVALID",
    );
    assert.throws(
      () => f.runtime.saveRoute({
        actor: f.actor,
        expectedRevision: 0,
        primaryModelConfigId: primary.id,
        fallbackModelConfigIds: [fallback.id, uuidv7(), uuidv7(), uuidv7()],
      }),
      (error: unknown) => error instanceof AIAgent1RuntimeError && error.code === "AI_AGENT_1_RUNTIME_INVALID",
    );
    assert.throws(
      () => f.runtime.saveRoute({
        actor: f.actor,
        expectedRevision: 0,
        primaryModelConfigId: primary.id,
        fallbackModelConfigIds: [primary.id],
      }),
      (error: unknown) => error instanceof AIAgent1RuntimeError && error.code === "AI_AGENT_1_RUNTIME_INVALID",
    );
    assert.throws(
      () => f.runtime.saveRoute({
        actor: f.actor,
        expectedRevision: 0,
        primaryModelConfigId: uuidv7(),
        fallbackModelConfigIds: [],
      }),
      (error: unknown) => error instanceof AIAgent1RuntimeError && error.code === "AI_AGENT_1_RUNTIME_MODEL_NOT_FOUND",
    );
    assert.equal(f.runtime.getSnapshot().config.revision, 0);
  } finally {
    f.close();
  }
});

test("fallback order saves atomically, revisions conflict, and Agent 1 models cannot be deleted", async () => {
  const f = fixture();
  try {
    const provider = await addProvider(f, "Ordered Provider");
    const primary = await addModel(f, provider.id, "generation-primary");
    const first = await addModel(f, provider.id, "generation-first");
    const second = await addModel(f, provider.id, "generation-second");
    const third = await addModel(f, provider.id, "generation-third");
    const saved = f.runtime.saveRoute({
      actor: f.actor,
      expectedRevision: 0,
      primaryModelConfigId: primary.id,
      fallbackModelConfigIds: [first.id, second.id, third.id],
    });
    assert.equal(saved.config.revision, 1);
    assert.deepEqual(saved.config.fallbackModelConfigIds, [first.id, second.id, third.id]);

    const reordered = f.runtime.saveRoute({
      actor: f.actor,
      expectedRevision: 1,
      primaryModelConfigId: primary.id,
      fallbackModelConfigIds: [third.id, first.id, second.id],
    });
    assert.equal(reordered.config.revision, 2);
    assert.deepEqual(reordered.config.fallbackModelConfigIds, [third.id, first.id, second.id]);

    assert.throws(
      () => f.runtime.saveRoute({
        actor: f.actor,
        expectedRevision: 1,
        primaryModelConfigId: primary.id,
        fallbackModelConfigIds: [first.id, second.id, third.id],
      }),
      (error: unknown) => error instanceof AIAgent1RuntimeError && error.code === "AI_AGENT_1_RUNTIME_CONFLICT",
    );

    f.database.client.exec(`
      CREATE TRIGGER agent_1_test_fail_second_fallback
      BEFORE INSERT ON ai_agent_runtime_fallback_models
      WHEN NEW.position = 2
      BEGIN SELECT RAISE(ABORT, 'test rollback'); END;
    `);
    assert.throws(
      () => f.runtime.saveRoute({
        actor: f.actor,
        expectedRevision: 2,
        primaryModelConfigId: primary.id,
        fallbackModelConfigIds: [first.id, third.id, second.id],
      }),
      (error: unknown) => error instanceof AIAgent1RuntimeError && error.code === "AI_AGENT_1_RUNTIME_CONFLICT",
    );
    f.database.client.exec("DROP TRIGGER agent_1_test_fail_second_fallback");
    const afterRollback = f.runtime.getSnapshot();
    assert.equal(afterRollback.config.revision, 2);
    assert.deepEqual(afterRollback.config.fallbackModelConfigIds, [third.id, first.id, second.id]);

    assert.throws(
      () => f.admin.deleteModel({ modelId: second.id, expectedRevision: second.revision }),
      (error: unknown) => error instanceof Error &&
        "code" in error && (error as { code?: string }).code === "AI_ADMIN_MODEL_DELETE_BLOCKED" &&
        JSON.stringify((error as { details?: unknown }).details).includes("Agent 1 fallback route"),
    );
    assert.throws(
      () => f.admin.deleteModel({ modelId: primary.id, expectedRevision: primary.revision }),
      (error: unknown) => error instanceof Error &&
        "code" in error && (error as { code?: string }).code === "AI_ADMIN_MODEL_DELETE_BLOCKED" &&
        JSON.stringify((error as { details?: unknown }).details).includes("Agent 1 primary route"),
    );
  } finally {
    f.close();
  }
});

test("readiness exposes disabled model/provider, missing credential and unsupported adapter without secrets", async () => {
  const f = fixture();
  try {
    const provider = await addProvider(f, "Readiness Provider");
    const model = await addModel(f, provider.id, "readiness-model");
    const saved = f.runtime.saveRoute({
      actor: f.actor,
      expectedRevision: 0,
      primaryModelConfigId: model.id,
      fallbackModelConfigIds: [],
    });
    assert.equal(saved.canEnable, true);
    assert.equal(JSON.stringify(saved).includes("secret-only-Readiness Provider"), false);
    assert.equal(JSON.stringify(saved).includes("credentialRef"), false);

    f.admin.setModelEnabled({
      modelId: model.id,
      enabled: false,
      expectedRevision: model.revision,
      actor: f.actor,
    });
    assert.equal(f.runtime.getSnapshot().primary?.readiness, "MODEL_DISABLED");

    const currentModel = new SQLiteAIModelConfigRepository(f.database).getById(model.id)!;
    f.admin.setModelEnabled({
      modelId: model.id,
      enabled: true,
      expectedRevision: currentModel.revision,
      actor: f.actor,
    });
    const currentProvider = new SQLiteAIProviderConfigRepository(f.database).getById(provider.id)!;
    f.admin.setProviderEnabled({
      providerId: provider.id,
      enabled: false,
      expectedRevision: currentProvider.revision,
      actor: f.actor,
    });
    assert.equal(f.runtime.getSnapshot().primary?.readiness, "PROVIDER_DISABLED");
    assert.throws(
      () => f.runtime.setEnabled({ actor: f.actor, enabled: true, expectedRevision: 1 }),
      (error: unknown) => error instanceof AIAgent1RuntimeError && error.code === "AI_AGENT_1_RUNTIME_MODEL_NOT_READY",
    );

    const reopenedProvider = new SQLiteAIProviderConfigRepository(f.database).getById(provider.id)!;
    f.admin.setProviderEnabled({
      providerId: provider.id,
      enabled: true,
      expectedRevision: reopenedProvider.revision,
      actor: f.actor,
    });

    const modelRepo = new SQLiteAIModelConfigRepository(f.database);
    const currentModelForAdapter = modelRepo.getById(model.id)!;
    modelRepo.update({
      id: model.id,
      expectedRevision: currentModelForAdapter.revision,
      actor: f.actor,
      now: BASE_TIME + 90,
      content: normalizeAIModelConfigContent({
        key: currentModelForAdapter.key,
        displayName: currentModelForAdapter.displayName,
        providerConfigId: currentModelForAdapter.providerConfigId,
        providerModelId: currentModelForAdapter.providerModelId,
        capability: currentModelForAdapter.capability,
        adapterKey: "unregistered-generation-v1",
        enabled: currentModelForAdapter.enabled,
        contextWindowTokens: currentModelForAdapter.contextWindowTokens,
        maxOutputTokens: currentModelForAdapter.maxOutputTokens,
        embeddingDimensions: currentModelForAdapter.embeddingDimensions,
        supportsStreaming: currentModelForAdapter.supportsStreaming,
        supportsReasoning: currentModelForAdapter.supportsReasoning,
        supportsStructuredOutput: currentModelForAdapter.supportsStructuredOutput,
        inputModalities: currentModelForAdapter.inputModalities,
        outputModalities: currentModelForAdapter.outputModalities,
      }),
    });
    assert.equal(f.runtime.getSnapshot().primary?.readiness, "ADAPTER_UNAVAILABLE");

    const currentAfterAdapterCheck = modelRepo.getById(model.id)!;
    modelRepo.update({
      id: model.id,
      expectedRevision: currentAfterAdapterCheck.revision,
      actor: f.actor,
      now: BASE_TIME + 91,
      content: normalizeAIModelConfigContent({
        key: currentAfterAdapterCheck.key,
        displayName: currentAfterAdapterCheck.displayName,
        providerConfigId: currentAfterAdapterCheck.providerConfigId,
        providerModelId: currentAfterAdapterCheck.providerModelId,
        capability: currentAfterAdapterCheck.capability,
        adapterKey: model.adapterKey,
        enabled: currentAfterAdapterCheck.enabled,
        contextWindowTokens: currentAfterAdapterCheck.contextWindowTokens,
        maxOutputTokens: currentAfterAdapterCheck.maxOutputTokens,
        embeddingDimensions: currentAfterAdapterCheck.embeddingDimensions,
        supportsStreaming: currentAfterAdapterCheck.supportsStreaming,
        supportsReasoning: currentAfterAdapterCheck.supportsReasoning,
        supportsStructuredOutput: currentAfterAdapterCheck.supportsStructuredOutput,
        inputModalities: currentAfterAdapterCheck.inputModalities,
        outputModalities: currentAfterAdapterCheck.outputModalities,
      }),
    });

    const credentialRef = new SQLiteAIProviderConfigRepository(f.database).getById(provider.id)!.credentialRef!;
    await f.secrets.revoke({
      credentialRef,
      actor: { type: "ADMIN", actorUserId: f.actor.actorUserId },
    });
    assert.equal(f.runtime.getSnapshot().primary?.readiness, "CREDENTIAL_UNAVAILABLE");
  } finally {
    f.close();
  }
});

test("Agent 1 runtime routes preserve local-admin protections and reject browser actors", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-agent-1-route-"));
  const previousDataDirectory = process.env.PYTHAGORAS_DATA_DIR;
  const previousMasterKey = process.env.PYTHAGORAS_AI_MASTER_KEY;
  const globals = globalThis as typeof globalThis & {
    __pythagorasContentDatabase?: ContentDatabase;
  };
  process.env.PYTHAGORAS_DATA_DIR = root;
  process.env.PYTHAGORAS_AI_MASTER_KEY = TEST_MASTER_KEY.toString("hex");
  try {
    const read = await GET(new NextRequest(
      "http://localhost:3000/api/admin/local/ai/agent-1/runtime",
      { headers: localHeaders },
    ));
    assert.equal(read.status, 200);
    const body = await read.json() as {
      ok: boolean;
      config: { enabled: boolean; revision: number };
      models: unknown[];
      execution: { connected: boolean };
    };
    assert.equal(body.ok, true);
    assert.equal(body.config.enabled, false);
    assert.equal(body.config.revision, 0);
    assert.deepEqual(body.models, []);
    assert.equal(body.execution.connected, false);

    const suppliedActor = await PUT(new NextRequest(
      "http://localhost:3000/api/admin/local/ai/agent-1/runtime",
      {
        method: "PUT",
        headers: localHeaders,
        body: JSON.stringify({
          expectedRevision: 0,
          primaryModelConfigId: null,
          fallbackModelConfigIds: [],
          actorId: "browser-controlled",
        }),
      },
    ));
    assert.equal(suppliedActor.status, 400);

    const crossOrigin = await PATCH(new NextRequest(
      "http://localhost:3000/api/admin/local/ai/agent-1/runtime",
      {
        method: "PATCH",
        headers: { ...localHeaders, Origin: "https://untrusted.example" },
        body: JSON.stringify({ expectedRevision: 0, enabled: false }),
      },
    ));
    assert.equal(crossOrigin.status, 403);
  } finally {
    globals.__pythagorasContentDatabase?.close();
    delete globals.__pythagorasContentDatabase;
    if (previousDataDirectory === undefined) delete process.env.PYTHAGORAS_DATA_DIR;
    else process.env.PYTHAGORAS_DATA_DIR = previousDataDirectory;
    if (previousMasterKey === undefined) delete process.env.PYTHAGORAS_AI_MASTER_KEY;
    else process.env.PYTHAGORAS_AI_MASTER_KEY = previousMasterKey;
    rmSync(root, { recursive: true, force: true });
  }
});

test("selected models must have Generation capability", async () => {
  const f = fixture();
  try {
    const provider = await addProvider(f, "Capability Provider");
    const modelRepo = new SQLiteAIModelConfigRepository(f.database);
    const embedding = modelRepo.create({
      id: uuidv7(),
      actor: f.actor,
      now: BASE_TIME + 30,
      content: normalizeAIModelConfigContent({
        key: `embedding-${uuidv7()}`,
        displayName: "Embedding model",
        providerConfigId: provider.id,
        providerModelId: "embedding-model",
        capability: "EMBEDDING",
        adapterKey: "openai-compatible-embedding-v1",
        enabled: true,
        contextWindowTokens: null,
        maxOutputTokens: null,
        embeddingDimensions: 1536,
        supportsStreaming: false,
        supportsReasoning: false,
        supportsStructuredOutput: false,
        inputModalities: ["TEXT"],
        outputModalities: ["TEXT"],
      }),
    });
    assert.throws(
      () => f.runtime.saveRoute({
        actor: f.actor,
        expectedRevision: 0,
        primaryModelConfigId: embedding.id,
        fallbackModelConfigIds: [],
      }),
      (error: unknown) => error instanceof AIAgent1RuntimeError && error.code === "AI_AGENT_1_RUNTIME_INVALID",
    );
    const snapshot = f.runtime.getSnapshot();
    assert.equal(snapshot.config.revision, 0);
    assert.equal(snapshot.models.find((model) => model.id === embedding.id)?.readiness, "INCOMPATIBLE_CAPABILITY");
  } finally {
    f.close();
  }
});
