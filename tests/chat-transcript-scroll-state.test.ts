import assert from "node:assert/strict";
import test from "node:test";

import {
  beginChatTranscriptTurn,
  beginChatTranscriptUserDrag,
  calculateChatTranscriptAnchorBlankSpace,
  createChatTranscriptScrollState,
  positionChatTranscriptTurn,
  shouldFollowChatTranscript,
  shouldRecalculateChatAnchorSpace,
  updateChatTranscriptEndVisibility,
} from "../mobile/src/ai/chat-transcript-scroll-state";

test("first send follows without a manual anchor; later turns anchor once", () => {
  let state = createChatTranscriptScrollState();
  state = beginChatTranscriptTurn(state, "first", false);
  assert.deepEqual(state, { mode: "following", anchorTurnId: "first" });

  state = beginChatTranscriptTurn(state, "second", true);
  assert.deepEqual(state, { mode: "anchoring-new-turn", anchorTurnId: "second" });
  state = positionChatTranscriptTurn(state, "second");
  assert.deepEqual(state, { mode: "following", anchorTurnId: "second" });
  assert.equal(positionChatTranscriptTurn(state, "second"), state);
});

test("CASE A: passive visible-end callback preserves a pending new-turn anchor", () => {
  const anchoring = beginChatTranscriptTurn(createChatTranscriptScrollState(), "target", true);
  assert.equal(anchoring.mode, "anchoring-new-turn");
  assert.equal(updateChatTranscriptEndVisibility(anchoring, true, false), anchoring);
});

test("CASE B: passive end-left callback preserves a pending new-turn anchor", () => {
  const anchoring = beginChatTranscriptTurn(createChatTranscriptScrollState(), "target", true);
  assert.equal(updateChatTranscriptEndVisibility(anchoring, false, false), anchoring);
});

test("CASE C: only the target row layout completes the pending anchor", () => {
  const anchoring = beginChatTranscriptTurn(createChatTranscriptScrollState(), "target", true);
  assert.equal(positionChatTranscriptTurn(anchoring, "other"), anchoring);
  assert.deepEqual(positionChatTranscriptTurn(anchoring, "target"), {
    mode: "following",
    anchorTurnId: "target",
  });
});

test("CASE D: an explicit user drag cancels the pending anchor", () => {
  const anchoring = beginChatTranscriptTurn(createChatTranscriptScrollState(), "target", true);
  assert.deepEqual(beginChatTranscriptUserDrag(anchoring), {
    mode: "user-scrolled-away",
    anchorTurnId: "target",
  });
});

test("CASE E: end visibility transitions still work after anchoring", () => {
  const following = positionChatTranscriptTurn(
    beginChatTranscriptTurn(createChatTranscriptScrollState(), "target", true),
    "target",
  );
  const atBottom = updateChatTranscriptEndVisibility(following, true, false);
  assert.equal(atBottom.mode, "at-bottom");
  assert.equal(updateChatTranscriptEndVisibility(atBottom, false, false).mode, "following");
  assert.equal(updateChatTranscriptEndVisibility(atBottom, false, true).mode, "user-scrolled-away");
});

test("manual drag pauses follow and only a user return to end re-arms it", () => {
  let state = beginChatTranscriptTurn(createChatTranscriptScrollState(), "t", false);
  state = beginChatTranscriptUserDrag(state);
  assert.equal(state.mode, "user-scrolled-away");
  assert.equal(shouldFollowChatTranscript(state), false);
  assert.equal(shouldRecalculateChatAnchorSpace(state, true), false);

  state = updateChatTranscriptEndVisibility(state, true, false);
  assert.equal(state.mode, "at-bottom");
  assert.equal(shouldFollowChatTranscript(state), true);
  assert.equal(shouldRecalculateChatAnchorSpace(state, true), true);
});

test("keyboard events and completion do not independently change scroll policy", () => {
  const following = beginChatTranscriptTurn(createChatTranscriptScrollState(), "t", false);
  const userAway = beginChatTranscriptUserDrag(following);

  assert.equal(updateChatTranscriptEndVisibility(following, false, false), following);
  assert.equal(updateChatTranscriptEndVisibility(userAway, true, false).mode, "at-bottom");
  assert.equal(shouldRecalculateChatAnchorSpace(following, false), false);
});

test("dragging during new-turn layout cancels the pending anchor", () => {
  const anchoring = beginChatTranscriptTurn(createChatTranscriptScrollState(), "t", true);
  const userAway = beginChatTranscriptUserDrag(anchoring);

  assert.equal(positionChatTranscriptTurn(userAway, "t"), userAway);
});

test("anchor blank space tracks only content below the target and cannot feed back into itself", () => {
  assert.equal(calculateChatTranscriptAnchorBlankSpace(500, 600, 700), 600);
  assert.equal(calculateChatTranscriptAnchorBlankSpace(500, 700, 700), 500);
  assert.equal(calculateChatTranscriptAnchorBlankSpace(500, 1_000, 700), 200);
  assert.equal(calculateChatTranscriptAnchorBlankSpace(500, 1_200, 700), 0);
  assert.equal(calculateChatTranscriptAnchorBlankSpace(500, 1_200, 0), 0);
});
