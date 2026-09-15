import type { NextRequest } from "next/server";

import { EphemeralModelChatService } from "@/server/ai/ephemeral-model-chat-service";
import { getContentDatabase } from "@/server/content";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
} from "../../../../_shared";
import { assertFields } from "../../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ modelId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    assertFields(body, ["messages", "reasoningEffort"]);
    const { modelId } = await context.params;
    const result = await EphemeralModelChatService.forDatabase(
      getContentDatabase(),
    ).chat(
      {
        modelId,
        messages: body.messages,
        reasoningEffort: body.reasoningEffort,
      },
      { signal: request.signal },
    );
    return localJson({ ok: true, ...result });
  } catch (error) {
    return localApiError(error);
  }
}
