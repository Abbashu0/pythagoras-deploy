"use client";

import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useResetOn } from "@/lib/hooks";
import { formatDate, formatDateRange } from "@/lib/format";
import { Button, IconButton } from "../primitives/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "../overlays/popover";
import { Separator } from "../primitives/separator";
import { inputShell, rawInput, type InputSize, type InputStatus } from "./input";
import { useFieldContext } from "./field";

/* ============================================================================
   Calendar / DatePicker / DateRangePicker / TimeInput
   ---------------------------------------------------------------------------
   Written by hand rather than pulled from a date library, for three reasons:
   1. RTL grids: the weekday columns must run right-to-left while the *dates*
      still increase left-to-right within a week. Most libraries get one of
      those two wrong.
   2. Arabic month/weekday names come from Intl, so no locale bundle is needed.
   3. Analytics ranges need presets far more than they need free navigation, and
      presets are the primary affordance here.

   Week starts on Saturday, which is the Iraqi convention.
   ========================================================================== */

const WEEK_START = 6; // Saturday

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function addMonths(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const monthFmt = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {
  month: "long",
  year: "numeric",
});
const weekdayFmt = new Intl.DateTimeFormat("ar-IQ", { weekday: "narrow" });

function buildMonth(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const offset = (first.getDay() - WEEK_START + 7) % 7;
  const gridStart = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

const weekdayLabels = Array.from({ length: 7 }, (_, i) =>
  weekdayFmt.format(new Date(2024, 0, 6 + ((i + WEEK_START) % 7))),
);

/* ---------------------------------------------------------------------------
   Calendar
   ------------------------------------------------------------------------ */

export interface CalendarProps {
  /** Single selected day. */
  selected?: Date | null;
  /** Range selection: [from, to]. */
  range?: [Date | null, Date | null];
  mode?: "single" | "range";
  onSelect?: (date: Date) => void;
  min?: Date;
  max?: Date;
  className?: string;
  /** Extra content under the grid — presets, apply buttons. */
  footer?: React.ReactNode;
  /** Highlight days that carry data (activity heat-style dots). */
  markedDays?: Date[];
}

export function Calendar({
  selected,
  range,
  mode = "single",
  onSelect,
  min,
  max,
  className,
  footer,
  markedDays,
}: CalendarProps) {
  const initialAnchor =
    selected ?? range?.[0] ?? new Date();
  const [anchor, setAnchor] = React.useState(
    new Date(initialAnchor.getFullYear(), initialAnchor.getMonth(), 1),
  );
  const days = React.useMemo(() => buildMonth(anchor), [anchor]);
  const today = React.useMemo(() => startOfDay(new Date()), []);
  const marked = React.useMemo(
    () => new Set((markedDays ?? []).map((d) => startOfDay(d).getTime())),
    [markedDays],
  );

  const [from, to] = range ?? [null, null];

  const inRange = (d: Date) =>
    mode === "range" &&
    from != null &&
    to != null &&
    d >= startOfDay(from) &&
    d <= startOfDay(to);

  const isEdge = (d: Date) =>
    (from != null && isSameDay(d, from)) || (to != null && isSameDay(d, to));

  const disabled = (d: Date) =>
    (min != null && d < startOfDay(min)) || (max != null && d > startOfDay(max));

  return (
    <div className={cn("w-[17.5rem] select-none", className)}>
      {/* Header: the chevron that means "previous" points toward the inline
          start, which is the right edge in Arabic. */}
      <div className="flex items-center justify-between px-1 pb-2">
        <IconButton
          label="الشهر السابق"
          size="sm"
          variant="ghost"
          onClick={() => setAnchor((a) => addMonths(a, -1))}
        >
          <ChevronRight className="rtl:rotate-0 ltr:rotate-180" aria-hidden />
        </IconButton>
        <span className="text-sm font-medium text-fg">
          {monthFmt.format(anchor)}
        </span>
        <IconButton
          label="الشهر التالي"
          size="sm"
          variant="ghost"
          onClick={() => setAnchor((a) => addMonths(a, 1))}
        >
          <ChevronLeft className="rtl:rotate-0 ltr:rotate-180" aria-hidden />
        </IconButton>
      </div>

      <div className="grid grid-cols-7 gap-px">
        {weekdayLabels.map((w, i) => (
          <div
            key={`${w}-${i}`}
            className="flex h-7 items-center justify-center text-2xs font-medium text-fg-quaternary"
          >
            {w}
          </div>
        ))}

        {days.map((d) => {
          const outside = d.getMonth() !== anchor.getMonth();
          const isSelected =
            mode === "single" ? selected != null && isSameDay(d, selected) : isEdge(d);
          const between = inRange(d) && !isEdge(d);
          const isToday = isSameDay(d, today);
          const off = disabled(d);

          return (
            <button
              key={d.toISOString()}
              type="button"
              disabled={off}
              aria-current={isToday ? "date" : undefined}
              aria-pressed={isSelected}
              onClick={() => onSelect?.(startOfDay(d))}
              className={cn(
                "relative flex h-8 items-center justify-center text-xs tnum",
                "transition-colors duration-[var(--dur-fast)]",
                "focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
                "disabled:pointer-events-none disabled:text-disabled-fg",
                outside ? "text-fg-quaternary" : "text-fg-secondary",
                !isSelected && !between && "rounded-md hover:bg-hover",
                between && "bg-accent-subtle text-accent-text",
                isSelected && "rounded-md bg-accent font-semibold text-on-accent",
                isToday && !isSelected && "font-semibold text-accent-text",
              )}
            >
              {d.getDate()}
              {marked.has(startOfDay(d).getTime()) && !isSelected ? (
                <span
                  aria-hidden
                  className="absolute bottom-1 size-1 rounded-full bg-accent"
                />
              ) : null}
              {isToday && !isSelected ? (
                <span
                  aria-hidden
                  className="absolute bottom-1 size-1 rounded-full bg-current opacity-70"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {footer ? (
        <>
          <Separator className="my-2" />
          {footer}
        </>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   DatePicker
   ------------------------------------------------------------------------ */

export interface DatePickerProps {
  value?: Date | null;
  onValueChange?: (value: Date | null) => void;
  placeholder?: string;
  size?: InputSize;
  status?: InputStatus;
  disabled?: boolean;
  min?: Date;
  max?: Date;
  clearable?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

export function DatePicker({
  value,
  onValueChange,
  placeholder = "اختر تاريخًا",
  size = "md",
  status,
  disabled,
  min,
  max,
  clearable = true,
  className,
  id,
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const field = useFieldContext();
  const resolvedStatus =
    status ?? (field?.status === "default" ? undefined : field?.status);
  const canClear = clearable && value != null && !disabled;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          data-state={open ? "open" : "closed"}
          className={cn(
            inputShell({ size, status: resolvedStatus }),
            "cursor-pointer",
            "data-[state=open]:border-accent data-[state=open]:shadow-[0_0_0_3px_var(--accent-subtle)]",
            disabled && "cursor-not-allowed",
            className,
          )}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              id={id ?? field?.id}
              disabled={disabled}
              aria-label={ariaLabel}
              className="inline-flex min-w-0 flex-1 items-center appearance-none border-0 bg-transparent p-0 text-start text-inherit outline-none focus-visible:outline-none"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <CalendarDays
                  className="size-3.5 shrink-0 text-fg-tertiary"
                  aria-hidden
                />
                <span className={cn("truncate", !value && "text-fg-quaternary")}>
                  {value ? formatDate(value) : placeholder}
                </span>
              </span>
            </button>
          </PopoverTrigger>
          {canClear ? (
            <IconButton
              label="مسح التاريخ"
              size="xs"
              variant="ghost"
              tabIndex={-1}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onValueChange?.(null);
              }}
            >
              <X aria-hidden />
            </IconButton>
          ) : null}
        </div>
      </PopoverAnchor>
      <PopoverContent padding="sm" align="start">
        <Calendar
          mode="single"
          selected={value ?? null}
          min={min}
          max={max}
          onSelect={(d) => {
            onValueChange?.(d);
            setOpen(false);
          }}
          footer={
            <div className="flex justify-between">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onValueChange?.(startOfDay(new Date()));
                  setOpen(false);
                }}
              >
                اليوم
              </Button>
              {value ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onValueChange?.(null);
                    setOpen(false);
                  }}
                >
                  مسح
                </Button>
              ) : null}
            </div>
          }
        />
      </PopoverContent>
    </Popover>
  );
}

/* ---------------------------------------------------------------------------
   DateRangePicker
   ------------------------------------------------------------------------ */

export interface DateRangePreset {
  key: string;
  label: string;
  resolve: () => [Date, Date];
}

export const DEFAULT_RANGE_PRESETS: DateRangePreset[] = [
  {
    key: "today",
    label: "اليوم",
    resolve: () => [startOfDay(new Date()), startOfDay(new Date())],
  },
  {
    key: "7d",
    label: "آخر ٧ أيام",
    resolve: () => [startOfDay(addDays(new Date(), -6)), startOfDay(new Date())],
  },
  {
    key: "30d",
    label: "آخر ٣٠ يومًا",
    resolve: () => [startOfDay(addDays(new Date(), -29)), startOfDay(new Date())],
  },
  {
    key: "90d",
    label: "آخر ٩٠ يومًا",
    resolve: () => [startOfDay(addDays(new Date(), -89)), startOfDay(new Date())],
  },
  {
    key: "mtd",
    label: "هذا الشهر",
    resolve: () => {
      const now = new Date();
      return [new Date(now.getFullYear(), now.getMonth(), 1), startOfDay(now)];
    },
  },
  {
    key: "prevMonth",
    label: "الشهر الماضي",
    resolve: () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return [first, startOfDay(last)];
    },
  },
];

export interface DateRangePickerProps {
  value?: [Date, Date] | null;
  onValueChange?: (value: [Date, Date] | null) => void;
  presets?: DateRangePreset[];
  size?: InputSize;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  max?: Date;
  /** Compact trigger for toolbars. */
  appearance?: "field" | "button";
}

export function DateRangePicker({
  value,
  onValueChange,
  presets = DEFAULT_RANGE_PRESETS,
  size = "md",
  disabled,
  className,
  placeholder = "اختر مدى زمنيًا",
  max,
  appearance = "field",
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<[Date | null, Date | null]>(
    value ?? [null, null],
  );

  // Reopening the popover starts from the committed range, not a stale draft.
  useResetOn(open, () => {
    if (open) setDraft(value ?? [null, null]);
  });

  const pick = (d: Date) => {
    const [from, to] = draft;
    if (from == null || (from != null && to != null)) {
      setDraft([d, null]);
    } else if (d < from) {
      setDraft([d, from]);
    } else {
      setDraft([from, d]);
    }
  };

  const apply = () => {
    if (draft[0] && draft[1]) {
      onValueChange?.([draft[0], draft[1]]);
      setOpen(false);
    } else if (draft[0]) {
      onValueChange?.([draft[0], draft[0]]);
      setOpen(false);
    }
  };

  const label = value ? formatDateRange(value[0], value[1]) : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {appearance === "button" ? (
          <Button
            variant="secondary"
            size={size === "sm" ? "sm" : "md"}
            icon={<CalendarDays aria-hidden />}
            disabled={disabled}
            className={className}
          >
            {label}
          </Button>
        ) : (
          <button
            type="button"
            disabled={disabled}
            className={cn(
              inputShell({ size }),
              "cursor-pointer justify-between text-start",
              "data-[state=open]:border-accent data-[state=open]:shadow-[0_0_0_3px_var(--accent-subtle)]",
              className,
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <CalendarDays
                className="size-3.5 shrink-0 text-fg-tertiary"
                aria-hidden
              />
              <span className={cn("truncate", !value && "text-fg-quaternary")}>
                {label}
              </span>
            </span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent padding="none" align="start" className="flex">
        <div className="w-40 shrink-0 border-e border-border-subtle p-1.5">
          <p className="eyebrow px-2 pb-1 pt-1">فترات جاهزة</p>
          {presets.map((p) => {
            const [f, t] = p.resolve();
            const active =
              value != null && isSameDay(value[0], f) && isSameDay(value[1], t);
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  onValueChange?.([f, t]);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center rounded-[5px] px-2 py-1.5 text-start text-xs transition-colors",
                  active
                    ? "bg-selected font-medium text-accent-text"
                    : "text-fg-secondary hover:bg-hover",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="p-2.5">
          <Calendar
            mode="range"
            range={draft}
            max={max}
            onSelect={pick}
            footer={
              <div className="flex items-center justify-between gap-2">
                <span className="text-2xs text-fg-quaternary">
                  {draft[0] && draft[1]
                    ? formatDateRange(draft[0], draft[1])
                    : draft[0]
                      ? "اختر تاريخ النهاية"
                      : "اختر تاريخ البداية"}
                </span>
                <span className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                    إلغاء
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={apply}
                    disabled={!draft[0]}
                  >
                    تطبيق
                  </Button>
                </span>
              </div>
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ---------------------------------------------------------------------------
   TimeInput — 24h, LTR, minute-stepped.
   ------------------------------------------------------------------------ */

export function TimeInput({
  value,
  onValueChange,
  size = "md",
  status,
  disabled,
  step = 300,
  className,
}: {
  /** "HH:MM" */
  value?: string;
  onValueChange?: (value: string) => void;
  size?: InputSize;
  status?: InputStatus;
  disabled?: boolean;
  /** seconds */
  step?: number;
  className?: string;
}) {
  const field = useFieldContext();
  const resolvedStatus =
    status ?? (field?.status === "default" ? undefined : field?.status);

  return (
    <div className={cn(inputShell({ size, status: resolvedStatus }), className)}>
      <Clock className="size-3.5 shrink-0 text-fg-tertiary" aria-hidden />
      <input
        type="time"
        dir="ltr"
        step={step}
        value={value ?? ""}
        disabled={disabled}
        id={field?.id}
        onChange={(e) => onValueChange?.(e.target.value)}
        className={cn(rawInput, "ltr-island tnum")}
      />
    </div>
  );
}
