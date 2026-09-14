"use client";

import * as React from "react";
import { Select as S } from "radix-ui";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { inputShell, type InputSize, type InputStatus } from "./input";
import { useFieldContext } from "./field";

/* ============================================================================
   Select
   ---------------------------------------------------------------------------
   For a *known, short* list of options (≤ ~12) where scanning beats typing:
   retention policy, density, chart range, log level.

   For anything longer, or anything an operator would rather type than scroll —
   models, subjects, providers, taxonomy — use the Combobox instead. That
   distinction is the difference between a pleasant admin and a tedious one.
   ========================================================================== */

export interface SelectOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  /** Short trailing note — a technical id, a price, a count. */
  meta?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** Group heading this option belongs to. */
  group?: string;
}

export interface SelectProps<T extends string = string> {
  options: SelectOption<T>[];
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  placeholder?: string;
  size?: InputSize;
  status?: InputStatus;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  /** Keep the trigger width; content matches it. */
  matchTriggerWidth?: boolean;
  name?: string;
  id?: string;
  "aria-label"?: string;
  /** Rendered before the value in the trigger. */
  prefix?: React.ReactNode;
}

export function Select<T extends string = string>({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = "اختر…",
  size = "md",
  status,
  disabled,
  className,
  contentClassName,
  matchTriggerWidth = true,
  name,
  id,
  "aria-label": ariaLabel,
  prefix,
}: SelectProps<T>) {
  const field = useFieldContext();
  const resolvedStatus =
    status ?? (field?.status === "default" ? undefined : field?.status);

  const groups = React.useMemo(() => {
    const map = new Map<string, SelectOption<T>[]>();
    for (const opt of options) {
      const key = opt.group ?? "";
      const list = map.get(key);
      if (list) list.push(opt);
      else map.set(key, [opt]);
    }
    return [...map.entries()];
  }, [options]);

  return (
    <S.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={(v) => onValueChange?.(v as T)}
      disabled={disabled}
      name={name}
    >
      <S.Trigger
        id={id ?? field?.id}
        aria-label={ariaLabel}
        aria-invalid={resolvedStatus === "invalid" || undefined}
        aria-describedby={field?.descriptionId}
        className={cn(
          inputShell({ size, status: resolvedStatus }),
          "cursor-pointer justify-between text-start",
          "data-[placeholder]:text-fg-quaternary",
          "data-[state=open]:border-accent data-[state=open]:shadow-[0_0_0_3px_var(--accent-subtle)]",
          "focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-subtle)]",
          "disabled:cursor-not-allowed",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {prefix}
          <S.Value placeholder={placeholder} />
        </span>
        <S.Icon asChild>
          <ChevronDown
            className="size-3.5 shrink-0 text-fg-quaternary transition-transform duration-[var(--dur-fast)]"
            aria-hidden
          />
        </S.Icon>
      </S.Trigger>

      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={5}
          collisionPadding={12}
          className={cn(
            "pyth-overlay-anim z-[var(--z-dropdown)] overflow-hidden rounded-lg border border-border bg-elevated p-1 shadow-lg",
            "max-h-[min(20rem,var(--radix-select-content-available-height))]",
            matchTriggerWidth && "w-[var(--radix-select-trigger-width)]",
            !matchTriggerWidth && "min-w-[var(--radix-select-trigger-width)]",
            contentClassName,
          )}
        >
          <S.ScrollUpButton className="flex h-5 items-center justify-center text-fg-quaternary">
            <ChevronUp className="size-3" aria-hidden />
          </S.ScrollUpButton>
          <S.Viewport>
            {groups.map(([group, items], gi) => (
              <React.Fragment key={group || `g${gi}`}>
                {group ? (
                  <S.Group>
                    <S.Label className="eyebrow px-2 pb-1 pt-2 first:pt-1">
                      {group}
                    </S.Label>
                    {items.map((opt) => (
                      <Item key={opt.value} option={opt} />
                    ))}
                  </S.Group>
                ) : (
                  items.map((opt) => <Item key={opt.value} option={opt} />)
                )}
                {gi < groups.length - 1 ? (
                  <S.Separator className="-mx-1 my-1 h-px bg-separator" />
                ) : null}
              </React.Fragment>
            ))}
          </S.Viewport>
          <S.ScrollDownButton className="flex h-5 items-center justify-center text-fg-quaternary">
            <ChevronDown className="size-3" aria-hidden />
          </S.ScrollDownButton>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

function Item<T extends string>({ option }: { option: SelectOption<T> }) {
  return (
    <S.Item
      value={option.value}
      disabled={option.disabled}
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2.5 rounded-[5px] px-2 py-[7px] pe-7 text-sm text-fg outline-none",
        "transition-colors duration-[var(--dur-fast)]",
        "data-[highlighted]:bg-hover",
        "data-[state=checked]:font-medium",
        "data-[disabled]:pointer-events-none data-[disabled]:text-disabled-fg",
        "[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-fg-tertiary",
      )}
    >
      {option.icon}
      <span className="min-w-0 flex-1">
        <S.ItemText>
          <span className="block truncate">{option.label}</span>
        </S.ItemText>
        {option.description ? (
          <span className="mt-0.5 block truncate text-2xs text-fg-quaternary">
            {option.description}
          </span>
        ) : null}
      </span>
      {option.meta ? (
        <span className="shrink-0 text-2xs text-fg-quaternary">
          {option.meta}
        </span>
      ) : null}
      <S.ItemIndicator className="absolute end-2 flex items-center">
        <Check className="size-3.5 text-accent" aria-hidden />
      </S.ItemIndicator>
    </S.Item>
  );
}

/* ============================================================================
   NativeSelect — for dense table cells and mobile-first surfaces where the OS
   picker is genuinely better than a custom listbox.
   ========================================================================== */

export interface NativeSelectProps
  extends Omit<React.ComponentPropsWithoutRef<"select">, "size"> {
  size?: InputSize;
  status?: InputStatus;
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}

export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  NativeSelectProps
>(function NativeSelect(
  { size = "md", status, options, placeholder, className, ...props },
  ref,
) {
  const field = useFieldContext();
  const resolvedStatus =
    status ?? (field?.status === "default" ? undefined : field?.status);

  return (
    <div className={cn(inputShell({ size, status: resolvedStatus }), "pe-0")}>
      <select
        ref={ref}
        id={field?.id}
        className={cn(
          "min-w-0 flex-1 cursor-pointer appearance-none border-0 bg-transparent py-0 pe-7 ps-0 text-inherit outline-none",
          "disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute end-2.5 size-3.5 text-fg-quaternary"
        aria-hidden
      />
    </div>
  );
});
