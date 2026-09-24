import {
  devAgent1ErrorResponse,
  devAgent1Json,
  isDevMobileChatEnabled,
  readDevAgent1Json,
} from "../_shared";
import { getAgent1DevPairingRegistry } from "@/server/ai/agent-1-runtime/dev-pairing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDevMobileChatEnabled()) {
    return devAgent1Json({ ok: false, code: "DEV_CHAT_DISABLED" }, 404);
  }

  try {
    const body = await readDevAgent1Json(request, 1_024);
    if (Object.keys(body).some((key) => key !== "code")) {
      return devAgent1Json({ ok: false, code: "INVALID_REQUEST" }, 400);
    }
    const result = getAgent1DevPairingRegistry().redeemCode(body.code);
    if (!result.ok) {
      const status = result.code === "PAIRING_RATE_LIMITED" ? 429 : 401;
      return devAgent1Json({ ok: false, code: result.code }, status);
    }
    return devAgent1Json({ ok: true, token: result.token, expiresAt: result.expiresAt });
  } catch (error) {
    return devAgent1ErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  if (!isDevMobileChatEnabled()) {
    return devAgent1Json({ ok: false, code: "DEV_CHAT_DISABLED" }, 404);
  }
  const authorization = request.headers.get("authorization") ?? "";
  const token = /^Bearer ([A-Za-z0-9_-]{40,128})$/u.exec(authorization)?.[1];
  if (token) getAgent1DevPairingRegistry().revokeSession(token);
  return devAgent1Json({ ok: true });
}
