import type { NextRequest } from "next/server";

import { AIAgent1RuntimeService } from "@/server/ai/agent-1-runtime/service";
import { getAgent1DevPairingRegistry } from "@/server/ai/agent-1-runtime/dev-pairing";
import { getContentDatabase } from "@/server/content";
import { localApiError, localJson, requireLocalAdminMutation } from "../../../_shared";
import { devAgent1Json, isDevMobileChatEnabled } from "@/app/api/dev/ai/agent-1/_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isDevMobileChatEnabled()) {
    return devAgent1Json({ ok: false, code: "DEV_CHAT_DISABLED" }, 404);
  }

  try {
    requireLocalAdminMutation(request);
    const snapshot = AIAgent1RuntimeService.forDatabase(getContentDatabase()).getSnapshot();
    if (!snapshot.config.enabled || !snapshot.primary?.ready) {
      return localJson(
        { ok: false, code: "AGENT_1_NOT_READY" },
        { status: 409 },
      );
    }

    const pairing = getAgent1DevPairingRegistry().issueCode();
    return localJson({ ok: true, ...pairing });
  } catch (error) {
    return localApiError(error);
  }
}
