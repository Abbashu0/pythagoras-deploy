"use client";

/**
 * ImagePositioner
 * ----------------
 * Lets the admin position an uploaded banner image inside the carousel's
 * visual frame, using `transform: translate(X%, Y%) scale(s)` instead of
 * `object-position`.
 *
 * Why transform instead of object-position?
 *   - Translates are in % of the image element's own box, which gives a
 *     consistent 1:1 drag feel regardless of how the image is letterboxed.
 *   - Works uniformly with `object-fit: contain` (the image is NEVER
 *     cropped in the editor — the user sees the full picture and chooses
 *     how to place it inside the frame).
 *   - The live preview (LiveCarouselPreview) uses the same transform
 *     values, so what you see in the editor is what students see.
 *
 * Why `object-fit: contain` (not cover)?
 *   - In the editor we want the user to see the ENTIRE image so they can
 *     precisely place it. Cropping would hide parts they may need to align.
 *   - The carousel itself uses `cover` (in LiveCarouselPreview), but the
 *     editor uses `contain` for better editability.
 *
 * Drag implementation note (IMPORTANT):
 *   - We use `useRef` for the dragging flag, NOT `useState`.
 *   - React batches state updates, so if we used `useState` and checked
 *     `dragging` inside `onPointerMove`, the very first move event after
 *     `onPointerDown` would see the OLD value (false) and skip the move.
 *   - With a ref, `draggingRef.current = true` is visible synchronously
 *     to the next pointermove handler — no race condition.
 */

import { useCallback, useEffect, useRef } from "react";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Move,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BannerImageTransform,
  BANNER_TRANSFORM_DEFAULT,
} from "@/lib/admin/banner-model";

interface Props {
  imageSrc: string;
  gradient?: string;
  value: BannerImageTransform;
  onChange: (next: BannerImageTransform) => void;
  /** Width of the preview frame. Default 320. */
  previewWidth?: number;
  /**
   * When true (full-banner mode), the safe-area overlay covers the entire
   * frame. When false (split mode, default), the overlay shows only the
   * 42% left visual panel boundary.
   */
  fullFrame?: boolean;
  /**
   * Notifies the parent when the user starts/stops actively editing
   * (dragging the image). The parent can use this to suppress
   * "unsaved changes" warnings during live drags, or to pause auto-save.
   */
  onEditingChange?: (editing: boolean) => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const SCALE_STEP = 0.25;
const WHEEL_ZOOM_STEP = 0.1; // Smaller step for smooth wheel zoom
/** Max offset in % (±150%) — wide range for precise editing. */
const MAX_OFFSET = 150;
/** Long-press arrow button repeat interval (ms). */
const ARROW_INTERVAL_MS = 50;
/** Per-tick offset for arrow buttons (in %). */
const ARROW_STEP = 1;
/** Per-tick offset for Shift+Arrow (in %). */
const ARROW_SHIFT_STEP = 10;

export function ImagePositioner({
  imageSrc,
  gradient,
  value,
  onChange,
  previewWidth = 320,
  fullFrame = false,
  onEditingChange,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);

  // ---- Synchronous drag flag (REF, not state — see file header) ----
  const draggingRef = useRef(false);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    offX: number;
    offY: number;
  } | null>(null);

  // ---- Keyboard shortcut active flag ----
  // True while the positioner is "active" (hovered or focused). The window
  // keydown listener checks this ref before acting.
  const positionerActiveRef = useRef(false);

  // ---- Always-fresh value ref ----
  // Long-press arrow intervals and the global keydown listener need to read
  // the LATEST value without re-subscribing. We update this ref in an effect
  // (NOT during render — that's disallowed by react-hooks/refs) so closures
  // always see fresh data.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // ---- Clamps ----
  const clampOffset = (v: number) =>
    Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, v));
  const clampScale = (v: number) =>
    Math.max(MIN_SCALE, Math.min(MAX_SCALE, +v.toFixed(2)));

  // ---- Pointer handlers ----
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!imageSrc) return;
      e.preventDefault();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* noop — some browsers throw if pointerId is already released */
      }
      // Synchronous ref mutation — visible to onPointerMove immediately.
      draggingRef.current = true;
      onEditingChange?.(true);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        offX: value.offsetX,
        offY: value.offsetY,
      };
    },
    [imageSrc, value.offsetX, value.offsetY, onEditingChange]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Synchronous ref check — fixes the React state race condition where
      // the first move after pointerdown would see stale state.
      if (!draggingRef.current || !dragStartRef.current || !frameRef.current)
        return;
      const frameW = frameRef.current.clientWidth;
      const frameH = frameRef.current.clientHeight;
      if (!frameW || !frameH) return;
      // 1:1 drag: delta px → delta % (relative to frame size).
      const dxPct = ((e.clientX - dragStartRef.current.x) / frameW) * 100;
      const dyPct = ((e.clientY - dragStartRef.current.y) / frameH) * 100;
      const nextX = clampOffset(dragStartRef.current.offX + dxPct);
      const nextY = clampOffset(dragStartRef.current.offY + dyPct);
      onChange({ ...valueRef.current, offsetX: nextX, offsetY: nextY });
    },
    [onChange]
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      if (draggingRef.current) {
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
      }
      draggingRef.current = false;
      dragStartRef.current = null;
      onEditingChange?.(false);
    },
    [onEditingChange]
  );

  // ---- Zoom / Reset ----
  const zoomIn = useCallback(() => {
    onChange({
      ...valueRef.current,
      scale: clampScale(valueRef.current.scale + SCALE_STEP),
    });
  }, [onChange]);

  const zoomOut = useCallback(() => {
    const s = clampScale(valueRef.current.scale - SCALE_STEP);
    // If we zoomed back to 1, reset offsets too (image fills frame exactly).
    onChange({
      ...valueRef.current,
      scale: s,
      offsetX: s === 1 ? 0 : valueRef.current.offsetX,
      offsetY: s === 1 ? 0 : valueRef.current.offsetY,
    });
  }, [onChange]);

  const reset = useCallback(() => {
    onChange({ ...BANNER_TRANSFORM_DEFAULT });
  }, [onChange]);

  // ---- Arrow button long-press (continuous 50ms movement) ----
  const arrowTimerRef = useRef<number | null>(null);
  const startArrow = useCallback(
    (dx: number, dy: number) => {
      const move = () => {
        const v = valueRef.current;
        onChange({
          ...v,
          offsetX: clampOffset(v.offsetX + dx * ARROW_STEP),
          offsetY: clampOffset(v.offsetY + dy * ARROW_STEP),
        });
      };
      move(); // fire once immediately
      if (arrowTimerRef.current !== null) {
        window.clearInterval(arrowTimerRef.current);
      }
      arrowTimerRef.current = window.setInterval(move, ARROW_INTERVAL_MS);
    },
    [onChange]
  );
  const stopArrow = useCallback(() => {
    if (arrowTimerRef.current !== null) {
      window.clearInterval(arrowTimerRef.current);
      arrowTimerRef.current = null;
    }
  }, []);

  // Clear interval on unmount.
  useEffect(() => stopArrow, [stopArrow]);

  // ---- Auto Position ----
  // Loads the image, calculates the contain-based scale that makes the
  // image COVER the frame (no letterbox), and centers it (offset 0,0).
  // This is the "best fit" default that ensures the image fills the frame
  // without distortion, regardless of the source image's aspect ratio.
  const autoPosition = useCallback(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.onload = () => {
      if (!frameRef.current) return;
      const frameW = frameRef.current.clientWidth;
      const frameH = frameRef.current.clientHeight;
      if (!img.width || !img.height || !frameW || !frameH) return;
      const imgRatio = img.width / img.height;
      const frameRatio = frameW / frameH;
      // Scale needed for the contained image to COVER the frame:
      //   - if image is wider than frame: scale by imgRatio/frameRatio
      //   - if image is taller than frame: scale by frameRatio/imgRatio
      const coverScale =
        imgRatio > frameRatio ? imgRatio / frameRatio : frameRatio / imgRatio;
      onChange({
        ...valueRef.current,
        offsetX: 0,
        offsetY: 0,
        scale: clampScale(coverScale),
      });
    };
    img.onerror = () => {
      /* ignore — image may be invalid */
    };
    img.src = imageSrc;
  }, [imageSrc, onChange]);

  // ---- Keyboard shortcuts (global listener gated by positionerActiveRef) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!positionerActiveRef.current || !imageSrc) return;
      const v = valueRef.current;
      switch (e.key) {
        case "ArrowUp":
        case "ArrowDown":
        case "ArrowLeft":
        case "ArrowRight": {
          e.preventDefault();
          const step = e.shiftKey ? ARROW_SHIFT_STEP : ARROW_STEP;
          let dx = 0;
          let dy = 0;
          if (e.key === "ArrowUp") dy = -step;
          else if (e.key === "ArrowDown") dy = step;
          else if (e.key === "ArrowLeft") dx = -step;
          else if (e.key === "ArrowRight") dx = step;
          onChange({
            ...v,
            offsetX: clampOffset(v.offsetX + dx),
            offsetY: clampOffset(v.offsetY + dy),
          });
          break;
        }
        case "+":
        case "=": {
          e.preventDefault();
          onChange({
            ...v,
            scale: clampScale(v.scale + SCALE_STEP),
          });
          break;
        }
        case "-":
        case "_": {
          e.preventDefault();
          const s = clampScale(v.scale - SCALE_STEP);
          onChange({
            ...v,
            scale: s,
            offsetX: s === 1 ? 0 : v.offsetX,
            offsetY: s === 1 ? 0 : v.offsetY,
          });
          break;
        }
        case "r":
        case "R": {
          e.preventDefault();
          onChange({ ...BANNER_TRANSFORM_DEFAULT });
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [imageSrc, onChange]);

  // ---- Ctrl + Mouse Wheel zoom ----
  // When the user hovers over the positioner frame and presses Ctrl + wheel,
  // zoom in/out smoothly. Prevents page zoom while over the frame.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !imageSrc) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const v = valueRef.current;
      const delta = e.deltaY < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP;
      onChange({
        ...v,
        scale: clampScale(+(v.scale + delta).toFixed(2)),
      });
    };

    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [imageSrc, onChange]);

  // Activate keyboard shortcuts on hover/focus.
  const activate = () => {
    positionerActiveRef.current = true;
  };
  const deactivate = () => {
    positionerActiveRef.current = false;
  };

  const canZoomOut = value.scale > MIN_SCALE + 0.001;
  const canZoomIn = value.scale < MAX_SCALE - 0.001;
  const isDefault =
    value.offsetX === 0 && value.offsetY === 0 && value.scale === 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
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
            disabled={!imageSrc || !canZoomOut}
            title="تصغير (−)"
            className="h-8 w-8 p-0"
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
            disabled={!imageSrc || !canZoomIn}
            title="تكبير (+)"
            className="h-8 w-8 p-0"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reset}
            disabled={!imageSrc || isDefault}
            title="إعادة (R)"
            className="h-8 w-8 p-0"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={autoPosition}
            disabled={!imageSrc}
            title="تموضع تلقائي"
            className="h-8 gap-1 px-2"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="text-[11px]">تلقائي</span>
          </Button>
        </div>
      </div>

      {/* Preview frame — same aspect ratio + visual panel proportions as student app */}
      <div
        ref={frameRef}
        className={`relative mx-auto overflow-hidden rounded-2xl border-2 border-border select-none outline-none ${
          imageSrc ? "cursor-grab active:cursor-grabbing" : "cursor-default"
        }`}
        style={{
          width: previewWidth,
          aspectRatio: "5 / 2",
          background: imageSrc ? "#0a0d14" : gradient || "#1e2536",
        }}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onMouseEnter={activate}
        onMouseLeave={deactivate}
        onFocus={activate}
        onBlur={deactivate}
      >
        {imageSrc ? (
          <>
            <img
              src={imageSrc}
              alt="preview"
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={{
                // contain — the image is NEVER cropped in the editor.
                objectFit: "contain",
                // translate is in % of the img element's own box (which is
                // the same size as the frame), giving a clean 1:1 drag feel.
                transform: `translate(${value.offsetX}%, ${value.offsetY}%) scale(${value.scale})`,
                transformOrigin: "center",
              }}
            />
            {/* Safe-area overlay.
                - Full-banner mode: dashed border around the entire frame.
                - Split mode: dashed border on the 42% left visual panel only. */}
            {fullFrame ? (
              <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-white/30">
                <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
                  المنطقة الظاهرة في الكاروسيل (الإطار كامل)
                </span>
              </div>
            ) : (
              <div
                className="pointer-events-none absolute inset-y-0 left-0 border-r-2 border-dashed border-white/30"
                style={{ width: "42%" }}
              >
                <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
                  المنطقة الظاهرة في الكاروسيل
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            ارفع صورة أولاً لضبط موضعها
          </div>
        )}
      </div>

      {/* Arrow-button nudge pad — long-press for continuous movement */}
      <div className="flex items-center justify-center gap-2">
        <div className="grid grid-cols-3 gap-1" dir="ltr">
          <span />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!imageSrc}
            onPointerDown={(e) => {
              e.preventDefault();
              startArrow(0, -1);
            }}
            onPointerUp={stopArrow}
            onPointerLeave={stopArrow}
            onPointerCancel={stopArrow}
            title="تحريك لأعلى"
            className="h-8 w-8 p-0"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <span />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!imageSrc}
            onPointerDown={(e) => {
              e.preventDefault();
              startArrow(-1, 0);
            }}
            onPointerUp={stopArrow}
            onPointerLeave={stopArrow}
            onPointerCancel={stopArrow}
            title="تحريك لليسار"
            className="h-8 w-8 p-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!imageSrc}
            onPointerDown={(e) => {
              e.preventDefault();
              startArrow(0, 1);
            }}
            onPointerUp={stopArrow}
            onPointerLeave={stopArrow}
            onPointerCancel={stopArrow}
            title="تحريك لأسفل"
            className="h-8 w-8 p-0"
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!imageSrc}
            onPointerDown={(e) => {
              e.preventDefault();
              startArrow(1, 0);
            }}
            onPointerUp={stopArrow}
            onPointerLeave={stopArrow}
            onPointerCancel={stopArrow}
            title="تحريك لليمين"
            className="h-8 w-8 p-0"
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        اسحب الصورة أو استخدم الأسهم للضبط الدقيق. القيم: X={value.offsetX.toFixed(1)}% Y=
        {value.offsetY.toFixed(1)}% تكبير={value.scale.toFixed(2)}×
      </p>
    </div>
  );
}
