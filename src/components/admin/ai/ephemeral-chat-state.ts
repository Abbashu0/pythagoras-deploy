import type {
  EphemeralChatFinishReason,
  EphemeralChatMessage,
  EphemeralChatStreamEvent,
  EphemeralPythonResultStatus,
  EphemeralChatUsage,
} from "@/lib/ephemeral-chat-contract";

export type EphemeralChatTurnStatus =
  | "pending"
  | "streaming"
  | "completed"
  | "error";

export type EphemeralChatSegment =
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | {
      type: "tool";
      callId: string;
      toolName: string;
      argumentsText: string;
      code: string;
      status: "calling" | "running" | EphemeralPythonResultStatus;
      stdout?: string;
      result?: string | null;
      stderr?: string;
      errorType?: string;
      message?: string;
      durationMs?: number;
    };

export interface EphemeralChatTurn extends EphemeralChatMessage {
  id: string;
  reasoningText: string;
  status: EphemeralChatTurnStatus;
  reasoningStartedAt: number | null;
  reasoningCompletedAt: number | null;
  workStartedAt: number | null;
  workCompletedAt: number | null;
  usage: EphemeralChatUsage | null;
  latencyMs: number | null;
  finishReason: EphemeralChatFinishReason | null;
  segments: EphemeralChatSegment[];
  error?: string;
}

export interface EphemeralChatPresentation {
  workSegments: Extract<EphemeralChatSegment, { type: "reasoning" | "tool" }>[];
  answerText: string;
}

export function applyEphemeralChatEvent(
  turn: EphemeralChatTurn,
  event: EphemeralChatStreamEvent,
  now: number,
): EphemeralChatTurn {
  switch (event.type) {
    case "started":
      return { ...turn, status: "streaming" };
    case "reasoning_delta":
      return {
        ...turn,
        status: "streaming",
        reasoningText: turn.reasoningText + event.text,
        segments: appendTextSegment(turn.segments, "reasoning", event.text),
        reasoningStartedAt: turn.reasoningStartedAt ?? now,
        workStartedAt: turn.workStartedAt ?? now,
      };
    case "text_delta":
      return {
        ...turn,
        status: "streaming",
        content: turn.content + event.text,
        segments: appendTextSegment(turn.segments, "text", event.text),
        workCompletedAt:
          turn.workStartedAt !== null && turn.workCompletedAt === null
            ? now
            : turn.workCompletedAt,
        reasoningCompletedAt:
          turn.reasoningStartedAt !== null && turn.reasoningCompletedAt === null
            ? now
            : turn.reasoningCompletedAt,
      };
    case "tool_call":
      return {
        ...turn,
        status: "streaming",
        workStartedAt: turn.workStartedAt ?? now,
        segments: upsertToolSegment(turn.segments, event.callId, (segment) => {
          const argumentsText = segment.argumentsText + event.argumentsDelta;
          return {
            ...segment,
            toolName: event.toolName,
            argumentsText,
            code: extractPythonCode(argumentsText) ?? segment.code,
            status:
              segment.status === "calling" || segment.status === "running"
                ? segment.status
                : "calling",
          };
        }),
      };
    case "tool_started":
      return {
        ...turn,
        status: "streaming",
        workStartedAt: turn.workStartedAt ?? now,
        segments: upsertToolSegment(turn.segments, event.callId, (segment) => ({
          ...segment,
          toolName: event.toolName,
          code: event.code,
          status: "running",
        })),
      };
    case "tool_result":
      return {
        ...turn,
        status: "streaming",
        workStartedAt: turn.workStartedAt ?? now,
        segments: upsertToolSegment(turn.segments, event.callId, (segment) => ({
          ...segment,
          toolName: event.toolName,
          status: event.status,
          ...(event.stdout === undefined ? {} : { stdout: event.stdout }),
          ...(event.result === undefined ? {} : { result: event.result }),
          ...(event.stderr === undefined ? {} : { stderr: event.stderr }),
          ...(event.errorType === undefined ? {} : { errorType: event.errorType }),
          ...(event.message === undefined ? {} : { message: event.message }),
          durationMs: event.durationMs,
        })),
      };
    case "usage":
      return { ...turn, usage: event.usage };
    case "completed":
      return {
        ...turn,
        status: "completed",
        usage: event.usage,
        latencyMs: event.latencyMs,
        finishReason: event.finishReason,
        reasoningCompletedAt:
          turn.reasoningStartedAt !== null && turn.reasoningCompletedAt === null
            ? now
            : turn.reasoningCompletedAt,
        workCompletedAt:
          turn.workStartedAt !== null && turn.workCompletedAt === null
            ? now
            : turn.workCompletedAt,
      };
    case "error":
      return {
        ...turn,
        status: "error",
        error: event.errorCode ?? event.code,
        workCompletedAt:
          turn.workStartedAt !== null && turn.workCompletedAt === null
            ? now
            : turn.workCompletedAt,
      };
  }
}

export function truncateAfterUserTurn(
  turns: readonly EphemeralChatTurn[],
  userTurnId: string,
): EphemeralChatTurn[] {
  const index = turns.findIndex(
    (turn) => turn.id === userTurnId && turn.role === "user",
  );
  return index < 0 ? [...turns] : turns.slice(0, index + 1);
}

export function isNearChatBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = 72,
): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= threshold;
}

function appendTextSegment(
  segments: readonly EphemeralChatSegment[],
  type: "reasoning" | "text",
  text: string,
): EphemeralChatSegment[] {
  if (!text) return [...segments];
  const previous = segments.at(-1);
  if (previous?.type === type) {
    return [...segments.slice(0, -1), { ...previous, text: previous.text + text }];
  }
  return [...segments, { type, text }];
}

function upsertToolSegment(
  segments: readonly EphemeralChatSegment[],
  callId: string,
  update: (
    segment: Extract<EphemeralChatSegment, { type: "tool" }>,
  ) => Extract<EphemeralChatSegment, { type: "tool" }>,
): EphemeralChatSegment[] {
  const index = segments.findIndex(
    (segment) => segment.type === "tool" && segment.callId === callId,
  );
  if (index < 0) {
    return [
      ...segments,
      update({
        type: "tool",
        callId,
        toolName: "python",
        argumentsText: "",
        code: "",
        status: "calling",
      }),
    ];
  }
  const current = segments[index];
  if (current.type !== "tool") return [...segments];
  return [...segments.slice(0, index), update(current), ...segments.slice(index + 1)];
}

function extractPythonCode(argumentsText: string): string | null {
  if (!argumentsText.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(argumentsText);
    if (isRecord(parsed) && typeof parsed.code === "string") return parsed.code;
  } catch {
    // Tool arguments arrive in fragments; wait for a complete JSON object.
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function reasoningDurationSeconds(turn: EphemeralChatTurn): number | null {
  if (turn.reasoningStartedAt === null || turn.reasoningCompletedAt === null) {
    return null;
  }
  return Math.max(
    0,
    Math.round((turn.reasoningCompletedAt - turn.reasoningStartedAt) / 1000),
  );
}

export function workDurationSeconds(turn: EphemeralChatTurn): number | null {
  if (turn.workStartedAt === null || turn.workCompletedAt === null) return null;
  return Math.max(0, Math.round((turn.workCompletedAt - turn.workStartedAt) / 1000));
}

export function groupEphemeralChatPresentation(
  turn: EphemeralChatTurn,
): EphemeralChatPresentation {
  return {
    workSegments: turn.segments.filter(
      (segment): segment is Extract<EphemeralChatSegment, { type: "reasoning" | "tool" }> =>
        segment.type === "reasoning" || segment.type === "tool",
    ),
    answerText: turn.content,
  };
}

export function toggleWorkExpanded(
  expanded: Readonly<Record<string, boolean>>,
  turnId: string,
): Record<string, boolean> {
  return { ...expanded, [turnId]: !(expanded[turnId] ?? true) };
}

export function technicalUsageParts(
  usage: EphemeralChatUsage | null,
): string[] {
  if (!usage) return [];
  return [
    usage.inputTokens === null ? null : `Input ${usage.inputTokens}`,
    usage.outputTokens === null ? null : `Output ${usage.outputTokens}`,
    usage.totalTokens === null ? null : `Total ${usage.totalTokens}`,
    usage.reasoningTokens === null ? null : `Reasoning ${usage.reasoningTokens}`,
    usage.cachedInputTokens === null ? null : `Cached ${usage.cachedInputTokens}`,
  ].filter((value): value is string => value !== null);
}
