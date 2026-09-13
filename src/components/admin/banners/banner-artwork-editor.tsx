"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  RotateCcw,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { AssetThumb, type Asset } from "@/components/admin-ui/domain/content/assets";
import { Button, IconButton } from "@/components/admin-ui/primitives/button";
import { NumberInput } from "@/components/admin-ui/forms/input";
import { Slider } from "@/components/admin-ui/forms/slider";
import { FormField } from "@/components/admin-ui/forms/field";
import { Panel, PanelHeader, Well } from "@/components/admin-ui/primitives/surface";
import { Tooltip } from "@/components/admin-ui/primitives/tooltip";
import { cn } from "@/lib/cn";
import { BannerArtworkFrame } from "./banner-student-preview";

const FRAME_RATIO = 5 / 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function autoScale(asset: Asset): number {
  if (!asset.width || !asset.height) return 1;
  const sourceRatio = asset.width / asset.height;
  return clamp(Math.max(FRAME_RATIO / sourceRatio, sourceRatio / FRAME_RATIO), 0.5, 3);
}

export interface BannerArtworkDraft {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export function BannerArtworkEditor({
  asset,
  value,
  onChange,
  className,
}: {
  asset: Asset | null;
  value: BannerArtworkDraft;
  onChange: (value: BannerArtworkDraft) => void;
  className?: string;
}) {
  const frameRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const move = (axis: "offsetX" | "offsetY", delta: number) => {
    onChange({
      ...value,
      [axis]: clamp(value[axis] + delta, -50, 50),
    });
  };

  const setScale = (scale: number) => onChange({ ...value, scale: clamp(scale, 0.5, 3) });

  const updateFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    const frame = frameRef.current;
    if (!start || !frame || event.pointerId !== start.pointerId) return;
    const rect = frame.getBoundingClientRect();
    onChange({
      ...value,
      offsetX: clamp(start.offsetX + ((event.clientX - start.clientX) / rect.width) * 100, -50, 50),
      offsetY: clamp(start.offsetY + ((event.clientY - start.clientY) / rect.height) * 100, -50, 50),
    });
  };

  return (
    <Panel className={cn("min-w-0", className)}>
      <PanelHeader
        title="موضع الصورة"
        description="اسحب الصورة أو استخدم القيم الدقيقة. التغيير محفوظ محليًا حتى تضغط حفظ."
        density="compact"
      />
      <div className="space-y-4 p-4">
        {asset ? (
          <>
            <div
              ref={frameRef}
              role="application"
              tabIndex={0}
              aria-label="محرر موضع صورة البانر"
              onPointerDown={(event) => {
                if (!asset.previewUrl || asset.integrity !== "ok") return;
                event.currentTarget.setPointerCapture(event.pointerId);
                event.currentTarget.focus();
                dragRef.current = {
                  pointerId: event.pointerId,
                  clientX: event.clientX,
                  clientY: event.clientY,
                  offsetX: value.offsetX,
                  offsetY: value.offsetY,
                };
              }}
              onPointerMove={updateFromPointer}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                dragRef.current = null;
              }}
              onPointerCancel={() => {
                dragRef.current = null;
              }}
              onWheel={(event) => {
                if (!asset.previewUrl || asset.integrity !== "ok") return;
                event.preventDefault();
                setScale(value.scale + (event.deltaY < 0 ? 0.05 : -0.05));
              }}
              onKeyDown={(event) => {
                const delta = event.shiftKey ? 10 : 1;
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  move("offsetX", -delta);
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  move("offsetX", delta);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  move("offsetY", -delta);
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  move("offsetY", delta);
                }
              }}
              className="relative cursor-move rounded-[30px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
              <BannerArtworkFrame
                asset={asset}
                offsetX={value.offsetX}
                offsetY={value.offsetY}
                scale={value.scale}
                className="border-0"
              />
            </div>

            <div className="flex items-center justify-center gap-1">
              <Tooltip content="تحريك يمين">
                <IconButton label="تحريك يمين" size="sm" variant="ghost" onClick={() => move("offsetX", 1)}>
                  <ArrowRight aria-hidden />
                </IconButton>
              </Tooltip>
              <Tooltip content="تحريك يسار">
                <IconButton label="تحريك يسار" size="sm" variant="ghost" onClick={() => move("offsetX", -1)}>
                  <ArrowLeft aria-hidden />
                </IconButton>
              </Tooltip>
              <Tooltip content="تحريك أعلى">
                <IconButton label="تحريك أعلى" size="sm" variant="ghost" onClick={() => move("offsetY", -1)}>
                  <ArrowUp aria-hidden />
                </IconButton>
              </Tooltip>
              <Tooltip content="تحريك أسفل">
                <IconButton label="تحريك أسفل" size="sm" variant="ghost" onClick={() => move("offsetY", 1)}>
                  <ArrowDown aria-hidden />
                </IconButton>
              </Tooltip>
              <span className="mx-1 h-4 w-px bg-separator" aria-hidden />
              <Tooltip content="تصغير">
                <IconButton label="تصغير" size="sm" variant="ghost" onClick={() => setScale(value.scale - 0.05)}>
                  <ZoomOut aria-hidden />
                </IconButton>
              </Tooltip>
              <Tooltip content="تكبير">
                <IconButton label="تكبير" size="sm" variant="ghost" onClick={() => setScale(value.scale + 0.05)}>
                  <ZoomIn aria-hidden />
                </IconButton>
              </Tooltip>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="الموضع الأفقي" description="من -50 إلى 50">
                <NumberInput
                  value={value.offsetX}
                  onValueChange={(next) => next !== null && onChange({ ...value, offsetX: clamp(next, -50, 50) })}
                  min={-50}
                  max={50}
                  step={1}
                  unit="%"
                  aria-label="الموضع الأفقي"
                />
              </FormField>
              <FormField label="الموضع العمودي" description="من -50 إلى 50">
                <NumberInput
                  value={value.offsetY}
                  onValueChange={(next) => next !== null && onChange({ ...value, offsetY: clamp(next, -50, 50) })}
                  min={-50}
                  max={50}
                  step={1}
                  unit="%"
                  aria-label="الموضع العمودي"
                />
              </FormField>
            </div>

            <div className="space-y-3">
              <Slider
                value={value.offsetX}
                onValueChange={(next) => onChange({ ...value, offsetX: next })}
                min={-50}
                max={50}
                step={1}
                size="sm"
                showValue
                formatValue={(next) => `${next}%`}
              />
              <Slider
                value={value.offsetY}
                onValueChange={(next) => onChange({ ...value, offsetY: next })}
                min={-50}
                max={50}
                step={1}
                size="sm"
                showValue
                formatValue={(next) => `${next}%`}
              />
              <FormField label="المقياس" description="من 0.5 إلى 3">
                <NumberInput
                  value={value.scale}
                  onValueChange={(next) => next !== null && setScale(next)}
                  min={0.5}
                  max={3}
                  step={0.01}
                  unit="×"
                  aria-label="مقياس الصورة"
                />
              </FormField>
              <Slider
                value={value.scale}
                onValueChange={setScale}
                min={0.5}
                max={3}
                step={0.01}
                size="sm"
                showValue
                formatValue={(next) => `${next.toFixed(2)}×`}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
              <Button
                size="sm"
                variant="secondary"
                icon={<Sparkles aria-hidden />}
                onClick={() => onChange({ offsetX: 0, offsetY: 0, scale: autoScale(asset) })}
              >
                أفضل موضع
              </Button>
              <Button
                size="sm"
                variant="quiet"
                icon={<RotateCcw aria-hidden />}
                onClick={() => onChange({ offsetX: 0, offsetY: 0, scale: 1 })}
              >
                إعادة الضبط
              </Button>
            </div>
          </>
        ) : (
          <Well padding="md">
            <p className="text-center text-xs text-fg-tertiary">
              اختر صورة صحيحة لبدء ضبط موضعها.
            </p>
          </Well>
        )}
      </div>
    </Panel>
  );
}
