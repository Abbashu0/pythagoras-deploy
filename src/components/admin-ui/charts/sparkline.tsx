"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/cn";
import { formatNumber, formatPercent } from "@/lib/format";
import { roleColor, type ChartRole } from "./chart-primitives";

/* ============================================================================
   Micro-visualisations
   ---------------------------------------------------------------------------
   These live *inside* other components — metric tiles, table cells, list rows.
   Rules that follow from that:
   - No axes, no grid, no tooltip. A sparkline shows shape, not values; the
     number next to it carries the value.
   - No animation on mount: a table of forty sparklines animating is a mess.
   - Fixed height, fluid width, so they never affect row geometry.
   ========================================================================== */

export interface SparkPoint {
  value: number;
  [key: string]: number;
}

/** Derives the tone from the first→last direction of the series. */
function autoRole(data: SparkPoint[], inverted: boolean): ChartRole {
  if (data.length < 2) return "neutral";
  const first = data[0].value;
  const last = data[data.length - 1].value;
  if (Math.abs(last - first) < Math.abs(first) * 0.01) return "neutral";
  const up = last > first;
  return (inverted ? !up : up) ? "positive" : "negative";
}

export function Sparkline({
  data,
  role,
  /** For metrics where down is good (latency, cost, failures). */
  inverted = false,
  height = 28,
  width,
  filled = true,
  strokeWidth = 1.5,
  className,
  /** Show a dot on the final point — anchors "where we are now". */
  showLastPoint = true,
  ariaLabel,
}: {
  data: SparkPoint[];
  role?: ChartRole;
  inverted?: boolean;
  height?: number;
  width?: number | string;
  filled?: boolean;
  strokeWidth?: number;
  className?: string;
  showLastPoint?: boolean;
  ariaLabel?: string;
}) {
  const resolvedRole = role ?? autoRole(data, inverted);
  const color = roleColor(resolvedRole);
  const gradientId = React.useId().replace(/:/g, "");

  if (data.length === 0) {
    return (
      <div
        className={cn("rounded-sm bg-chart-track", className)}
        style={{ height, width: width ?? "100%" }}
        aria-hidden
      />
    );
  }

  const chart = filled ? (
    <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <Area
        type="monotone"
        dataKey="value"
        stroke={color}
        strokeWidth={strokeWidth}
        fill={`url(#${gradientId})`}
        dot={false}
        isAnimationActive={false}
      />
    </AreaChart>
  ) : (
    <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
      <Line
        type="monotone"
        dataKey="value"
        stroke={color}
        strokeWidth={strokeWidth}
        dot={false}
        isAnimationActive={false}
      />
    </LineChart>
  );

  return (
    <div
      className={cn("pyth-chart relative", className)}
      style={{ height, width: width ?? "100%" }}
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer width="100%" height="100%">
        {chart}
      </ResponsiveContainer>
      {showLastPoint ? (
        <span
          aria-hidden
          className="absolute end-0 top-1/2 hidden"
          style={{ color }}
        />
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   SparkBars — for counts per bucket where the discrete buckets matter
   (daily eval runs, publications per day).
   ------------------------------------------------------------------------ */

export function SparkBars({
  data,
  role,
  inverted = false,
  height = 28,
  className,
  /** Tint the final bar differently — "today, still accumulating". */
  highlightLast = false,
  ariaLabel,
}: {
  data: SparkPoint[];
  role?: ChartRole;
  inverted?: boolean;
  height?: number;
  className?: string;
  highlightLast?: boolean;
  ariaLabel?: string;
}) {
  const resolvedRole = role ?? autoRole(data, inverted);
  const color = roleColor(resolvedRole);

  return (
    <div
      className={cn("pyth-chart", className)}
      style={{ height, width: "100%" }}
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 1, right: 0, bottom: 0, left: 0 }}>
          <Bar
            dataKey="value"
            radius={[1.5, 1.5, 0, 0]}
            isAnimationActive={false}
            minPointSize={1}
          >
            {data.map((_, i) => (
              <Cell
                key={i}
                fill={color}
                opacity={
                  highlightLast && i === data.length - 1 ? 0.45 : 1
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   MiniTrend — sparkline + value + delta as one unit. This is the shape used in
   dashboard metric rows and inside table cells.
   ------------------------------------------------------------------------ */

export function MiniTrend({
  data,
  value,
  delta,
  inverted = false,
  className,
  width = 64,
  label,
}: {
  data: SparkPoint[];
  value: React.ReactNode;
  /** Fractional change, e.g. 0.062 for +6.2%. */
  delta?: number | null;
  inverted?: boolean;
  className?: string;
  width?: number;
  label?: React.ReactNode;
}) {
  const flat = delta == null || Math.abs(delta) < 0.0005;
  const good = delta == null ? false : inverted ? delta < 0 : delta > 0;

  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg tnum">{value}</span>
        {label ? (
          <span className="block truncate text-2xs text-fg-quaternary">
            {label}
          </span>
        ) : null}
      </span>
      <Sparkline data={data} inverted={inverted} height={22} width={width} />
      {delta != null ? (
        <span
          className={cn(
            "shrink-0 text-2xs font-medium tnum",
            flat
              ? "text-fg-quaternary"
              : good
                ? "text-success-text"
                : "text-danger-text",
          )}
        >
          {formatPercent(delta, { decimals: 1, signed: true })}
        </span>
      ) : null}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   GaugeChart — a 180° arc for "current value inside a range". Used for budget
   consumption and success-rate against an SLO. Read faster than a full ring
   when the value has a hard ceiling.
   ------------------------------------------------------------------------ */

export function GaugeChart({
  value,
  min = 0,
  max = 100,
  thresholds,
  size = 132,
  thickness = 10,
  label,
  formatValue = (v) => formatNumber(v, { decimals: 0 }),
  className,
  /** Marks the target on the arc. */
  target,
}: {
  value: number;
  min?: number;
  max?: number;
  thresholds?: { warn: number; bad: number };
  size?: number;
  thickness?: number;
  label?: React.ReactNode;
  formatValue?: (value: number) => string;
  className?: string;
  target?: number;
}) {
  const clamped = Math.min(Math.max(value, min), max);
  const ratio = max > min ? (clamped - min) / (max - min) : 0;

  const color = thresholds
    ? clamped >= thresholds.bad
      ? "var(--chart-negative)"
      : clamped >= thresholds.warn
        ? "var(--chart-warning)"
        : "var(--chart-positive)"
    : "var(--chart-1)";

  const r = size / 2 - thickness / 2 - 1;
  const cx = size / 2;
  const cy = size / 2;
  const arc = Math.PI * r; // half circumference
  const height = size / 2 + thickness + 14;

  const targetAngle =
    target != null && max > min ? (target - min) / (max - min) : null;

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height }}
    >
      <svg width={size} height={height} aria-hidden>
        {/* Track */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="var(--chart-track)"
          strokeWidth={thickness}
          strokeLinecap="round"
        />
        {/* Value */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={arc}
          strokeDashoffset={arc * (1 - ratio)}
          style={{
            transition: "stroke-dashoffset 400ms var(--ease-in-out)",
          }}
        />
        {/* Target tick */}
        {targetAngle != null ? (
          <line
            x1={cx + (r - thickness / 2 - 2) * Math.cos(Math.PI - targetAngle * Math.PI)}
            y1={cy - (r - thickness / 2 - 2) * Math.sin(Math.PI - targetAngle * Math.PI)}
            x2={cx + (r + thickness / 2 + 2) * Math.cos(Math.PI - targetAngle * Math.PI)}
            y2={cy - (r + thickness / 2 + 2) * Math.sin(Math.PI - targetAngle * Math.PI)}
            stroke="var(--fg-secondary)"
            strokeWidth={1.5}
          />
        ) : null}
      </svg>

      <div
        className="absolute inset-x-0 flex flex-col items-center text-center"
        style={{ top: size / 2 - 26 }}
      >
        <span className="text-xl font-semibold tracking-tighter text-fg tnum">
          {formatValue(clamped)}
        </span>
        {label ? (
          <span className="mt-0.5 text-2xs text-fg-tertiary">{label}</span>
        ) : null}
      </div>

      <div className="absolute inset-x-0 bottom-0 flex justify-between px-1 text-[10px] text-fg-quaternary tnum">
        <span>{formatValue(min)}</span>
        <span>{formatValue(max)}</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   TargetMeter — a linear "actual vs target" bar. Preferred over a gauge inside
   dense lists because it aligns across rows.
   ------------------------------------------------------------------------ */

export function TargetMeter({
  value,
  target,
  max,
  formatValue = (v) => formatNumber(v),
  label,
  /** Below target is bad by default; set for cost/latency style metrics. */
  inverted = false,
  className,
  size = "md",
}: {
  value: number;
  target: number;
  max?: number;
  formatValue?: (value: number) => string;
  label?: React.ReactNode;
  inverted?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  const ceiling = max ?? Math.max(value, target) * 1.15;
  const valuePct = ceiling > 0 ? Math.min(100, (value / ceiling) * 100) : 0;
  const targetPct = ceiling > 0 ? Math.min(100, (target / ceiling) * 100) : 0;
  const met = inverted ? value <= target : value >= target;

  return (
    <div className={cn("min-w-0", className)}>
      {label || true ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {label ? (
            <span className="min-w-0 truncate text-xs text-fg-secondary">
              {label}
            </span>
          ) : null}
          <span className="shrink-0 text-xs tnum">
            <span
              className={cn(
                "font-semibold",
                met ? "text-success-text" : "text-warning-text",
              )}
            >
              {formatValue(value)}
            </span>
            <span className="text-fg-quaternary">
              {" "}
              / هدف {formatValue(target)}
            </span>
          </span>
        </div>
      ) : null}
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-chart-track",
          size === "sm" ? "h-1.5" : "h-2",
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-[400ms] ease-[var(--ease-in-out)]",
            met ? "bg-chart-positive" : "bg-chart-warning",
          )}
          style={{ width: `${valuePct}%` }}
        />
        <span
          aria-hidden
          className="absolute inset-y-[-2px] w-[1.5px] rounded-full bg-[var(--text-secondary)]"
          style={{ insetInlineStart: `${targetPct}%` }}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   ProgressRing — the tiny ring used in table cells and list rows.
   ------------------------------------------------------------------------ */

export function ProgressRing({
  value,
  max = 100,
  size = 22,
  thickness = 2.5,
  role,
  className,
  ariaLabel,
}: {
  value: number;
  max?: number;
  size?: number;
  thickness?: number;
  role?: ChartRole;
  className?: string;
  ariaLabel?: string;
}) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const color = roleColor(role ?? "accent");

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("-rotate-90 shrink-0", className)}
      role="img"
      aria-label={ariaLabel ?? formatPercent(pct, { decimals: 0 })}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={thickness}
        stroke="var(--chart-track)"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={thickness}
        stroke={color}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
      />
    </svg>
  );
}
