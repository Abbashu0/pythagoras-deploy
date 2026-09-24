import { Agent1DevChatService } from "@/server/ai/agent-1-runtime/ephemeral-chat-service";
import { getAgent1DevPairingRegistry } from "@/server/ai/agent-1-runtime/dev-pairing";
import { getContentDatabase } from "@/server/content";
import {
  assertDevAgent1Fields,
  devAgent1ErrorResponse,
  devAgent1Json,
  isDevMobileChatEnabled,
  readDevAgent1Json,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDevMobileChatEnabled()) {
    return devAgent1Json({ ok: false, code: "DEV_CHAT_DISABLED" }, 404);
  }

  try {
    const body = await readDevAgent1Json(request);
    assertDevAgent1Fields(body, ["messages"]);
    const authorization = request.headers.get("authorization") ?? "";
    const token = /^Bearer ([A-Za-z0-9_-]{40,128})$/u.exec(authorization)?.[1];
    if (!getAgent1DevPairingRegistry().authorizeRequest(token)) {
      return devAgent1Json({ ok: false, code: "PAIRING_REQUIRED" }, 401);
    }

    const result = await Agent1DevChatService.forDatabase(getContentDatabase()).chat(
      { messages: body.messages },
      { signal: request.signal },
    );
    return devAgent1Json({ ok: true, ...result });
  } catch (error) {
    return devAgent1ErrorResponse(error);
  }
}
