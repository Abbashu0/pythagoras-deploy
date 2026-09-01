import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  AI_SECRET_CREDENTIAL_REF_PATTERN,
} from "./contracts";
import { AISecretStoreError } from "./errors";

export const AI_SECRET_ENVELOPE_FORMAT_VERSION = 1;
export const AI_SECRET_ALGORITHM = "aes-256-gcm" as const;
export const AI_SECRET_KEY_BYTES = 32;
export const AI_SECRET_IV_BYTES = 12;
export const AI_SECRET_AUTH_TAG_BYTES = 16;
export const AI_SECRET_MAX_VALUE_BYTES = 64 * 1024;

export interface EncryptedAISecretEnvelope {
  formatVersion: typeof AI_SECRET_ENVELOPE_FORMAT_VERSION;
  algorithm: typeof AI_SECRET_ALGORITHM;
  iv: string;
  ciphertext: string;
  authTag: string;
  secretVersion: number;
}

export function validateAISecretMasterKey(value: Uint8Array): Buffer {
  if (value.byteLength !== AI_SECRET_KEY_BYTES) {
    throw new AISecretStoreError(
      "AI_SECRET_CONFIGURATION_INVALID",
      "The AI secret master key has an invalid size.",
    );
  }
  return Buffer.from(value);
}

export function readAISecretMasterKey(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Buffer {
  const encoded = environment.PYTHAGORAS_AI_MASTER_KEY?.trim();
  if (!encoded) {
    throw new AISecretStoreError(
      "AI_SECRET_STORE_UNAVAILABLE",
      "The AI secret store is unavailable.",
    );
  }

  if (/^[0-9a-f]{64}$/iu.test(encoded)) {
    return validateAISecretMasterKey(Buffer.from(encoded, "hex"));
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) {
    throw new AISecretStoreError(
      "AI_SECRET_CONFIGURATION_INVALID",
      "The AI secret master key configuration is invalid.",
    );
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(encoded, "base64");
  } catch (error) {
    throw new AISecretStoreError(
      "AI_SECRET_CONFIGURATION_INVALID",
      "The AI secret master key configuration is invalid.",
      error,
    );
  }
  if (
    decoded.length !== AI_SECRET_KEY_BYTES ||
    decoded.toString("base64") !== encoded
  ) {
    throw new AISecretStoreError(
      "AI_SECRET_CONFIGURATION_INVALID",
      "The AI secret master key configuration is invalid.",
    );
  }
  return validateAISecretMasterKey(decoded);
}

export function encryptAISecret(
  credentialRef: string,
  secret: string,
  secretVersion: number,
  masterKey: Uint8Array,
): EncryptedAISecretEnvelope {
  assertCredentialRef(credentialRef);
  assertSecretVersion(secretVersion);
  assertSecretValue(secret);
  const key = validateAISecretMasterKey(masterKey);
  const iv = randomBytes(AI_SECRET_IV_BYTES);
  const cipher = createCipheriv(AI_SECRET_ALGORITHM, key, iv);
  cipher.setAAD(buildAdditionalData(credentialRef, secretVersion));
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    formatVersion: AI_SECRET_ENVELOPE_FORMAT_VERSION,
    algorithm: AI_SECRET_ALGORITHM,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: authTag.toString("base64"),
    secretVersion,
  };
}

export function decryptAISecret(
  credentialRef: string,
  envelope: unknown,
  masterKey: Uint8Array,
): string {
  assertCredentialRef(credentialRef);
  const parsed = parseEnvelope(envelope);
  const key = validateAISecretMasterKey(masterKey);
  try {
    const iv = decodeField(parsed.iv);
    const ciphertext = decodeField(parsed.ciphertext);
    const authTag = decodeField(parsed.authTag);
    if (
      iv.length !== AI_SECRET_IV_BYTES ||
      authTag.length !== AI_SECRET_AUTH_TAG_BYTES
    ) {
      throw new Error("Invalid envelope length");
    }
    const decipher = createDecipheriv(AI_SECRET_ALGORITHM, key, iv);
    decipher.setAAD(buildAdditionalData(credentialRef, parsed.secretVersion));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (error) {
    throw new AISecretStoreError(
      "AI_SECRET_DECRYPTION_FAILED",
      "The stored AI secret could not be authenticated.",
      error,
    );
  }
}

export function assertSecretValue(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > AI_SECRET_MAX_VALUE_BYTES
  ) {
    throw new AISecretStoreError(
      "AI_SECRET_INPUT_INVALID",
      "The AI secret value is invalid.",
    );
  }
}

function parseEnvelope(value: unknown): EncryptedAISecretEnvelope {
  if (!isPlainObject(value)) invalidEnvelope();
  const expectedKeys = [
    "algorithm",
    "authTag",
    "ciphertext",
    "formatVersion",
    "iv",
    "secretVersion",
  ];
  const actualKeys = Object.keys(value).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    invalidEnvelope();
  }
  if (
    value.formatVersion !== AI_SECRET_ENVELOPE_FORMAT_VERSION ||
    value.algorithm !== AI_SECRET_ALGORITHM ||
    typeof value.iv !== "string" ||
    typeof value.ciphertext !== "string" ||
    typeof value.authTag !== "string"
  ) {
    invalidEnvelope();
  }
  assertSecretVersion(value.secretVersion);
  return {
    formatVersion: AI_SECRET_ENVELOPE_FORMAT_VERSION,
    algorithm: AI_SECRET_ALGORITHM,
    iv: value.iv,
    ciphertext: value.ciphertext,
    authTag: value.authTag,
    secretVersion: value.secretVersion,
  };
}

function decodeField(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) invalidEnvelope();
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) invalidEnvelope();
  return decoded;
}

function buildAdditionalData(credentialRef: string, secretVersion: number): Buffer {
  return Buffer.from(
    `pythagoras-ai-secret:${AI_SECRET_ENVELOPE_FORMAT_VERSION}:${credentialRef}:${secretVersion}`,
    "utf8",
  );
}

function assertCredentialRef(value: string): void {
  if (!AI_SECRET_CREDENTIAL_REF_PATTERN.test(value)) {
    throw new AISecretStoreError(
      "AI_SECRET_REF_INVALID",
      "The AI secret reference is invalid.",
    );
  }
}

function assertSecretVersion(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) invalidEnvelope();
}

function invalidEnvelope(): never {
  throw new AISecretStoreError(
    "AI_SECRET_DECRYPTION_FAILED",
    "The stored AI secret could not be authenticated.",
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
