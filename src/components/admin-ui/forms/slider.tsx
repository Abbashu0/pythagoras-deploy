"use client";

import * as React from "react";
import * as SL from "@radix-ui/react-slider";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { useFieldContext } from "./field";

/* ============================================================================
   Slider / RangeSlider
   ---------------------------------------------------------------------------
   Sliders are for values where the *relative* position matters more than the
   exact number — retrieval weights, temperature, evidence limits. Whenever the
   exact number matters too, pair the slider with a NumberInput rather than
   forcing the operator to drag for precision.

   Radix resolves direction from the Direction provider, so the track fills
   from the inline start automatically in RTL.
   ========================================================================== */

export interface SliderProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof SL.Root>,
    "value" | "defaultValue" | "onValueChange"
  > {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  /** Tick labels rendered under the track. */
  marks?: { value: number; label: React.ReactNode }[];
  /** Show the current value as a bubble above the thumb while dragging. */
  showValue?: boolean;
  formatValue?: (value: number) => string;
  size?: "sm" | "md";
}

export function Slider({
  value,
  defaultValue,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  marks,
  showValue = false,
  formatValue = (v) => formatNumber(v, { decimals: Number.isInteger(step) ? 0 : 2 }),
  size = "md",
  className,
  disabled,
  ...props
}: SliderProps) {
  const field = useFieldContext();
  const current = value ?? defaultValue ?? min;

  return (
    <div className={cn("w-full", className)}>
      {showValue ? (
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs text-fg-tertiary">
            {formatValue(min)}
          </span>
          <span className="text-sm font-semibold text-fg tnum">
            {formatValue(current)}
          </span>
          <span className="text-xs text-fg-tertiary">{formatValue(max)}</span>
        </div>
      ) : null}
      <SL.Root
        value={value != null ? [value] : undefined}
        defaultValue={defaultValue != null ? [defaultValue] : undefined}
        onValueChange={(v) => onValueChange?.(v[0])}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-describedby={field?.descriptionId}
        className={cn(
          "relative flex w-full touch-none select-none items-center",
          size === "sm" ? "h-4" : "h-5",
          disabled && "opacity-55",
        )}
        {...props}
      >
        <SL.Track
          className={cn(
            "relative w-full grow overflow-hidden rounded-full bg-chart-track",
            size === "sm" ? "h-1" : "h-1.5",
          )}
        >
          <SL.Range className="absolute h-full rounded-full bg-accent" />
        </SL.Track>
        <SL.Thumb
          className={cn(
            "block rounded-full border-2 border-accent bg-surface shadow-sm",
            "transition-[box-shadow,transform] duration-[var(--dur-fast)]",
            "hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
            "disabled:cursor-not-allowed",
            size === "sm" ? "size-3" : "size-3.5",
          )}
          aria-label="القيمة"
        />
      </SL.Root>
      {marks?.length ? (
        <div className="relative mt-1.5 h-4">
          {marks.map((m) => {
            const pct = ((m.value - min) / (max - min)) * 100;
            return (
              <span
                key={m.value}
                className="absolute -translate-x-1/2 whitespace-nowrap text-2xs text-fg-quaternary rtl:translate-x-1/2"
                style={{ insetInlineStart: `${pct}%` }}
              >
                {m.label}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================================
   RangeSlider — two thumbs. Used by latency/cost filters and date-free ranges.
   ========================================================================== */

export interface RangeSliderProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof SL.Root>,
    "value" | "defaultValue" | "onValueChange"
  > {
  value?: [number, number];
  defaultValue?: [number, number];
  onValueChange?: (value: [number, number]) => void;
  formatValue?: (value: number) => string;
  showValue?: boolean;
  size?: "sm" | "md";
  /** Minimum gap between the two thumbs. */
  minStepsBetweenThumbs?: number;
}

export function RangeSlider({
  value,
  defaultValue,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  showValue = true,
  formatValue = (v) => formatNumber(v),
  size = "md",
  minStepsBetweenThumbs = 1,
  className,
  disabled,
  ...props
}: RangeSliderProps) {
  const current = value ?? defaultValue ?? [min, max];

  return (
    <div className={cn("w-full", className)}>
      {showValue ? (
        <div className="mb-2 flex items-baseline justify-between gap-2 text-sm tnum">
          <span className="font-semibold text-fg">{formatValue(current[0])}</span>
          <span className="text-xs text-fg-quaternary">إلى</span>
          <span className="font-semibold text-fg">{formatValue(current[1])}</span>
        </div>
      ) : null}
      <SL.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={(v) => onValueChange?.([v[0], v[1]])}
        min={min}
        max={max}
        step={step}
        minStepsBetweenThumbs={minStepsBetweenThumbs}
        disabled={disabled}
        className={cn(
          "relative flex w-full touch-none select-none items-center",
          size === "sm" ? "h-4" : "h-5",
          disabled && "opacity-55",
        )}
        {...props}
      >
        <SL.Track
          className={cn(
            "relative w-full grow overflow-hidden rounded-full bg-chart-track",
            size === "sm" ? "h-1" : "h-1.5",
          )}
        >
          <SL.Range className="absolute h-full rounded-full bg-accent" />
        </SL.Track>
        {["الحد الأدنى", "الحد الأعلى"].map((label) => (
          <SL.Thumb
            key={label}
            aria-label={label}
            className={cn(
              "block rounded-full border-2 border-accent bg-surface shadow-sm",
              "transition-transform duration-[var(--dur-fast)] hover:scale-110",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
              size === "sm" ? "size-3" : "size-3.5",
            )}
          />
        ))}
      </SL.Root>
    </div>
  );
}
