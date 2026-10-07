export const COMPOSER_COMPACT_HEIGHT = 48;
export const COMPOSER_COMPACT_HORIZONTAL_INSET = 38;
export const COMPOSER_COMPACT_CORNER_RADIUS = 24;
export const COMPOSER_EXPANDED_MIN_HEIGHT = 94;
export const COMPOSER_EXPANDED_HORIZONTAL_INSET = 16;
export const COMPOSER_EXPANDED_CORNER_RADIUS = 28;
export const COMPOSER_BOTTOM_PADDING = 10;
export const ACTION_BUTTON_DIAMETER = 36;
export const ACTION_BUTTON_HIT_TARGET = 44;
export const ACTION_ROW_BOTTOM_INSET = 5;

export function getChatComposerPresentation({ focused, draftLength, sheetPresented, visualOverflow }: {
  focused: boolean;
  draftLength: number;
  sheetPresented: boolean;
  visualOverflow: boolean;
}) {
  const mode = !focused && draftLength === 0 && !sheetPresented ? 'compact' : 'expanded';
  return { mode, showExpand: mode === 'expanded' && draftLength > 0 && visualOverflow && !sheetPresented } as const;
}

export function isChatComposerDraftSendable(draft: string) {
  return draft.trim().length > 0;
}

export type ComposerTextMeasurement = { width: number; height: number };

/** Native natural text versus native five-line capacity at the SAME measured width. */
export function getChatComposerVisualOverflow(natural: ComposerTextMeasurement | null, fiveLines: ComposerTextMeasurement | null): boolean | null {
  if (!natural || !fiveLines || !Number.isFinite(natural.height) || !Number.isFinite(fiveLines.height) ||
    !Number.isFinite(natural.width) || !Number.isFinite(fiveLines.width) || natural.width <= 0 ||
    fiveLines.width <= 0 || natural.height < 0 || fiveLines.height <= 0 || Math.abs(natural.width - fiveLines.width) >= 0.5) return null;
  return natural.height > fiveLines.height + 0.5;
}
