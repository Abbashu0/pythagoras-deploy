export interface ChatRowGeometry { y: number; height: number }
export interface ChatTurnGeometry {
  turnId: string | null;
  user: ChatRowGeometry | null;
  assistant: ChatRowGeometry | null;
  nativeUserHeight?: number | null;
}

/** RN row padding is internal: raw row separation is 0, rich content separation
 * is assistant.paddingTop (26pt). Expose both, never label padded content as row Y. */
export function describeChatTurnGeometry(turn: ChatTurnGeometry, assistantPaddingTop: number) {
  const userBottom = turn.user ? turn.user.y + turn.user.height : null;
  const rowGap = userBottom !== null && turn.assistant ? turn.assistant.y - userBottom : null;
  const contentGap = rowGap === null ? null : rowGap + assistantPaddingTop;
  const nativeHeight = turn.nativeUserHeight ?? null;
  const visualBottom = turn.user && nativeHeight !== null ? turn.user.y + nativeHeight : null;
  const visualGap = visualBottom !== null && turn.assistant ? turn.assistant.y + assistantPaddingTop - visualBottom : null;
  const heightDifference = turn.user && nativeHeight !== null ? turn.user.height - nativeHeight : null;
  return {
    turnId: turn.turnId,
    userY: turn.user?.y ?? null,
    userHeight: turn.user?.height ?? null,
    userNativeHostHeight: nativeHeight,
    userRNMinusNativeHeight: heightDifference,
    userHostHeightMismatch: heightDifference !== null && Math.abs(heightDifference) > 0.5,
    userVisualBottom: visualBottom,
    assistantRowY: turn.assistant?.y ?? null,
    assistantRowHeight: turn.assistant?.height ?? null,
    assistantContentY: turn.assistant ? turn.assistant.y + assistantPaddingTop : null,
    assistantRowStartMinusUserBottom: rowGap,
    assistantStartMinusUserBottom: contentGap,
    assistantStartMinusUserVisualBottom: visualGap,
    visualGapInvariantViolated: visualGap !== null && visualGap < assistantPaddingTop - 0.5,
    expectedContentGap: assistantPaddingTop,
    overlapInvariantViolated: rowGap !== null && rowGap < -0.5,
  };
}

/** Bound diagnostic precision and deduplicate geometry across event sources. */
export function chatGeometryDiagnosticKey(values: Record<string, string | number | boolean | null>) {
  return JSON.stringify(Object.fromEntries(Object.entries(values).map(([key, value]) =>
    [key, typeof value === 'number' ? Math.round(value * 2) / 2 : value])));
}
