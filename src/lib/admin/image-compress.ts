/**
 * Image compression utility for admin banner uploads.
 *
 * Problem: Raw photos from cameras/phones can be 2-5 MB each. Five such
 * images in localStorage easily exceed the ~5 MB quota, causing
 * QuotaExceededError → banners silently disappear on next page load.
 *
 * Solution: Before storing a banner image, scale it to fit within the
 * recommended banner dimensions and re-encode as JPEG (quality 0.85).
 * This typically reduces a 3 MB photo to ~80-150 KB — a 20× reduction
 * with no visible quality loss at the carousel's display size.
 *
 * Contain (NOT cover) behavior — the image is NEVER cropped:
 *   - The image is scaled proportionally to fit WITHIN the max dimensions
 *     (like CSS `object-fit: contain`).
 *   - The full image is preserved; empty margins may appear on the sides
 *     that don't match the source aspect ratio.
 *   - No offset tricks, no cropping — what you upload is what gets stored,
 *     just smaller.
 *
 * The compression target depends on bannerType (2× retina of the carousel's
 * CSS pixel size):
 *   - "full":  1464×586  (2× retina of 732×293)
 *   - "split": 616×584   (2× retina of 308×292)
 */

export interface CompressOptions {
  /** Max width in pixels (retina). Image never exceeds this. */
  maxWidth: number;
  /** Max height in pixels (retina). Image never exceeds this. */
  maxHeight: number;
  /** JPEG quality 0-1. Default 0.85 — good balance of size vs quality. */
  quality?: number;
  /** Output format. Default "image/jpeg". Use "image/png" if transparency needed. */
  mime?: string;
}

/**
 * Compress an image File or data URL to a smaller data URL.
 *
 * Uses "contain" fit: the image is scaled to fit entirely inside the target
 * box, preserving aspect ratio. No cropping, no offset. Empty margins are
 * left on the sides that don't match the source aspect ratio.
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
        // "Contain" fit: scale image so it fits entirely inside the target
        // box, preserving aspect ratio. No cropping. The full image is
        // preserved — empty margins are left on the sides that don't match.
        const sourceRatio = img.width / img.height;
        const targetRatio = maxWidth / maxHeight;

        let drawWidth: number;
        let drawHeight: number;

        if (sourceRatio > targetRatio) {
          // Source is wider than the target box — match width, scale height
          // down so the image fits inside (height < maxHeight).
          drawWidth = maxWidth;
          drawHeight = maxWidth / sourceRatio;
        } else {
          // Source is taller than (or equal to) the target box — match
          // height, scale width down so the image fits inside.
          drawHeight = maxHeight;
          drawWidth = maxHeight * sourceRatio;
        }

        // Center the image inside the target box — empty margins fill the
        // remaining space on the cross axis. This is the visual equivalent
        // of `object-fit: contain`.
        const offsetX = (maxWidth - drawWidth) / 2;
        const offsetY = (maxHeight - drawHeight) / 2;

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
 *
 * These are 2× retina of the recommended CSS pixel sizes so the image
 * stays crisp on high-DPI screens.
 *
 *   - "full":  1464×586  (2× retina of 732×293)
 *   - "split": 616×584   (2× retina of 308×292)
 */
export function getCompressionTarget(bannerType: "full" | "split"): CompressOptions {
  if (bannerType === "full") {
    return { maxWidth: 1464, maxHeight: 586, quality: 0.85, mime: "image/jpeg" };
  }
  return { maxWidth: 616, maxHeight: 584, quality: 0.85, mime: "image/jpeg" };
}

/**
 * Estimate the size of a data URL in bytes.
 *
 * Useful for showing "this image is N KB" hints in the UI and for
 * detecting when an image is too large to safely store in localStorage.
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
