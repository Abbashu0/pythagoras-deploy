import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";

import type { ContentDatabase } from "../../content/database";
import type {
  AISecretActor,
  AISecretMetadata,
  AISecretMetadataRepository,
  AISecretStoreAdapter,
} from "./contracts";
import {
  assertSecretValue,
  decryptAISecret,
  encryptAISecret,
  readAISecretMasterKey,
  validateAISecretMasterKey,
  type EncryptedAISecretEnvelope,
} from "./crypto";
import { AISecretStoreError } from "./errors";
import { SQLiteAISecretMetadataRepository } from "./sqlite-repository";
import { isAISecretCredentialRef } from "./contracts";

const LOCAL_SECRET_DIRECTORY_NAME = "ai-secrets";

export interface LocalEncryptedAISecretStoreOptions {
  storageDirectory: string;
  metadataRepository: AISecretMetadataRepository;
  masterKey: Uint8Array;
  clock?: () => number;
  credentialRefFactory?: () => string;
  /** Test-only synchronization hook; production callers should leave it unset. */
  beforeResolveVersionRecheck?: (input: {
    credentialRef: string;
    expectedSecretVersion: number;
  }) => Promise<void> | void;
}

export interface CreateLocalAISecretStoreOptions {
  masterKey?: Uint8Array;
  environment?: Readonly<Record<string, string | undefined>>;
  clock?: () => number;
  credentialRefFactory?: () => string;
}

export class LocalEncryptedAISecretStore implements AISecretStoreAdapter {
  private readonly storageDirectory: string;
  private readonly metadataRepository: AISecretMetadataRepository;
  private readonly masterKey: Buffer;
  private readonly clock: () => number;
  private readonly credentialRefFactory: () => string;
  private readonly beforeResolveVersionRecheck: LocalEncryptedAISecretStoreOptions["beforeResolveVersionRecheck"];

  constructor(options: LocalEncryptedAISecretStoreOptions) {
    this.storageDirectory = path.resolve(options.storageDirectory);
    this.metadataRepository = options.metadataRepository;
    this.masterKey = validateAISecretMasterKey(options.masterKey);
    this.clock = options.clock ?? Date.now;
    this.credentialRefFactory = options.credentialRefFactory ?? uuidv7;
    this.beforeResolveVersionRecheck = options.beforeResolveVersionRecheck;
  }

  async create(input: {
    secret: string;
    actor: AISecretActor;
  }): Promise<AISecretMetadata> {
    assertSecretActor(input.actor);
    assertSecretValue(input.secret);
    const credentialRef = this.newCredentialRef();
    if (this.getMetadataFromRepository(credentialRef)) {
      throw new AISecretStoreError(
        "AI_SECRET_CONFLICT",
        "The generated AI secret reference already exists.",
      );
    }

    const now = this.clock();
    const envelope = encryptAISecret(credentialRef, input.secret, 1, this.masterKey);
    try {
      await this.writeVersionFile(credentialRef, 1, envelope);
    } catch (error) {
      throw toStoreError(error, "The AI secret store is unavailable.");
    }

    const metadata: AISecretMetadata = {
      credentialRef,
      status: "ACTIVE",
      secretVersion: 1,
      createdAt: now,
      updatedAt: now,
      rotatedAt: null,
      revokedAt: null,
      revision: 1,
    };
    try {
      return this.metadataRepository.create({ metadata, actor: input.actor });
    } catch (error) {
      await this.removeVersionFile(credentialRef, 1);
      throw toStoreError(error, "The AI secret metadata store is unavailable.");
    }
  }

  async resolve(credentialRef: string): Promise<string> {
    const validRef = assertCredentialRef(credentialRef);
    const metadata = this.getMetadataFromRepository(validRef);
    if (!metadata) {
      throw new AISecretStoreError(
        "AI_SECRET_NOT_FOUND",
        "The AI secret reference was not found.",
      );
    }
    return this.resolveVersion({
      credentialRef: validRef,
      expectedSecretVersion: metadata.secretVersion,
    });
  }

  async resolveVersion(input: {
    credentialRef: string;
    expectedSecretVersion: number;
  }): Promise<string> {
    const validRef = assertCredentialRef(input.credentialRef);
    assertSecretVersion(input.expectedSecretVersion);
    const expectedSecretVersion = input.expectedSecretVersion;
    const initialMetadata = this.getMetadataFromRepository(validRef);
    if (!initialMetadata) {
      throw new AISecretStoreError(
        "AI_SECRET_NOT_FOUND",
        "The AI secret reference was not found.",
      );
    }
    if (initialMetadata.status === "REVOKED") {
      await this.recordFailure(initialMetadata, "AI_SECRET_REVOKED", expectedSecretVersion);
      throw new AISecretStoreError(
        "AI_SECRET_REVOKED",
        "The AI secret reference has been revoked.",
      );
    }
    if (initialMetadata.secretVersion !== expectedSecretVersion) {
      const failure = secretVersionChangedError();
      await this.recordFailure(initialMetadata, failure.code, expectedSecretVersion);
      throw failure;
    }

    let secret: string;
    try {
      const contents = await readFile(
        this.versionFilePath(validRef, expectedSecretVersion),
        "utf8",
      );
      const envelope = parseEnvelope(contents);
      if (envelope.secretVersion !== expectedSecretVersion) {
        throw new AISecretStoreError(
          "AI_SECRET_DECRYPTION_FAILED",
          "The stored AI secret version is invalid.",
        );
      }
      secret = decryptAISecret(validRef, envelope, this.masterKey);
      assertSecretValue(secret);
    } catch (error) {
      const changedMetadata = this.getMetadataFromRepository(validRef);
      if (changedMetadata?.status === "REVOKED") {
        await this.recordFailure(changedMetadata, "AI_SECRET_REVOKED", expectedSecretVersion);
        throw new AISecretStoreError(
          "AI_SECRET_REVOKED",
          "The AI secret reference has been revoked.",
        );
      }
      if (changedMetadata && changedMetadata.secretVersion !== expectedSecretVersion) {
        const failure = secretVersionChangedError();
        await this.recordFailure(changedMetadata, failure.code, expectedSecretVersion);
        throw failure;
      }
      const failure = mapResolveFailure(error);
      await this.recordFailure(initialMetadata, failure.code, expectedSecretVersion);
      throw failure;
    }

    await this.beforeResolveVersionRecheck?.({
      credentialRef: validRef,
      expectedSecretVersion,
    });
    const finalMetadata = this.getMetadataFromRepository(validRef);
    if (!finalMetadata) {
      const failure = new AISecretStoreError(
        "AI_SECRET_NOT_FOUND",
        "The AI secret reference was not found.",
      );
      await this.recordFailure(initialMetadata, failure.code, expectedSecretVersion);
      throw failure;
    }
    if (finalMetadata.status === "REVOKED") {
      const failure = new AISecretStoreError(
        "AI_SECRET_REVOKED",
        "The AI secret reference has been revoked.",
      );
      await this.recordFailure(finalMetadata, failure.code, expectedSecretVersion);
      throw failure;
    }
    if (finalMetadata.secretVersion !== expectedSecretVersion) {
      const failure = secretVersionChangedError();
      await this.recordFailure(finalMetadata, failure.code, expectedSecretVersion);
      throw failure;
    }

    try {
      this.metadataRepository.appendAudit({
        credentialRef: validRef,
        eventType: "RESOLVED",
        secretVersion: expectedSecretVersion,
        actor: { type: "SYSTEM" },
        outcome: "SUCCESS",
        createdAt: this.clock(),
      });
    } catch (error) {
      throw toStoreError(error, "The AI secret audit store is unavailable.");
    }
    return secret;
  }

  async rotate(input: {
    credentialRef: string;
    secret: string;
    actor: AISecretActor;
  }): Promise<AISecretMetadata> {
    assertSecretActor(input.actor);
    assertSecretValue(input.secret);
    const validRef = assertCredentialRef(input.credentialRef);
    const current = this.requireActiveMetadata(validRef);
    const nextVersion = current.secretVersion + 1;
    const envelope = encryptAISecret(validRef, input.secret, nextVersion, this.masterKey);

    try {
      await this.writeVersionFile(validRef, nextVersion, envelope);
    } catch (error) {
      throw toStoreError(error, "The AI secret store is unavailable.");
    }

    let updated: AISecretMetadata;
    try {
      updated = this.metadataRepository.rotate({
        credentialRef: validRef,
        expectedVersion: current.secretVersion,
        rotatedAt: this.clock(),
        actor: input.actor,
      });
    } catch (error) {
      await this.removeVersionFile(validRef, nextVersion);
      throw toStoreError(error, "The AI secret metadata store is unavailable.");
    }

    await this.removeVersionFile(validRef, current.secretVersion);
    return updated;
  }

  async revoke(input: {
    credentialRef: string;
    actor: AISecretActor;
  }): Promise<AISecretMetadata> {
    assertSecretActor(input.actor);
    const validRef = assertCredentialRef(input.credentialRef);
    const current = this.getMetadataFromRepository(validRef);
    if (!current) {
      throw new AISecretStoreError(
        "AI_SECRET_NOT_FOUND",
        "The AI secret reference was not found.",
      );
    }
    if (current.status === "REVOKED") return current;

    let updated: AISecretMetadata;
    try {
      updated = this.metadataRepository.revoke({
        credentialRef: validRef,
        expectedVersion: current.secretVersion,
        revokedAt: this.clock(),
        actor: input.actor,
      });
    } catch (error) {
      throw toStoreError(error, "The AI secret metadata store is unavailable.");
    }
    await this.removeAllVersionFiles(validRef);
    return updated;
  }

  getMetadata(credentialRef: string): AISecretMetadata | null {
    return this.getMetadataFromRepository(assertCredentialRef(credentialRef));
  }

  private requireActiveMetadata(credentialRef: string): AISecretMetadata {
    const metadata = this.getMetadataFromRepository(credentialRef);
    if (!metadata) {
      throw new AISecretStoreError(
        "AI_SECRET_NOT_FOUND",
        "The AI secret reference was not found.",
      );
    }
    if (metadata.status === "REVOKED") {
      throw new AISecretStoreError(
        "AI_SECRET_REVOKED",
        "The AI secret reference has been revoked.",
      );
    }
    return metadata;
  }

  private getMetadataFromRepository(
    credentialRef: string,
  ): AISecretMetadata | null {
    try {
      return this.metadataRepository.get(credentialRef);
    } catch (error) {
      throw toStoreError(error, "The AI secret metadata store is unavailable.");
    }
  }

  private newCredentialRef(): string {
    const credentialRef = this.credentialRefFactory();
    return assertCredentialRef(credentialRef);
  }

  private versionDirectory(credentialRef: string): string {
    return path.join(this.storageDirectory, assertCredentialRef(credentialRef));
  }

  private versionFilePath(credentialRef: string, secretVersion: number): string {
    if (!Number.isInteger(secretVersion) || secretVersion < 1) {
      throw new AISecretStoreError(
        "AI_SECRET_INPUT_INVALID",
        "The AI secret version is invalid.",
      );
    }
    return path.join(this.versionDirectory(credentialRef), `secret.v${secretVersion}.json`);
  }

  private async writeVersionFile(
    credentialRef: string,
    secretVersion: number,
    envelope: EncryptedAISecretEnvelope,
  ): Promise<void> {
    const target = this.versionFilePath(credentialRef, secretVersion);
    const directory = this.versionDirectory(credentialRef);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, JSON.stringify(envelope), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private async removeVersionFile(
    credentialRef: string,
    secretVersion: number,
  ): Promise<void> {
    await unlink(this.versionFilePath(credentialRef, secretVersion)).catch(() => undefined);
  }

  private async removeAllVersionFiles(credentialRef: string): Promise<void> {
    const directory = this.versionDirectory(credentialRef);
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch {
      return;
    }
    await Promise.all(
      entries
        .filter((entry) => /^secret\.v[1-9][0-9]*\.json$/u.test(entry))
        .map((entry) => unlink(path.join(directory, entry)).catch(() => undefined)),
    );
  }

  private async recordFailure(
    metadata: AISecretMetadata,
    errorCode: string,
    secretVersion = metadata.secretVersion,
  ): Promise<void> {
    try {
      this.metadataRepository.appendAudit({
        credentialRef: metadata.credentialRef,
        eventType: "RESOLVE_FAILED",
        secretVersion,
        actor: { type: "SYSTEM" },
        outcome: "FAILURE",
        errorCode,
        createdAt: this.clock(),
      });
    } catch (error) {
      throw toStoreError(error, "The AI secret audit store is unavailable.");
    }
  }
}

function assertSecretVersion(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new AISecretStoreError(
      "AI_SECRET_INPUT_INVALID",
      "The AI secret version is invalid.",
    );
  }
}

function secretVersionChangedError(): AISecretStoreError {
  return new AISecretStoreError(
    "AI_SECRET_VERSION_CHANGED",
    "The AI secret version changed during resolution.",
  );
}

export function createLocalAISecretStore(
  database: ContentDatabase,
  options: CreateLocalAISecretStoreOptions = {},
): LocalEncryptedAISecretStore {
  const masterKey = options.masterKey
    ? validateAISecretMasterKey(options.masterKey)
    : readAISecretMasterKey(options.environment);
  return new LocalEncryptedAISecretStore({
    storageDirectory: path.join(database.paths.root, LOCAL_SECRET_DIRECTORY_NAME),
    metadataRepository: new SQLiteAISecretMetadataRepository(database),
    masterKey,
    clock: options.clock,
    credentialRefFactory: options.credentialRefFactory,
  });
}

function assertCredentialRef(value: unknown): string {
  if (!isAISecretCredentialRef(value)) {
    throw new AISecretStoreError(
      "AI_SECRET_REF_INVALID",
      "The AI secret reference is invalid.",
    );
  }
  return value;
}

function assertSecretActor(actor: AISecretActor): void {
  if (
    actor.type === "ADMIN" &&
    typeof actor.actorUserId === "string" &&
    actor.actorUserId.trim()
  ) {
    return;
  }
  if (actor.type === "SYSTEM") return;
  throw new AISecretStoreError(
    "AI_SECRET_INPUT_INVALID",
    "The AI secret actor is invalid.",
  );
}

function parseEnvelope(contents: string): EncryptedAISecretEnvelope {
  try {
    return JSON.parse(contents) as EncryptedAISecretEnvelope;
  } catch (error) {
    throw new AISecretStoreError(
      "AI_SECRET_DECRYPTION_FAILED",
      "The stored AI secret could not be authenticated.",
      error,
    );
  }
}

function mapResolveFailure(error: unknown): AISecretStoreError {
  if (error instanceof AISecretStoreError) {
    if (error.code === "AI_SECRET_NOT_FOUND") return error;
    if (error.code === "AI_SECRET_DECRYPTION_FAILED") return error;
    if (error.code === "AI_SECRET_INPUT_INVALID") {
      return new AISecretStoreError(
        "AI_SECRET_DECRYPTION_FAILED",
        "The stored AI secret could not be authenticated.",
        error,
      );
    }
    return error;
  }
  if (isNodeFileNotFound(error)) {
    return new AISecretStoreError(
      "AI_SECRET_NOT_FOUND",
      "The stored AI secret is unavailable.",
      error,
    );
  }
  return new AISecretStoreError(
    "AI_SECRET_STORE_UNAVAILABLE",
    "The AI secret store is unavailable.",
    error,
  );
}

function toStoreError(error: unknown, message: string): AISecretStoreError {
  if (error instanceof AISecretStoreError) return error;
  return new AISecretStoreError("AI_SECRET_STORE_UNAVAILABLE", message, error);
}

function isNodeFileNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT",
  );
}
