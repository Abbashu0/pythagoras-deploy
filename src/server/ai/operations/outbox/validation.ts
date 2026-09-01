import { createHash } from "node:crypto";

import { AIOutboxError } from "./errors";
import { canonicalize } from "../jobs/validation";
import type { AIOutboxEventSpec } from "./contracts";

const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9.-]{0,119}$/u;
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const MAX_PAYLOAD_BYTES = 32 * 1024;

export interface NormalizedAIOutboxEventSpec extends Omit<AIOutboxEventSpec, "scheduledAt"> {
  scheduledAt: number;
  payloadJson: string;
  payloadHash: string;
}

export function normalizeAIOutboxEventSpec(value: AIOutboxEventSpec): NormalizedAIOutboxEventSpec {
  if (!isPlainObject(value)) invalid("Outbox event specification must be an object.");
  if (typeof value.eventType !== "string" || !EVENT_TYPE_PATTERN.test(value.eventType)) invalid("Outbox event type is invalid.");
  if (!Number.isSafeInteger(value.payloadVersion) || value.payloadVersion < 1 || value.payloadVersion > 100) invalid("Outbox payload version is invalid.");
  if (typeof value.dedupeKey !== "string" || !value.dedupeKey.trim() || value.dedupeKey.length > 240) invalid("Outbox dedupe key is invalid.");
  if (!isPlainObject(value.payload)) invalid("Outbox payload must be an object.");
  const payload = canonicalize(value.payload, "payload");
  const payloadJson = JSON.stringify(payload);
  if (Buffer.byteLength(payloadJson, "utf8") > MAX_PAYLOAD_BYTES) invalid("Outbox payload exceeds the bounded size.");
  const payloadHash = createHash("sha256").update(payloadJson).digest("hex");
  const scheduledAt = value.scheduledAt ?? Date.now();
  if (!Number.isSafeInteger(scheduledAt) || scheduledAt < 0 || scheduledAt > MAX_TIMESTAMP) invalid("Outbox scheduledAt is invalid.");
  return {
    id: value.id,
    eventType: value.eventType,
    payloadVersion: value.payloadVersion,
    payload,
    payloadJson,
    payloadHash,
    dedupeKey: value.dedupeKey.trim(),
    scheduledAt,
  };
}

function invalid(message: string): never {
  throw new AIOutboxError("AI_OUTBOX_INVALID", message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
