import { Agent1DevChatService } from "@/server/ai/agent-1-runtime/ephemeral-chat-service";
import { createAgent1DevChatStreamResponse } from "@/server/ai/agent-1-runtime/dev-chat-stream-response";
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
    const service = Agent1DevChatService.forDatabase(getContentDatabase());
    return createAgent1DevChatStreamResponse(request.signal, (signal) =>
      service.stream({ messages: body.messages }, { signal }),
    );
  } catch (error) {
    return devAgent1ErrorResponse(error);
  }
}
