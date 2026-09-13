"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import { Panel } from "../primitives/surface";
import { Tooltip, InfoTip } from "../primitives/tooltip";
import { SkeletonMetric } from "../primitives/skeleton";
import { StatusBadge, StatusDot } from "../status/status-badge";
import type { StatusKey, StatusTone } from "../status/status-registry";
import { toneClasses } from "../status/status-registry";
import { CircularProgress } from "../primitives/progress";
import { Sparkline, SparkBars, ProgressRing, type SparkPoint } from "./sparkline";
import { StackedShareBar } from "./matrix";

/* ============================================================================
   Metrics
   ---------------------------------------------------------------------------
   Eight distinct shapes, not one card with options. A dashboard that renders
   every number as an identical bordered rectangle communicates nothing about
   which numbers matter, so the *shape* carries the hierarchy:

     MetricRow          a dense row of primary numbers, no card chrome at all
     CompactMetric      a single number in a row — the default
     MetricWithTrend    number + period-over-period delta
     MetricWithSparkline number + shape over time
     MetricWithBreakdown number + composition bar
     CircularMetric     a ratio where "out of a whole" is the point
     ProgressMetric     progress toward a target or a budget
     StatusMetric       a state, not a number (Pi enabled, retrieval ready)
     ComparisonMetric   two periods or two candidates side by side

   Shared rules:
   - Label above value. Reading order in Arabic goes label → number.
   - Values use tabular figures and `tracking-tighter` so long numbers stay
     compact and columns of numbers align.
   - The delta's colour is semantic, and `inverted` flips it for metrics where
     down is good (cost, latency, failures). Green must never mean "went up".
   - No metric is ever a link-coloured card; if it navigates, the whole tile is
     a link with a quiet chevron.
   ========================================================================== */

export interface MetricDelta {
  /** Fractional change, e.g. 0.062 → +6.2%. */
  value: number;
  /** What it is compared against. */
  comparedTo?: string;
  /** Down is good — cost, latency, failure rate. */
  inverted?: boolean;
  /** Render as an absolute number instead of a percentage. */
  absolute?: boolean;
  formatAbsolute?: (value: number) => string;
}

/* ---------------------------------------------------------------------------
   Delta
   ------------------------------------------------------------------------ */

export function MetricTrend({
  delta,
  size = "sm",
  className,
  showComparison = true,
}: {
  delta: MetricDelta;
  size?: "xs" | "sm" | "md";
  className?: string;
  showComparison?: boolean;
}) {
  const flat = Math.abs(delta.value) < 0.0005;
  const up = delta.value > 0;
  const good = delta.inverted ? !up : up;
  const Icon = flat ? Minus : up ? ArrowUp : ArrowDown;

  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-medium tnum",
          size === "xs" && "text-2xs",
          size === "sm" && "text-xs",
          size === "md" && "text-sm",
          flat
            ? "text-fg-quaternary"
            : good
              ? "text-success-text"
              : "text-danger-text",
        )}
      >
        <Icon
          className={cn(size === "md" ? "size-3.5" : "size-3", "shrink-0")}
          aria-hidden
        />
        {delta.absolute
          ? (delta.formatAbsolute ?? ((v: number) => formatNumber(v)))(
              Math.abs(delta.value),
            )
          : formatPercent(Math.abs(delta.value), { decimals: 1 })}
      </span>
      {showComparison && delta.comparedTo ? (
        <span className="text-2xs text-fg-quaternary">{delta.comparedTo}</span>
      ) : null}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Shared metric frame
   ------------------------------------------------------------------------ */

interface MetricFrameProps {
  label: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  loading?: boolean;
  className?: string;
  children: React.ReactNode;
  /** Bordered tile vs. bare (inside a MetricRow). */
  variant?: "tile" | "bare" | "tonal";
  /** Trailing element in the label row — a status dot, a badge. */
  labelTrailing?: React.ReactNode;
  size?: "sm" | "md";
}

function MetricFrame({
  label,
  hint,
  href,
  onClick,
  loading,
  className,
  children,
  variant = "tile",
  labelTrailing,
  size = "md",
}: MetricFrameProps) {
  const interactive = Boolean(href || onClick);

  const inner = (
    <>
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "min-w-0 truncate text-fg-tertiary",
            size === "sm" ? "text-2xs" : "text-xs",
          )}
        >
          {label}
        </span>
        {hint ? <InfoTip content={hint} /> : null}
        {labelTrailing}
        {interactive ? (
          <ChevronLeft
            className="ms-auto size-3 shrink-0 text-fg-quaternary opacity-0 transition-opacity group-hover/metric:opacity-100 ltr:rotate-180"
            aria-hidden
          />
        ) : null}
      </div>
      {loading ? <SkeletonMetric className="mt-2" /> : children}
    </>
  );

  const base = cn(
    "group/metric min-w-0",
    variant === "tile" && "rounded-lg border border-border bg-surface p-3.5",
    variant === "tonal" && "rounded-lg bg-surface-secondary p-3.5",
    variant === "bare" && "",
    interactive &&
      variant !== "bare" &&
      "transition-colors hover:border-border-strong hover:bg-hover",
    interactive && variant === "bare" && "rounded-md transition-colors",
    className,
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          base,
          "block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
        )}
      >
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          base,
          "block w-full text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
        )}
      >
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
}

const VALUE_SIZE = {
  sm: "text-md",
  md: "text-2xl",
  lg: "text-3xl",
} as const;

function MetricValue({
  value,
  unit,
  size = "md",
  tone,
  className,
}: {
  value: React.ReactNode;
  unit?: React.ReactNode;
  size?: keyof typeof VALUE_SIZE;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 font-semibold tracking-tighter tnum",
        VALUE_SIZE[size],
        tone ? toneClasses[tone].text : "text-fg",
        className,
      )}
    >
      {value}
      {unit ? (
        <span className="text-xs font-normal text-fg-quaternary">{unit}</span>
      ) : null}
    </span>
  );
}

/* ============================================================================
   CompactMetric — the default. Label, value, optional single line of context.
   ========================================================================== */

export function CompactMetric({
  label,
  value,
  unit,
  hint,
  context,
  href,
  onClick,
  loading,
  variant = "tile",
  size = "md",
  tone,
  status,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  hint?: React.ReactNode;
  /** A single line of quiet supporting detail. */
  context?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  loading?: boolean;
  variant?: "tile" | "bare" | "tonal";
  size?: "sm" | "md";
  tone?: StatusTone;
  status?: StatusKey;
  className?: string;
}) {
  return (
    <MetricFrame
      label={label}
      hint={hint}
      href={href}
      onClick={onClick}
      loading={loading}
      variant={variant}
      className={className}
      size={size}
      labelTrailing={status ? <StatusDot status={status} size="sm" /> : undefined}
    >
      <div className="mt-1.5">
        <MetricValue
          value={value}
          unit={unit}
          size={size === "sm" ? "sm" : "md"}
          tone={tone}
        />
        {context ? (
          <p className="mt-1 truncate text-2xs text-fg-quaternary">{context}</p>
        ) : null}
      </div>
    </MetricFrame>
  );
}

/* ============================================================================
   MetricWithTrend
   ========================================================================== */

export function MetricWithTrend({
  label,
  value,
  unit,
  delta,
  hint,
  context,
  href,
  loading,
  variant = "tile",
  className,
  valueSize = "md",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  delta?: MetricDelta;
  hint?: React.ReactNode;
  context?: React.ReactNode;
  href?: string;
  loading?: boolean;
  variant?: "tile" | "bare" | "tonal";
  className?: string;
  valueSize?: "sm" | "md" | "lg";
}) {
  return (
    <MetricFrame
      label={label}
      hint={hint}
      href={href}
      loading={loading}
      variant={variant}
      className={className}
    >
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <MetricValue value={value} unit={unit} size={valueSize} />
        {delta ? <MetricTrend delta={delta} /> : null}
      </div>
      {context ? (
        <p className="mt-1 truncate text-2xs text-fg-quaternary">{context}</p>
      ) : null}
    </MetricFrame>
  );
}

/* ============================================================================
   MetricWithSparkline
   ========================================================================== */

export function MetricWithSparkline({
  label,
  value,
  unit,
  delta,
  data,
  hint,
  href,
  loading,
  variant = "tile",
  className,
  /** Bars for discrete counts, line for continuous rates. */
  shape = "line",
  sparklineHeight = 34,
  /** Axis-free context labels under the sparkline. */
  rangeLabel,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  delta?: MetricDelta;
  data: SparkPoint[];
  hint?: React.ReactNode;
  href?: string;
  loading?: boolean;
  variant?: "tile" | "bare" | "tonal";
  className?: string;
  shape?: "line" | "bars";
  sparklineHeight?: number;
  rangeLabel?: React.ReactNode;
}) {
  return (
    <MetricFrame
      label={label}
      hint={hint}
      href={href}
      loading={loading}
      variant={variant}
      className={className}
    >
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <MetricValue value={value} unit={unit} />
        {delta ? <MetricTrend delta={delta} showComparison={false} /> : null}
      </div>
      <div className="mt-2.5">
        {shape === "bars" ? (
          <SparkBars
            data={data}
            height={sparklineHeight}
            inverted={delta?.inverted}
            highlightLast
          />
        ) : (
          <Sparkline
            data={data}
            height={sparklineHeight}
            inverted={delta?.inverted}
          />
        )}
      </div>
      {rangeLabel ? (
        <p className="mt-1 text-2xs text-fg-quaternary">{rangeLabel}</p>
      ) : null}
    </MetricFrame>
  );
}

/* ============================================================================
   MetricWithBreakdown
   ========================================================================== */

export function MetricWithBreakdown({
  label,
  value,
  unit,
  delta,
  segments,
  hint,
  href,
  loading,
  variant = "tile",
  className,
  valueFormatter,
  showLegend = true,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  delta?: MetricDelta;
  segments: { key: string; label: string; value: number; color?: string }[];
  hint?: React.ReactNode;
  href?: string;
  loading?: boolean;
  variant?: "tile" | "bare" | "tonal";
  className?: string;
  valueFormatter?: (value: number) => string;
  showLegend?: boolean;
}) {
  return (
    <MetricFrame
      label={label}
      hint={hint}
      href={href}
      loading={loading}
      variant={variant}
      className={className}
    >
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <MetricValue value={value} unit={unit} />
        {delta ? <MetricTrend delta={delta} showComparison={false} /> : null}
      </div>
      <StackedShareBar
        className="mt-3"
        segments={segments}
        height={8}
        showLegend={showLegend}
        valueFormatter={valueFormatter ?? ((v) => formatCompact(v))}
      />
    </MetricFrame>
  );
}

/* ============================================================================
   CircularMetric
   ========================================================================== */

export function CircularMetric({
  label,
  value,
  max = 100,
  displayValue,
  hint,
  context,
  tone,
  thresholds,
  loading,
  variant = "tile",
  className,
  size = 56,
}: {
  label: React.ReactNode;
  value: number;
  max?: number;
  displayValue?: React.ReactNode;
  hint?: React.ReactNode;
  context?: React.ReactNode;
  tone?: StatusTone;
  /** Derives the tone when `tone` is not provided. */
  thresholds?: { warn: number; bad: number };
  loading?: boolean;
  variant?: "tile" | "bare" | "tonal";
  className?: string;
  size?: number;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const resolvedTone: StatusTone =
    tone ??
    (thresholds
      ? pct < thresholds.bad
        ? "danger"
        : pct < thresholds.warn
          ? "warning"
          : "success"
      : "accent");

  return (
    <MetricFrame
      label={label}
      hint={hint}
      loading={loading}
      variant={variant}
      className={className}
    >
      <div className="mt-2 flex items-center gap-3.5">
        <CircularProgress
          value={value}
          max={max}
          size={size}
          thickness={5}
          tone={resolvedTone}
          label={typeof label === "string" ? label : undefined}
        >
          <span className="text-2xs font-semibold text-fg tnum">
            {formatPercent(pct / 100, { decimals: 0 })}
          </span>
        </CircularProgress>
        <div className="min-w-0">
          <MetricValue
            value={displayValue ?? formatNumber(value)}
            size="sm"
            tone={resolvedTone}
          />
          {context ? (
            <p className="mt-0.5 text-2xs leading-snug text-fg-quaternary">
              {context}
            </p>
          ) : null}
        </div>
      </div>
    </MetricFrame>
  );
}

/* ============================================================================
   ProgressMetric — value against a target or an allowance.
   ========================================================================== */

export function ProgressMetric({
  label,
  value,
  max,
  valueLabel,
  maxLabel,
  hint,
  thresholds = { warning: 0.75, danger: 0.92 },
  note,
  loading,
  variant = "tile",
  className,
  href,
}: {
  label: React.ReactNode;
  value: number;
  max: number;
  valueLabel?: React.ReactNode;
  maxLabel?: React.ReactNode;
  hint?: React.ReactNode;
  thresholds?: { warning: number; danger: number };
  note?: React.ReactNode;
  loading?: boolean;
  variant?: "tile" | "bare" | "tonal";
  className?: string;
  href?: string;
}) {
  const ratio = max > 0 ? value / max : 0;
  const tone: StatusTone =
    ratio >= thresholds.danger
      ? "danger"
      : ratio >= thresholds.warning
        ? "warning"
        : "success";

  return (
    <MetricFrame
      label={label}
      hint={hint}
      loading={loading}
      variant={variant}
      className={className}
      href={href}
    >
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
        <MetricValue value={valueLabel ?? formatNumber(value)} tone={tone} />
        {maxLabel ? (
          <span className="text-xs text-fg-quaternary tnum">
            / {maxLabel}
          </span>
        ) : null}
      </div>
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-chart-track">
        <div
          className={cn("h-full rounded-full", toneClasses[tone].solid)}
          style={{
            width: `${Math.min(100, Math.max(0, ratio * 100))}%`,
            transition: "width 400ms var(--ease-in-out)",
          }}
        />
      </div>
      <p
        className={cn(
          "mt-1.5 text-2xs",
          tone === "success" ? "text-fg-quaternary" : toneClasses[tone].text,
        )}
      >
        {note ?? `${formatPercent(ratio, { decimals: 0 })} مُستهلك`}
      </p>
    </MetricFrame>
  );
}

/* ============================================================================
   StatusMetric — a state rather than a number. Pi enabled / retrieval ready /
   provider connected. Its job is to make "is this OK?" answerable at a glance.
   ========================================================================== */

export function StatusMetric({
  label,
  status,
  statusLabel,
  detail,
  hint,
  href,
  loading,
  variant = "tile",
  className,
  action,
}: {
  label: React.ReactNode;
  status: StatusKey;
  statusLabel?: React.ReactNode;
  detail?: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
  loading?: boolean;
  variant?: "tile" | "bare" | "tonal";
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <MetricFrame
      label={label}
      hint={hint}
      href={href}
      loading={loading}
      variant={variant}
      className={className}
    >
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <StatusBadge status={status} label={statusLabel} appearance="subtle" />
        {action}
      </div>
      {detail ? (
        <p className="mt-1.5 text-2xs leading-snug text-fg-quaternary">
          {detail}
        </p>
      ) : null}
    </MetricFrame>
  );
}

/* ============================================================================
   ComparisonMetric — two values side by side (this period vs last, candidate
   vs baseline). Used heavily by evals and analytics.
   ========================================================================== */

export function ComparisonMetric({
  label,
  primary,
  secondary,
  hint,
  inverted = false,
  loading,
  variant = "tile",
  className,
  format = (v) => formatNumber(v),
}: {
  label: React.ReactNode;
  primary: { label: string; value: number };
  secondary: { label: string; value: number };
  hint?: React.ReactNode;
  inverted?: boolean;
  loading?: boolean;
  variant?: "tile" | "bare" | "tonal";
  className?: string;
  format?: (value: number) => string;
}) {
  const diff = primary.value - secondary.value;
  const ratio = secondary.value !== 0 ? diff / Math.abs(secondary.value) : 0;
  const better = inverted ? diff < 0 : diff > 0;
  const same = Math.abs(diff) < 1e-9;

  return (
    <MetricFrame
      label={label}
      hint={hint}
      loading={loading}
      variant={variant}
      className={className}
    >
      <div className="mt-2 flex items-end gap-4">
        <div className="min-w-0">
          <MetricValue
            value={format(primary.value)}
            size="md"
            tone={same ? undefined : better ? "success" : "danger"}
          />
          <p className="mt-0.5 truncate text-2xs text-fg-quaternary">
            {primary.label}
          </p>
        </div>
        <div className="min-w-0 pb-0.5">
          <span className="block text-md font-medium text-fg-tertiary tnum">
            {format(secondary.value)}
          </span>
          <p className="mt-0.5 truncate text-2xs text-fg-quaternary">
            {secondary.label}
          </p>
        </div>
      </div>
      {!same ? (
        <div className="mt-2 border-t border-border-subtle pt-2">
          <MetricTrend
            delta={{ value: ratio, inverted }}
            size="xs"
            showComparison={false}
          />
        </div>
      ) : null}
    </MetricFrame>
  );
}

/* ============================================================================
   MetricRow — the dashboard's primary numbers, with no card chrome. Separated
   by hairlines, which is far quieter than five bordered boxes and lets the eye
   scan across rather than jumping between containers.
   ========================================================================== */

export function MetricRow({
  children,
  columns,
  className,
  bordered = true,
}: {
  children: React.ReactNode;
  /** Defaults to the child count, capped at 6. */
  columns?: 2 | 3 | 4 | 5 | 6;
  className?: string;
  bordered?: boolean;
}) {
  const count = React.Children.count(children);
  const cols = columns ?? (Math.min(count, 6) as 2 | 3 | 4 | 5 | 6);

  return (
    <Panel
      variant={bordered ? "outlined" : "ghost"}
      padding="none"
      className={cn("min-w-0 overflow-hidden", className)}
    >
      <div
        className={cn(
          "grid divide-border-subtle",
          "divide-y sm:divide-y-0 sm:divide-x sm:rtl:divide-x-reverse",
          cols === 2 && "sm:grid-cols-2",
          cols === 3 && "sm:grid-cols-2 lg:grid-cols-3",
          cols === 4 && "sm:grid-cols-2 lg:grid-cols-4",
          cols === 5 && "sm:grid-cols-3 xl:grid-cols-5",
          cols === 6 && "sm:grid-cols-3 xl:grid-cols-6",
        )}
      >
        {React.Children.map(children, (child, i) => (
          <div key={i} className="min-w-0 p-4">
            {child}
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ============================================================================
   MetricListItem — a metric inside a list or an inspector panel: label and
   value on one line, with an optional ring or sparkline.
   ========================================================================== */

export function MetricListItem({
  label,
  value,
  delta,
  ring,
  spark,
  status,
  hint,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: MetricDelta;
  /** 0–100 progress ring. */
  ring?: number;
  spark?: SparkPoint[];
  status?: StatusKey;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border-subtle py-2.5 last:border-b-0",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {status ? <StatusDot status={status} size="sm" /> : null}
        {ring != null ? <ProgressRing value={ring} size={18} /> : null}
        <span className="min-w-0 truncate text-xs text-fg-secondary">{label}</span>
        {hint ? <InfoTip content={hint} /> : null}
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        {spark ? (
          <Sparkline data={spark} height={18} width={52} inverted={delta?.inverted} />
        ) : null}
        <span className="text-sm font-medium text-fg tnum">{value}</span>
        {delta ? (
          <MetricTrend delta={delta} size="xs" showComparison={false} />
        ) : null}
      </span>
    </div>
  );
}

/* ============================================================================
   BigNumber — for a single hero figure on an analytics page. Used sparingly,
   and never with a coloured background.
   ========================================================================== */

export function BigNumber({
  label,
  value,
  unit,
  delta,
  context,
  className,
  align = "start",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  delta?: MetricDelta;
  context?: React.ReactNode;
  className?: string;
  align?: "start" | "center";
}) {
  return (
    <div
      className={cn(
        "min-w-0",
        align === "center" && "text-center",
        className,
      )}
    >
      <p className="text-xs text-fg-tertiary">{label}</p>
      <div
        className={cn(
          "mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1",
          align === "center" && "justify-center",
        )}
      >
        <MetricValue value={value} unit={unit} size="lg" />
        {delta ? <MetricTrend delta={delta} size="md" /> : null}
      </div>
      {context ? (
        <p className="mt-2 text-xs leading-relaxed text-fg-quaternary">
          {context}
        </p>
      ) : null}
    </div>
  );
}

/** Small stat used inside table footers and drawer headers. */
export function InlineStat({
  label,
  value,
  tone,
  className,
  tooltip,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: StatusTone;
  className?: string;
  tooltip?: React.ReactNode;
}) {
  const body = (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      <span className="text-2xs text-fg-quaternary">{label}</span>
      <span
        className={cn(
          "text-xs font-medium tnum",
          tone ? toneClasses[tone].text : "text-fg",
        )}
      >
        {value}
      </span>
    </span>
  );
  return tooltip ? <Tooltip content={tooltip}>{body}</Tooltip> : body;
}
