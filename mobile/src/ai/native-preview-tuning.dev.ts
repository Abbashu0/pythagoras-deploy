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

/** Defaults reproduce the current opticalInsets correction exactly.
 * Lower safety values can reintroduce visual clipping during experimentation.
 */
export const NATIVE_PREVIEW_TUNING: NativePreviewTuning = Object.freeze({
  opticalSafetyEnabled: true,
  sideSafetyPixels: 1,
  endSafetyWidthFactor: 1,
  endSafetyExtraPixels: 3,
  narrowEligibilityFactor: 2,
});
