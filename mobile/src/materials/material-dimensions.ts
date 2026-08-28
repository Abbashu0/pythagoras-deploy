const MIN_NATIVE_CARD_HEIGHT = 160;
const MAX_NATIVE_CARD_HEIGHT = 340;

export const DEFAULT_MATERIAL_CARD_HEIGHT = 213;
export const DEFAULT_NATIVE_MATERIAL_CARD_HEIGHT = DEFAULT_MATERIAL_CARD_HEIGHT;

export function getNativeMaterialCardHeight(cardHeight: number) {
  const safeHeight = Number.isFinite(cardHeight) && cardHeight > 0
    ? cardHeight
    : DEFAULT_MATERIAL_CARD_HEIGHT;

  return Math.max(
    MIN_NATIVE_CARD_HEIGHT,
    Math.min(MAX_NATIVE_CARD_HEIGHT, Math.round(safeHeight))
  );
}
