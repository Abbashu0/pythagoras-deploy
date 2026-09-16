export type EphemeralChatRole = "user" | "assistant";

export interface EphemeralChatMessage {
  role: EphemeralChatRole;
  content: string;
}

export interface EphemeralChatUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  cachedInputTokens: number | null;
  cacheMissInputTokens: number | null;
}

export const EPHEMERAL_CHAT_FINISH_REASONS = [
  "STOP",
  "LENGTH",
  "CONTENT_FILTER",
  "TOOL_USE",
  "ERROR",
  "UNKNOWN",
] as const;

export type EphemeralChatFinishReason =
  (typeof EPHEMERAL_CHAT_FINISH_REASONS)[number];

export const EPHEMERAL_PYTHON_RESULT_STATUSES = [
  "ok",
  "error",
  "timeout",
  "cancelled",
] as const;

export type EphemeralPythonResultStatus =
  (typeof EPHEMERAL_PYTHON_RESULT_STATUSES)[number];

export type EphemeralChatStreamEvent =
  | { type: "started" }
  | { type: "reasoning_delta"; text: string }
  | { type: "text_delta"; text: string }
  | {
      type: "tool_call";
      callId: string;
      toolName: string;
      argumentsDelta: string;
    }
  | {
      type: "tool_started";
      callId: string;
      toolName: string;
      code: string;
    }
  | {
      type: "tool_result";
      callId: string;
      toolName: string;
      status: EphemeralPythonResultStatus;
      durationMs: number;
      stdout?: string;
      result?: string | null;
      stderr?: string;
      errorType?: string;
      message?: string;
    }
  | { type: "usage"; usage: EphemeralChatUsage }
  | {
      type: "completed";
      usage: EphemeralChatUsage;
      latencyMs: number | null;
      finishReason: EphemeralChatFinishReason;
    }
  | { type: "error"; code: string; errorCode?: string };

export function isEphemeralChatUsage(value: unknown): value is EphemeralChatUsage {
  if (!isRecord(value)) return false;
  return [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "reasoningTokens",
    "cachedInputTokens",
    "cacheMissInputTokens",
  ].every((key) => value[key] === null || safeNonNegativeInteger(value[key]));
}

export function isEphemeralChatStreamEvent(
  value: unknown,
): value is EphemeralChatStreamEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "started":
      return true;
    case "reasoning_delta":
    case "text_delta":
      return boundedText(value.text, 512 * 1024);
    case "tool_call":
      return boundedId(value.callId) && boundedToolName(value.toolName) && boundedText(value.argumentsDelta, 128 * 1024);
    case "tool_started":
      return boundedId(value.callId) && boundedToolName(value.toolName) && boundedText(value.code, 12 * 1024);
    case "tool_result":
      return (
        boundedId(value.callId) &&
        boundedToolName(value.toolName) &&
        (EPHEMERAL_PYTHON_RESULT_STATUSES as readonly string[]).includes(String(value.status)) &&
        safeNonNegativeInteger(value.durationMs) &&
        optionalBoundedText(value.stdout, 32 * 1024) &&
        optionalBoundedText(value.result, 32 * 1024) &&
        optionalBoundedText(value.stderr, 16 * 1024) &&
        optionalBoundedText(value.errorType, 120) &&
        optionalBoundedText(value.message, 16 * 1024)
      );
    case "usage":
      return isEphemeralChatUsage(value.usage);
    case "completed":
      return (
        isEphemeralChatUsage(value.usage) &&
        (typeof value.finishReason === "string" &&
          (EPHEMERAL_CHAT_FINISH_REASONS as readonly string[]).includes(value.finishReason)) &&
        (value.latencyMs === null || safeNonNegativeInteger(value.latencyMs))
      );
    case "error":
      return (
        boundedText(value.code, 120) &&
        (value.errorCode === undefined || boundedText(value.errorCode, 80))
      );
    default:
      return false;
  }
}

function boundedText(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && new TextEncoder().encode(value).byteLength <= maxBytes;
}

function optionalBoundedText(value: unknown, maxBytes: number): boolean {
  return value === undefined || value === null || boundedText(value, maxBytes);
}

function boundedId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 240;
}

function boundedToolName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/u.test(value);
}

function safeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
