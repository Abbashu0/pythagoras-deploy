import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { v7 as uuidv7 } from "uuid";

import { POST as createModel } from "../src/app/api/admin/ai/models/route";
import { createAdminAuthService } from "../src/server/admin-auth";
import { SQLiteAIProviderConfigRepository } from "../src/server/ai/configuration";
import { SQLiteAIModelConfigRepository } from "../src/server/ai/model-registry";
import { AI_SECRET_KEY_BYTES, createLocalAISecretStore } from "../src/server/ai/secrets";
import { getContentDatabase, type ContentDatabase } from "../src/server/content";

test("Admin Model lifecycle creates an enabled model against a ready Provider", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-model-admin-lifecycle-"));
  const previousDataDirectory = process.env.PYTHAGORAS_DATA_DIR;
  const previousMasterKey = process.env.PYTHAGORAS_AI_MASTER_KEY;
  const globals = globalThis as typeof globalThis & {
    __pythagorasContentDatabase?: ContentDatabase;
    __pythagorasAdminAuthService?: unknown;
  };
  process.env.PYTHAGORAS_DATA_DIR = root;
  process.env.PYTHAGORAS_AI_MASTER_KEY = Buffer.alloc(AI_SECRET_KEY_BYTES, 0x56).toString("hex");

  try {
    const database = getContentDatabase();
    const authentication = await createAdminAuthService(database).setupInitialOwner({
      displayName: "Model Owner",
      email: `model-owner-${uuidv7()}@example.test`,
      password: "ModelTestPassword-123!",
    });
    const owner = { actorUserId: authentication.authentication.user.id, actorRole: "OWNER" as const };
    const secret = await createLocalAISecretStore(database).create({ secret: "MODEL_PROVIDER_SECRET", actor: { type: "ADMIN", actorUserId: owner.actorUserId } });
    const provider = new SQLiteAIProviderConfigRepository(database).create({ id: uuidv7(), content: { key: `model-provider-${uuidv7()}`, displayName: "Model Provider", baseUrl: "https://provider.example/v1", credentialRef: secret.credentialRef, enabled: true, retentionPolicy: "UNKNOWN", trainingPolicy: "UNKNOWN", zdrSupported: false, zdrRequired: false }, actor: owner, now: Date.now() });
    const headers = { Cookie: `pythagoras_admin_session=${authentication.rawToken}`, Host: "localhost:3000", Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" };

    const response = await createModel(new NextRequest("http://localhost:3000/api/admin/ai/models", { method: "POST", headers, body: JSON.stringify({ displayName: "Tutor Generation Model", key: `tutor-generation-${uuidv7()}`, providerConfigId: provider.id, providerModelId: "provider-generation-model", capability: "GENERATION", adapterKey: "test.generation", contextWindowTokens: 8192, maxOutputTokens: 1024, embeddingDimensions: null, supportsStreaming: true, supportsReasoning: false, supportsStructuredOutput: true }) }));
    assert.equal(response.status, 201);
    const body = await response.json() as { ok: boolean; model: { id: string; enabled: boolean; providerConfigId: string; capability: string }; [key: string]: unknown };
    assert.equal(body.ok, true);
    assert.equal(body.model.enabled, true);
    assert.equal(body.model.providerConfigId, provider.id);
    assert.equal(body.model.capability, "GENERATION");
    assert.equal(JSON.stringify(body).includes("MODEL_PROVIDER_SECRET"), false);
    assert.equal(new SQLiteAIModelConfigRepository(database).getById(body.model.id)?.enabled, true);
  } finally {
    globals.__pythagorasContentDatabase?.close();
    delete globals.__pythagorasContentDatabase;
    delete globals.__pythagorasAdminAuthService;
    if (previousDataDirectory === undefined) delete process.env.PYTHAGORAS_DATA_DIR;
    else process.env.PYTHAGORAS_DATA_DIR = previousDataDirectory;
    if (previousMasterKey === undefined) delete process.env.PYTHAGORAS_AI_MASTER_KEY;
    else process.env.PYTHAGORAS_AI_MASTER_KEY = previousMasterKey;
    rmSync(root, { recursive: true, force: true });
  }
});
