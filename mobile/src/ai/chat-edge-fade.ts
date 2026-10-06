/** Palette background is currently a six-digit sRGB hex in BOTH themes
 * (mobile/src/theme.ts). Validate that narrow contract instead of treating
 * arbitrary ColorValue strings as hex. Transparent stops keep the same RGB. */
export function chatBackgroundWithAlpha(background: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(background);
  if (!match) throw new Error('Chat edge fades require the palette background sRGB hex contract.');
  const hex = match[1];
  return `rgba(${Number.parseInt(hex.slice(0, 2), 16)}, ${Number.parseInt(hex.slice(2, 4), 16)}, ${Number.parseInt(hex.slice(4, 6), 16)}, ${Math.max(0, Math.min(1, alpha))})`;
}

export const CHAT_TOP_FADE_LOCATIONS = [0, 0.4, 0.68, 0.86, 1] as const;
export const CHAT_BOTTOM_FADE_LOCATIONS = [0, 0.16, 0.4, 0.72, 1] as const;
export function chatEdgeFadeColors(background: string) {
  const color = (alpha: number) => chatBackgroundWithAlpha(background, alpha);
  return {
    top: [color(1), color(0.98), color(0.72), color(0.24), color(0)] as const,
    bottom: [color(0), color(0.68), color(0.9), color(0.98), color(1)] as const,
  };
}

/** Full Composer measurement already includes bottom safe area. Only the closed
 * safe-area allowance disappears as the keyboard opens; never count it twice. */
export function chatBottomFadeHeight(composerHeight: number, safeAreaBottom: number, keyboardProgress: number, breathingGap: number) {
  'worklet';
  return Math.max(0, composerHeight - Math.max(0, safeAreaBottom) * Math.max(0, Math.min(1, keyboardProgress))) + breathingGap;
}
