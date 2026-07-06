"use client";

/**
 * ImagePositioner
 * ----------------
 * Lets the admin choose which part of the uploaded image will be visible inside
 * the carousel's visual panel. Behaves like a cover-photo cropper:
 *
 *   - Drag the image to reposition (updates offsetX / offsetY in %).
 *   - Zoom In / Zoom Out buttons adjust scale.
 *   - Reset returns to centered + scale=1.
 *
 * The visual panel uses the EXACT same proportions as the student app's
 * SponsoredCarouselCard (42% width × full frame height, frame aspect 5/2),
 * so what you see here is what students will see.
 *
 * State is lifted to the parent via `value` / `onChange` so the editor can
 * save it to the store.
 */

import { useCallback, useRef, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw, Move } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BannerImageTransform, BANNER_TRANSFORM_DEFAULT } from "@/lib/admin/banner-model";

interface Props {
  imageSrc: string;
  gradient?: string;
  value: BannerImageTransform;
  onChange: (next: BannerImageTransform) => void;
  /** Width of the preview frame (matches student app ~154px visual panel). */
  previewWidth?: number;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;
const DRAG_SENSITIVITY = 0.5; // % per px — tuned for natural feel

export function ImagePositioner({
  imageSrc,
  gradient,
  value,
  onChange,
  previewWidth = 320,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; offX: number; offY: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!imageSrc) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        offX: value.offsetX,
        offY: value.offsetY,
      };
    },
    [imageSrc, value.offsetX, value.offsetY]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || !dragStart.current || !frameRef.current) return;
      const frameW = frameRef.current.clientWidth;
      const frameH = frameRef.current.clientHeight;
      // Convert px delta to % of frame size, then divide by (scale-1) so the
      // image follows the cursor proportionally to the current zoom.
      const scaleRange = Math.max(0.001, value.scale - 1);
      const dxPct = ((e.clientX - dragStart.current.x) / frameW) * 100 * DRAG_SENSITIVITY;
      const dyPct = ((e.clientY - dragStart.current.y) / frameH) * 100 * DRAG_SENSITIVITY;
      let nextX = dragStart.current.offX - dxPct / scaleRange;
      let nextY = dragStart.current.offY - dyPct / scaleRange;
      // Clamp to ±50% so the image can't be dragged entirely off-frame
      nextX = Math.max(-50, Math.min(50, nextX));
      nextY = Math.max(-50, Math.min(50, nextY));
      onChange({ ...value, offsetX: nextX, offsetY: nextY });
    },
    [dragging, value, onChange]
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (dragging) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // noop
      }
    }
    setDragging(false);
    dragStart.current = null;
  }, [dragging]);

  const zoomIn = () => {
    onChange({ ...value, scale: Math.min(MAX_SCALE, +(value.scale + SCALE_STEP).toFixed(2)) });
  };
  const zoomOut = () => {
    const newScale = Math.max(MIN_SCALE, +(value.scale - SCALE_STEP).toFixed(2));
    // If we zoomed back to 1, reset offsets too (image fills frame exactly)
    onChange({
      ...value,
      scale: newScale,
      offsetX: newScale === 1 ? 0 : value.offsetX,
      offsetY: newScale === 1 ? 0 : value.offsetY,
    });
  };
  const reset = () => {
    onChange({ ...BANNER_TRANSFORM_DEFAULT });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Move className="h-4 w-4 text-muted-foreground" />
          ضبط موضع الصورة
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={zoomOut}
            disabled={!imageSrc || value.scale <= MIN_SCALE}
            title="تصغير"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
            {value.scale.toFixed(2)}×
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={zoomIn}
            disabled={!imageSrc || value.scale >= MAX_SCALE}
            title="تكبير"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reset}
            disabled={!imageSrc || (value.offsetX === 0 && value.offsetY === 0 && value.scale === 1)}
            title="إعادة"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Preview frame — same aspect ratio + visual panel proportions as student app */}
      <div
        ref={frameRef}
        className="relative mx-auto overflow-hidden rounded-2xl border-2 border-border select-none"
        style={{
          width: previewWidth,
          aspectRatio: "5 / 2",
          background: imageSrc ? "#0a0d14" : gradient || "#1e2536",
          cursor: imageSrc ? (dragging ? "grabbing" : "grab") : "default",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {imageSrc ? (
          <>
            <img
              src={imageSrc}
              alt="preview"
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={{
                objectFit: "cover",
                objectPosition: `${50 + value.offsetX}% ${50 + value.offsetY}%`,
                transform: `scale(${value.scale})`,
                transformOrigin: "center",
              }}
            />
            {/* Safe-area overlay — shows the visual panel boundary (42% left in LTR) */}
            <div
              className="pointer-events-none absolute inset-y-0 left-0 border-r-2 border-dashed border-white/30"
              style={{ width: "42%" }}
            >
              <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
                المنطقة الظاهرة في الكاروسيل
              </span>
            </div>
          </>
        ) : (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            ارفع صورة أولاً لضبط موضعها
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        اسحب الصورة لتحديد الجزء الظاهر. استخدم التكبير/التصغير للتركيز على تفاصيل محددة.
        القيم: X={value.offsetX.toFixed(1)}% Y={value.offsetY.toFixed(1)}% تكبير={value.scale.toFixed(2)}×
      </p>
    </div>
  );
}
