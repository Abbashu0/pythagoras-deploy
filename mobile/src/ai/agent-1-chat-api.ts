import { fetch } from "expo/fetch";

import { resolveApiUrl } from "@/api/client";
import { Agent1ChatStreamError, consumeAgent1ChatStream } from "@/ai/agent-1-chat-stream";
import type { Agent1ChatStreamEvent, ChatMessage } from "@/ai/chat-types";

interface JsonResponse {
  code?: string;
}

export class Agent1ChatApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "Agent1ChatApiError";
  }
}

export async function sendAgent1DevChat(
  messages: readonly Pick<ChatMessage, "role" | "content">[],
  signal: AbortSignal,
  onEvent: (event: Agent1ChatStreamEvent) => void,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(resolveApiUrl("/api/dev/ai/agent-1/chat"), {
      method: "POST",
      credentials: "omit",
      headers: {
        Accept: "application/x-ndjson, application/json",
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages }),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Agent1ChatApiError("NETWORK_UNAVAILABLE");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as JsonResponse;
    throw new Agent1ChatApiError(body.code ?? `HTTP_${response.status}`);
  }

  if (!response.headers.get("content-type")?.toLowerCase().includes("application/x-ndjson")) {
    throw new Agent1ChatApiError("STREAM_UNSUPPORTED");
  }
  if (!response.body) throw new Agent1ChatApiError("STREAM_UNAVAILABLE");

  try {
    await consumeAgent1ChatStream(response.body, onEvent, signal);
  } catch (error) {
    if (error instanceof Agent1ChatStreamError) {
      throw new Agent1ChatApiError(error.code);
    }
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Agent1ChatApiError("STREAM_FAILED");
  }
}
