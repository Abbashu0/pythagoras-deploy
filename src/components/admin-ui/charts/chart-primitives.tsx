"use client";

import * as React from "react";
import { ResponsiveContainer, type TooltipContentProps } from "recharts";
import { AlertTriangle, BarChart3, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "../primitives/button";
import { Panel, PanelHeader } from "../primitives/surface";
import { SkeletonChart } from "../primitives/skeleton";
import { SegmentedControl } from "../forms/segmented";
import { InfoTip } from "../primitives/tooltip";
import { Badge } from "../status/status-badge";
import { formatCompact, formatNumber } from "@/lib/format";

/* ============================================================================
   Chart foundations
   ---------------------------------------------------------------------------
   Charts here are part of the design system, not library output dropped into a
   card. Everything below enforces that:

   - Colour comes from the visualisation palette (--chart-1…8) or a semantic
     token. No component ever picks a hex.
   - Series colours are assigned by *meaning* where meaning exists (success/
     failure, cost, latency) and by index only for genuinely arbitrary
     categories. No rainbows.
   - Every chart plots left-to-right, including in Arabic: `.pyth-chart` sets
     `direction: ltr` on the plot area while headers, legends and tooltips stay
     in the RTL flow. A reversed time axis is a misreading hazard, not
     localisation.
   - Grids are horizontal-only, hairline, and drawn in --chart-grid. Vertical
     grid lines add noise without adding information for time series.
   - Axes are unlabelled where the header already says what the value is.
   - Loading, empty and error are first-class and share the chart's exact
     geometry so the layout never jumps.
   ========================================================================== */

export interface ChartSeries {
  /** Data key in the row objects. */
  key: string;
  /** Arabic label used in legends and tooltips. */
  label: string;
  /** Explicit colour token override. */
  color?: string;
  /** Semantic role — preferred over an index colour when it applies. */
  role?: ChartRole;
  /** Formatter for values of this series. */
  format?: (value: number) => string;
  /** Render this series as a dashed line (comparison / previous period). */
  dashed?: boolean;
  /** Hide from the legend but keep in the tooltip. */
  hideInLegend?: boolean;
  /** Stack id for stacked charts. */
  stackId?: string;
  unit?: string;
}

export type ChartRole =
  | "positive"
  | "negative"
  | "warning"
  | "neutral"
  | "comparison"
  | "accent";

const ROLE_VAR: Record<ChartRole, string> = {
  positive: "var(--chart-positive)",
  negative: "var(--chart-negative)",
  warning: "var(--chart-warning)",
  neutral: "var(--chart-neutral)",
  comparison: "var(--chart-comparison)",
  accent: "var(--chart-1)",
};

export const CHART_SERIES_VARS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
] as const;

/** Resolves the stroke/fill for a series. Meaning beats position. */
export function seriesColor(series: ChartSeries, index: number): string {
  if (series.color) return series.color;
  if (series.role) return ROLE_VAR[series.role];
  return CHART_SERIES_VARS[index % CHART_SERIES_VARS.length];
}

export function roleColor(role: ChartRole): string {
  return ROLE_VAR[role];
}

/* ---------------------------------------------------------------------------
   Shared axis / grid configuration so every cartesian chart matches.
   ------------------------------------------------------------------------ */

export const axisDefaults = {
  stroke: "var(--chart-axis)",
  tick: { fill: "var(--chart-axis)", fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

export const gridDefaults = {
  stroke: "var(--chart-grid)",
  strokeDasharray: "0",
  vertical: false,
} as const;

/* ============================================================================
   ChartContainer
   ========================================================================== */

export interface ChartContainerProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Small caps label above the title. */
  eyebrow?: React.ReactNode;
  /** Nuance that belongs in a tooltip, not the description. */
  hint?: React.ReactNode;
  /** Headline value shown next to the title — the chart's summary. */
  value?: React.ReactNode;
  /** Delta / comparison next to the value. */
  trend?: React.ReactNode;
  /** Range selector, density toggle, export. */
  actions?: React.ReactNode;
  /** Legend node. Rendered under the header by default. */
  legend?: React.ReactNode;
  legendPosition?: "top" | "bottom";
  /** Fixed plot height in px. Charts are height-driven, not aspect-driven. */
  height?: number;
  loading?: boolean;
  error?: { message?: string } | null;
  onRetry?: () => void;
  /** Explicitly empty (no rows in range) — distinct from loading. */
  empty?: boolean;
  emptyState?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  /** Render without the Panel chrome, for charts already inside one. */
  bare?: boolean;
  /** Disable Recharts' measurement wrapper for native SVG visualisations. */
  responsive?: boolean;
  /** Footnote under the plot — sampling notes, exclusions. */
  footnote?: React.ReactNode;
}

export function ChartContainer({
  title,
  description,
  eyebrow,
  hint,
  value,
  trend,
  actions,
  legend,
  legendPosition = "bottom",
  height = 220,
  loading = false,
  error = null,
  onRetry,
  empty = false,
  emptyState,
  children,
  className,
  bare = false,
  responsive = true,
  footnote,
}: ChartContainerProps) {
  const body = (
    <>
      {legend && legendPosition === "top" ? (
        <div className="mb-3">{legend}</div>
      ) : null}

      <div style={{ height }} className="relative w-full">
        {loading ? (
          <ChartLoadingState height={height} />
        ) : error ? (
          <ChartErrorState message={error.message} onRetry={onRetry} />
        ) : empty ? (
          (emptyState ?? <ChartEmptyState />)
        ) : (
          <div className="pyth-chart size-full">
            {responsive ? (
              <ResponsiveContainer width="100%" height="100%">
                {children as React.ReactElement}
              </ResponsiveContainer>
            ) : (
              children
            )}
          </div>
        )}
      </div>

      {legend && legendPosition === "bottom" && !loading && !error && !empty ? (
        <div className="mt-3">{legend}</div>
      ) : null}

      {footnote ? (
        <p className="mt-2.5 text-2xs leading-relaxed text-fg-quaternary">
          {footnote}
        </p>
      ) : null}
    </>
  );

  if (bare) {
    return <div className={cn("min-w-0", className)}>{body}</div>;
  }

  return (
    <Panel className={cn("min-w-0", className)}>
      {title || actions || value ? (
        <ChartHeader
          title={title}
          description={description}
          eyebrow={eyebrow}
          hint={hint}
          value={value}
          trend={trend}
          actions={actions}
        />
      ) : null}
      <div className="p-4">{body}</div>
    </Panel>
  );
}

/* ---------------------------------------------------------------------------
   ChartHeader
   ------------------------------------------------------------------------ */

export function ChartHeader({
  title,
  description,
  eyebrow,
  hint,
  value,
  trend,
  actions,
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  hint?: React.ReactNode;
  value?: React.ReactNode;
  trend?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <PanelHeader
      bordered={false}
      density="compact"
      className={cn("items-start pb-1", className)}
      actions={actions}
      eyebrow={eyebrow}
      title={
        title ? (
          <span className="inline-flex items-baseline gap-1.5">
            {title}
            {hint ? <InfoTip content={hint} /> : null}
          </span>
        ) : undefined
      }
      description={description}
    >
      {value != null ? (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-2.5">
          <span className="text-2xl font-semibold tracking-tighter text-fg tnum">
            {value}
          </span>
          {trend}
        </div>
      ) : null}
    </PanelHeader>
  );
}

/* ---------------------------------------------------------------------------
   ChartLegend — interactive by default: clicking a series isolates it, which is
   the fastest way to read a busy multi-series chart.
   ------------------------------------------------------------------------ */

export function ChartLegend({
  series,
  hidden = [],
  onToggle,
  className,
  align = "start",
  /** Show each series' latest / total value beside its label. */
  values,
  compact = false,
}: {
  series: ChartSeries[];
  hidden?: string[];
  onToggle?: (key: string) => void;
  className?: string;
  align?: "start" | "center" | "end";
  values?: Record<string, number>;
  compact?: boolean;
}) {
  const visible = series.filter((s) => !s.hideInLegend);

  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5",
        align === "center" && "justify-center",
        align === "end" && "justify-end",
        className,
      )}
    >
      {visible.map((s, i) => {
        const color = seriesColor(s, series.indexOf(s));
        const isHidden = hidden.includes(s.key);
        const content = (
          <>
            <span
              aria-hidden
              className={cn(
                "shrink-0 rounded-[2px]",
                compact ? "size-2" : "size-2.5",
                s.dashed && "border border-dashed bg-transparent",
              )}
              style={
                s.dashed
                  ? { borderColor: color }
                  : { backgroundColor: color }
              }
            />
            <span
              className={cn(
                "truncate",
                isHidden ? "text-fg-quaternary line-through" : "text-fg-secondary",
              )}
            >
              {s.label}
            </span>
            {values?.[s.key] != null ? (
              <span className="shrink-0 font-medium text-fg tnum">
                {s.format
                  ? s.format(values[s.key])
                  : formatCompact(values[s.key])}
              </span>
            ) : null}
          </>
        );

        return (
          <li key={s.key} className="min-w-0">
            {onToggle ? (
              <button
                type="button"
                onClick={() => onToggle(s.key)}
                aria-pressed={!isHidden}
                className={cn(
                  "-mx-1 flex min-w-0 items-center gap-1.5 rounded-[4px] px-1 py-0.5 text-xs",
                  "transition-colors hover:bg-hover",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
                )}
              >
                {content}
              </button>
            ) : (
              <span className="flex min-w-0 items-center gap-1.5 text-xs">
                {content}
              </span>
            )}
            {i < 0 ? null : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Legend for categorical charts where each *datum* has its own colour. */
export function CategoryLegend({
  items,
  className,
  columns = 1,
}: {
  items: { label: string; color: string; value?: React.ReactNode }[];
  className?: string;
  columns?: 1 | 2;
}) {
  return (
    <ul
      className={cn(
        "grid gap-x-4 gap-y-1.5",
        columns === 2 ? "grid-cols-2" : "grid-cols-1",
        className,
      )}
    >
      {items.map((item) => (
        <li
          key={item.label}
          className="flex min-w-0 items-center justify-between gap-3 text-xs"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: item.color }}
            />
            <span className="truncate text-fg-secondary">{item.label}</span>
          </span>
          {item.value != null ? (
            <span className="shrink-0 font-medium text-fg tnum">
              {item.value}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------------------
   ChartTooltip — one tooltip for every chart type in the system.
   Rendered RTL even though the plot is LTR, because it contains prose.
   ------------------------------------------------------------------------ */

export interface ChartTooltipOptions {
  series?: ChartSeries[];
  /** Formats the axis label (usually a date). */
  labelFormatter?: (label: string | number) => React.ReactNode;
  /** Default value formatter when a series does not define one. */
  valueFormatter?: (value: number, key: string) => React.ReactNode;
  /** Show the sum of all series in the hovered bucket. */
  showTotal?: boolean;
  totalLabel?: string;
  /** Hide series whose value is 0 — keeps stacked tooltips readable. */
  hideZero?: boolean;
}

export function makeChartTooltip(options: ChartTooltipOptions = {}) {
  const {
    series = [],
    labelFormatter,
    valueFormatter,
    showTotal = false,
    totalLabel = "المجموع",
    hideZero = false,
  } = options;

  const byKey = new Map(series.map((s) => [s.key, s]));

  // Recharts' default generics (`ValueType`, `NameType`) keep this assignable
  // to `Tooltip.content` without a cast; values are coerced with Number().
  return function TooltipContent(props: TooltipContentProps) {
    const { active, payload, label } = props;
    if (!active || !payload?.length) return null;

    const rows = payload.filter((p) => {
      if (!hideZero) return true;
      return Number(p.value) !== 0;
    });
    if (rows.length === 0) return null;

    const total = rows.reduce((sum, p) => sum + (Number(p.value) || 0), 0);

    return (
      <div
        dir="rtl"
        className="min-w-40 max-w-64 rounded-lg border border-border bg-elevated px-2.5 py-2 shadow-lg"
      >
        {label != null ? (
          <p className="mb-1.5 border-b border-border-subtle pb-1.5 text-2xs font-medium text-fg-secondary">
            {labelFormatter ? labelFormatter(label) : String(label)}
          </p>
        ) : null}
        <ul className="space-y-1">
          {rows.map((p) => {
            const key = String(p.dataKey ?? p.name ?? "");
            const s = byKey.get(key);
            const value = Number(p.value) || 0;
            return (
              <li
                key={key}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: p.color ?? "var(--chart-1)" }}
                  />
                  <span className="truncate text-fg-tertiary">
                    {s?.label ?? p.name ?? key}
                  </span>
                </span>
                <span className="shrink-0 font-medium text-fg tnum">
                  {s?.format
                    ? s.format(value)
                    : valueFormatter
                      ? valueFormatter(value, key)
                      : formatNumber(value)}
                  {s?.unit ? (
                    <span className="ms-0.5 text-2xs font-normal text-fg-quaternary">
                      {s.unit}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
        {showTotal && rows.length > 1 ? (
          <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-border-subtle pt-1.5 text-xs">
            <span className="text-fg-tertiary">{totalLabel}</span>
            <span className="font-semibold text-fg tnum">
              {valueFormatter
                ? valueFormatter(total, "__total")
                : formatNumber(total)}
            </span>
          </div>
        ) : null}
      </div>
    );
  };
}

/* ---------------------------------------------------------------------------
   States
   ------------------------------------------------------------------------ */

export function ChartLoadingState({ height = 200 }: { height?: number }) {
  return (
    <div className="flex size-full items-end" aria-busy>
      <SkeletonChart height={height - 24} className="w-full" />
    </div>
  );
}

export function ChartEmptyState({
  message = "لا توجد بيانات في هذه الفترة",
  hint,
  action,
  className,
}: {
  message?: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex size-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-inset/40 px-4 text-center",
        className,
      )}
    >
      <BarChart3 className="size-5 text-fg-quaternary" aria-hidden />
      <p className="text-xs text-fg-tertiary">{message}</p>
      {hint ? <p className="text-2xs text-fg-quaternary">{hint}</p> : null}
      {action}
    </div>
  );
}

export function ChartErrorState({
  message = "تعذّر تحميل هذا المخطط.",
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex size-full flex-col items-center justify-center gap-2.5 rounded-md border border-danger-border bg-danger-subtle px-4 text-center",
        className,
      )}
      role="alert"
    >
      <AlertTriangle className="size-5 text-danger-text" aria-hidden />
      <p className="text-xs text-danger-text">{message}</p>
      {onRetry ? (
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw aria-hidden />}
          onClick={onRetry}
        >
          إعادة المحاولة
        </Button>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   ChartRangeSelector
   ------------------------------------------------------------------------ */

export type ChartRange = "24h" | "7d" | "30d" | "90d" | "12m" | "custom";

export const CHART_RANGE_LABELS: Record<ChartRange, string> = {
  "24h": "٢٤ ساعة",
  "7d": "٧ أيام",
  "30d": "٣٠ يومًا",
  "90d": "٩٠ يومًا",
  "12m": "١٢ شهرًا",
  custom: "مخصّص",
};

export function ChartRangeSelector({
  value,
  onValueChange,
  ranges = ["24h", "7d", "30d", "90d"],
  size = "sm",
  className,
}: {
  value: ChartRange;
  onValueChange: (value: ChartRange) => void;
  ranges?: ChartRange[];
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <SegmentedControl
      size={size}
      aria-label="الفترة الزمنية"
      value={value}
      onValueChange={onValueChange}
      className={className}
      options={ranges.map((r) => ({
        value: r,
        label: CHART_RANGE_LABELS[r],
      }))}
    />
  );
}

/* ---------------------------------------------------------------------------
   Helpers used across chart components
   ------------------------------------------------------------------------ */

/** Toggle-visibility state for a legend-driven chart. */
export function useSeriesVisibility(series: ChartSeries[]) {
  const [hidden, setHidden] = React.useState<string[]>([]);
  const toggle = React.useCallback(
    (key: string) =>
      setHidden((prev) => {
        const next = prev.includes(key)
          ? prev.filter((k) => k !== key)
          : [...prev, key];
        // Never allow hiding every series — an empty chart reads as broken.
        return next.length === series.length ? prev : next;
      }),
    [series.length],
  );
  const visibleSeries = React.useMemo(
    () => series.filter((s) => !hidden.includes(s.key)),
    [series, hidden],
  );
  return { hidden, toggle, visibleSeries };
}

/** Compact axis tick formatter shared by every numeric axis. */
export function compactTick(value: number): string {
  return formatCompact(value, 1);
}

/** Deduplicated, evenly spaced tick indices for dense time axes. */
export function sparseTicks<T>(data: T[], max = 6): number[] {
  if (data.length <= max) return data.map((_, i) => i);
  const step = Math.ceil(data.length / max);
  const out: number[] = [];
  for (let i = 0; i < data.length; i += step) out.push(i);
  if (out[out.length - 1] !== data.length - 1) out.push(data.length - 1);
  return out;
}

/** Marks a chart as sampled / partial, so operators do not over-read it. */
export function ChartQualifier({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warning";
}) {
  return (
    <Badge size="sm" variant="inset" tone={tone}>
      {children}
    </Badge>
  );
}
