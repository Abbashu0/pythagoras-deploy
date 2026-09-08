import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { v7 as uuidv7 } from "uuid";

import { POST as createProvider } from "../src/app/api/admin/ai/providers/route";
import { DELETE as removeProvider, PATCH as updateProvider } from "../src/app/api/admin/ai/providers/[providerId]/route";
import { createAdminAuthService } from "../src/server/admin-auth";
import { SQLiteAIProviderConfigRepository } from "../src/server/ai/configuration";
import { AI_SECRET_KEY_BYTES } from "../src/server/ai/secrets";
import { getContentDatabase, type ContentDatabase } from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");

test("Admin Provider lifecycle creates immediately and removes the canonical row plus its credential", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-provider-admin-lifecycle-"));
  const previousDataDirectory = process.env.PYTHAGORAS_DATA_DIR;
  const previousMasterKey = process.env.PYTHAGORAS_AI_MASTER_KEY;
  const globals = globalThis as typeof globalThis & {
    __pythagorasContentDatabase?: ContentDatabase;
    __pythagorasAdminAuthService?: unknown;
  };
  process.env.PYTHAGORAS_DATA_DIR = root;
  process.env.PYTHAGORAS_AI_MASTER_KEY = Buffer.alloc(AI_SECRET_KEY_BYTES, 0x55).toString("hex");

  try {
    const database = getContentDatabase();
    const authentication = await createAdminAuthService(database).setupInitialOwner({
      displayName: "Provider Owner",
      email: `provider-owner-${uuidv7()}@example.test`,
      password: "ProviderTestPassword-123!",
    });
    const headers = {
      Cookie: `pythagoras_admin_session=${authentication.rawToken}`,
      Host: "localhost:3000",
      Origin: "http://localhost:3000",
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
    };

    const createdResponse = await createProvider(new NextRequest("http://localhost:3000/api/admin/ai/providers", {
      method: "POST",
      headers,
      body: JSON.stringify({
        displayName: "Immediate Provider",
        key: `immediate-${uuidv7()}`,
        baseUrl: "https://provider.example/v1",
        retentionPolicy: "ZERO_RETENTION",
        trainingPolicy: "NOT_USED_FOR_TRAINING",
        zdrSupported: true,
        zdrRequired: true,
        secret: "TOP_SECRET_PROVIDER_ADMIN_KEY",
      }),
    }));
    assert.equal(createdResponse.status, 201);
    const createdBody = await createdResponse.json() as { ok: boolean; provider: { id: string; enabled: boolean; credentialConfigured: boolean; credentialStatus: string }; [key: string]: unknown };
    assert.equal(createdBody.ok, true);
    assert.equal(createdBody.provider.enabled, true);
    assert.equal(createdBody.provider.credentialConfigured, true);
    assert.equal(createdBody.provider.credentialStatus, "ACTIVE");
    assert.equal(JSON.stringify(createdBody).includes("TOP_SECRET_PROVIDER_ADMIN_KEY"), false);

    const repository = new SQLiteAIProviderConfigRepository(database);
    const created = repository.getById(createdBody.provider.id);
    assert.ok(created);
    assert.equal(created.enabled, true);
    assert.ok(created.credentialRef);

    const disabledResponse = await updateProvider(new NextRequest(`http://localhost:3000/api/admin/ai/providers/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ enabled: false, expectedRevision: created.revision }),
    }), { params: Promise.resolve({ providerId: created.id }) });
    assert.equal(disabledResponse.status, 200);
    assert.equal(repository.getById(created.id)?.enabled, false);
    assert.equal(Number((database.client.prepare("select count(*) as count from change_sets where status='PUBLISHED'").get() as { count: number }).count) >= 1, true);

    const removedResponse = await removeProvider(new NextRequest(`http://localhost:3000/api/admin/ai/providers/${created.id}`, {
      method: "DELETE",
      headers,
    }), { params: Promise.resolve({ providerId: created.id }) });
    assert.equal(removedResponse.status, 200);
    assert.deepEqual(await removedResponse.json(), { ok: true, providerId: created.id, messageCode: "AI_PROVIDER_REMOVED" });
    assert.equal(repository.getById(created.id), null);
    const secretStatus = database.client.prepare("select status from ai_secret_refs where credential_ref = ?").get(created.credentialRef) as { status: string } | undefined;
    assert.equal(secretStatus?.status, "REVOKED");
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
