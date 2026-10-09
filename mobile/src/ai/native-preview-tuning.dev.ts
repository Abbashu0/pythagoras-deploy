/** Native optical tuning for Debug Development Builds, delivered by Fast Refresh.
 * Dismiss and reopen the ContextMenu after editing. No stored preference/UI.
 * Native rejects invalid/out-of-range numbers by using that field's default.
 * Release native builds ignore these overrides entirely.
 */
export type NativePreviewTuning = Readonly<{
  opticalSafetyEnabled: boolean;
  sideSafetyPixels: number; // Physical pixels, 0–8.
  endSafetyWidthFactor: number; // Multiple of basic fitted width, 0–4.
  endSafetyExtraPixels: number; // Physical pixels at each end, 0–32.
  narrowEligibilityFactor: number; // Multiple of source corner radius, 0–8.
}>;

/** Intentional Debug/Release baseline: mandatory native ink/path containment.
 * The old width-based optical bands are an optional diagnostic, OFF by default.
 * Enabling them never bypasses native containment validation.
 */
export const NATIVE_PREVIEW_TUNING: NativePreviewTuning = Object.freeze({
  opticalSafetyEnabled: false,
  sideSafetyPixels: 1,
  endSafetyWidthFactor: 1,
  endSafetyExtraPixels: 3,
  narrowEligibilityFactor: 2,
});
