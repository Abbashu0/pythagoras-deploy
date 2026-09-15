import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as createProvider } from "../src/app/api/admin/local/ai/providers/route";
import {
  GET as listProviders,
} from "../src/app/api/admin/local/ai/providers/route";
import {
  POST as createModel,
} from "../src/app/api/admin/local/ai/providers/[providerId]/models/route";
import {
  DELETE as deleteModel,
} from "../src/app/api/admin/local/ai/models/[modelId]/route";
import {
  DELETE as deleteProvider,
} from "../src/app/api/admin/local/ai/providers/[providerId]/route";
import { AI_SECRET_KEY_BYTES } from "../src/server/ai/secrets";
import type { ContentDatabase } from "../src/server/content";

const headers = {
  Host: "localhost:3000",
  Origin: "http://localhost:3000",
  "Sec-Fetch-Site": "same-origin",
  "Content-Type": "application/json",
};

test("local AI Admin routes use the direct same-origin workflow", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-admin-routes-"));
  const previousDataDirectory = process.env.PYTHAGORAS_DATA_DIR;
  const previousMasterKey = process.env.PYTHAGORAS_AI_MASTER_KEY;
  const globals = globalThis as typeof globalThis & {
    __pythagorasContentDatabase?: ContentDatabase;
  };
  process.env.PYTHAGORAS_DATA_DIR = root;
  process.env.PYTHAGORAS_AI_MASTER_KEY = Buffer.alloc(AI_SECRET_KEY_BYTES, 0x71).toString("hex");
  try {
    const providerResponse = await createProvider(
      new NextRequest("http://localhost:3000/api/admin/local/ai/providers", {
        method: "POST",
        headers,
        body: JSON.stringify({
          displayName: "Route Provider",
          baseUrl: "https://provider.example/v1",
          apiFormat: "OPENAI_CHAT_COMPLETIONS",
          apiKey: "ROUTE_SECRET_VALUE",
        }),
      }),
    );
    assert.equal(providerResponse.status, 201);
    const providerBody = await providerResponse.json() as {
      provider: { id: string; revision: number; models: unknown[] };
    };
    assert.equal(JSON.stringify(providerBody).includes("ROUTE_SECRET_VALUE"), false);

    const modelResponse = await createModel(
      new NextRequest("http://localhost:3000/api/admin/local/ai/providers/x/models", {
        method: "POST",
        headers,
        body: JSON.stringify({
          providerModelId: "model-name:free",
          contextWindowTokens: 8192,
          maxOutputTokens: 1024,
          inputModalities: ["TEXT", "PDF"],
        }),
      }),
      { params: Promise.resolve({ providerId: providerBody.provider.id }) },
    );
    assert.equal(modelResponse.status, 201);
    const modelBody = await modelResponse.json() as { model: { id: string; revision: number } };

    const listResponse = await listProviders(
      new NextRequest("http://localhost:3000/api/admin/local/ai/providers", { headers }),
    );
    assert.equal(listResponse.status, 200);
    const listBody = await listResponse.json() as { providers: Array<{ id: string; modelCount: number }> };
    assert.equal(listBody.providers[0].id, providerBody.provider.id);
    assert.equal(listBody.providers[0].modelCount, 1);

    const removedModel = await deleteModel(
      new NextRequest("http://localhost:3000/api/admin/local/ai/models/x", {
        method: "DELETE",
        headers,
        body: JSON.stringify({ expectedRevision: modelBody.model.revision }),
      }),
      { params: Promise.resolve({ modelId: modelBody.model.id }) },
    );
    assert.equal(removedModel.status, 200);

    const removedProvider = await deleteProvider(
      new NextRequest("http://localhost:3000/api/admin/local/ai/providers/x", {
        method: "DELETE",
        headers,
        body: JSON.stringify({ expectedRevision: providerBody.provider.revision }),
      }),
      { params: Promise.resolve({ providerId: providerBody.provider.id }) },
    );
    assert.equal(removedProvider.status, 200);
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
