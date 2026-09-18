import assert from "node:assert/strict";
import {
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdtempSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { v7 as uuidv7 } from "uuid";

import {
  AI_PROVIDER_CONFIG_RESOURCE_TYPE,
  AIProviderConfigError,
  SQLiteAIProviderConfigRepository,
  toSafeAIProviderConfigDTO,
} from "../src/server/ai/configuration";
import { normalizeAIProviderConfigContent } from "../src/server/ai/configuration/validation";
import {
  AI_SECRET_ALGORITHM,
  AI_SECRET_ENVELOPE_FORMAT_VERSION,
  AI_SECRET_IV_BYTES,
  AI_SECRET_KEY_BYTES,
  AISecretStoreError,
  LocalEncryptedAISecretStore,
  SQLiteAISecretMetadataRepository,
  createLocalAISecretStore,
  decryptAISecret,
  encryptAISecret,
  readAISecretMasterKey,
} from "../src/server/ai/secrets";
import type { AISecretActor } from "../src/server/ai/secrets";
import { createChangeManagementService } from "../src/server/change-management";
import type { AdminActor } from "../src/server/admin-auth";
import { SQLiteAdminIdentityRepository } from "../src/server/admin-auth/sqlite-admin-identity-repository";
import {
  getContentDatabaseStatus,
  openContentDatabase,
  type ContentDatabase,
} from "../src/server/content";

const migrationsDirectory = path.join(process.cwd(), "drizzle");
const TEST_MASTER_KEY = Buffer.alloc(AI_SECRET_KEY_BYTES, 0x5a);

interface Fixture {
  root: string;
  database: ContentDatabase;
  owner: AdminActor;
  admin: AdminActor;
  secrets: LocalEncryptedAISecretStore;
  secretMetadata: SQLiteAISecretMetadataRepository;
  configs: SQLiteAIProviderConfigRepository;
  changes: ReturnType<typeof createChangeManagementService>;
  close(): void;
}

function createFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "pythagoras-ai-m1-"));
  const database = openContentDatabase({ dataDirectory: root, migrationsDirectory });
  const identities = new SQLiteAdminIdentityRepository(database);
  const ownerUser = identities.createInitialOwner({
    id: uuidv7(),
    email: `owner-${uuidv7()}@ai-m1.test`,
    displayName: "AI M1 Owner",
    passwordHash: "fixture-only",
    createdAt: 1_900_000_000_000,
  });
  const adminUser = identities.createAdmin({
    id: uuidv7(),
    email: `admin-${uuidv7()}@ai-m1.test`,
    displayName: "AI M1 Admin",
    passwordHash: "fixture-only",
    createdAt: 1_900_000_000_001,
  });
  let now = 1_900_000_100_000;
  const secretMetadata = new SQLiteAISecretMetadataRepository(database);
  const secrets = createLocalAISecretStore(database, {
    masterKey: TEST_MASTER_KEY,
    clock: () => now++,
  });
  return {
    root,
    database,
    owner: { actorUserId: ownerUser.id, actorRole: "OWNER" },
    admin: { actorUserId: adminUser.id, actorRole: "ADMIN" },
    secrets,
    secretMetadata,
    configs: new SQLiteAIProviderConfigRepository(database),
    changes: createChangeManagementService(database),
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    },
  };
}

function fakeSecret(): string {
  return `test-only-${randomBytes(48).toString("base64url")}`;
}

function adminSecretActor(actor: AdminActor): AISecretActor {
  return { type: "ADMIN", actorUserId: actor.actorUserId };
}

function providerContent(credentialRef: string | null, overrides: Record<string, unknown> = {}) {
  return {
    key: "provider-one",
    displayName: "Provider One",
    baseUrl: "https://provider.example/v1",
    credentialRef,
    enabled: credentialRef !== null,
    retentionPolicy: "UNKNOWN" as const,
    trainingPolicy: "UNKNOWN" as const,
    zdrSupported: false,
    zdrRequired: false,
    ...overrides,
  };
}

function createProviderDraft(
  fixture: Fixture,
  content: ReturnType<typeof providerContent>,
  actor: AdminActor = fixture.owner,
) {
  const id = uuidv7();
  const draft = fixture.changes.createChangeSet(
    {
      title: "AI Provider configuration test",
      initialItem: {
        resourceType: AI_PROVIDER_CONFIG_RESOURCE_TYPE,
        resourceId: id,
        operation: "CREATE",
        expectedRevision: 0,
        desired: content,
      },
    },
    actor,
  );
  return { id, draft, actor };
}

function errorCode(code: string) {
  return (error: unknown): boolean =>
    error instanceof AISecretStoreError && error.code === code;
}

function changeErrorCode(code: string) {
  return (error: unknown): boolean =>
    error instanceof Error && "code" in error && (error as { code?: unknown }).code === code;
}

function secretFiles(root: string, credentialRef: string): string[] {
  const directory = path.join(root, "ai-secrets", credentialRef);
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => /^secret\.v[1-9][0-9]*\.json$/u.test(entry))
    .map((entry) => path.join(directory, entry));
}

test("AI M1 migration creates metadata tables without ciphertext or master-key columns", () => {
  const fixture = createFixture();
  try {
    assert.equal(getContentDatabaseStatus(fixture.database).migrationsApplied, 49);
    for (const table of ["ai_provider_configs", "ai_secret_refs", "ai_secret_audit_events"]) {
      assert.ok(fixture.database.client.prepare("select name from sqlite_master where type='table' and name=?").get(table));
    }
    for (const table of ["ai_provider_configs", "ai_secret_refs", "ai_secret_audit_events"]) {
      const columns = fixture.database.client
        .prepare(`pragma table_info(${table})`)
        .all() as Array<{ name: string }>;
      assert.equal(columns.some((column) => ["ciphertext", "master_key", "secret", "auth_tag"].includes(column.name)), false);
    }
  } finally {
    fixture.close();
  }
});

test("local encrypted secret store creates and resolves exact plaintext under the isolated data directory", async () => {
  const fixture = createFixture();
  const secret = fakeSecret();
  try {
    const metadata = await fixture.secrets.create({ secret, actor: adminSecretActor(fixture.owner) });
    assert.equal(metadata.status, "ACTIVE");
    assert.equal(metadata.secretVersion, 1);
    assert.equal(await fixture.secrets.resolve(metadata.credentialRef), secret);
    assert.equal(secretFiles(fixture.root, metadata.credentialRef).length, 1);
    const persisted = readFileSync(secretFiles(fixture.root, metadata.credentialRef)[0]);
    assert.equal(persisted.includes(Buffer.from(secret, "utf8")), false);
    assert.equal(JSON.stringify(fixture.secretMetadata.listAudit(metadata.credentialRef)).includes(secret), false);
  } finally {
    fixture.close();
  }
});

test("version-fenced Secret resolution rejects stale and revoked generations and detects rotation during post-decrypt verification", async () => {
  const fixture = createFixture();
  const firstSecret = fakeSecret();
  const secondSecret = fakeSecret();
  try {
    const created = await fixture.secrets.create({ secret: firstSecret, actor: adminSecretActor(fixture.owner) });
    assert.equal(await fixture.secrets.resolveVersion({ credentialRef: created.credentialRef, expectedSecretVersion: 1 }), firstSecret);
    const rotated = await fixture.secrets.rotate({ credentialRef: created.credentialRef, secret: secondSecret, actor: adminSecretActor(fixture.owner) });
    assert.equal(await fixture.secrets.resolveVersion({ credentialRef: created.credentialRef, expectedSecretVersion: rotated.secretVersion }), secondSecret);
    await assert.rejects(
      () => fixture.secrets.resolveVersion({ credentialRef: created.credentialRef, expectedSecretVersion: 1 }),
      errorCode("AI_SECRET_VERSION_CHANGED"),
    );

    const postDecrypt = await fixture.secrets.create({ secret: firstSecret, actor: adminSecretActor(fixture.owner) });
    let rotatedDuringResolution = false;
    const rotatingStore = new LocalEncryptedAISecretStore({
      storageDirectory: path.join(fixture.root, "ai-secrets"),
      metadataRepository: fixture.secretMetadata,
      masterKey: TEST_MASTER_KEY,
      beforeResolveVersionRecheck: async () => {
        if (rotatedDuringResolution) return;
        rotatedDuringResolution = true;
        await fixture.secrets.rotate({ credentialRef: postDecrypt.credentialRef, secret: secondSecret, actor: adminSecretActor(fixture.owner) });
      },
    });
    await assert.rejects(
      () => rotatingStore.resolveVersion({ credentialRef: postDecrypt.credentialRef, expectedSecretVersion: 1 }),
      errorCode("AI_SECRET_VERSION_CHANGED"),
    );
    assert.equal(await fixture.secrets.resolveVersion({ credentialRef: postDecrypt.credentialRef, expectedSecretVersion: 2 }), secondSecret);

    const revoked = await fixture.secrets.create({ secret: firstSecret, actor: adminSecretActor(fixture.owner) });
    await fixture.secrets.revoke({ credentialRef: revoked.credentialRef, actor: adminSecretActor(fixture.owner) });
    await assert.rejects(
      () => fixture.secrets.resolveVersion({ credentialRef: revoked.credentialRef, expectedSecretVersion: 1 }),
      errorCode("AI_SECRET_REVOKED"),
    );
    const audits = fixture.secretMetadata.listAudit(postDecrypt.credentialRef);
    assert.equal(audits.some((event) => event.eventType === "RESOLVE_FAILED" && event.secretVersion === 1 && event.errorCode === "AI_SECRET_VERSION_CHANGED"), true);
    assert.equal(JSON.stringify(audits).includes(firstSecret), false);
    assert.equal(JSON.stringify(audits).includes(secondSecret), false);
  } finally {
    fixture.close();
  }
});

test("AES-256-GCM envelope uses the explicit version and fresh IV for identical plaintext", () => {
  const credentialRef = uuidv7();
  const secret = fakeSecret();
  const first = encryptAISecret(credentialRef, secret, 1, TEST_MASTER_KEY);
  const second = encryptAISecret(credentialRef, secret, 1, TEST_MASTER_KEY);

  assert.equal(first.formatVersion, AI_SECRET_ENVELOPE_FORMAT_VERSION);
  assert.equal(first.algorithm, AI_SECRET_ALGORITHM);
  assert.equal(Buffer.from(first.iv, "base64").length, AI_SECRET_IV_BYTES);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(decryptAISecret(credentialRef, first, TEST_MASTER_KEY), secret);
});

test("tampered ciphertext and a wrong master key fail authenticated decryption without exposing plaintext", async () => {
  const fixture = createFixture();
  const secret = fakeSecret();
  try {
    const metadata = await fixture.secrets.create({ secret, actor: adminSecretActor(fixture.owner) });
    const file = secretFiles(fixture.root, metadata.credentialRef)[0];
    const envelope = JSON.parse(readFileSync(file, "utf8")) as { ciphertext: string };
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}${envelope.ciphertext.endsWith("A") ? "B" : "A"}`;
    writeFileSync(file, JSON.stringify(envelope), "utf8");
    await assert.rejects(() => fixture.secrets.resolve(metadata.credentialRef), errorCode("AI_SECRET_DECRYPTION_FAILED"));

    const secondMetadata = await fixture.secrets.create({ secret, actor: adminSecretActor(fixture.owner) });
    const wrongKeyStore = new LocalEncryptedAISecretStore({
      storageDirectory: path.join(fixture.root, "ai-secrets"),
      metadataRepository: fixture.secretMetadata,
      masterKey: Buffer.alloc(AI_SECRET_KEY_BYTES, 0x2a),
    });
    await assert.rejects(() => wrongKeyStore.resolve(secondMetadata.credentialRef), errorCode("AI_SECRET_DECRYPTION_FAILED"));
  } catch (error) {
    if (error instanceof Error) assert.equal(error.message.includes(secret), false);
    throw error;
  } finally {
    fixture.close();
  }
});

test("master key configuration is strict, supports base64/hex, and fails closed", () => {
  const base64 = TEST_MASTER_KEY.toString("base64");
  const hex = TEST_MASTER_KEY.toString("hex");
  assert.deepEqual(readAISecretMasterKey({ PYTHAGORAS_AI_MASTER_KEY: base64 }), TEST_MASTER_KEY);
  assert.deepEqual(readAISecretMasterKey({ PYTHAGORAS_AI_MASTER_KEY: hex }), TEST_MASTER_KEY);
  assert.throws(() => readAISecretMasterKey({}), errorCode("AI_SECRET_STORE_UNAVAILABLE"));
  assert.throws(
    () => readAISecretMasterKey({ PYTHAGORAS_AI_MASTER_KEY: Buffer.alloc(31).toString("base64") }),
    errorCode("AI_SECRET_CONFIGURATION_INVALID"),
  );
  assert.throws(
    () => new LocalEncryptedAISecretStore({
      storageDirectory: path.join(os.tmpdir(), "pythagoras-ai-invalid-key"),
      metadataRepository: {} as SQLiteAISecretMetadataRepository,
      masterKey: Buffer.alloc(31),
    }),
    errorCode("AI_SECRET_CONFIGURATION_INVALID"),
  );
});

test("Provider base URLs are normalized and reject credentials, unsafe schemes, and non-loopback HTTP", () => {
  const base = providerContent(null, { key: "url-provider", enabled: false });
  assert.equal(
    normalizeAIProviderConfigContent(base).baseUrl,
    "https://provider.example/v1",
  );
  assert.equal(
    normalizeAIProviderConfigContent(
      { ...base, baseUrl: "http://localhost:3000" },
      { allowLocalHttp: true },
    ).baseUrl,
    "http://localhost:3000/",
  );
  for (const baseUrl of [
    "http://provider.example",
    "https://user:password@provider.example",
    "file:///tmp/provider",
    "data:text/plain,provider",
  ]) {
    assert.throws(
      () => normalizeAIProviderConfigContent({ ...base, baseUrl }),
      (error) => error instanceof AIProviderConfigError && error.code === "AI_PROVIDER_CONFIG_INVALID",
    );
  }
  assert.throws(
    () => normalizeAIProviderConfigContent({ ...base, baseUrl: "http://localhost:3000", enabled: true }, { allowLocalHttp: true }),
    (error) => error instanceof AIProviderConfigError && error.code === "AI_PROVIDER_CONFIG_INVALID",
  );
});

test("local Admin OmniRoute opt-in accepts only the exact local gateway target", () => {
  const base = providerContent(uuidv7(), { key: "omniroute-provider", enabled: true });
  assert.equal(
    normalizeAIProviderConfigContent(
      { ...base, baseUrl: "http://localhost:20128/v1" },
      { allowLocalOmniRoute: true },
    ).baseUrl,
    "http://localhost:20128/v1",
  );
  assert.throws(
    () => normalizeAIProviderConfigContent({ ...base, baseUrl: "http://localhost:20128/v1" }),
    (error) => error instanceof AIProviderConfigError && error.code === "AI_PROVIDER_CONFIG_INVALID",
  );
  for (const baseUrl of [
    "http://localhost:20129/v1",
    "http://localhost:20128/other",
    "http://192.168.0.105:20128/v1",
  ]) {
    assert.throws(
      () => normalizeAIProviderConfigContent({ ...base, baseUrl }, { allowLocalOmniRoute: true }),
      (error) => error instanceof AIProviderConfigError && error.code === "AI_PROVIDER_CONFIG_INVALID",
    );
  }
});

test("secret rotation preserves credentialRef, increments version, and keeps the old secret on failed input", async () => {
  const fixture = createFixture();
  const firstSecret = fakeSecret();
  const secondSecret = fakeSecret();
  try {
    const created = await fixture.secrets.create({ secret: firstSecret, actor: adminSecretActor(fixture.owner) });
    const rotated = await fixture.secrets.rotate({
      credentialRef: created.credentialRef,
      secret: secondSecret,
      actor: adminSecretActor(fixture.owner),
    });
    assert.equal(rotated.credentialRef, created.credentialRef);
    assert.equal(rotated.secretVersion, 2);
    assert.equal(await fixture.secrets.resolve(created.credentialRef), secondSecret);
    assert.equal(secretFiles(fixture.root, created.credentialRef).length, 1);
    await assert.rejects(
      () => fixture.secrets.rotate({ credentialRef: created.credentialRef, secret: "", actor: adminSecretActor(fixture.owner) }),
      errorCode("AI_SECRET_INPUT_INVALID"),
    );
    assert.equal(await fixture.secrets.resolve(created.credentialRef), secondSecret);
  } finally {
    fixture.close();
  }
});

test("secret revocation blocks resolution and removes material while preserving safe metadata/audit", async () => {
  const fixture = createFixture();
  try {
    const created = await fixture.secrets.create({ secret: fakeSecret(), actor: adminSecretActor(fixture.owner) });
    const revoked = await fixture.secrets.revoke({ credentialRef: created.credentialRef, actor: adminSecretActor(fixture.owner) });
    assert.equal(revoked.status, "REVOKED");
    assert.equal(secretFiles(fixture.root, created.credentialRef).length, 0);
    await assert.rejects(() => fixture.secrets.resolve(created.credentialRef), errorCode("AI_SECRET_REVOKED"));
    assert.deepEqual(
      fixture.secretMetadata.listAudit(created.credentialRef).map((event) => event.eventType),
      ["CREATED", "REVOKED", "RESOLVE_FAILED"],
    );
    const auditText = JSON.stringify(fixture.secretMetadata.listAudit(created.credentialRef));
    assert.equal(auditText.includes("ciphertext"), false);
  } finally {
    fixture.close();
  }
});

test("credential references are opaque UUIDs and reject path traversal", async () => {
  const fixture = createFixture();
  try {
    await assert.rejects(
      () => fixture.secrets.resolve("../../outside-secret"),
      errorCode("AI_SECRET_REF_INVALID"),
    );
    assert.throws(() => fixture.secrets.getMetadata("../outside-secret"), errorCode("AI_SECRET_REF_INVALID"));
  } finally {
    fixture.close();
  }
});

test("Provider configuration is staged through Change Sets and approval alone does not mutate canonical state", async () => {
  const fixture = createFixture();
  const secret = fakeSecret();
  try {
    const credential = await fixture.secrets.create({ secret, actor: adminSecretActor(fixture.owner) });
    const staged = createProviderDraft(fixture, providerContent(credential.credentialRef));
    assert.equal(staged.draft.items[0].resourceType, AI_PROVIDER_CONFIG_RESOURCE_TYPE);
    assert.equal(staged.draft.items[0].proposedSnapshot.credentialRef, credential.credentialRef);
    assert.equal(JSON.stringify(staged.draft).includes(secret), false);

    const submitted = fixture.changes.submit(staged.draft.changeSet.id, staged.draft.changeSet.revision, fixture.owner);
    const approved = fixture.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
    assert.equal(fixture.configs.getById(staged.id), null);
    assert.equal(JSON.stringify(approved).includes(secret), false);
  } finally {
    fixture.close();
  }
});

test("OWNER publication creates safe Provider configuration without decrypting its credential", async () => {
  const fixture = createFixture();
  const secret = fakeSecret();
  try {
    const credential = await fixture.secrets.create({ secret, actor: adminSecretActor(fixture.owner) });
    const staged = createProviderDraft(fixture, providerContent(credential.credentialRef));
    const submitted = fixture.changes.submit(staged.draft.changeSet.id, staged.draft.changeSet.revision, fixture.owner);
    const approved = fixture.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.owner);
    const published = fixture.changes.publish(approved.changeSet.id, approved.changeSet.revision, fixture.owner);
    const config = fixture.configs.getById(staged.id);
    if (!config) throw new Error("Expected Provider configuration after publication.");
    assert.equal(config.credentialRef, credential.credentialRef);
    assert.equal(JSON.stringify(config).includes(secret), false);
    const dto = toSafeAIProviderConfigDTO(config, "ACTIVE");
    assert.equal("credentialRef" in dto, false);
    assert.equal(dto.credentialConfigured, true);
    assert.equal(dto.credentialStatus, "ACTIVE");
    assert.equal(JSON.stringify(dto).includes(secret), false);
    assert.equal(JSON.stringify(published).includes(secret), false);
  } finally {
    fixture.close();
  }
});

test("Provider configuration updates remain governed and stale revisions conflict", async () => {
  const fixture = createFixture();
  try {
    const credential = await fixture.secrets.create({ secret: fakeSecret(), actor: adminSecretActor(fixture.owner) });
    const created = createProviderDraft(fixture, providerContent(credential.credentialRef));
    const createdSubmitted = fixture.changes.submit(created.draft.changeSet.id, created.draft.changeSet.revision, fixture.owner);
    const createdApproved = fixture.changes.approve(createdSubmitted.changeSet.id, createdSubmitted.changeSet.revision, fixture.owner);
    fixture.changes.publish(createdApproved.changeSet.id, createdApproved.changeSet.revision, fixture.owner);
    const current = fixture.configs.getById(created.id);
    if (!current) throw new Error("Expected the published Provider configuration.");

    const updateDraft = fixture.changes.createChangeSet(
      {
        title: "AI Provider configuration update test",
        initialItem: {
          resourceType: AI_PROVIDER_CONFIG_RESOURCE_TYPE,
          resourceId: created.id,
          operation: "UPDATE",
          expectedRevision: current.revision,
          desired: providerContent(credential.credentialRef, { displayName: "Provider Updated" }),
        },
      },
      fixture.owner,
    );
    const updateSubmitted = fixture.changes.submit(updateDraft.changeSet.id, updateDraft.changeSet.revision, fixture.owner);
    const updateApproved = fixture.changes.approve(updateSubmitted.changeSet.id, updateSubmitted.changeSet.revision, fixture.owner);
    fixture.changes.publish(updateApproved.changeSet.id, updateApproved.changeSet.revision, fixture.owner);
    assert.equal(fixture.configs.getById(created.id)?.displayName, "Provider Updated");
    assert.equal(fixture.configs.getById(created.id)?.revision, current.revision + 1);

    assert.throws(
      () => fixture.changes.createChangeSet(
        {
          title: "Stale AI Provider configuration update",
          initialItem: {
            resourceType: AI_PROVIDER_CONFIG_RESOURCE_TYPE,
            resourceId: created.id,
            operation: "UPDATE",
            expectedRevision: current.revision,
            desired: providerContent(credential.credentialRef, { displayName: "Stale Update" }),
          },
        },
        fixture.owner,
      ),
      changeErrorCode("CHANGE_CONFLICT"),
    );
  } finally {
    fixture.close();
  }
});

test("Provider configuration governance enforces credential, HTTPS, ZDR, identity, and revision rules", async () => {
  const fixture = createFixture();
  try {
    assert.throws(
      () => createProviderDraft(fixture, providerContent(null, { enabled: true })),
      changeErrorCode("CHANGE_VALIDATION_FAILED"),
    );
    assert.throws(
      () => createProviderDraft(fixture, providerContent(null, { baseUrl: "http://provider.example" })),
      changeErrorCode("CHANGE_VALIDATION_FAILED"),
    );
    assert.throws(
      () => createProviderDraft(fixture, providerContent(null, { baseUrl: "javascript:alert(1)" })),
      changeErrorCode("CHANGE_VALIDATION_FAILED"),
    );
    assert.throws(
      () => createProviderDraft(fixture, providerContent(null, { zdrSupported: false, zdrRequired: true })),
      changeErrorCode("CHANGE_VALIDATION_FAILED"),
    );

    const disabled = createProviderDraft(fixture, providerContent(null, { key: "disabled-provider", enabled: false }));
    const disabledSubmitted = fixture.changes.submit(disabled.draft.changeSet.id, disabled.draft.changeSet.revision, fixture.owner);
    const disabledApproved = fixture.changes.approve(disabledSubmitted.changeSet.id, disabledSubmitted.changeSet.revision, fixture.owner);
    fixture.changes.publish(disabledApproved.changeSet.id, disabledApproved.changeSet.revision, fixture.owner);
    const disabledConfig = fixture.configs.getById(disabled.id);
    if (!disabledConfig) throw new Error("Expected disabled Provider configuration.");
    assert.equal(disabledConfig.enabled, false);
    assert.throws(
      () => fixture.configs.update({
        id: disabled.id,
        content: providerContent(null, { key: "disabled-provider", enabled: false }),
        expectedRevision: 0,
        actor: fixture.owner,
        now: Date.now(),
      }),
      (error) => error instanceof AIProviderConfigError && error.code === "AI_PROVIDER_CONFIG_CONFLICT",
    );
  } finally {
    fixture.close();
  }
});

test("missing credentials cannot be published, and non-OWNER review/publication remains forbidden", async () => {
  const fixture = createFixture();
  try {
    const missingCredential = uuidv7();
    const missing = createProviderDraft(fixture, providerContent(missingCredential));
    const missingSubmitted = fixture.changes.submit(missing.draft.changeSet.id, missing.draft.changeSet.revision, fixture.owner);
    const missingApproved = fixture.changes.approve(missingSubmitted.changeSet.id, missingSubmitted.changeSet.revision, fixture.owner);
    assert.throws(
      () => fixture.changes.publish(missingApproved.changeSet.id, missingApproved.changeSet.revision, fixture.owner),
      changeErrorCode("CHANGE_VALIDATION_FAILED"),
    );

    const secret = await fixture.secrets.create({ secret: fakeSecret(), actor: adminSecretActor(fixture.owner) });
    const staged = createProviderDraft(fixture, providerContent(secret.credentialRef), fixture.admin);
    const submitted = fixture.changes.submit(staged.draft.changeSet.id, staged.draft.changeSet.revision, fixture.admin);
    assert.throws(
      () => fixture.changes.approve(submitted.changeSet.id, submitted.changeSet.revision, fixture.admin),
      changeErrorCode("CHANGE_AUTHORIZATION_FAILED"),
    );
  } finally {
    fixture.close();
  }
});
