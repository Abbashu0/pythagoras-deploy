import assert from "node:assert/strict";
import test from "node:test";

import { projectAgent1ChatRows } from "../mobile/src/ai/agent-1-chat-presentation";
import { Agent1ChatStreamStore } from "../mobile/src/ai/agent-1-chat-stream-store";
import {
  completeAgent1ChatTurn,
  createAcceptedAgent1ChatTurn,
  failAgent1ChatTurn,
  markAgent1ChatTurnStreaming,
} from "../mobile/src/ai/agent-1-chat-state";
import type { Agent1ChatStreamScheduler } from "../mobile/src/ai/agent-1-chat-stream-store";
import type { ChatTurn } from "../mobile/src/ai/chat-types";

class ManualScheduler implements Agent1ChatStreamScheduler {
  private nextHandle = 0;
  private readonly tasks = new Map<number, () => void>();

  schedule(callback: () => void): number {
    const handle = this.nextHandle++;
    this.tasks.set(handle, callback);
    return handle;
  }

  cancel(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  runPending(): void {
    const pending = [...this.tasks.values()];
    this.tasks.clear();
    pending.forEach((callback) => callback());
  }

  get pendingCount(): number {
    return this.tasks.size;
  }
}

function makeTurn(id: string, attempt = 0): ChatTurn {
  return {
    id,
    user: { id, role: "user", content: `user ${id}` },
    assistantAttempt: attempt,
    assistant: null,
    assistantStatus: "working",
    errorMessage: null,
  };
}

test("presentation projection gives user and assistant independent stable identities", () => {
  const first = makeTurn("t-1");
  const rows = projectAgent1ChatRows([first]);
  const regenerated = projectAgent1ChatRows([{ ...first, assistantAttempt: 1 }]);

  assert.deepEqual(rows.map(({ key, type }) => [key, type]), [
    ["turn:t-1:user", "user-message"],
    ["turn:t-1:assistant:0", "assistant-message"],
  ]);
  assert.equal(rows[0].key, regenerated[0].key);
  assert.notEqual(rows[1].key, regenerated[1].key);
  assert.equal(rows[0].type === "user-message" && regenerated[0].type === "user-message"
    ? rows[0].message
    : null, first.user);
});

test("stream store accumulates every delta immediately and coalesces presentation updates", () => {
  const scheduler = new ManualScheduler();
  const store = new Agent1ChatStreamStore(32, scheduler);
  const key = "turn-assistant-0";
  let notifications = 0;
  store.subscribe(key, () => notifications++);
  store.begin(key);
  notifications = 0;

  store.append(key, "مرحبا ");
  store.append(key, "بكم");

  assert.equal(store.getAccumulatedText(key), "مرحبا بكم");
  assert.equal(store.getSnapshot(key).text, "");
  assert.equal(scheduler.pendingCount, 1);

  scheduler.runPending();
  assert.equal(store.getSnapshot(key).text, "مرحبا بكم");
  assert.equal(notifications, 1);
});

test("terminal flush commits the exact accumulated text once and seals late deltas", () => {
  const scheduler = new ManualScheduler();
  const store = new Agent1ChatStreamStore(32, scheduler);
  const key = "turn-assistant-0";
  store.begin(key);
  store.append(key, "complete ");
  store.append(key, "answer");

  assert.equal(store.finish(key), "complete answer");
  assert.equal(store.getSnapshot(key).text, "complete answer");
  assert.equal(scheduler.pendingCount, 0);
  store.append(key, "late");
  assert.equal(store.getAccumulatedText(key), "complete answer");

  const turn = createAcceptedAgent1ChatTurn("turn", "question");
  const streaming = markAgent1ChatTurnStreaming([turn], "turn");
  assert.equal(streaming[0].assistant, null);
  assert.equal(markAgent1ChatTurnStreaming(streaming, "turn"), streaming);
  const completed = completeAgent1ChatTurn(streaming, "turn", store.getAccumulatedText(key));
  assert.equal(completed[0].assistant?.content, "complete answer");
  assert.equal(completed[0].assistantStatus, "completed");
});

test("partial failure commits exactly the current buffer and preserves incomplete semantics", () => {
  const turn = createAcceptedAgent1ChatTurn("turn", "question");
  const streaming = markAgent1ChatTurnStreaming([turn], "turn");
  const failed = failAgent1ChatTurn(streaming, "turn", "safe error", "partial response");

  assert.equal(failed[0].assistant?.id, "turn-assistant-0");
  assert.equal(failed[0].assistant?.content, "partial response");
  assert.equal(failed[0].assistantStatus, "incomplete");
  assert.equal(failed[0].errorMessage, "انقطع الرد قبل اكتماله.");
  assert.equal(failAgent1ChatTurn(streaming, "turn", "safe error", " \n ")[0].assistant, null);
});

test("new attempts and stale subscriptions cannot receive another turn's stream", () => {
  const scheduler = new ManualScheduler();
  const store = new Agent1ChatStreamStore(32, scheduler);
  store.begin("turn-assistant-0");
  store.append("turn-assistant-0", "old");
  store.begin("turn-assistant-1");
  store.append("turn-assistant-0", "stale");
  store.append("turn-assistant-1", "new");
  scheduler.runPending();

  assert.equal(store.getSnapshot("turn-assistant-0").text, "");
  assert.equal(store.getSnapshot("turn-assistant-1").text, "new");
});

test("clearing an unmounted screen cancels pending presentation and leaves the store reusable", () => {
  const scheduler = new ManualScheduler();
  const store = new Agent1ChatStreamStore(32, scheduler);
  store.begin("old-assistant");
  store.append("old-assistant", "partial");
  store.clear();
  assert.equal(scheduler.pendingCount, 0);
  assert.equal(store.getAccumulatedText("old-assistant"), "");

  store.begin("next-assistant");
  store.append("next-assistant", "fresh");
  scheduler.runPending();
  assert.equal(store.getSnapshot("next-assistant").text, "fresh");
});
