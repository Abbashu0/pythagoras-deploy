import {
  Agent1DevChatError,
  type Agent1DevChatStreamEvent,
} from "./ephemeral-chat-service";

type Agent1DevChatWireEvent =
  | Agent1DevChatStreamEvent
  | { type: "error"; code: string };

type Agent1DevChatRunner = (signal: AbortSignal) => AsyncIterable<Agent1DevChatStreamEvent>;

export function createAgent1DevChatStreamResponse(
  requestSignal: AbortSignal,
  runChat: Agent1DevChatRunner,
): Response {
  const operationController = new AbortController();
  const abortWithRequest = () => operationController.abort(requestSignal.reason);
  if (requestSignal.aborted) {
    abortWithRequest();
  } else {
    requestSignal.addEventListener("abort", abortWithRequest, { once: true });
  }

  let clientCancelled = false;
  let iterator: AsyncIterator<Agent1DevChatStreamEvent> | null = null;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const sendFrame = (frame: Agent1DevChatWireEvent) => {
        if (clientCancelled || operationController.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
        } catch {
          clientCancelled = true;
          operationController.abort();
        }
      };

      void (async () => {
        try {
          iterator = runChat(operationController.signal)[Symbol.asyncIterator]();
          while (!clientCancelled && !operationController.signal.aborted) {
            const next = await iterator.next();
            if (next.done) break;
            sendFrame(next.value);
          }
        } catch (error) {
          if (!operationController.signal.aborted) {
            sendFrame({
              type: "error",
              code: error instanceof Agent1DevChatError ? error.code : "DEV_CHAT_UNAVAILABLE",
            });
          }
        } finally {
          requestSignal.removeEventListener("abort", abortWithRequest);
          if (clientCancelled || operationController.signal.aborted) {
            try {
              await iterator?.return?.();
            } catch {
              // The upstream stream may already have completed during cancellation.
            }
          }
          if (!clientCancelled) {
            try {
              controller.close();
            } catch {
              // The client may have disconnected while the last event was flushing.
            }
          }
        }
      })();
    },
    cancel() {
      clientCancelled = true;
      operationController.abort();
      void iterator?.return?.();
    },
  });

  return new Response(body, {
    headers: {
      "Cache-Control": "no-store, no-cache, no-transform",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
