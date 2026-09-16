import type { NextRequest } from "next/server";

import type { EphemeralChatStreamEvent } from "@/lib/ephemeral-chat-contract";
import {
  EphemeralModelChatService,
  isEphemeralModelChatError,
} from "@/server/ai/ephemeral-model-chat-service";
import { getContentDatabase } from "@/server/content";
import {
  localApiError,
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
    assertFields(body, ["messages", "pythonEnabled"]);
    const { modelId } = await context.params;
    const abortController = new AbortController();
    const abortFromRequest = () => abortController.abort();
    request.signal.addEventListener("abort", abortFromRequest, { once: true });

    let events: AsyncGenerator<EphemeralChatStreamEvent>;
    try {
      events = EphemeralModelChatService.forDatabase(getContentDatabase()).stream(
        { modelId, messages: body.messages, pythonEnabled: body.pythonEnabled },
        { signal: abortController.signal },
      );
    } catch (error) {
      request.signal.removeEventListener("abort", abortFromRequest);
      return localApiError(error);
    }

    const encoder = new TextEncoder();
    const bodyStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of events) {
            if (abortController.signal.aborted) break;
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          }
        } catch (error) {
          if (!abortController.signal.aborted) {
            controller.enqueue(
              encoder.encode(`${JSON.stringify(safeStreamError(error))}\n`),
            );
          }
        } finally {
          request.signal.removeEventListener("abort", abortFromRequest);
          controller.close();
        }
      },
      cancel() {
        abortController.abort();
      },
    });

    return new Response(bodyStream, {
      headers: {
        "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return localApiError(error);
  }
}

function safeStreamError(error: unknown): EphemeralChatStreamEvent {
  if (isEphemeralModelChatError(error)) {
    return {
      type: "error",
      code: error.code,
      ...(error.detailCode || error.providerErrorCode
        ? { errorCode: error.detailCode ?? error.providerErrorCode }
        : {}),
    };
  }
  return { type: "error", code: "AI_EPHEMERAL_CHAT_FAILED" };
}
