import { createHash } from "node:crypto";

import {
  AI_CONVERSATION_FINISH_REASONS,
  AI_CONVERSATION_MAX_CHUNK_BYTES,
  AI_CONVERSATION_MAX_CONVERSATION_PAGE_SIZE,
  AI_CONVERSATION_MAX_MESSAGE_BYTES,
  AI_CONVERSATION_MAX_MESSAGE_PAGE_SIZE,
  AI_CONVERSATION_MAX_RESPONSE_BYTES,
  AI_CONVERSATION_SAFE_ERROR_CODES,
  type AIConversationFinishReason,
  type AIConversationSafeErrorCode,
} from "./contracts";
import { AIConversationError } from "./errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SUBJECT_KEY_PATTERN = /^[a-z0-9-]{1,80}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const IDENTITY_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;

export function normalizeConversationId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid("Conversation identity is invalid.");
  return value;
}

export function normalizeConversationSubjectKey(value: unknown): string {
  if (typeof value !== "string") invalid("Conversation subject is invalid.");
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (!SUBJECT_KEY_PATTERN.test(normalized)) invalid("Conversation subject is invalid.", "AI_CONVERSATION_SUBJECT_INVALID");
  return normalized;
}

export function normalizeConversationPrincipalRef(value: unknown): string {
  if (typeof value !== "string" || !IDENTITY_PATTERN.test(value)) invalid("Conversation Principal identity is invalid.");
  return value;
}

export function normalizeIdempotencyKey(value: unknown): string {
  if (typeof value !== "string") invalid("Conversation idempotency key is invalid.");
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > 200) invalid("Conversation idempotency key is invalid.");
  return normalized;
}

export function validateUserMessageContent(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > AI_CONVERSATION_MAX_MESSAGE_BYTES) {
    invalid("User message content is invalid.");
  }
  return value;
}

export function validateResponseChunkText(value: unknown): string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value, "utf8") > AI_CONVERSATION_MAX_CHUNK_BYTES) {
    invalid("Response chunk content is invalid.", "AI_CONVERSATION_RESPONSE_INVALID");
  }
  return value;
}

export function validateResponseOutputBytes(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > AI_CONVERSATION_MAX_RESPONSE_BYTES) invalid("Response output size is invalid.", "AI_CONVERSATION_RESPONSE_INVALID");
}

export function validateChunkSequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 100_000_000) invalid("Response chunk sequence is invalid.", "AI_CONVERSATION_STREAM_CONFLICT");
  return value as number;
}

export function normalizeSafeResponseErrorCode(value: unknown): AIConversationSafeErrorCode {
  if (typeof value !== "string" || !AI_CONVERSATION_SAFE_ERROR_CODES.includes(value as AIConversationSafeErrorCode)) invalid("Response error code is invalid.", "AI_CONVERSATION_RESPONSE_INVALID");
  return value as AIConversationSafeErrorCode;
}

export function normalizeFinishReason(value: unknown): AIConversationFinishReason {
  if (typeof value !== "string" || !AI_CONVERSATION_FINISH_REASONS.includes(value as AIConversationFinishReason)) invalid("Response finish reason is invalid.", "AI_CONVERSATION_RESPONSE_INVALID");
  return value as AIConversationFinishReason;
}

export function normalizeMessagePage(input: { afterOrdinal?: number; limit?: number }): { afterOrdinal: number; limit: number } {
  const afterOrdinal = input.afterOrdinal ?? 0;
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(afterOrdinal) || afterOrdinal < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > AI_CONVERSATION_MAX_MESSAGE_PAGE_SIZE) invalid("Conversation message pagination is invalid.");
  return { afterOrdinal, limit };
}

export function normalizeConversationPageLimit(value: number | undefined): number {
  const limit = value ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > AI_CONVERSATION_MAX_CONVERSATION_PAGE_SIZE) invalid("Conversation pagination is invalid.");
  return limit;
}

export function normalizeCursor(value: { lastActivityAt: number; conversationId: string } | undefined): { lastActivityAt: number; conversationId: string } | undefined {
  if (!value) return undefined;
  if (!Number.isSafeInteger(value.lastActivityAt) || value.lastActivityAt < 0) invalid("Conversation cursor is invalid.");
  return { lastActivityAt: value.lastActivityAt, conversationId: normalizeConversationId(value.conversationId) };
}

export function createConversationRequestFingerprint(input: {
  conversationId: string;
  subjectKey: string;
  userContent: string;
}): string {
  const contentHash = createHash("sha256").update(input.userContent, "utf8").digest("hex");
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    conversationId: normalizeConversationId(input.conversationId),
    subjectKey: normalizeConversationSubjectKey(input.subjectKey),
    userContentHash: contentHash,
  })).digest("hex");
}

export function hashConversationText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function invalid(message: string, code: "AI_CONVERSATION_INVALID" | "AI_CONVERSATION_SUBJECT_INVALID" | "AI_CONVERSATION_RESPONSE_INVALID" | "AI_CONVERSATION_STREAM_CONFLICT" = "AI_CONVERSATION_INVALID"): never {
  throw new AIConversationError(code, message);
}

export function isHash(value: string): boolean {
  return HASH_PATTERN.test(value);
}
