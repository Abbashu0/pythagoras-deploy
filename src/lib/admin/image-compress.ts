/**
 * Image storage utility for admin uploads.
 *
 * CRITICAL: This module does NOT crop, resize, or re-encode images.
 * The original image is preserved 100% as-is. The only processing is
 * converting the File to a data URL for localStorage storage.
 *
 * If the image is larger than ~3MB (which would blow localStorage's
 * ~5MB quota when storing multiple images), we scale it down
 * proportionally — but we NEVER crop, NEVER change aspect ratio,
 * and NEVER center-crop. The full image is always preserved.
 *
 * The admin then uses the Image Positioner (translate + scale) to
 * decide which part of the image is visible inside the frame.
 */

export interface StoreOptions {
  /**
   * Maximum file size in bytes. If the image exceeds this, it's
   * scaled down proportionally (NOT cropped) to fit.
   * Default: 2MB (2_097_152) — leaves room for other localStorage data.
   */
  maxBytes?: number;
  /** JPEG quality for downscaled images. Default 0.9 (high quality). */
  quality?: number;
  /** Output format. Default "image/jpeg". */
  mime?: string;
}

/**
 * Store an image File as a data URL, preserving the original image
 * as much as possible.
 *
 * - If the file is small enough (< maxBytes), it's stored AS-IS
 *   with zero processing — original dimensions, original quality.
 * - If the file exceeds maxBytes, it's scaled down proportionally
 *   (preserving aspect ratio, NO cropping) until it fits.
 *
 * Returns a Promise<string> that resolves to the data URL.
 */
export function storeImage(
  source: File | string,
  options: StoreOptions = {}
): Promise<string> {
  const { maxBytes = 2_097_152, quality = 0.9, mime = "image/jpeg" } = options;

  return new Promise((resolve, reject) => {
    // If source is already a string (data URL), check its size
    if (typeof source === "string") {
      const bytes = dataUrlBytes(source);
      if (bytes <= maxBytes) {
        // Small enough — return as-is, zero processing
        resolve(source);
        return;
      }
      // Too large — need to scale down (no crop)
      scaleDownToSize(source, maxBytes, quality, mime).then(resolve).catch(reject);
      return;
    }

    // Source is a File — read it as data URL first
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Failed to read file"));
        return;
      }
      const dataUrl = reader.result;
      const bytes = dataUrlBytes(dataUrl);

      if (bytes <= maxBytes) {
        // Small enough — store original as-is, zero processing
        resolve(dataUrl);
        return;
      }

      // Too large — scale down proportionally (NO crop, preserve aspect ratio)
      scaleDownToSize(dataUrl, maxBytes, quality, mime).then(resolve).catch(reject);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(source);
  });
}

/**
 * Scale an image down proportionally until its data URL fits within
 * maxBytes. Aspect ratio is ALWAYS preserved. The image is NEVER cropped.
 *
 * Algorithm:
 *   1. Start with the original dimensions.
 *   2. If the data URL is too large, scale down by 10%.
 *   3. Repeat until it fits or we hit a minimum dimension.
 */
function scaleDownToSize(
  dataUrl: string,
  maxBytes: number,
  quality: number,
  mime: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      let scale = 1.0;
      const minScale = 0.1; // Don't go below 10% of original
      const originalW = img.width;
      const originalH = img.height;

      const tryScale = (currentScale: number): void => {
        const w = Math.round(originalW * currentScale);
        const h = Math.round(originalH * currentScale);

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas 2D context not available"));
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        // Draw the FULL image at the scaled size — no crop, no offset
        ctx.drawImage(img, 0, 0, w, h);

        const result = canvas.toDataURL(mime, quality);
        const bytes = dataUrlBytes(result);

        if (bytes <= maxBytes || currentScale <= minScale) {
          resolve(result);
        } else {
          // Still too large — reduce scale by 10% and try again
          tryScale(currentScale * 0.9);
        }
      };

      tryScale(scale);
    };

    img.onerror = () => reject(new Error("Failed to load image for scaling"));
    img.src = dataUrl;
  });
}

/**
 * Backward-compatible alias. Old code calls `compressImage` — we keep
 * the function name but it now delegates to `storeImage` which does
 * NOT crop.
 */
export function compressImage(
  source: File | string,
  _options: { maxWidth: number; maxHeight: number; quality?: number; mime?: string }
): Promise<string> {
  // Ignore maxWidth/maxHeight — we don't resize to specific dimensions anymore.
  // Just store the image as-is (or scale down proportionally if too large).
  return storeImage(source, {
    maxBytes: 2_097_152,
    quality: _options.quality || 0.9,
    mime: _options.mime || "image/jpeg",
  });
}

/**
 * Get compression target for a given banner type.
 * Kept for backward compatibility — the values are no longer used
 * for cropping, only as hints in the UI.
 */
export function getCompressionTarget(bannerType: "full" | "split"): {
  maxWidth: number;
  maxHeight: number;
  quality: number;
  mime: string;
} {
  if (bannerType === "full") {
    return { maxWidth: 1464, maxHeight: 586, quality: 0.9, mime: "image/jpeg" };
  }
  return { maxWidth: 616, maxHeight: 584, quality: 0.9, mime: "image/jpeg" };
}

/**
 * Estimate the size of a data URL in bytes.
 */
export function dataUrlBytes(dataUrl: string): number {
  try {
    const base64 = dataUrl.split(",")[1] || "";
    const padding = (base64.match(/=+$/) || [""])[0].length;
    return Math.floor((base64.length * 3) / 4) - padding;
  } catch {
    return dataUrl.length;
  }
}
