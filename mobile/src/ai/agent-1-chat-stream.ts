import type { Agent1ChatStreamEvent } from "./chat-types";

export class Agent1ChatStreamError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "Agent1ChatStreamError";
  }
}

const MAX_STREAM_FRAME_CHARACTERS = 72 * 1_024;

export async function consumeAgent1ChatStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: Agent1ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedStarted = false;
  let receivedText = false;
  let terminal: "completed" | "error" | null = null;
  let reachedEnd = false;

  const onAbort = () => {
    void reader.cancel(createAbortError()).catch(() => {});
  };
  if (signal?.aborted) throw createAbortError();
  signal?.addEventListener("abort", onAbort, { once: true });

  const consumeLine = (rawLine: string) => {
    const line = rawLine.trim().replace(/^\uFEFF/u, "");
    if (!line) return;
    if (line.length > MAX_STREAM_FRAME_CHARACTERS) {
      throw new Agent1ChatStreamError("STREAM_FRAME_TOO_LARGE");
    }
    if (terminal) throw new Agent1ChatStreamError("STREAM_INVALID");

    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch {
      throw new Agent1ChatStreamError("STREAM_INVALID");
    }
    if (typeof frame !== "object" || frame === null || Array.isArray(frame)) {
      throw new Agent1ChatStreamError("STREAM_INVALID");
    }

    const record = frame as Record<string, unknown>;
    if (record.type === "started" && hasExactKeys(record, ["type"])) {
      if (receivedStarted) throw new Agent1ChatStreamError("STREAM_INVALID");
      receivedStarted = true;
      onEvent({ type: "started" });
      return;
    }
    if (
      record.type === "phase" &&
      hasExactKeys(record, ["type", "phase"]) &&
      (record.phase === "working" || record.phase === "thinking")
    ) {
      if (!receivedStarted) throw new Agent1ChatStreamError("STREAM_INVALID");
      onEvent({ type: "phase", phase: record.phase });
      return;
    }
    if (
      record.type === "text_delta" &&
      hasExactKeys(record, ["type", "text"]) &&
      typeof record.text === "string"
    ) {
      if (!receivedStarted) throw new Agent1ChatStreamError("STREAM_INVALID");
      if (record.text) {
        receivedText ||= Boolean(record.text.trim());
        onEvent({ type: "text_delta", text: record.text });
      }
      return;
    }
    if (record.type === "completed" && hasExactKeys(record, ["type"])) {
      if (!receivedStarted || !receivedText) {
        throw new Agent1ChatStreamError(receivedText ? "STREAM_INVALID" : "EMPTY_RESPONSE");
      }
      terminal = "completed";
      return;
    }
    if (
      record.type === "error" &&
      hasExactKeys(record, ["type", "code"]) &&
      typeof record.code === "string" &&
      record.code.length > 0
    ) {
      terminal = "error";
      throw new Agent1ChatStreamError(record.code);
    }
    throw new Agent1ChatStreamError("STREAM_INVALID");
  };

  try {
    while (true) {
      if (signal?.aborted) throw createAbortError();
      const { done, value } = await reader.read();
      if (signal?.aborted) throw createAbortError();
      reachedEnd = done;
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > MAX_STREAM_FRAME_CHARACTERS && !buffer.includes("\n")) {
        throw new Agent1ChatStreamError("STREAM_FRAME_TOO_LARGE");
      }

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        consumeLine(buffer.slice(0, newlineIndex));
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
      }

      if (done) {
        if (buffer.trim()) consumeLine(buffer);
        break;
      }
    }

    if (terminal !== "completed") {
      throw new Agent1ChatStreamError("STREAM_INCOMPLETE");
    }
    onEvent({ type: "completed" });
  } catch (error) {
    if (error instanceof Agent1ChatStreamError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Agent1ChatStreamError("STREAM_FAILED");
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!reachedEnd) {
      try {
        await reader.cancel();
      } catch {
        // The request may already have been aborted by the caller.
      }
    }
    reader.releaseLock();
  }
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === expected.length && expected.every((key) => key in record);
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
