"use client";

/**
 * UploadArea
 * -----------
 * Drag & drop + click-to-browse image uploader with validation, adaptive
 * compression, and preview.
 *
 * Flow:
 *   1. User drops/selects a file
 *   2. Validate type (PNG/JPG/WEBP) and size (max 10MB raw)
 *   3. ADAPTIVE compression — small images pass through byte-identical;
 *      medium/large images re-encode at the appropriate quality tier.
 *      NEVER cropped.
 *   4. Pass the (possibly compressed) data URL to `onUploaded`
 *
 * Recommended-size hint:
 *   - The hint adapts to the `recommendedDimensions` prop (a Dimensions
 *     object computed by the parent via getMaterialCardDimensions() or
 *     getBannerDimensions()).
 *   - Falls back to the legacy `recommendedHint` string for callers that
 *     don't supply dimensions.
 */

import { useCallback, useRef, useState } from "react";
import { UploadCloud, ImageIcon, AlertCircle, Loader2 } from "lucide-react";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
} from "@/lib/admin/banner-model";
import { storeImage } from "@/lib/admin/image-compress";
import type { Dimensions } from "@/lib/admin/dimensions";

interface Props {
  onUploaded: (dataUrl: string) => void;
  currentImage?: string;
  onClear?: () => void;
  /** Recommended dimensions for the hint. When provided, takes precedence
   *  over `recommendedHint`. */
  recommendedDimensions?: Dimensions;
  /** Optional label for the recommended-size hint (e.g. "بانر كامل"). */
  recommendedLabel?: string;
  /** Custom "recommended size" hint text. Ignored when `recommendedDimensions` is set. */
  recommendedHint?: string;
}

export function UploadArea({
  onUploaded,
  currentImage,
  onClear,
  recommendedDimensions,
  recommendedLabel,
  recommendedHint,
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
        const stored = await storeImage(file);
        onUploaded(stored);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[UploadArea] storeImage failed:", msg, err);
        try {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") {
              onUploaded(reader.result);
            } else {
              setError("تعذّر قراءة الملف. حاول مجددًا بصورة أخرى.");
            }
          };
          reader.onerror = () =>
            setError("تعذّر قراءة الملف. تأكد من أن الصورة سليمة وحاول مجددًا.");
          reader.readAsDataURL(file);
        } catch {
          setError(
            "تعذّر معالجة الصورة. جرب صورة أصغر أو بصيغة مختلفة (PNG / JPG / WEBP)."
          );
        }
      } finally {
        setCompressing(false);
      }
    },
    [onUploaded, validate]
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

  const maxMb = (MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0);
  const rec = recommendedDimensions;
  const recLabel = recommendedLabel || "الصورة";

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
            <p className="text-sm font-medium text-foreground">جارٍ حفظ الصورة…</p>
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
                PNG · JPG · WEBP — الحد الأقصى {maxMb} ميجابايت
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

      <div className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <ImageIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        {rec ? (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-semibold text-foreground">{recLabel}</span>
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {rec.aspectRatio}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
              <span>
                حجم العرض:{" "}
                <span className="font-medium text-foreground">
                  {rec.cssWidth}×{rec.cssHeight}px
                </span>
              </span>
              <span>
                الحجم الموصى به (2× retina):{" "}
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {rec.retinaWidth}×{rec.retinaHeight}px
                </span>
              </span>
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              صدّر صورة بهذا الحجم بالضبط لتحصل على ملاءمة تامة بدون قص. يتم حفظ
              الصورة بأبعادها الأصلية، واستخدم أدوات التموضع لضبط الجزء الظاهر.
            </p>
          </div>
        ) : recommendedHint ? (
          <span>{recommendedHint}</span>
        ) : (
          <span>يتم حفظ الصورة بأبعادها الأصلية دون قص. استخدم أدوات التموضع لضبط الجزء الظاهر.</span>
        )}
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
