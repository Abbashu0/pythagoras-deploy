import {
  AI_MEMORY_KINDS,
  type AIMemoryKind,
  type AIMemoryScope,
} from "./contracts";
import { AIMemoryError } from "./contracts";

export const AI_MEMORY_COMMAND_PROTOCOL_KEY = "memory-command-v1" as const;
export const AI_MEMORY_COMMAND_PROTOCOL_REVISION = 1 as const;
export const AI_MEMORY_COMMAND_MAX_BYTES = 16 * 1024;

export const AI_MEMORY_COMMAND_ACTIONS = [
  "NOOP",
  "CREATE",
  "UPDATE",
  "ADD_EVIDENCE",
  "ACTIVATE",
  "RESOLVE",
  "DELETE",
] as const;
export type AIMemoryCommandAction = (typeof AI_MEMORY_COMMAND_ACTIONS)[number];

export interface AIMemoryCommand {
  protocolKey: typeof AI_MEMORY_COMMAND_PROTOCOL_KEY;
  protocolRevision: typeof AI_MEMORY_COMMAND_PROTOCOL_REVISION;
  action: AIMemoryCommandAction;
  scope: AIMemoryScope;
  subjectKey: string | null;
  memoryId: string | null;
  expectedRevision: number | null;
  kind: AIMemoryKind | null;
  origin: "EXPLICIT" | "INFERRED" | null;
  confidenceUnits: number | null;
  memoryText: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SUBJECT_PATTERN = /^[a-z0-9-]{1,80}$/u;
const MAX_TEXT_BYTES = 131_072;
const KEYS = new Set([
  "protocolKey",
  "protocolRevision",
  "action",
  "scope",
  "subjectKey",
  "memoryId",
  "expectedRevision",
  "kind",
  "origin",
  "confidenceUnits",
  "memoryText",
]);

/** Strict provider-neutral command parser; source/owner identity is derived by the server. */
export function parseAIMemoryCommand(value: unknown): AIMemoryCommand {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !KEYS.has(key))) invalid("The Memory command shape is invalid.");
  try {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > AI_MEMORY_COMMAND_MAX_BYTES) invalid("The Memory command exceeds its bound.");
  } catch {
    invalid("The Memory command shape is invalid.");
  }
  if (value.protocolKey !== AI_MEMORY_COMMAND_PROTOCOL_KEY || value.protocolRevision !== AI_MEMORY_COMMAND_PROTOCOL_REVISION) invalid("The Memory command protocol is unsupported.");
  const action = enumValue(value.action, AI_MEMORY_COMMAND_ACTIONS, "action");
  const scope = enumValue(value.scope, ["GLOBAL", "SUBJECT"] as const, "scope");
  const subjectKey = value.subjectKey === null ? null : boundedSubject(value.subjectKey);
  if ((scope === "GLOBAL" && subjectKey !== null) || (scope === "SUBJECT" && subjectKey === null)) invalid("The Memory command scope is invalid.");
  const memoryId = value.memoryId === undefined || value.memoryId === null ? null : boundedUuid(value.memoryId, "memoryId");
  const expectedRevision = value.expectedRevision === undefined || value.expectedRevision === null ? null : boundedPositiveInteger(value.expectedRevision, "expectedRevision");
  const kind = value.kind === undefined || value.kind === null ? null : enumValue(value.kind, AI_MEMORY_KINDS, "kind");
  const origin = value.origin === undefined || value.origin === null ? null : enumValue(value.origin, ["EXPLICIT", "INFERRED"] as const, "origin");
  const confidenceUnits = value.confidenceUnits === undefined || value.confidenceUnits === null ? null : boundedInteger(value.confidenceUnits, 0, 1_000_000, "confidenceUnits");
  const memoryText = value.memoryText === undefined || value.memoryText === null ? null : boundedText(value.memoryText);

  if (action === "NOOP" && (memoryId !== null || expectedRevision !== null || kind !== null || origin !== null || confidenceUnits !== null || memoryText !== null)) invalid("A NOOP Memory command cannot carry mutation data.");
  if (action === "CREATE" && (memoryId !== null || expectedRevision !== null || kind === null || origin === null || confidenceUnits === null || memoryText === null)) invalid("A CREATE Memory command is incomplete.");
  if (action === "CREATE" && origin === "EXPLICIT" && scope === "GLOBAL" && kind === "PREFERRED_NAME" && !memoryText) invalid("The Memory command is empty.");
  if (["UPDATE"].includes(action) && (memoryId === null || expectedRevision === null || kind === null || confidenceUnits === null || memoryText === null)) invalid("An UPDATE Memory command is incomplete.");
  if (["ADD_EVIDENCE", "ACTIVATE", "RESOLVE", "DELETE"].includes(action) && (memoryId === null || expectedRevision === null)) invalid("The targeted Memory command is incomplete.");
  if (action === "ADD_EVIDENCE" && (kind !== null || origin !== null || confidenceUnits !== null || memoryText !== null)) invalid("An evidence command cannot carry Memory content.");
  if (action === "ACTIVATE" && (kind !== null || confidenceUnits !== null || memoryText !== null || origin !== "INFERRED")) invalid("An activation command is invalid.");
  if (["RESOLVE", "DELETE"].includes(action) && (kind !== null || origin !== null || confidenceUnits !== null || memoryText !== null)) invalid("A terminal Memory command cannot carry Memory content.");
  if (action === "UPDATE" && origin !== null) invalid("An UPDATE command does not select a new Memory origin.");

  return { protocolKey: AI_MEMORY_COMMAND_PROTOCOL_KEY, protocolRevision: AI_MEMORY_COMMAND_PROTOCOL_REVISION, action, scope, subjectKey, memoryId, expectedRevision, kind, origin, confidenceUnits, memoryText };
}

function boundedText(value: unknown): string {
  if (typeof value !== "string") invalid("The Memory command text is invalid.");
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > MAX_TEXT_BYTES) invalid("The Memory command text exceeds its bound.");
  return normalized;
}

function boundedSubject(value: unknown): string {
  if (typeof value !== "string") invalid("The Memory command subject is invalid.");
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (!SUBJECT_PATTERN.test(normalized) || normalized !== value) invalid("The Memory command subject is invalid.");
  return normalized;
}

function boundedUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid(`The Memory command ${field} is invalid.`);
  return value;
}

function boundedPositiveInteger(value: unknown, field: string): number {
  return boundedInteger(value, 1, Number.MAX_SAFE_INTEGER, field);
}

function boundedInteger(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid(`The Memory command ${field} is invalid.`);
  return value;
}

function enumValue<T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) invalid(`The Memory command ${field} is invalid.`);
  return value as T[number];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(message: string): never {
  throw new AIMemoryError("AI_MEMORY_MUTATION_INVALID", message);
}
