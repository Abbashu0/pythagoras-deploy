"use client";

/**
 * UploadArea
 * -----------
 * Drag & drop + click-to-browse image uploader with validation and preview.
 *
 * Validation:
 *   - Accepted types: PNG, JPG, WEBP
 *   - Max size: 4 MB (RECOMMENDED_BANNER.MAX_IMAGE_BYTES)
 *   - Errors surfaced via `onError` callback AND inline alert
 *
 * On valid file:
 *   - Converts to data URL
 *   - Calls `onUploaded(dataUrl)` so parent can wire it into the editor
 *
 * Architecture:
 *   - Pure UI component — no store coupling. Parent decides what to do with
 *     the uploaded data URL (typically: set as banner.image in the editor).
 */

import { useCallback, useRef, useState } from "react";
import { UploadCloud, ImageIcon, AlertCircle } from "lucide-react";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  RECOMMENDED_BANNER,
} from "@/lib/admin/banner-model";

interface Props {
  onUploaded: (dataUrl: string) => void;
  currentImage?: string;
  onClear?: () => void;
}

export function UploadArea({ onUploaded, currentImage, onClear }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = useCallback((file: File): string | null => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type as typeof ACCEPTED_IMAGE_TYPES[number])) {
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
    (file: File) => {
      const err = validate(file);
      if (err) {
        setError(err);
        return;
      }
      setError(null);
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          onUploaded(reader.result);
        }
      };
      reader.onerror = () => setError("تعذّر قراءة الملف. حاول مجددًا.");
      reader.readAsDataURL(file);
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
      // Reset input so the same file can be selected again after removal
      e.target.value = "";
    },
    [handleFile]
  );

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
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
          dragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30"
        }`}
        style={{ minHeight: 180 }}
      >
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
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          onChange={onInputChange}
          className="hidden"
        />
      </div>

      {/* Recommended size hint */}
      <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <ImageIcon className="h-3.5 w-3.5 flex-shrink-0" />
        <span>
          الحجم الموصى به: {RECOMMENDED_BANNER.width}×{RECOMMENDED_BANNER.height}px
          (نسبة {RECOMMENDED_BANNER.aspectRatio}) — تصدير 2× retina.
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
