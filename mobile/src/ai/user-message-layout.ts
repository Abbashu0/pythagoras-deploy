export type UserMessageMode = 'collapsed' | 'expanded';
export type UserMessageHeightCache = {
  context: string;
  collapsed: number | null;
  expanded: number | null;
};

export function recordUserMessageHeight(cache: UserMessageHeightCache, context: string, mode: UserMessageMode, height: number): UserMessageHeightCache {
  if (!Number.isFinite(height) || height <= 0) return cache;
  const current = cache.context === context ? cache : { context, collapsed: null, expanded: null };
  if (current[mode] !== null && Math.abs(current[mode]! - height) < 0.5) return current;
  return { ...current, [mode]: height };
}

/** Only real Host measurements may supply a floor, including during a mode transition. */
export function userMessageHeightFloor(cache: UserMessageHeightCache, context: string, mode: UserMessageMode): number | null {
  if (cache.context !== context) return null;
  return cache[mode] ?? cache[mode === 'expanded' ? 'collapsed' : 'expanded'];
}

export type UserMessageRowGeometry = { y: number; height: number };
export type UserMessageCollapseAnchor = { turnId: string; viewportY: number; oldHeight: number; contentRevision: number };

/** Expansion never creates a bottom anchor. No synthetic text or document measurements. */
export function captureUserMessageCollapseAnchor(turnId: string, mode: UserMessageMode, row: UserMessageRowGeometry | undefined, scrollOffset: number, contentRevision: number): UserMessageCollapseAnchor | null {
  if (mode !== 'collapsed' || !row || row.height <= 0 || ![row.y, row.height, scrollOffset].every(Number.isFinite)) return null;
  return { turnId, viewportY: row.y + row.height - scrollOffset, oldHeight: row.height, contentRevision };
}

/** Resolve only after the collapsed Host, RN row AND native document range have caught up. */
export function resolveUserMessageCollapseOffset(anchor: UserMessageCollapseAnchor, row: UserMessageRowGeometry, nativeHeight: number | null, bounds: { contentHeight: number; viewportHeight: number; insetBottom: number; contentRevision: number }): number | null {
  if (nativeHeight === null || nativeHeight <= 0 || row.height <= 0 || bounds.viewportHeight <= 0 ||
      ![anchor.viewportY, row.y, row.height, nativeHeight, bounds.contentHeight, bounds.viewportHeight, bounds.insetBottom].every(Number.isFinite) ||
      Math.abs(row.height - nativeHeight) >= 0.5 || row.height >= anchor.oldHeight - 0.5 ||
      bounds.contentRevision <= anchor.contentRevision || bounds.contentHeight + 0.5 < row.y + row.height) return null;
  const maximumOffset = Math.max(0, bounds.contentHeight + Math.max(0, bounds.insetBottom) - bounds.viewportHeight);
  return Math.min(maximumOffset, Math.max(0, row.y + row.height - anchor.viewportY));
}
