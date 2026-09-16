import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEphemeralChatEvent,
  groupEphemeralChatPresentation,
  isNearChatBottom,
  reasoningDurationSeconds,
  technicalUsageParts,
  truncateAfterUserTurn,
  toggleWorkExpanded,
  type EphemeralChatTurn,
  workDurationSeconds,
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
    workStartedAt: null,
    workCompletedAt: null,
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
    workStartedAt: null,
    workCompletedAt: null,
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

test("one Assistant turn groups all work phases outside its final answer", () => {
  let turn = assistant("assistant-work");
  turn = applyEphemeralChatEvent(turn, { type: "reasoning_delta", text: "Plan" }, 1_000);
  turn = applyEphemeralChatEvent(turn, { type: "tool_call", callId: "call-1", toolName: "python", argumentsDelta: '{"code":"2+2"}' }, 2_000);
  turn = applyEphemeralChatEvent(turn, { type: "tool_started", callId: "call-1", toolName: "python", code: "2+2" }, 2_100);
  turn = applyEphemeralChatEvent(turn, { type: "tool_result", callId: "call-1", toolName: "python", status: "ok", result: "4", durationMs: 10 }, 2_200);
  turn = applyEphemeralChatEvent(turn, { type: "reasoning_delta", text: "Check" }, 3_000);
  turn = applyEphemeralChatEvent(turn, { type: "text_delta", text: "Final answer" }, 4_000);
  const presentation = groupEphemeralChatPresentation(turn);
  assert.deepEqual(presentation.workSegments.map((segment) => segment.type), ["reasoning", "tool", "reasoning"]);
  assert.equal(presentation.answerText, "Final answer");
  assert.equal(workDurationSeconds(turn), 3);
});

test("collapsing Work never hides a text_delta final answer", () => {
  let turn = assistant("assistant-greeting");
  turn = applyEphemeralChatEvent(turn, { type: "reasoning_delta", text: "thinking" }, 1_000);
  turn = applyEphemeralChatEvent(turn, { type: "text_delta", text: "Hello" }, 2_000);

  assert.equal(turn.reasoningText, "thinking");
  assert.equal(turn.content, "Hello");
  assert.deepEqual(turn.segments.map((segment) => segment.type), ["reasoning", "text"]);

  const presentation = groupEphemeralChatPresentation(turn);
  assert.deepEqual(presentation.workSegments.map((segment) => segment.type), ["reasoning"]);
  assert.equal(presentation.answerText, "Hello");

  const collapsed = toggleWorkExpanded({ [turn.id]: true }, turn.id);
  assert.equal(collapsed[turn.id], false);
  assert.equal(presentation.answerText, "Hello");
});

test("event kinds remain authoritative when reasoning resumes after answer text", () => {
  let turn = assistant("assistant-interleaved");
  turn = applyEphemeralChatEvent(turn, { type: "reasoning_delta", text: "a" }, 1_000);
  turn = applyEphemeralChatEvent(turn, { type: "text_delta", text: "first" }, 2_000);
  turn = applyEphemeralChatEvent(turn, { type: "reasoning_delta", text: "b" }, 3_000);
  turn = applyEphemeralChatEvent(turn, { type: "text_delta", text: "final" }, 4_000);

  const presentation = groupEphemeralChatPresentation(turn);
  assert.deepEqual(turn.segments.map((segment) => segment.type), ["reasoning", "text", "reasoning", "text"]);
  assert.deepEqual(presentation.workSegments.map((segment) => segment.type), ["reasoning", "reasoning"]);
  assert.equal(presentation.answerText, "firstfinal");
});

test("answer-only turns have no Work section and Work expansion is independent per turn", () => {
  const answerOnly = assistant("answer-only");
  const presentation = groupEphemeralChatPresentation({ ...answerOnly, content: "Hello", segments: [{ type: "text", text: "Hello" }] });
  assert.equal(presentation.workSegments.length, 0);
  assert.equal(presentation.answerText, "Hello");

  const independent = toggleWorkExpanded({ "turn-a": true, "turn-b": true }, "turn-a");
  assert.equal(independent["turn-a"], false);
  assert.equal(independent["turn-b"], true);
});
