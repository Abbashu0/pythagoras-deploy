import { createHash, randomBytes } from "node:crypto";

export const ADMIN_SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export function generateAdminSessionToken(): string {
  return randomBytes(ADMIN_SESSION_TOKEN_BYTES).toString("base64url");
}

export function isValidAdminSessionToken(token: unknown): token is string {
  return typeof token === "string" && SESSION_TOKEN_PATTERN.test(token);
}

export function hashAdminSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
