"use client";

/**
 * UploadArea
 * -----------
 * Drag & drop + click-to-browse image uploader with validation, compression,
 * and preview.
 *
 * Flow:
 *   1. User drops/selects a file
 *   2. Validate type (PNG/JPG/WEBP) and size (max 4MB raw)
 *   3. COMPRESS the image to the recommended banner dimensions (1464×586 for
 *      full, 616×584 for split) as JPEG quality 0.85. This reduces a 3MB
 *      photo to ~100KB, preventing localStorage quota issues.
 *   4. Pass the compressed data URL to `onUploaded`
 *
 * Architecture:
 *   - Pure UI component — no store coupling. Parent decides what to do with
 *     the uploaded data URL.
 *   - The `bannerType` prop controls which compression target is used and
 *     which "recommended size" hint is shown.
 */

import { useCallback, useRef, useState } from "react";
import { UploadCloud, ImageIcon, AlertCircle, Loader2 } from "lucide-react";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  RECOMMENDED_BANNER_FULL,
  RECOMMENDED_BANNER_SPLIT,
  BannerType,
} from "@/lib/admin/banner-model";
import { compressImage, getCompressionTarget } from "@/lib/admin/image-compress";

interface Props {
  onUploaded: (dataUrl: string) => void;
  currentImage?: string;
  onClear?: () => void;
  /** Which recommended size + compression target to use. Defaults to "full". */
  bannerType?: BannerType;
}

export function UploadArea({
  onUploaded,
  currentImage,
  onClear,
  bannerType = "full",
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);

  const validate = useCallback((file: File): string | null => {
    if (
      !ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])
    ) {
      return "صيغة غير مدعومة. المسموح: PNG, JPG, WEBP.";
    }
    if (file.size > MAX_IMAGE_BYTES) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      const maxMb = (MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0);
      return `حجم الصورة ${mb}MB يتجاوز الحد الأقصى (${maxMb}MB).`;
    }
    return null;
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      const err = validate(file);
      if (err) {
        setError(err);
        return;
      }
      setError(null);
      setCompressing(true);
      try {
        // Compress the image to the recommended banner dimensions.
        // This prevents localStorage quota issues when storing 5 banners.
        const target = getCompressionTarget(bannerType);
        const compressed = await compressImage(file, target);
        onUploaded(compressed);
      } catch {
        // If compression fails, try passing the raw data URL as a fallback
        // (might still work if the image is small enough).
        try {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") {
              onUploaded(reader.result);
            } else {
              setError("تعذّر قراءة الملف. حاول مجددًا.");
            }
          };
          reader.onerror = () => setError("تعذّر قراءة الملف. حاول مجددًا.");
          reader.readAsDataURL(file);
        } catch {
          setError("تعذّر معالجة الصورة. حاول بصورة أخرى.");
        }
      } finally {
        setCompressing(false);
      }
    },
    [onUploaded, validate, bannerType]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = "";
    },
    [handleFile]
  );

  const rec = bannerType === "split" ? RECOMMENDED_BANNER_SPLIT : RECOMMENDED_BANNER_FULL;
  const typeLabel = bannerType === "split" ? "مقسّم" : "كامل";

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => !compressing && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`group relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
          compressing
            ? "border-primary/50 bg-primary/5 opacity-70"
            : dragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30"
        }`}
        style={{ minHeight: 180 }}
      >
        {compressing ? (
          <>
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground">جارٍ ضغط الصورة…</p>
          </>
        ) : (
          <>
            <div className="grid place-items-center rounded-full bg-primary/10 p-3 text-primary transition-transform group-hover:scale-110">
              <UploadCloud className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                اسحب الصورة هنا أو اضغط للاختيار
              </p>
              <p className="text-xs text-muted-foreground">
                PNG · JPG · WEBP — الحد الأقصى 4 ميجابايت
              </p>
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          onChange={onInputChange}
          className="hidden"
          disabled={compressing}
        />
      </div>

      {/* Recommended size hint — adapts to the current banner type */}
      <div className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <ImageIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        <span>
          الحجم الموصى به (بانر {typeLabel}): {rec.width}×{rec.height}px
          (نسبة {rec.aspectRatio}) — تصدير {rec.retinaScale}× retina.
          <br />
          يتم ضغط الصور تلقائياً عند الرفع لتوفير المساحة.
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {currentImage && (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
          <div className="flex items-center gap-2">
            <img
              src={currentImage}
              alt="current"
              className="h-10 w-10 rounded object-cover"
            />
            <span className="text-xs text-muted-foreground">صورة جاهزة للمعاينة</span>
          </div>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
            >
              إزالة
            </button>
          )}
        </div>
      )}
    </div>
  );
}
