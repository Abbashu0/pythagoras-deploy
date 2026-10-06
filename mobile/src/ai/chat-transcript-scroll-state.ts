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

  // Native height/inset changes can make the end visible without a reader move.
  // Only an actual user gesture may re-arm a suspended reader.
  if (state.mode === "user-scrolled-away" && !userGestureActive) return state;
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

/** Reader intent and the controller's end signal own this affordance. Passive
 * streaming growth cannot make it appear while the transcript is following. */
export function shouldShowChatTranscriptScrollToBottom(
  state: ChatTranscriptScrollState,
  endVisible: boolean,
): boolean {
  return state.mode === "user-scrolled-away" && !endVisible;
}

/** Explicit button action only. Reach the document above the composer without
 * jumping into unused anchor blankSpace; clamp to the actual native range. */
export function getChatTranscriptEndTarget(geometry: {
  contentHeight: number; viewportHeight: number; bottomOcclusion: number; contentInsetBottom: number;
}): number | null {
  if (!Object.values(geometry).every(Number.isFinite) || geometry.viewportHeight <= 0) return null;
  const nativeMaximum = Math.max(0, geometry.contentHeight - geometry.viewportHeight + Math.max(0, geometry.contentInsetBottom));
  return Math.min(nativeMaximum, Math.max(0, geometry.contentHeight - geometry.viewportHeight + Math.max(0, geometry.bottomOcclusion)));
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
  minimumContentInset = 0,
): number {
  if (
    !Number.isFinite(targetOffset) ||
    !Number.isFinite(measuredContentHeight) ||
    !Number.isFinite(viewportHeight) ||
    viewportHeight <= 0
  ) {
    return 0;
  }
  const requiredInset = Math.max(0, targetOffset - (measuredContentHeight - viewportHeight));
  return requiredInset > minimumContentInset ? requiredInset : 0;
}

/** Capacity only: consume the reserve monotonically, without introducing a
 * range clamp by releasing capacity needed at the reader's offset. Terminal events use the same
 * calculation and do not issue scroll commands. A manual reader keeps capacity. */
export function consumeChatTranscriptAnchorSpace(
  state: ChatTranscriptScrollState,
  previousSpace: number,
  requiredAnchorSpace: number,
  scrollOffset: number,
  contentHeight: number,
  viewportHeight: number,
  minimumContentInset: number,
): number {
  if (state.mode === "user-scrolled-away") return previousSpace;
  if (state.mode === "anchoring-new-turn") return requiredAnchorSpace;
  const preserveOffsetSpace = calculateChatTranscriptAnchorBlankSpace(
    scrollOffset, contentHeight, viewportHeight, minimumContentInset,
  );
  return Math.min(previousSpace, Math.max(requiredAnchorSpace, preserveOffsetSpace));
}

/** One-shot anchor must wait for BOTH the user row and the real content range.
 * contentInset is the effective range reported by KeyboardChatScrollView. */
export function canPositionChatTranscriptAnchor({
  state, turnId, userHeight, userBottom, contentHeight, viewportHeight, targetOffset, contentInsetBottom,
}: {
  state: ChatTranscriptScrollState; turnId: string; userHeight: number; userBottom: number;
  contentHeight: number; viewportHeight: number; targetOffset: number; contentInsetBottom: number;
}): boolean {
  return state.mode === "anchoring-new-turn" && state.anchorTurnId === turnId &&
    userHeight > 0 && viewportHeight > 0 && contentHeight >= userBottom &&
    contentHeight - viewportHeight + contentInsetBottom >= targetOffset - 0.5;
}

/** Single content-growth offset writer. Target the document, NOT the native
 * inset end (scrollToEnd includes unused blankSpace). No write for shrink,
 * already-visible content, keyboard motion, pending anchors, or manual readers. */
export function getChatTranscriptFollowTarget(state: ChatTranscriptScrollState, geometry: {
  streamIsActive: boolean; keyboardInMotion: boolean; assistantBottom: number;
  userGestureActive?: boolean;
  controllerInsetShiftPending?: boolean;
  previousAssistantBottom: number; contentHeight: number; viewportHeight: number;
  scrollOffset: number; bottomOcclusion: number; documentBottomGap: number;
}): number | null {
  const { streamIsActive, keyboardInMotion, assistantBottom, previousAssistantBottom,
    contentHeight, viewportHeight, scrollOffset, bottomOcclusion, documentBottomGap } = geometry;
  if (!streamIsActive || keyboardInMotion || geometry.userGestureActive || geometry.controllerInsetShiftPending ||
    !shouldFollowChatTranscript(state) || viewportHeight <= 0 ||
    !Object.values(geometry).every(value => typeof value !== 'number' || Number.isFinite(value)) ||
    assistantBottom <= previousAssistantBottom + 0.5 ||
    contentHeight + 0.5 < assistantBottom + documentBottomGap) return null;
  const target = Math.max(0, assistantBottom + documentBottomGap + bottomOcclusion - viewportHeight);
  return target > scrollOffset + 0.5 ? target : null;
}
