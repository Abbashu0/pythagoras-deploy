/**
 * Adaptive image storage for admin uploads.
 *
 * Design goals:
 *   1. NO strict 150KB cap — use adaptive tiers based on the source size.
 *   2. NEVER crop. NEVER force-resize. Aspect ratio is ALWAYS preserved.
 *   3. Small images stay byte-identical (no re-encode).
 *   4. Medium images re-encode at near-lossless quality.
 *   5. Large/huge images re-encode at lower quality + proportional
 *      downscale (still no crop) to keep them reasonable.
 *   6. PNG with alpha is preserved as PNG (no JPEG conversion).
 *
 * Adaptive tiers (based on the RAW file size):
 *   < 500 KB → Store as-is (zero processing)
 *   < 1 MB   → Re-encode JPEG q=0.92 (near-lossless)
 *   < 2 MB   → Re-encode JPEG q=0.85 (good quality)
 *   < 5 MB   → Re-encode JPEG q=0.80 + scale max 2560px wide
 *   >= 5 MB  → Re-encode JPEG q=0.75 + scale max 2000px wide
 */

export interface StoreOptions {
  quality?: number;
  mime?: string;
  maxWidth?: number;
}

interface CompressionTier {
  name: "passthrough" | "light" | "medium" | "high" | "extreme";
  quality: number;
  maxWidth: number;
  mime: "image/jpeg" | "image/png" | "image/webp";
}

const SMALL = 500 * 1024;
const MEDIUM = 1024 * 1024;
const LARGE = 2 * 1024 * 1024;
const HUGE = 5 * 1024 * 1024;

export function pickTier(sourceBytes: number, hasAlpha: boolean): CompressionTier {
  if (hasAlpha) {
    if (sourceBytes < HUGE) {
      return { name: "passthrough", quality: 1, maxWidth: 0, mime: "image/png" };
    }
    return { name: "high", quality: 1, maxWidth: 2560, mime: "image/png" };
  }

  if (sourceBytes < SMALL) {
    return { name: "passthrough", quality: 1, maxWidth: 0, mime: "image/jpeg" };
  }
  if (sourceBytes < MEDIUM) {
    return { name: "light", quality: 0.92, maxWidth: 0, mime: "image/jpeg" };
  }
  if (sourceBytes < LARGE) {
    return { name: "medium", quality: 0.85, maxWidth: 0, mime: "image/jpeg" };
  }
  if (sourceBytes < HUGE) {
    return { name: "high", quality: 0.80, maxWidth: 2560, mime: "image/jpeg" };
  }
  return { name: "extreme", quality: 0.75, maxWidth: 2000, mime: "image/jpeg" };
}

export function storeImage(
  source: File | string,
  options: StoreOptions = {}
): Promise<string> {
  const { quality, mime, maxWidth } = options;

  return new Promise((resolve, reject) => {
    if (typeof source === "string") {
      const srcBytes = dataUrlBytes(source);
      const hasAlpha = detectAlpha(source);
      const tier = pickTier(srcBytes, hasAlpha);
      applyTier(source, tier, { quality, mime, maxWidth }).then(resolve).catch(reject);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Failed to read file"));
        return;
      }
      const dataUrl = reader.result;
      const srcBytes = dataUrlBytes(dataUrl);
      const hasAlpha = detectAlpha(dataUrl);
      const tier = pickTier(srcBytes, hasAlpha);
      applyTier(dataUrl, tier, { quality, mime, maxWidth }).then(resolve).catch(reject);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(source);
  });
}

function applyTier(
  dataUrl: string,
  tier: CompressionTier,
  overrides: { quality?: number; mime?: string; maxWidth?: number }
): Promise<string> {
  const finalQuality = overrides.quality ?? tier.quality;
  const finalMime = (overrides.mime as CompressionTier["mime"]) ?? tier.mime;
  const finalMaxWidth = overrides.maxWidth ?? tier.maxWidth;

  if (tier.name === "passthrough") {
    return Promise.resolve(dataUrl);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      let targetW = img.width;
      let targetH = img.height;
      if (finalMaxWidth > 0 && targetW > finalMaxWidth) {
        const ratio = finalMaxWidth / targetW;
        targetW = Math.round(targetW * ratio);
        targetH = Math.round(targetH * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas 2D context not available"));
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      if (finalMime === "image/jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, targetW, targetH);
      }
      ctx.drawImage(img, 0, 0, targetW, targetH);

      try {
        const result = canvas.toDataURL(finalMime, finalQuality);
        resolve(result);
      } catch (err) {
        reject(new Error(`Canvas export failed: ${err instanceof Error ? err.message : String(err)}`));
      }
    };

    img.onerror = () => reject(new Error("Failed to load image for compression"));
    img.src = dataUrl;
  });
}

function detectAlpha(dataUrl: string): boolean {
  return /^data:image\/png/i.test(dataUrl);
}

export function compressImage(
  source: File | string,
  _options: { maxWidth: number; maxHeight: number; quality?: number; mime?: string }
): Promise<string> {
  return storeImage(source, {
    quality: _options.quality,
    mime: _options.mime,
    maxWidth: 0,
  });
}

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

export function dataUrlBytes(dataUrl: string): number {
  try {
    const base64 = dataUrl.split(",")[1] || "";
    const padding = (base64.match(/=+$/) || [""])[0].length;
    return Math.floor((base64.length * 3) / 4) - padding;
  } catch {
    return dataUrl.length;
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
