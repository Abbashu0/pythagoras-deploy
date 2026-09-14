"use client";

import * as React from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw, Sparkles, ZoomIn, ZoomOut } from "lucide-react";
import { NumberInput } from "@/components/admin-ui/forms/input";
import { Slider } from "@/components/admin-ui/forms/slider";
import { FormField } from "@/components/admin-ui/forms/field";
import { Panel, PanelHeader, Well } from "@/components/admin-ui/primitives/surface";
import { Button, IconButton } from "@/components/admin-ui/primitives/button";
import { Tooltip } from "@/components/admin-ui/primitives/tooltip";
import { type Asset } from "@/components/admin-ui/domain/content/assets";
import { cn } from "@/lib/cn";
import {
  getNativeMaterialCardHeight,
  getNativeMaterialCenterFillScale,
  getNativeMaterialDisplayScale,
  getNativeMaterialPointerOffsets,
  NATIVE_MATERIAL_LOGICAL_CARD_WIDTH,
  NATIVE_MATERIAL_MAX_SCALE,
  NATIVE_MATERIAL_MIN_SCALE,
  NativeMaterialCardPreview,
  type NativeMaterialImageDimensions,
  type MaterialPreviewModel,
  type MaterialPreviewSettings,
} from "./material-student-preview";

export interface MaterialArtworkDraft {
  offsetX: number;
  offsetY: number;
  scale: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getAssetImageDimensions(asset: Asset | null): NativeMaterialImageDimensions | null {
  const width = asset?.width;
  const height = asset?.height;
  if (
    asset &&
    typeof width === "number" && Number.isFinite(width) && width > 0 &&
    typeof height === "number" && Number.isFinite(height) && height > 0
  ) {
    return { height, width };
  }

  return null;
}

export function MaterialArtworkEditor({
  material,
  value,
  settings,
  onChange,
  className,
}: {
  material: MaterialPreviewModel;
  value: MaterialArtworkDraft;
  settings: MaterialPreviewSettings;
  onChange: (value: MaterialArtworkDraft) => void;
  className?: string;
}) {
  const asset: Asset | null = material.asset;
  const frameRef = React.useRef<HTMLDivElement>(null);
  const onChangeRef = React.useRef(onChange);
  const valueRef = React.useRef(value);
  const [imageDimensions, setImageDimensions] = React.useState<NativeMaterialImageDimensions | null>(() => getAssetImageDimensions(asset));
  const dragRef = React.useRef<{ pointerId: number; clientX: number; clientY: number; offsetX: number; offsetY: number } | null>(null);

  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  React.useEffect(() => {
    valueRef.current = value;
  }, [value]);

  React.useEffect(() => {
    setImageDimensions(getAssetImageDimensions(asset));
  }, [asset?.height, asset?.id, asset?.width]);

  const move = (axis: "offsetX" | "offsetY", delta: number) =>
    onChange({ ...value, [axis]: clamp(value[axis] + delta, -50, 50) });
  const setScale = (scale: number) => onChange({ ...value, scale: clamp(scale, NATIVE_MATERIAL_MIN_SCALE, NATIVE_MATERIAL_MAX_SCALE) });

  const updateFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    const frame = frameRef.current;
    if (!start || !frame || event.pointerId !== start.pointerId) return;
    const rect = frame.getBoundingClientRect();
    const displayScale = getNativeMaterialDisplayScale(rect.width);
    const nextOffsets = getNativeMaterialPointerOffsets({
      startOffsetX: start.offsetX,
      startOffsetY: start.offsetY,
      displayedDeltaX: event.clientX - start.clientX,
      displayedDeltaY: event.clientY - start.clientY,
      displayScale,
      frameHeight: getNativeMaterialCardHeight(settings.cardHeight),
    });
    onChange({
      ...value,
      offsetX: clamp(nextOffsets.offsetX, -50, 50),
      offsetY: clamp(nextOffsets.offsetY, -50, 50),
    });
  };

  React.useEffect(() => {
    const viewport = frameRef.current;
    if (!viewport || !asset?.previewUrl || asset.integrity !== "ok") return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const current = valueRef.current;
      const nextScale = clamp(
        current.scale + (event.deltaY < 0 ? 0.05 : -0.05),
        NATIVE_MATERIAL_MIN_SCALE,
        NATIVE_MATERIAL_MAX_SCALE,
      );
      if (nextScale !== current.scale) {
        onChangeRef.current({ ...current, scale: nextScale });
      }
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [asset?.id, asset?.integrity, asset?.previewUrl]);

  const autoPosition = () => {
    if (!imageDimensions) return;
    const scale = getNativeMaterialCenterFillScale({
      frameHeight: getNativeMaterialCardHeight(settings.cardHeight),
      frameWidth: NATIVE_MATERIAL_LOGICAL_CARD_WIDTH,
      sourceHeight: imageDimensions.height,
      sourceWidth: imageDimensions.width,
    });
    if (scale === null) return;
    onChange({ offsetX: 0, offsetY: 0, scale });
  };

  return (
    <Panel className={cn("min-w-0", className)}>
      <PanelHeader
        title="موضع artwork"
        description="اسحب الصورة أو استخدم القيم الدقيقة. التغييرات محلية حتى تضغط حفظ."
        density="compact"
      />
      <div className="space-y-4 p-4">
        {asset ? (
          <>
            <div
              ref={frameRef}
              role="application"
              tabIndex={0}
              aria-label="محرر صورة بطاقة المادة"
              onPointerDown={(event) => {
                if (!asset.previewUrl || asset.integrity !== "ok") return;
                event.currentTarget.setPointerCapture(event.pointerId);
                event.currentTarget.focus();
                dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, offsetX: value.offsetX, offsetY: value.offsetY };
              }}
              onPointerMove={updateFromPointer}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                dragRef.current = null;
              }}
              onPointerCancel={() => { dragRef.current = null; }}
              onKeyDown={(event) => {
                const delta = event.shiftKey ? 10 : 1;
                if (event.key === "ArrowLeft") { event.preventDefault(); move("offsetX", -delta); }
                if (event.key === "ArrowRight") { event.preventDefault(); move("offsetX", delta); }
                if (event.key === "ArrowUp") { event.preventDefault(); move("offsetY", -delta); }
                if (event.key === "ArrowDown") { event.preventDefault(); move("offsetY", delta); }
              }}
              className="relative touch-none cursor-move rounded-[28px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              <NativeMaterialCardPreview
                material={{ ...material, ...value }}
                onImageDimensionsChange={setImageDimensions}
                settings={settings}
              />
            </div>

            <div className="flex items-center justify-center gap-1">
              <Tooltip content="تحريك يمين"><IconButton label="تحريك يمين" size="sm" variant="ghost" onClick={() => move("offsetX", 1)}><ArrowRight aria-hidden /></IconButton></Tooltip>
              <Tooltip content="تحريك يسار"><IconButton label="تحريك يسار" size="sm" variant="ghost" onClick={() => move("offsetX", -1)}><ArrowLeft aria-hidden /></IconButton></Tooltip>
              <Tooltip content="تحريك أعلى"><IconButton label="تحريك أعلى" size="sm" variant="ghost" onClick={() => move("offsetY", -1)}><ArrowUp aria-hidden /></IconButton></Tooltip>
              <Tooltip content="تحريك أسفل"><IconButton label="تحريك أسفل" size="sm" variant="ghost" onClick={() => move("offsetY", 1)}><ArrowDown aria-hidden /></IconButton></Tooltip>
              <span className="mx-1 h-4 w-px bg-separator" aria-hidden />
              <Tooltip content="تصغير"><IconButton label="تصغير" size="sm" variant="ghost" onClick={() => setScale(value.scale - 0.05)}><ZoomOut aria-hidden /></IconButton></Tooltip>
              <Tooltip content="تكبير"><IconButton label="تكبير" size="sm" variant="ghost" onClick={() => setScale(value.scale + 0.05)}><ZoomIn aria-hidden /></IconButton></Tooltip>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="الموضع الأفقي" description="من -50 إلى 50">
                <NumberInput value={value.offsetX} onValueChange={(next) => next !== null && onChange({ ...value, offsetX: clamp(next, -50, 50) })} min={-50} max={50} step={1} unit="%" aria-label="الموضع الأفقي" />
              </FormField>
              <FormField label="الموضع العمودي" description="من -50 إلى 50">
                <NumberInput value={value.offsetY} onValueChange={(next) => next !== null && onChange({ ...value, offsetY: clamp(next, -50, 50) })} min={-50} max={50} step={1} unit="%" aria-label="الموضع العمودي" />
              </FormField>
            </div>
            <Slider value={value.offsetX} onValueChange={(next) => onChange({ ...value, offsetX: next })} min={-50} max={50} step={1} showValue formatValue={(next) => `${next}%`} aria-label="الموضع الأفقي" />
            <Slider value={value.offsetY} onValueChange={(next) => onChange({ ...value, offsetY: next })} min={-50} max={50} step={1} showValue formatValue={(next) => `${next}%`} aria-label="الموضع العمودي" />
            <FormField label="المقياس" description="من 0.5 إلى 3">
              <NumberInput value={value.scale} onValueChange={(next) => next !== null && setScale(next)} min={NATIVE_MATERIAL_MIN_SCALE} max={NATIVE_MATERIAL_MAX_SCALE} step={0.01} unit="×" aria-label="مقياس الصورة" />
            </FormField>
            <Slider value={value.scale} onValueChange={setScale} min={NATIVE_MATERIAL_MIN_SCALE} max={NATIVE_MATERIAL_MAX_SCALE} step={0.01} showValue formatValue={(next) => `${next.toFixed(2)}×`} aria-label="مقياس الصورة" />
            <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
              <Button size="sm" variant="secondary" icon={<Sparkles aria-hidden />} disabled={!imageDimensions} onClick={autoPosition}>تعبئة تلقائية</Button>
              <Button size="sm" variant="quiet" icon={<RotateCcw aria-hidden />} onClick={() => onChange({ offsetX: 0, offsetY: 0, scale: 1 })}>إعادة الضبط</Button>
            </div>
          </>
        ) : (
          <Well padding="md"><p className="text-center text-xs text-fg-tertiary">اختر صورة صحيحة لبدء ضبط موضعها.</p></Well>
        )}
      </div>
    </Panel>
  );
}
