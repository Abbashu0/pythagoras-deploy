import assert from "node:assert/strict";
import test from "node:test";

import {
  Agent1ChatRequestCoordinator,
  applyAgent1ChatStreamEvent,
  buildAgent1HistoryForNewTurn,
  buildAgent1HistoryForRegenerate,
  canRegenerateAgent1Turn,
  createAcceptedAgent1ChatTurn,
  failAgent1ChatTurn,
  getAgent1AssistantActionPolicy,
  resetAgent1ChatTurnAttempt,
  toggleChatReaction,
} from "../mobile/src/ai/agent-1-chat-state";
import type { ChatTurn } from "../mobile/src/ai/chat-types";

function turn(
  id: string,
  options: Partial<Pick<ChatTurn, "assistant" | "assistantStatus" | "errorMessage" | "assistantAttempt">> = {},
): ChatTurn {
  return {
    id,
    user: { id, role: "user", content: `user ${id}` },
    assistantAttempt: options.assistantAttempt ?? 0,
    assistant: options.assistant ?? null,
    assistantStatus: options.assistantStatus ?? null,
    errorMessage: options.errorMessage ?? null,
  };
}

test("new model history includes user messages and only completed assistant responses", () => {
  const turns = [
    turn("complete", {
      assistant: { id: "a-complete", role: "assistant", content: "complete answer" },
      assistantStatus: "completed",
    }),
    turn("partial", {
      assistant: { id: "a-partial", role: "assistant", content: "unfinished answer" },
      assistantStatus: "incomplete",
      errorMessage: "انقطع الرد قبل اكتماله.",
    }),
    turn("failed", { assistantStatus: "error", errorMessage: "safe error" }),
    turn("active", { assistantStatus: "thinking" }),
  ];
  const nextUser = { id: "new", role: "user" as const, content: "next question" };

  assert.deepEqual(buildAgent1HistoryForNewTurn(turns, nextUser), [
    { role: "user", content: "user complete" },
    { role: "assistant", content: "complete answer" },
    { role: "user", content: "user partial" },
    { role: "user", content: "user failed" },
    { role: "user", content: "user active" },
    { role: "user", content: "next question" },
  ]);
});

test("regeneration history replaces only the latest assistant response and excludes UI state", () => {
  const turns = [
    turn("first", {
      assistant: { id: "a-first", role: "assistant", content: "first answer" },
      assistantStatus: "completed",
    }),
    turn("latest", {
      assistant: { id: "a-latest", role: "assistant", content: "old answer" },
      assistantStatus: "incomplete",
      errorMessage: "error that is not model history",
    }),
  ];

  assert.deepEqual(buildAgent1HistoryForRegenerate(turns, "latest"), [
    { role: "user", content: "user first" },
    { role: "assistant", content: "first answer" },
    { role: "user", content: "user latest" },
  ]);
  assert.equal(buildAgent1HistoryForRegenerate(turns, "first"), null);
});

test("stream events update one turn and append deltas to one assistant message", () => {
  const accepted = createAcceptedAgent1ChatTurn("second", "hello");
  assert.equal(accepted.assistantStatus, "working");
  let turns = [turn("first"), accepted];
  turns = applyAgent1ChatStreamEvent(turns, "second", { type: "started" });
  assert.equal(turns[0].assistantStatus, null);
  assert.equal(turns[1].assistantStatus, "working");
  turns = applyAgent1ChatStreamEvent(turns, "second", {
    type: "phase",
    phase: "thinking",
  });
  assert.equal(turns[1].assistantStatus, "thinking");
  assert.equal(
    getAgent1AssistantActionPolicy(turns[1], true, true).showStatus,
    true,
  );
  turns = applyAgent1ChatStreamEvent(turns, "second", {
    type: "text_delta",
    text: "hello ",
  });
  turns = applyAgent1ChatStreamEvent(turns, "second", {
    type: "text_delta",
    text: "world",
  });
  turns = applyAgent1ChatStreamEvent(turns, "second", {
    type: "phase",
    phase: "thinking",
  });

  assert.equal(turns[1].assistant?.id, "second-assistant-0");
  assert.equal(turns[1].assistant?.content, "hello world");
  assert.equal(turns[1].assistantStatus, "streaming");
  assert.equal(
    getAgent1AssistantActionPolicy(turns[1], true, true).showStatus,
    false,
  );
  turns = applyAgent1ChatStreamEvent(turns, "second", { type: "completed" });
  assert.equal(turns[1].assistantStatus, "completed");
  assert.deepEqual(getAgent1AssistantActionPolicy(turns[1], true, false), {
    showStatus: false,
    showFeedback: true,
    showRegenerate: true,
    showIncompleteNotice: false,
    showError: false,
  });
});

test("failure keeps the user turn, marks partial output incomplete, and does not invent an assistant", () => {
  const turns = [
    turn("partial", {
      assistant: { id: "a-partial", role: "assistant", content: "visible partial" },
      assistantStatus: "streaming",
    }),
    turn("no-output", { assistantStatus: "working" }),
  ];
  const failed = failAgent1ChatTurn(turns, "partial", "provider detail stays hidden");
  const noOutput = failAgent1ChatTurn(failed, "no-output", "safe Arabic error");

  assert.equal(noOutput[0].user.content, "user partial");
  assert.equal(noOutput[0].assistant?.content, "visible partial");
  assert.equal(noOutput[0].assistantStatus, "incomplete");
  assert.equal(noOutput[0].errorMessage, "انقطع الرد قبل اكتماله.");
  assert.equal(noOutput[1].assistant, null);
  assert.equal(noOutput[1].assistantStatus, "error");
  assert.equal(noOutput[1].errorMessage, "safe Arabic error");
  const blankFailure = failAgent1ChatTurn([
    turn("blank", {
      assistant: { id: "a-blank", role: "assistant", content: " \n " },
      assistantStatus: "streaming",
    }),
  ], "blank", "safe error");
  assert.equal(blankFailure[0].assistant, null);
  assert.equal(blankFailure[0].assistantStatus, "error");
  assert.equal(buildAgent1HistoryForNewTurn(noOutput, {
    id: "next",
    role: "user",
    content: "next",
  }).some(({ content }) => content.includes("visible partial")), false);
});

test("regenerate is limited to the latest completed or ended incomplete turn", () => {
  const turns = [
    turn("old", {
      assistant: { id: "a-old", role: "assistant", content: "old" },
      assistantStatus: "completed",
    }),
    turn("active", { assistantStatus: "thinking" }),
  ];
  assert.equal(canRegenerateAgent1Turn(turns, "old", null), false);
  assert.equal(canRegenerateAgent1Turn(turns, "active", "active"), false);
  assert.equal(canRegenerateAgent1Turn([
    turn("complete", {
      assistant: { id: "a", role: "assistant", content: "done" },
      assistantStatus: "completed",
    }),
  ], "complete", null), true);
  assert.equal(canRegenerateAgent1Turn([
    turn("empty-complete", { assistantStatus: "completed" }),
  ], "empty-complete", null), false);
  assert.equal(canRegenerateAgent1Turn([
    turn("failed", { assistantStatus: "error" }),
  ], "failed", null), false);
  assert.equal(canRegenerateAgent1Turn([
    turn("incomplete", {
      assistant: { id: "a", role: "assistant", content: "part" },
      assistantStatus: "incomplete",
    }),
  ], "incomplete", null), true);
  assert.equal(canRegenerateAgent1Turn([
    turn("incomplete", {
      assistant: { id: "a", role: "assistant", content: "part" },
      assistantStatus: "incomplete",
    }),
  ], "incomplete", "incomplete"), false);
});

test("assistant action policy matches active, historical, completed, incomplete, and error states", () => {
  const activeWorking = getAgent1AssistantActionPolicy(
    turn("working", { assistantStatus: "working" }),
    true,
    true,
  );
  assert.deepEqual(activeWorking, {
    showStatus: true,
    showFeedback: false,
    showRegenerate: false,
    showIncompleteNotice: false,
    showError: false,
  });

  const activeStreaming = getAgent1AssistantActionPolicy(
    turn("streaming", {
      assistant: { id: "a", role: "assistant", content: "partial" },
      assistantStatus: "streaming",
    }),
    true,
    true,
  );
  assert.equal(activeStreaming.showStatus, false);
  assert.equal(activeStreaming.showFeedback, false);
  assert.equal(activeStreaming.showRegenerate, false);

  const historicalComplete = getAgent1AssistantActionPolicy(
    turn("historical", {
      assistant: { id: "a-historical", role: "assistant", content: "done" },
      assistantStatus: "completed",
    }),
    false,
    false,
  );
  assert.equal(historicalComplete.showFeedback, true);
  assert.equal(historicalComplete.showRegenerate, false);

  const latestComplete = getAgent1AssistantActionPolicy(
    turn("latest", {
      assistant: { id: "a-latest", role: "assistant", content: "done" },
      assistantStatus: "completed",
    }),
    true,
    false,
  );
  assert.equal(latestComplete.showFeedback, true);
  assert.equal(latestComplete.showRegenerate, true);

  const latestIncomplete = getAgent1AssistantActionPolicy(
    turn("incomplete", {
      assistant: { id: "a-incomplete", role: "assistant", content: "partial" },
      assistantStatus: "incomplete",
    }),
    true,
    false,
  );
  assert.equal(latestIncomplete.showFeedback, false);
  assert.equal(latestIncomplete.showRegenerate, true);
  assert.equal(latestIncomplete.showIncompleteNotice, true);

  const historicalIncomplete = getAgent1AssistantActionPolicy(
    turn("older-incomplete", {
      assistant: { id: "a-older-incomplete", role: "assistant", content: "partial" },
      assistantStatus: "incomplete",
    }),
    false,
    false,
  );
  assert.equal(historicalIncomplete.showIncompleteNotice, true);
  assert.equal(historicalIncomplete.showRegenerate, false);

  const beforeOutputError = getAgent1AssistantActionPolicy(
    turn("error", { assistantStatus: "error", errorMessage: "safe" }),
    true,
    false,
  );
  assert.equal(beforeOutputError.showStatus, false);
  assert.equal(beforeOutputError.showError, true);
  assert.equal(beforeOutputError.showFeedback, false);
  assert.equal(beforeOutputError.showRegenerate, false);
});

test("regeneration clears the prior assistant attempt before a replacement starts", () => {
  const current = [turn("latest", {
    assistant: { id: "latest-assistant-0", role: "assistant", content: "old" },
    assistantStatus: "incomplete",
  })];
  const reset = resetAgent1ChatTurnAttempt(current, "latest");
  assert.equal(reset[0].assistant, null);
  assert.equal(reset[0].assistantStatus, "working");
  assert.equal(reset[0].assistantAttempt, 1);
});

test("local reactions toggle and remain mutually exclusive", () => {
  const liked = toggleChatReaction(undefined, "like");
  assert.equal(liked, "like");
  assert.equal(toggleChatReaction(liked, "like"), undefined);
  assert.equal(toggleChatReaction(liked, "dislike"), "dislike");
});

test("request coordinator allows one active request and aborts it before replacement", async () => {
  const coordinator = new Agent1ChatRequestCoordinator();
  let firstGeneration = -1;
  let activeRuns = 0;
  let maximumConcurrentRuns = 0;
  let firstWasCleanedUp = false;
  let signalFirstStarted: () => void = () => {};
  const firstStarted = new Promise<void>((resolve) => {
    signalFirstStarted = resolve;
  });
  let signalSecondStarted: () => void = () => {};
  const secondStarted = new Promise<void>((resolve) => {
    signalSecondStarted = resolve;
  });

  assert.equal(coordinator.start(async (signal, generation) => {
    firstGeneration = generation;
    activeRuns += 1;
    maximumConcurrentRuns = Math.max(maximumConcurrentRuns, activeRuns);
    signalFirstStarted();
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => {
        setTimeout(() => {
          activeRuns -= 1;
          firstWasCleanedUp = true;
          resolve();
        }, 5);
      }, { once: true });
    });
  }), true);
  await firstStarted;
  assert.equal(coordinator.start(async () => {}), false);

  const replacement = coordinator.replace(async () => {
    assert.equal(firstWasCleanedUp, true);
    activeRuns += 1;
    maximumConcurrentRuns = Math.max(maximumConcurrentRuns, activeRuns);
    signalSecondStarted();
    activeRuns -= 1;
  });
  assert.equal(coordinator.isCurrent(firstGeneration), false);
  await replacement;
  await secondStarted;
  assert.equal(maximumConcurrentRuns, 1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(coordinator.isBusy, false);
  coordinator.cancelAll();
});

test("request coordinator cancels a pending replacement on unmount and remains reusable", async () => {
  const coordinator = new Agent1ChatRequestCoordinator();
  let signalFirstStarted: () => void = () => {};
  const firstStarted = new Promise<void>((resolve) => {
    signalFirstStarted = resolve;
  });
  let releaseFirst: () => void = () => {};
  let replacementStarted = false;
  let freshRequestStarted = false;

  coordinator.start(async (signal) => {
    signalFirstStarted();
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
  });
  await firstStarted;
  const replacement = coordinator.replace(async () => {
    replacementStarted = true;
  });
  coordinator.cancelAll();
  releaseFirst();
  assert.equal(await replacement, false);
  assert.equal(replacementStarted, false);

  assert.equal(coordinator.start(async () => {
    freshRequestStarted = true;
  }), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(freshRequestStarted, true);
  coordinator.cancelAll();
});
