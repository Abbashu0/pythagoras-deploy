"use client";

import * as React from "react";
import * as CB from "@radix-ui/react-checkbox";
import * as RG from "@radix-ui/react-radio-group";
import * as SW from "@radix-ui/react-switch";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Spinner } from "../primitives/spinner";
import { useFieldContext } from "./field";

/* ============================================================================
   Checkbox / Switch / RadioGroup
   ---------------------------------------------------------------------------
   Which one to use:
   - Switch   : takes effect immediately (enable a provider, turn Pi on).
   - Checkbox : part of a form that is submitted later, or a selection.
   - Radio    : one of a small, visible set of mutually exclusive options.

   The Switch supports a `pending` state because "enable this provider" is an
   async operation and the operator must see that it is in flight without the
   control jumping back to its old position.
   ========================================================================== */

const SIZES = {
  sm: "size-3.5 rounded-[3px]",
  md: "size-4 rounded-[4px]",
  lg: "size-[18px] rounded-[5px]",
} as const;

export interface CheckboxProps
  extends Omit<React.ComponentPropsWithoutRef<typeof CB.Root>, "children"> {
  size?: keyof typeof SIZES;
  label?: React.ReactNode;
  description?: React.ReactNode;
  /** Renders the whole row as the hit target. */
  block?: boolean;
}

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  function Checkbox(
    { size = "md", label, description, block = false, className, id, ...props },
    ref,
  ) {
    const field = useFieldContext();
    const auto = React.useId();
    const inputId = id ?? field?.id ?? `cb${auto.replace(/:/g, "")}`;

    const control = (
      <CB.Root
        ref={ref}
        id={inputId}
        className={cn(
          "group/cb peer relative flex shrink-0 items-center justify-center border transition-all duration-[var(--dur-fast)]",
          "border-border-strong bg-surface",
          "hover:border-accent",
          "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
          "data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
          "disabled:cursor-not-allowed disabled:border-disabled-border disabled:bg-disabled-bg",
          "data-[state=checked]:disabled:bg-neutral data-[state=checked]:disabled:border-neutral",
          "aria-invalid:border-danger",
          SIZES[size],
          !label && className,
        )}
        {...props}
      >
        <CB.Indicator className="flex items-center justify-center text-on-accent">
          {props.checked === "indeterminate" ? (
            <Minus className="size-3" strokeWidth={3} aria-hidden />
          ) : (
            <Check
              className={size === "sm" ? "size-2.5" : "size-3"}
              strokeWidth={3}
              aria-hidden
            />
          )}
        </CB.Indicator>
      </CB.Root>
    );

    if (!label) return control;

    return (
      <div
        className={cn(
          "flex items-start gap-2.5",
          block &&
            "rounded-md border border-border p-3 transition-colors has-[[data-state=checked]]:border-accent-border has-[[data-state=checked]]:bg-accent-subtle",
          className,
        )}
      >
        <span className="mt-px flex items-center">{control}</span>
        <div className="min-w-0">
          <label
            htmlFor={inputId}
            className={cn(
              "block cursor-pointer text-sm text-fg",
              props.disabled && "cursor-not-allowed text-disabled-fg",
            )}
          >
            {label}
          </label>
          {description ? (
            <p className="mt-0.5 text-xs leading-[1.6] text-fg-tertiary">
              {description}
            </p>
          ) : null}
        </div>
      </div>
    );
  },
);

/* ============================================================================
   Switch
   ========================================================================== */

/* CSS transforms are physical, not logical: a checked thumb must travel left
   in Arabic and right in English, so each size declares both directions. */
const SWITCH_SIZES = {
  sm: {
    root: "h-4 w-7",
    thumb:
      "size-3 ltr:data-[state=checked]:translate-x-3 rtl:data-[state=checked]:-translate-x-3",
  },
  md: {
    root: "h-[18px] w-8",
    thumb:
      "size-3.5 ltr:data-[state=checked]:translate-x-3.5 rtl:data-[state=checked]:-translate-x-3.5",
  },
  lg: {
    root: "h-5 w-9",
    thumb:
      "size-4 ltr:data-[state=checked]:translate-x-4 rtl:data-[state=checked]:-translate-x-4",
  },
} as const;

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SW.Root> {
  size?: keyof typeof SWITCH_SIZES;
  /** The change is in flight. Shows a spinner and blocks further toggling. */
  pending?: boolean;
  label?: React.ReactNode;
  description?: React.ReactNode;
  /** Position of the label relative to the control. */
  labelSide?: "start" | "end";
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch(
    {
      size = "md",
      pending = false,
      label,
      description,
      labelSide = "end",
      className,
      disabled,
      id,
      ...props
    },
    ref,
  ) {
    const field = useFieldContext();
    const auto = React.useId();
    const inputId = id ?? field?.id ?? `sw${auto.replace(/:/g, "")}`;
    const s = SWITCH_SIZES[size];

    const control = (
      <span className="relative inline-flex shrink-0 items-center">
        <SW.Root
          ref={ref}
          id={inputId}
          disabled={disabled || pending}
          className={cn(
            "peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent p-0.5",
            "bg-border-strong transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)]",
            "data-[state=checked]:bg-accent",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
            "disabled:cursor-not-allowed disabled:opacity-55",
            s.root,
            !label && className,
          )}
          {...props}
        >
          <SW.Thumb
            className={cn(
              "pointer-events-none block rounded-full bg-surface shadow-xs",
              "transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)]",
              s.thumb,
            )}
          />
        </SW.Root>
        {pending ? (
          <span className="pointer-events-none absolute -end-5 inline-flex">
            <Spinner size="xs" className="text-fg-tertiary" />
          </span>
        ) : null}
      </span>
    );

    if (!label) return control;

    return (
      <div
        className={cn(
          "flex items-start gap-3",
          labelSide === "start" && "flex-row-reverse justify-between",
          className,
        )}
      >
        <span className="mt-px">{control}</span>
        <div className="min-w-0">
          <label
            htmlFor={inputId}
            className={cn(
              "block cursor-pointer text-sm text-fg",
              disabled && "cursor-not-allowed text-disabled-fg",
            )}
          >
            {label}
          </label>
          {description ? (
            <p className="mt-0.5 text-xs leading-[1.6] text-fg-tertiary">
              {description}
            </p>
          ) : null}
        </div>
      </div>
    );
  },
);

/* ============================================================================
   RadioGroup
   ========================================================================== */

export interface RadioOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  icon?: React.ReactNode;
  /** Trailing content — a badge, a price, a status. */
  trailing?: React.ReactNode;
}

export interface RadioGroupProps<T extends string = string>
  extends Omit<
    React.ComponentPropsWithoutRef<typeof RG.Root>,
    "onValueChange" | "value" | "defaultValue"
  > {
  options: RadioOption<T>[];
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  /** `card` gives each option a bordered hit area — better for 2–4 options
   *  with descriptions. `list` is compact for 5+. */
  appearance?: "list" | "card";
  columns?: 1 | 2 | 3;
}

export function RadioGroup<T extends string = string>({
  options,
  value,
  defaultValue,
  onValueChange,
  appearance = "list",
  columns = 1,
  className,
  ...props
}: RadioGroupProps<T>) {
  const field = useFieldContext();
  const auto = React.useId();

  return (
    <RG.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={(v) => onValueChange?.(v as T)}
      className={cn(
        "grid",
        appearance === "card" ? "gap-2" : "gap-2.5",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
      aria-describedby={field?.descriptionId}
      {...props}
    >
      {options.map((opt) => {
        const id = `${auto.replace(/:/g, "")}-${opt.value}`;
        return (
          <div
            key={opt.value}
            title={opt.disabled ? opt.disabledReason : undefined}
            className={cn(
              "flex items-start gap-2.5",
              appearance === "card" && [
                "rounded-md border border-border p-3 transition-colors duration-[var(--dur-fast)]",
                "has-[[data-state=checked]]:border-accent-border has-[[data-state=checked]]:bg-accent-subtle",
                !opt.disabled && "hover:border-border-strong",
                opt.disabled && "opacity-60",
              ],
            )}
          >
            <RG.Item
              id={id}
              value={opt.value}
              disabled={opt.disabled}
              className={cn(
                "relative mt-px flex size-4 shrink-0 items-center justify-center rounded-full border",
                "border-border-strong bg-surface transition-colors duration-[var(--dur-fast)]",
                "hover:border-accent",
                "data-[state=checked]:border-accent data-[state=checked]:border-[5px]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
                "disabled:cursor-not-allowed disabled:border-disabled-border disabled:bg-disabled-bg",
              )}
            />
            <div className="min-w-0 flex-1">
              <label
                htmlFor={id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 text-sm text-fg",
                  opt.disabled && "cursor-not-allowed text-disabled-fg",
                )}
              >
                {opt.icon ? (
                  <span className="shrink-0 text-fg-tertiary [&_svg]:size-4">
                    {opt.icon}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">{opt.label}</span>
                {opt.trailing}
              </label>
              {opt.description ? (
                <p className="mt-0.5 text-xs leading-[1.6] text-fg-tertiary">
                  {opt.description}
                </p>
              ) : null}
              {opt.disabled && opt.disabledReason ? (
                <p className="mt-0.5 text-xs text-warning-text">
                  {opt.disabledReason}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
    </RG.Root>
  );
}
