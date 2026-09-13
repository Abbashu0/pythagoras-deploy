"use client";

import * as React from "react";
import * as TG from "@radix-ui/react-toggle-group";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { transition } from "@/lib/motion";
import { Tooltip } from "../primitives/tooltip";

/* ============================================================================
   SegmentedControl / ToggleGroup
   ---------------------------------------------------------------------------
   SegmentedControl: one of 2–5 mutually exclusive *views* or *modes*. It is not
   a filter and not a form field — those are Tabs and RadioGroup respectively.
   The indicator slides so a mode change reads as a movement, and it never
   animates on first paint.

   ToggleGroup: independent on/off formatting-style toggles (density, chart
   series visibility, text alignment).
   ========================================================================== */

export interface SegmentedOption<T extends string = string> {
  value: T;
  label?: React.ReactNode;
  icon?: React.ReactNode;
  /** For icon-only segments — required for the accessible name. */
  ariaLabel?: string;
  disabled?: boolean;
  tooltip?: React.ReactNode;
  count?: number;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  size?: "sm" | "md" | "lg";
  /** Fill the available width, dividing it equally. */
  stretch?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onValueChange,
  size = "md",
  stretch = false,
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  const uid = React.useId();

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-inset p-0.5",
        stretch && "flex w-full",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const content = (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.ariaLabel}
            disabled={opt.disabled}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              "relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] font-medium",
              "transition-colors duration-[var(--dur-fast)]",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
              "disabled:pointer-events-none disabled:text-disabled-fg",
              "[&_svg]:size-3.5 [&_svg]:shrink-0",
              size === "sm" && "h-6 px-2 text-2xs",
              size === "md" && "h-7 px-2.5 text-xs",
              size === "lg" && "h-8 px-3 text-sm",
              !opt.label && "aspect-square px-0",
              stretch && "flex-1",
              active ? "text-fg" : "text-fg-tertiary hover:text-fg-secondary",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`seg-${uid}`}
                className="absolute inset-0 rounded-[5px] border border-border bg-surface shadow-xs"
                transition={transition.indicator}
              />
            ) : null}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {opt.icon}
              {opt.label}
              {opt.count != null ? (
                <span className="text-2xs text-fg-quaternary tnum">
                  {opt.count}
                </span>
              ) : null}
            </span>
          </button>
        );

        return opt.tooltip ? (
          <Tooltip key={opt.value} content={opt.tooltip}>
            {content}
          </Tooltip>
        ) : (
          content
        );
      })}
    </div>
  );
}

/* ============================================================================
   ToggleGroup — multiple independent toggles sharing one container.
   ========================================================================== */

type ToggleGroupRootProps = React.ComponentPropsWithoutRef<typeof TG.Root>;

export type ToggleGroupProps = { options: SegmentedOption[]; size?: "sm" | "md" } &
  (
    | ({ type?: "multiple" } & Omit<Extract<ToggleGroupRootProps, { type: "multiple" }>, "type">)
    | ({ type: "single" } & Omit<Extract<ToggleGroupRootProps, { type: "single" }>, "type">)
  );

export function ToggleGroup({
  options,
  size = "md",
  type = "multiple",
  className,
  ...props
}: ToggleGroupProps) {
  const rootProps = { type, ...props } as ToggleGroupRootProps;
  return (
    <TG.Root
      {...rootProps}
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-surface",
        "[&>*:first-child]:rounded-s-[5px] [&>*:last-child]:rounded-e-[5px]",
        "[&>*:not(:first-child)]:border-s [&>*:not(:first-child)]:border-border",
        className,
      )}
    >
      {options.map((opt) => {
        const item = (
          <TG.Item
            key={opt.value}
            value={opt.value}
            disabled={opt.disabled}
            aria-label={opt.ariaLabel}
            className={cn(
              "inline-flex shrink-0 items-center justify-center gap-1.5 font-medium",
              "text-fg-tertiary transition-colors duration-[var(--dur-fast)]",
              "hover:bg-hover hover:text-fg-secondary",
              "data-[state=on]:bg-selected data-[state=on]:text-accent-text",
              "focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]",
              "disabled:pointer-events-none disabled:text-disabled-fg",
              "[&_svg]:size-3.5 [&_svg]:shrink-0",
              size === "sm" && "h-control-sm px-2 text-2xs",
              size === "md" && "h-control-md px-2.5 text-xs",
              !opt.label && "aspect-square px-0",
            )}
          >
            {opt.icon}
            {opt.label}
          </TG.Item>
        );
        return opt.tooltip ? (
          <Tooltip key={opt.value} content={opt.tooltip}>
            {item}
          </Tooltip>
        ) : (
          item
        );
      })}
    </TG.Root>
  );
}
