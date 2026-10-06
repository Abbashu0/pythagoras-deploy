/** Explicit points, subsequently scaled by the native renderer's Dynamic Type.
 * Font size already contains the app preference; do not apply OS scale twice. */
export function agent1ReadingLineHeights(bodyFontSize: number) {
  return { paragraph: bodyFontSize * 1.48, list: bodyFontSize * 1.53 };
}
