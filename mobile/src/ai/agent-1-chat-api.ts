import { fetch } from "expo/fetch";

import { resolveApiUrl } from "@/api/client";
import type { ChatMessage } from "@/ai/chat-types";

interface JsonResponse {
  ok?: boolean;
  code?: string;
  token?: string;
  expiresAt?: number;
  reply?: string;
}

export class Agent1ChatApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "Agent1ChatApiError";
  }
}

let pairedToken: string | null = null;
let pairedTokenExpiresAt = 0;
let pairingGeneration = 0;

export function hasAgent1DevPairing(): boolean {
  return Boolean(pairedToken && Date.now() < pairedTokenExpiresAt);
}

export function clearAgent1DevPairing(): void {
  pairingGeneration += 1;
  const token = pairedToken;
  pairedToken = null;
  pairedTokenExpiresAt = 0;
  if (token) void revokeDevSession(token);
}

export async function pairAgent1DevChat(code: string, signal?: AbortSignal): Promise<void> {
  const generation = pairingGeneration;
  const body = await requestJson("/api/dev/ai/agent-1/pair", {
    method: "POST",
    body: JSON.stringify({ code: code.trim().toUpperCase() }),
    signal,
  });
  if (
    !body.token ||
    !Number.isSafeInteger(body.expiresAt) ||
    (body.expiresAt as number) <= Date.now()
  ) {
    throw new Agent1ChatApiError("PAIRING_RESPONSE_INVALID");
  }
  if (generation !== pairingGeneration) {
    void revokeDevSession(body.token);
    throw new Agent1ChatApiError("PAIRING_CANCELLED");
  }
  pairedToken = body.token;
  pairedTokenExpiresAt = body.expiresAt as number;
}

export async function sendAgent1DevChat(
  messages: readonly Pick<ChatMessage, "role" | "content">[],
  signal?: AbortSignal,
): Promise<string> {
  if (!hasAgent1DevPairing() || !pairedToken) {
    clearAgent1DevPairing();
    throw new Agent1ChatApiError("PAIRING_REQUIRED");
  }

  const body = await requestJson(
    "/api/dev/ai/agent-1/chat",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${pairedToken}` },
      body: JSON.stringify({ messages }),
      signal,
    },
  );
  if (typeof body.reply !== "string" || !body.reply.trim()) {
    throw new Agent1ChatApiError("EMPTY_RESPONSE");
  }
  return body.reply;
}

async function requestJson(
  path: string,
  init: RequestInit,
): Promise<JsonResponse> {
  let response: Response;
  try {
    response = await fetch(resolveApiUrl(path), {
      ...init,
      credentials: "omit",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Agent1ChatApiError("NETWORK_UNAVAILABLE");
  }

  const body = (await response.json().catch(() => ({}))) as JsonResponse;
  if (!response.ok || body.ok !== true) {
    if (body.code === "PAIRING_REQUIRED") clearAgent1DevPairing();
    throw new Agent1ChatApiError(body.code ?? `HTTP_${response.status}`);
  }
  return body;
}

async function revokeDevSession(token: string): Promise<void> {
  try {
    await fetch(resolveApiUrl("/api/dev/ai/agent-1/pair"), {
      method: "DELETE",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    // The server also expires every paired session automatically.
  }
}
