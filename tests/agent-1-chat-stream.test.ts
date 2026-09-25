import assert from "node:assert/strict";
import test from "node:test";

import {
  Agent1ChatStreamError,
  consumeAgent1ChatStream,
} from "../mobile/src/ai/agent-1-chat-stream";

function readableFrom(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

test("mobile stream parser handles multiple NDJSON frames and split UTF-8 characters", async () => {
  const encoded = new TextEncoder().encode([
    '{"type":"started"}',
    '{"type":"phase","phase":"thinking"}',
    '{"type":"text_delta","text":"مرحبا"}',
    '{"type":"text_delta","text":" بك"}',
    '{"type":"completed"}',
  ].join("\n") + "\n");
  const arabicByte = encoded.indexOf(0xd9);
  const splitPoints = [arabicByte + 1, 30, 70].sort((left, right) => left - right).filter(
    (point, index, points) => point > 0 && point < encoded.length && points.indexOf(point) === index,
  );
  const chunks: Uint8Array[] = [];
  let previous = 0;
  for (const splitPoint of splitPoints) {
    chunks.push(encoded.slice(previous, splitPoint));
    previous = splitPoint;
  }
  chunks.push(encoded.slice(previous));

  const events: unknown[] = [];
  await consumeAgent1ChatStream(readableFrom(chunks), (event) => events.push(event));

  assert.deepEqual(events, [
    { type: "started" },
    { type: "phase", phase: "thinking" },
    { type: "text_delta", text: "مرحبا" },
    { type: "text_delta", text: " بك" },
    { type: "completed" },
  ]);
});

test("mobile stream parser consumes several complete frames delivered in one read", async () => {
  const body = readableFrom([
    new TextEncoder().encode([
      '{"type":"started"}',
      '{"type":"phase","phase":"working"}',
      '{"type":"text_delta","text":"streamed"}',
      '{"type":"completed"}',
    ].join("\n") + "\n"),
  ]);
  const events: unknown[] = [];

  await consumeAgent1ChatStream(body, (event) => events.push(event));
  assert.deepEqual(events, [
    { type: "started" },
    { type: "phase", phase: "working" },
    { type: "text_delta", text: "streamed" },
    { type: "completed" },
  ]);
});

test("mobile stream parser surfaces a sanitized server error after preserving prior deltas", async () => {
  const body = readableFrom([
    new TextEncoder().encode('{"type":"started"}\n{"type":"text_delta","text":"جزء"}\n'),
    new TextEncoder().encode('{"type":"error","code":"PROVIDER_FAILED"}\n'),
  ]);
  const events: unknown[] = [];

  await assert.rejects(
    consumeAgent1ChatStream(body, (event) => events.push(event)),
    (error: unknown) =>
      error instanceof Agent1ChatStreamError && error.code === "PROVIDER_FAILED",
  );
  assert.deepEqual(events, [
    { type: "started" },
    { type: "text_delta", text: "جزء" },
  ]);
});

test("mobile stream parser rejects missing completion and does not invent terminal state", async () => {
  const events: unknown[] = [];
  const body = readableFrom([
    new TextEncoder().encode('{"type":"started"}\n{"type":"text_delta","text":"جزء"}\n'),
  ]);

  await assert.rejects(
    consumeAgent1ChatStream(body, (event) => events.push(event)),
    (error: unknown) =>
      error instanceof Agent1ChatStreamError && error.code === "STREAM_INCOMPLETE",
  );
  assert.deepEqual(events, [
    { type: "started" },
    { type: "text_delta", text: "جزء" },
  ]);
});

test("mobile stream parser rejects reasoning content and undeclared metadata", async () => {
  const reasoningEvents: unknown[] = [];
  const reasoningBody = readableFrom([
    new TextEncoder().encode(
      '{"type":"started"}\n{"type":"reasoning_delta","text":"secret reasoning"}\n',
    ),
  ]);
  await assert.rejects(
    consumeAgent1ChatStream(reasoningBody, (event) => reasoningEvents.push(event)),
    (error: unknown) =>
      error instanceof Agent1ChatStreamError && error.code === "STREAM_INVALID",
  );
  assert.deepEqual(reasoningEvents, [{ type: "started" }]);

  const metadataBody = readableFrom([
    new TextEncoder().encode('{"type":"started","providerRequestId":"private"}\n'),
  ]);
  await assert.rejects(
    consumeAgent1ChatStream(metadataBody, () => {}),
    (error: unknown) =>
      error instanceof Agent1ChatStreamError && error.code === "STREAM_INVALID",
  );
});

test("mobile stream parser aborts the reader without converting cancellation to a stream error", async () => {
  const controller = new AbortController();
  let resolvePullStarted: () => void = () => {};
  const pullStarted = new Promise<void>((resolve) => {
    resolvePullStarted = resolve;
  });
  let cancelled = false;
  let releasePendingPull: () => void = () => {};
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      streamController.enqueue(encoder.encode('{"type":"started"}\n'));
    },
    pull(streamController) {
      resolvePullStarted();
      return new Promise<void>((resolve) => {
        releasePendingPull = resolve;
      });
    },
    cancel() {
      cancelled = true;
      releasePendingPull();
    },
  });

  const consuming = consumeAgent1ChatStream(body, () => {}, controller.signal);
  await pullStarted;
  controller.abort();
  await assert.rejects(consuming, (error: unknown) =>
    error instanceof Error && error.name === "AbortError",
  );
  assert.equal(cancelled, true);
});
