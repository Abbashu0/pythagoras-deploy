import { Agent1DevChatError } from "@/server/ai/agent-1-runtime/ephemeral-chat-service";
import { isDevelopmentAgentExecution } from "@/server/ai/agent-1-runtime/instruction-qualification";

export const DEV_CHAT_BODY_LIMIT_BYTES = 64 * 1_024;

export class DevAgent1RouteError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "BODY_TOO_LARGE") {
    super("The development Agent 1 request is invalid.");
    this.name = "DevAgent1RouteError";
  }
}

export function devAgent1Json(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function readDevAgent1Json(
  request: Request,
  maxBytes = DEV_CHAT_BODY_LIMIT_BYTES,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (contentType !== "application/json" || declaredLength > maxBytes || !request.body) {
    throw new DevAgent1RouteError(declaredLength > maxBytes ? "BODY_TOO_LARGE" : "INVALID_REQUEST");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new DevAgent1RouteError("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  let parsed: unknown;
  try {
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new DevAgent1RouteError("INVALID_REQUEST");
  }
  if (!isRecord(parsed)) throw new DevAgent1RouteError("INVALID_REQUEST");
  return parsed;
}

export function assertDevAgent1Fields(
  body: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(body).some((key) => !allowedSet.has(key))) {
    throw new DevAgent1RouteError("INVALID_REQUEST");
  }
}

export function devAgent1ErrorResponse(error: unknown): Response {
  if (error instanceof DevAgent1RouteError) {
    return devAgent1Json(
      { ok: false, code: error.code },
      error.code === "BODY_TOO_LARGE" ? 413 : 400,
    );
  }
  if (error instanceof Agent1DevChatError) {
    const status =
      error.code === "AGENT_1_DISABLED" || error.code === "AGENT_1_NOT_READY"
        ? 409
        : error.code === "CHAT_INVALID"
          ? 400
          : error.code === "CHAT_TOO_LARGE" || error.code === "RESPONSE_TOO_LARGE"
            ? 413
            : error.code === "CANCELLED"
              ? 408
              : 502;
    return devAgent1Json(
      {
        ok: false,
        code: error.code,
        ...(error.providerCode ? { errorCode: error.providerCode } : {}),
      },
      status,
    );
  }
  return devAgent1Json({ ok: false, code: "DEV_CHAT_UNAVAILABLE" }, 500);
}

export function isDevMobileChatEnabled(nodeEnvironment = process.env.NODE_ENV): boolean {
  return isDevelopmentAgentExecution("DEVELOPMENT_STATELESS_CHAT", nodeEnvironment);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
