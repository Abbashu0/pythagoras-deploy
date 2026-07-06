/**
 * Image compression utility for admin banner uploads.
 *
 * Problem: Raw photos from cameras/phones can be 2-5 MB each. Five such
 * images in localStorage easily exceed the ~5 MB quota, causing
 * QuotaExceededError → banners silently disappear on next page load.
 *
 * Solution: Before storing a banner image, resize it to the recommended
 * banner dimensions and re-encode as JPEG (quality 0.85). This typically
 * reduces a 3 MB photo to ~80-150 KB — a 20× reduction with no visible
 * quality loss at the carousel's display size.
 *
 * The compression target depends on bannerType:
 *   - "full":  732×293 (2× retina of 366×146 frame)
 *   - "split": 308×292 (2× retina of 154×146 visual panel)
 *
 * We preserve aspect ratio by fitting (not stretching) the image into the
 * target box, then cropping overflow — same as object-fit: cover.
 */

export interface CompressOptions {
  /** Target width in pixels (retina). */
  maxWidth: number;
  /** Target height in pixels (retina). */
  maxHeight: number;
  /** JPEG quality 0-1. Default 0.85 — good balance of size vs quality. */
  quality?: number;
  /** Output format. Default "image/jpeg". Use "image/png" if transparency needed. */
  mime?: string;
}

/**
 * Compress an image File or data URL to a smaller data URL.
 *
 * Returns a Promise<string> that resolves to the compressed data URL.
 * If compression fails (e.g. bad image), rejects with an Error.
 */
export function compressImage(
  source: File | string,
  options: CompressOptions
): Promise<string> {
  const { maxWidth, maxHeight, quality = 0.85, mime = "image/jpeg" } = options;

  return new Promise((resolve, reject) => {
    // Create an Image element from the source
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        // Calculate the "cover" dimensions: scale + crop to fill the target box
        const sourceRatio = img.width / img.height;
        const targetRatio = maxWidth / maxHeight;

        let drawWidth: number;
        let drawHeight: number;
        let offsetX = 0;
        let offsetY = 0;

        if (sourceRatio > targetRatio) {
          // Source is wider — match height, crop width
          drawHeight = maxHeight;
          drawWidth = maxHeight * sourceRatio;
          offsetX = -(drawWidth - maxWidth) / 2;
        } else {
          // Source is taller — match width, crop height
          drawWidth = maxWidth;
          drawHeight = maxWidth / sourceRatio;
          offsetY = -(drawHeight - maxHeight) / 2;
        }

        const canvas = document.createElement("canvas");
        canvas.width = maxWidth;
        canvas.height = maxHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas 2D context not available"));
          return;
        }

        // High-quality downscaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

        const dataUrl = canvas.toDataURL(mime, quality);
        resolve(dataUrl);
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      reject(new Error("Failed to load image for compression"));
    };

    // Load the source into the Image element
    if (typeof source === "string") {
      img.src = source;
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          img.src = reader.result;
        } else {
          reject(new Error("Failed to read file"));
        }
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(source);
    }
  });
}

/**
 * Get the compression target for a given banner type.
 * Matches the RECOMMENDED_BANNER_FULL / RECOMMENDED_BANNER_SPLIT constants.
 */
export function getCompressionTarget(bannerType: "full" | "split"): CompressOptions {
  if (bannerType === "full") {
    return { maxWidth: 732, maxHeight: 293, quality: 0.85, mime: "image/jpeg" };
  }
  return { maxWidth: 308, maxHeight: 292, quality: 0.85, mime: "image/jpeg" };
}

/**
 * Estimate the size of a data URL in bytes.
 */
export function dataUrlBytes(dataUrl: string): number {
  try {
    const base64 = dataUrl.split(",")[1] || "";
    // Base64 encodes 3 bytes per 4 chars, minus padding
    const padding = (base64.match(/=+$/) || [""])[0].length;
    return Math.floor((base64.length * 3) / 4) - padding;
  } catch {
    return dataUrl.length;
  }
}
