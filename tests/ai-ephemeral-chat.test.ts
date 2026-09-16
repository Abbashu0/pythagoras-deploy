import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEphemeralChatEvent,
  isNearChatBottom,
  reasoningDurationSeconds,
  technicalUsageParts,
  truncateAfterUserTurn,
  type EphemeralChatTurn,
} from "../src/components/admin/ai/ephemeral-chat-state";

function user(id: string, content: string): EphemeralChatTurn {
  return {
    id,
    role: "user",
    content,
    reasoningText: "",
    status: "completed",
    reasoningStartedAt: null,
    reasoningCompletedAt: null,
    usage: null,
    latencyMs: null,
    finishReason: null,
    segments: [],
  };
}

function assistant(id: string): EphemeralChatTurn {
  return {
    id,
    role: "assistant",
    content: "",
    reasoningText: "",
    status: "pending",
    reasoningStartedAt: null,
    reasoningCompletedAt: null,
    usage: null,
    latencyMs: null,
    finishReason: null,
    segments: [],
  };
}

test("ephemeral chat state keeps reasoning separate from streamed answer and records duration", () => {
  let turn = assistant("assistant-1");
  turn = applyEphemeralChatEvent(turn, { type: "started" }, 1_000);
  turn = applyEphemeralChatEvent(turn, { type: "reasoning_delta", text: "Plan" }, 2_000);
  turn = applyEphemeralChatEvent(turn, { type: "text_delta", text: "Answer" }, 7_000);
  turn = applyEphemeralChatEvent(
    turn,
    {
      type: "completed",
      usage: {
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
        reasoningTokens: 1,
        cachedInputTokens: null,
        cacheMissInputTokens: null,
      },
      latencyMs: 9000,
      finishReason: "LENGTH",
    },
    8_000,
  );
  assert.equal(turn.reasoningText, "Plan");
  assert.equal(turn.content, "Answer");
  assert.equal(turn.status, "completed");
  assert.equal(turn.finishReason, "LENGTH");
  assert.equal(reasoningDurationSeconds(turn), 5);
  assert.deepEqual(technicalUsageParts(turn.usage), [
    "Input 2",
    "Output 3",
    "Total 5",
    "Reasoning 1",
  ]);
});

test("editing a User turn truncates all stale later turns", () => {
  const turns = [user("u1", "first"), assistant("a1"), user("u2", "second"), assistant("a2")];
  const truncated = truncateAfterUserTurn(turns, "u1");
  assert.deepEqual(truncated.map((turn) => turn.id), ["u1"]);
});

test("chat scroll pinning distinguishes bottom from an intentional upward read", () => {
  assert.equal(isNearChatBottom(450, 1_000, 520), true);
  assert.equal(isNearChatBottom(300, 1_000, 520), false);
});

test("ephemeral chat keeps Thought, Python, and answer segments in provider order", () => {
  let turn = assistant("assistant-tool");
  turn = applyEphemeralChatEvent(turn, { type: "reasoning_delta", text: "Plan" }, 1_000);
  turn = applyEphemeralChatEvent(turn, { type: "tool_call", callId: "call-1", toolName: "python", argumentsDelta: '{"code":"2 + ' }, 2_000);
  turn = applyEphemeralChatEvent(turn, { type: "tool_call", callId: "call-1", toolName: "python", argumentsDelta: '3"}' }, 2_100);
  turn = applyEphemeralChatEvent(turn, { type: "tool_started", callId: "call-1", toolName: "python", code: "2 + 3" }, 2_200);
  turn = applyEphemeralChatEvent(turn, { type: "tool_result", callId: "call-1", toolName: "python", status: "ok", result: "5", durationMs: 12 }, 2_300);
  turn = applyEphemeralChatEvent(turn, { type: "reasoning_delta", text: "Verified" }, 2_400);
  turn = applyEphemeralChatEvent(turn, { type: "text_delta", text: "5" }, 2_500);
  assert.deepEqual(turn.segments.map((segment) => segment.type), ["reasoning", "tool", "reasoning", "text"]);
  const tool = turn.segments.find((segment) => segment.type === "tool");
  assert.equal(tool?.type, "tool");
  if (tool?.type === "tool") {
    assert.equal(tool.code, "2 + 3");
    assert.equal(tool.result, "5");
  }
});
