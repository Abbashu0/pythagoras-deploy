import assert from "node:assert/strict";
import test from "node:test";

import {
  beginChatTranscriptTurn,
  beginChatTranscriptUserDrag,
  calculateChatTranscriptAnchorBlankSpace,
  canPositionChatTranscriptAnchor,
  consumeChatTranscriptAnchorSpace,
  createChatTranscriptScrollState,
  positionChatTranscriptTurn,
  getChatTranscriptFollowTarget,
  getChatTranscriptEndTarget,
  shouldShowChatTranscriptScrollToBottom,
  shouldFollowChatTranscript,
  shouldRecalculateChatAnchorSpace,
  updateChatTranscriptEndVisibility,
} from "../mobile/src/ai/chat-transcript-scroll-state";

test("end affordance appears only for an off-end intentional reader", () => {
  const bottom = createChatTranscriptScrollState();
  const following = beginChatTranscriptTurn(bottom, "first", false);
  const anchoring = beginChatTranscriptTurn(following, "second", true);
  for (const state of [bottom, following, anchoring]) {
    assert.equal(shouldShowChatTranscriptScrollToBottom(state, false), false);
    assert.equal(shouldShowChatTranscriptScrollToBottom(state, true), false);
  }
  const reader = beginChatTranscriptUserDrag(following);
  assert.equal(shouldShowChatTranscriptScrollToBottom(reader, false), true);
  assert.equal(shouldShowChatTranscriptScrollToBottom(reader, true), false);
});

test("explicit end request waits for visible-end confirmation to re-arm follow", () => {
  const reader = beginChatTranscriptUserDrag(createChatTranscriptScrollState());
  assert.equal(updateChatTranscriptEndVisibility(reader, false, true), reader);
  assert.equal(updateChatTranscriptEndVisibility(reader, true, false), reader);
  const reached = updateChatTranscriptEndVisibility(reader, true, true);
  assert.equal(reached.mode, "at-bottom");
  assert.equal(shouldFollowChatTranscript(reached), true);
  assert.equal(shouldShowChatTranscriptScrollToBottom(reached, true), false);
});

test("end target excludes unused anchor capacity and respects actual native bounds", () => {
  const geometry = { contentHeight: 2000, viewportHeight: 800, bottomOcclusion: 160, contentInsetBottom: 5000 };
  assert.equal(getChatTranscriptEndTarget(geometry), 1360);
  assert.equal(getChatTranscriptEndTarget({ ...geometry, contentInsetBottom: 100 }), 1300);
  assert.equal(getChatTranscriptEndTarget({ ...geometry, contentHeight: 300, contentInsetBottom: 100 }), 0);
  assert.equal(getChatTranscriptEndTarget({ ...geometry, viewportHeight: 0 }), null);
  assert.equal(getChatTranscriptEndTarget({ ...geometry, contentHeight: NaN }), null);
});

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

  assert.equal(updateChatTranscriptEndVisibility(state, true, false), state);
  state = updateChatTranscriptEndVisibility(state, true, true);
  assert.equal(state.mode, "at-bottom");
  assert.equal(shouldFollowChatTranscript(state), true);
  assert.equal(shouldRecalculateChatAnchorSpace(state, true), true);
});

test("keyboard events and completion do not independently change scroll policy", () => {
  const following = beginChatTranscriptTurn(createChatTranscriptScrollState(), "t", false);
  const userAway = beginChatTranscriptUserDrag(following);

  assert.equal(updateChatTranscriptEndVisibility(following, false, false), following);
  assert.equal(updateChatTranscriptEndVisibility(userAway, true, false), userAway);
  assert.equal(shouldRecalculateChatAnchorSpace(following, false), false);
});

const viewport = {
  streamIsActive: true, keyboardInMotion: false, assistantBottom: 800,
  previousAssistantBottom: 750, contentHeight: 824, viewportHeight: 700,
  scrollOffset: 150, bottomOcclusion: 130, documentBottomGap: 24,
};

test("anchor waits for nonzero user measurement AND the reported effective inset range", () => {
  const state = beginChatTranscriptTurn(createChatTranscriptScrollState(), "second", true);
  const geometry = { state, turnId: "second", userHeight: 50, userBottom: 600,
    contentHeight: 650, viewportHeight: 700, targetOffset: 500, contentInsetBottom: 550 };
  assert.equal(canPositionChatTranscriptAnchor(geometry), true);
  assert.equal(canPositionChatTranscriptAnchor({ ...geometry, userHeight: 0 }), false);
  assert.equal(canPositionChatTranscriptAnchor({ ...geometry, contentHeight: 500 }), false);
  assert.equal(canPositionChatTranscriptAnchor({ ...geometry, contentInsetBottom: 130 }), false);
  assert.equal(canPositionChatTranscriptAnchor({ ...geometry, state: positionChatTranscriptTurn(state, "second") }), false);
  assert.equal(canPositionChatTranscriptAnchor({ ...geometry, state: beginChatTranscriptUserDrag(state) }), false);
});

test("assistant growth cannot write offsets during anchoring, manual reading, keyboard animation or completion", () => {
  const anchoring = beginChatTranscriptTurn(createChatTranscriptScrollState(), "second", true);
  assert.equal(getChatTranscriptFollowTarget(anchoring, viewport), null);
  assert.equal(updateChatTranscriptEndVisibility(anchoring, true, false), anchoring);
  const following = positionChatTranscriptTurn(anchoring, "second");
  assert.equal(getChatTranscriptFollowTarget(beginChatTranscriptUserDrag(following), viewport), null);
  assert.equal(getChatTranscriptFollowTarget(following, { ...viewport, keyboardInMotion: true }), null);
  assert.equal(getChatTranscriptFollowTarget(following, { ...viewport, userGestureActive: true }), null);
  assert.equal(getChatTranscriptFollowTarget(following, { ...viewport, controllerInsetShiftPending: true }), null);
  assert.equal(getChatTranscriptFollowTarget(following, { ...viewport, streamIsActive: false }), null);
});

test("follow moves only for overflowing, genuinely grown, container-confirmed assistant content", () => {
  const following = beginChatTranscriptTurn(createChatTranscriptScrollState(), "first", false);
  assert.equal(getChatTranscriptFollowTarget(following, viewport), 254);
  assert.equal(getChatTranscriptFollowTarget(following, { ...viewport, scrollOffset: 254 }), null);
  assert.equal(getChatTranscriptFollowTarget(following, { ...viewport, assistantBottom: 500, previousAssistantBottom: 400 }), null);
  assert.equal(getChatTranscriptFollowTarget(following, { ...viewport, previousAssistantBottom: 850 }), null);
  assert.equal(getChatTranscriptFollowTarget(following, { ...viewport, contentHeight: 750 }), null);
  assert.equal(getChatTranscriptFollowTarget(following, { ...viewport, assistantBottom: Number.NaN }), null);
});

test("following targets document end, not unused native blank-space end", () => {
  const following = beginChatTranscriptTurn(createChatTranscriptScrollState(), "first", false);
  const target = getChatTranscriptFollowTarget(following, viewport)!;
  const oldScrollToEnd = viewport.contentHeight - viewport.viewportHeight + 700;
  assert.equal(target, 254);
  assert.equal(oldScrollToEnd, 824);
  assert.ok(target < oldScrollToEnd);
});

test("passive end visibility after native shrink, keyboard or completion never pulls a manual reader", () => {
  const away = beginChatTranscriptUserDrag(beginChatTranscriptTurn(createChatTranscriptScrollState(), "first", false));
  assert.equal(updateChatTranscriptEndVisibility(away, true, false), away);
  assert.equal(updateChatTranscriptEndVisibility(away, false, false), away);
  assert.equal(updateChatTranscriptEndVisibility(away, true, true).mode, "at-bottom");
});

test("blank-space consumes monotonically and is not increased by native markdown shrink", () => {
  const following = positionChatTranscriptTurn(beginChatTranscriptTurn(createChatTranscriptScrollState(), "second", true), "second");
  let space = 600;
  for (const contentHeight of [650, 900, 850, 1100, 1000, 1400]) {
    const required = calculateChatTranscriptAnchorBlankSpace(500, contentHeight, 700, 130);
    const next = consumeChatTranscriptAnchorSpace(following, space, required, 100, contentHeight, 700, 130);
    assert.ok(next <= space); space = next;
  }
  assert.equal(space, 0);
});

test("completion preserves exactly the capacity needed to avoid native clamping at the reading anchor", () => {
  const following = beginChatTranscriptTurn(createChatTranscriptScrollState(), "second", false);
  assert.equal(consumeChatTranscriptAnchorSpace(following, 600, 0, 500, 650, 700, 130), 550);
  assert.equal(consumeChatTranscriptAnchorSpace(following, 600, 0, 0, 900, 700, 130), 0);
  assert.equal(consumeChatTranscriptAnchorSpace(beginChatTranscriptUserDrag(following), 600, 0, 100, 1400, 700, 130), 600);
  assert.equal(calculateChatTranscriptAnchorBlankSpace(500, 1100, 700, 130), 0);
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
