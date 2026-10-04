export type ChatTranscriptScrollState =
  | { mode: "at-bottom"; anchorTurnId: string | null }
  | { mode: "anchoring-new-turn"; anchorTurnId: string }
  | { mode: "following"; anchorTurnId: string | null }
  | { mode: "user-scrolled-away"; anchorTurnId: string | null };

export function createChatTranscriptScrollState(): ChatTranscriptScrollState {
  return { mode: "at-bottom", anchorTurnId: null };
}

export function beginChatTranscriptTurn(
  _state: ChatTranscriptScrollState,
  turnId: string,
  hasPreviousTurns: boolean,
): ChatTranscriptScrollState {
  return hasPreviousTurns
    ? { mode: "anchoring-new-turn", anchorTurnId: turnId }
    : { mode: "following", anchorTurnId: turnId };
}

export function positionChatTranscriptTurn(
  state: ChatTranscriptScrollState,
  turnId: string,
): ChatTranscriptScrollState {
  return state.mode === "anchoring-new-turn" && state.anchorTurnId === turnId
    ? { mode: "following", anchorTurnId: turnId }
    : state;
}

export function beginChatTranscriptUserDrag(
  state: ChatTranscriptScrollState,
): ChatTranscriptScrollState {
  return { mode: "user-scrolled-away", anchorTurnId: state.anchorTurnId };
}

export function updateChatTranscriptEndVisibility(
  state: ChatTranscriptScrollState,
  endVisible: boolean,
  userGestureActive: boolean,
): ChatTranscriptScrollState {
  // Passive visibility callbacks must not cancel the one-shot new-turn anchor.
  // Only positioning the target row or an explicit user drag may leave this state.
  if (state.mode === "anchoring-new-turn") return state;

  if (endVisible) {
    return { mode: "at-bottom", anchorTurnId: state.anchorTurnId };
  }
  if (!endVisible && state.mode === "at-bottom") {
    return userGestureActive
      ? { mode: "user-scrolled-away", anchorTurnId: state.anchorTurnId }
      : { mode: "following", anchorTurnId: state.anchorTurnId };
  }
  return state;
}

export function shouldFollowChatTranscript(
  state: ChatTranscriptScrollState,
): boolean {
  return state.mode === "following" || state.mode === "at-bottom";
}

export function shouldRecalculateChatAnchorSpace(
  state: ChatTranscriptScrollState,
  streamIsActive: boolean,
): boolean {
  return (
    streamIsActive &&
    state.anchorTurnId !== null &&
    state.mode !== "user-scrolled-away"
  );
}

/**
 * Minimum bottom contentInset needed to make the anchored row scrollable to
 * its reading position. KeyboardChatScrollView's measured content height
 * excludes this inset, so recalculation cannot feed the spacer back into itself.
 */
export function calculateChatTranscriptAnchorBlankSpace(
  targetOffset: number,
  measuredContentHeight: number,
  viewportHeight: number,
): number {
  if (
    !Number.isFinite(targetOffset) ||
    !Number.isFinite(measuredContentHeight) ||
    !Number.isFinite(viewportHeight) ||
    viewportHeight <= 0
  ) {
    return 0;
  }
  return Math.max(0, targetOffset - (measuredContentHeight - viewportHeight));
}
