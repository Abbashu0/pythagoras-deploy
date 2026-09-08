import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import { AIProviderConnectionTester, AIProviderConnectionTransportError } from "../src/server/ai/provider-connection";
import type { AIProviderHttpTransport, AIProviderHttpResponse, OutboundTargetPolicy, ValidatedOutboundTarget } from "../src/server/ai/gateway";
import { AI_SECRET_KEY_BYTES, createLocalAISecretStore, type AISecretStoreAdapter } from "../src/server/ai/secrets";
import { SQLiteAIProviderConfigRepository } from "../src/server/ai/configuration";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth";
import { createCanonicalContentRepository } from "../src/server/canonical-content";
import { openContentDatabase, type ContentDatabase } from "../src/server/content";
import type { AdminActor } from "../src/server/admin-auth/contracts";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const TEST_MASTER_KEY = Buffer.alloc(AI_SECRET_KEY_BYTES, 0x4f);

class FakeTransport implements AIProviderHttpTransport {
  mode: "success" | "auth" | "forbidden" | "server" | "invalid" | "oversized" | "timeout" | "network" | "redirect" = "success";
  lastRequest: Parameters<AIProviderHttpTransport["request"]>[1] | null = null;
  async request(_target: ValidatedOutboundTarget, request: Parameters<AIProviderHttpTransport["request"]>[1]): Promise<AIProviderHttpResponse> {
    this.lastRequest = request;
    if (this.mode === "timeout" || this.mode === "network" || this.mode === "redirect" || this.mode === "oversized") throw new AIProviderConnectionTransportError(this.mode === "timeout" ? "TIMEOUT" : this.mode === "network" ? "UNREACHABLE" : this.mode === "redirect" ? "REDIRECT" : "RESPONSE_TOO_LARGE");
    const status = this.mode === "auth" ? 401 : this.mode === "forbidden" ? 403 : this.mode === "server" ? 503 : 200;
    const body = this.mode === "invalid" ? "not-json" : JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] });
    return { status, headers: { "content-type": "application/json" }, body: bytes(body) };
  }
}

function bytes(text: string): AsyncIterable<Uint8Array> {
  return (async function* () { yield new TextEncoder().encode(text); })();
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-provider-connection-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  createCanonicalContentRepository(database).bootstrap();
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({ id: uuidv7(), email: `owner-${uuidv7()}@provider-connection.test`, displayName: "Provider Owner", passwordHash: "fixture", createdAt: 1_900_500_000_000 });
  const owner: AdminActor = { actorUserId: ownerUser.id, actorRole: "OWNER" };
  const secrets = createLocalAISecretStore(database, { masterKey: TEST_MASTER_KEY, clock: () => 1_900_500_000_100 });
  return { root, database, owner, secrets, close() { database.close(); try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }); } catch {} } };
}

async function createProvider(fixtureValue: ReturnType<typeof fixture>, input: { enabled?: boolean; baseUrl?: string; credentialRef?: string | null } = {}) {
  const secret = input.credentialRef === undefined ? await fixtureValue.secrets.create({ secret: `provider-secret-${uuidv7()}`, actor: { type: "ADMIN", actorUserId: fixtureValue.owner.actorUserId } }) : null;
  const providerId = uuidv7();
  new SQLiteAIProviderConfigRepository(fixtureValue.database).create({ id: providerId, actor: fixtureValue.owner, now: 1_900_500_000_200, content: { key: `provider-${uuidv7()}`, displayName: "Canonical Test Provider", baseUrl: input.baseUrl ?? "https://api.example.com/v1", credentialRef: input.credentialRef === undefined ? secret!.credentialRef : input.credentialRef, enabled: input.enabled ?? true, retentionPolicy: "UNKNOWN", trainingPolicy: "UNKNOWN", zdrSupported: false, zdrRequired: false } });
  return { providerId, secretValue: secret ? `provider-secret-${""}` : null };
}

function publicTarget(url = "https://api.example.com/v1"): OutboundTargetPolicy { return { validate: async () => ({ url, hostname: "api.example.com", port: 443, resolvedAddresses: ["93.184.216.34"] }) }; }

test("published Provider connection test uses canonical /models and returns safe metadata", async () => {
  const f = fixture();
  try {
    const secret = await f.secrets.create({ secret: "TOP_SECRET_PROVIDER_KEY", actor: { type: "ADMIN", actorUserId: f.owner.actorUserId } });
    const providerId = uuidv7();
    new SQLiteAIProviderConfigRepository(f.database).create({ id: providerId, actor: f.owner, now: 1_900_500_000_200, content: { key: `provider-${uuidv7()}`, displayName: "Canonical Test Provider", baseUrl: "https://api.example.com/v1", credentialRef: secret.credentialRef, enabled: true, retentionPolicy: "UNKNOWN", trainingPolicy: "UNKNOWN", zdrSupported: false, zdrRequired: false } });
    const transport = new FakeTransport();
    const result = await new AIProviderConnectionTester(f.database, { secrets: f.secrets, outboundPolicy: publicTarget(), transport, clock: () => 1_900_500_000_500 }).test(providerId);
    assert.equal(result.status, "CONNECTED");
    assert.equal(result.modelCount, 2);
    assert.deepEqual(result.modelIds, ["model-a", "model-b"]);
    assert.equal(transport.lastRequest?.method, "GET");
    assert.equal(transport.lastRequest?.pathAndQuery, "models");
    assert.equal(transport.lastRequest?.headers?.Accept, "application/json");
    assert.equal(transport.lastRequest?.headers?.Authorization, "Bearer TOP_SECRET_PROVIDER_KEY");
    assert.equal(JSON.stringify(result).includes("TOP_SECRET_PROVIDER_KEY"), false);
  } finally { f.close(); }
});

test("Provider connection maps auth, provider, protocol, timeout, network, oversized, and redirect failures safely", async () => {
  const f = fixture();
  try {
    const secret = await f.secrets.create({ secret: "provider-secret", actor: { type: "ADMIN", actorUserId: f.owner.actorUserId } });
    const providerId = uuidv7();
    new SQLiteAIProviderConfigRepository(f.database).create({ id: providerId, actor: f.owner, now: 1_900_500_000_200, content: { key: `provider-${uuidv7()}`, displayName: "Canonical Test Provider", baseUrl: "https://api.example.com/v1", credentialRef: secret.credentialRef, enabled: true, retentionPolicy: "UNKNOWN", trainingPolicy: "UNKNOWN", zdrSupported: false, zdrRequired: false } });
    const transport = new FakeTransport();
    const tester = new AIProviderConnectionTester(f.database, { secrets: f.secrets, outboundPolicy: publicTarget(), transport, clock: () => 1_900_500_000_500 });
    for (const [mode, expected] of [["auth", "AUTH_FAILED"], ["forbidden", "AUTH_FAILED"], ["server", "PROVIDER_ERROR"], ["invalid", "UNSUPPORTED"], ["timeout", "TIMEOUT"], ["network", "UNREACHABLE"], ["oversized", "UNSUPPORTED"], ["redirect", "UNSUPPORTED"]] as const) { transport.mode = mode; const result = await tester.test(providerId); assert.equal(result.status, expected, mode); assert.equal(JSON.stringify(result).includes("provider-secret"), false); }
  } finally { f.close(); }
});

test("Provider connection fails closed for disabled, missing, unpublished, and private targets", async () => {
  const f = fixture();
  try {
    const transport = new FakeTransport();
    const disabled = await createProvider(f, { enabled: false, credentialRef: null });
    const disabledResult = await new AIProviderConnectionTester(f.database, { secrets: f.secrets, outboundPolicy: publicTarget(), transport }).test(disabled.providerId);
    assert.equal(disabledResult.messageCode, "PROVIDER_DISABLED");
    await assert.rejects(() => new AIProviderConnectionTester(f.database, { secrets: f.secrets, outboundPolicy: publicTarget(), transport }).test(uuidv7()), /not found/i);
    const secret = await f.secrets.create({ secret: "private-target-secret", actor: { type: "ADMIN", actorUserId: f.owner.actorUserId } });
    const privateProvider = uuidv7();
    new SQLiteAIProviderConfigRepository(f.database).create({ id: privateProvider, actor: f.owner, now: 1_900_500_000_200, content: { key: `private-${uuidv7()}`, displayName: "Private Target", baseUrl: "https://private.example/v1", credentialRef: secret.credentialRef, enabled: true, retentionPolicy: "UNKNOWN", trainingPolicy: "UNKNOWN", zdrSupported: false, zdrRequired: false } });
    const result = await new AIProviderConnectionTester(f.database, { secrets: f.secrets, outboundPolicy: { validate: async () => { throw new Error("private"); } }, transport }).test(privateProvider);
    assert.equal(result.messageCode, "OUTBOUND_TARGET_REJECTED");
    assert.equal(transport.lastRequest, null);
  } finally { f.close(); }
});

test("Strict outbound policy rejects loopback resolution before credential transport", async () => {
  const f = fixture();
  try {
    const secret = await f.secrets.create({ secret: "private-target-secret", actor: { type: "ADMIN", actorUserId: f.owner.actorUserId } });
    const providerId = uuidv7();
    new SQLiteAIProviderConfigRepository(f.database).create({ id: providerId, actor: f.owner, now: 1_900_500_000_200, content: { key: `loopback-${uuidv7()}`, displayName: "Loopback Target", baseUrl: "https://loopback.example/v1", credentialRef: secret.credentialRef, enabled: true, retentionPolicy: "UNKNOWN", trainingPolicy: "UNKNOWN", zdrSupported: false, zdrRequired: false } });
    const result = await new AIProviderConnectionTester(f.database, { secrets: f.secrets, outboundPolicy: { validate: async () => { throw new Error("loopback"); } }, transport: new FakeTransport() }).test(providerId);
    assert.equal(result.status, "UNSUPPORTED");
    assert.equal(result.messageCode, "OUTBOUND_TARGET_REJECTED");
  } finally { f.close(); }
});
