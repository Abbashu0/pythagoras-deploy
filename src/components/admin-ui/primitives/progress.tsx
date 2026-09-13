"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { progressFill } from "@/lib/motion";
import { formatPercent } from "@/lib/format";
import type { StatusTone } from "../status/status-registry";
import { toneClasses } from "../status/status-registry";

/* ============================================================================
   Progress primitives
   ---------------------------------------------------------------------------
   ProgressBar         determinate work with a known total
   IndeterminateBar    work with an unknown total (never fakes a percentage)
   Meter               a value inside a budget, with threshold semantics
   CircularProgress    compact ring for tiles and table cells
   SegmentedProgress   composition of pass/fail/pending counts in one rail
   ========================================================================== */

export function ProgressBar({
  value,
  max = 100,
  tone = "accent",
  size = "md",
  className,
  label,
  showValue = false,
  animate = true,
}: {
  value: number;
  max?: number;
  tone?: StatusTone;
  size?: "xs" | "sm" | "md";
  className?: string;
  label?: React.ReactNode;
  showValue?: boolean;
  animate?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const t = toneClasses[tone];

  return (
    <div className={cn("w-full", className)}>
      {label || showValue ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          {label ? (
            <span className="min-w-0 truncate text-xs text-fg-secondary">
              {label}
            </span>
          ) : null}
          {showValue ? (
            <span className="shrink-0 text-xs font-medium text-fg tnum">
              {formatPercent(pct, { decimals: 0, alreadyScaled: true })}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-chart-track",
          size === "xs" && "h-1",
          size === "sm" && "h-1.5",
          size === "md" && "h-2",
        )}
      >
        {animate ? (
          <motion.div
            className={cn("h-full rounded-full", t.solid)}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={progressFill}
          />
        ) : (
          <div
            className={cn("h-full rounded-full", t.solid)}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}

export function IndeterminateBar({
  tone = "accent",
  size = "sm",
  className,
  label,
}: {
  tone?: StatusTone;
  size?: "xs" | "sm" | "md";
  className?: string;
  label?: string;
}) {
  const t = toneClasses[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-chart-track",
        size === "xs" && "h-1",
        size === "sm" && "h-1.5",
        size === "md" && "h-2",
        className,
      )}
    >
      <span
        className={cn("absolute inset-y-0 rounded-full", t.solid)}
        style={{ animation: "pyth-indeterminate 1.5s var(--ease-in-out) infinite" }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Meter — a value inside an allowance. Tone is derived from thresholds so the
   caller never has to decide when "amber" begins.
   ------------------------------------------------------------------------ */

export function Meter({
  value,
  max,
  thresholds = { warning: 0.75, danger: 0.92 },
  label,
  valueLabel,
  maxLabel,
  hint,
  size = "md",
  className,
}: {
  value: number;
  max: number;
  thresholds?: { warning: number; danger: number };
  label?: React.ReactNode;
  valueLabel?: React.ReactNode;
  maxLabel?: React.ReactNode;
  hint?: React.ReactNode;
  size?: "sm" | "md";
  className?: string;
}) {
  const ratio = max > 0 ? value / max : 0;
  const tone: StatusTone =
    ratio >= thresholds.danger
      ? "danger"
      : ratio >= thresholds.warning
        ? "warning"
        : "success";
  const t = toneClasses[tone];
  const pct = Math.min(100, Math.max(0, ratio * 100));

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-xs text-fg-secondary">{label}</span>
        <span className="shrink-0 text-xs tnum">
          <span className={cn("font-semibold", t.text)}>{valueLabel}</span>
          {maxLabel ? (
            <span className="text-fg-quaternary"> / {maxLabel}</span>
          ) : null}
        </span>
      </div>
      <div
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-chart-track",
          size === "sm" ? "h-1.5" : "h-2",
        )}
      >
        <motion.div
          className={cn("h-full rounded-full", t.solid)}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={progressFill}
        />
        {/* Threshold ticks make the amber/red boundary explicit. */}
        <span
          aria-hidden
          className="absolute inset-y-0 w-px bg-[var(--surface)] opacity-60"
          style={{ insetInlineStart: `${thresholds.warning * 100}%` }}
        />
        <span
          aria-hidden
          className="absolute inset-y-0 w-px bg-[var(--surface)] opacity-60"
          style={{ insetInlineStart: `${thresholds.danger * 100}%` }}
        />
      </div>
      {hint ? (
        <p className={cn("mt-1.5 text-2xs", tone === "success" ? "text-fg-quaternary" : t.text)}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   CircularProgress — used inside metric tiles and dense operational rows.
   ------------------------------------------------------------------------ */

export function CircularProgress({
  value,
  max = 100,
  size = 44,
  thickness = 4,
  tone = "accent",
  children,
  className,
  trackClassName,
  label,
}: {
  value: number;
  max?: number;
  size?: number;
  thickness?: number;
  tone?: StatusTone;
  children?: React.ReactNode;
  className?: string;
  trackClassName?: string;
  label?: string;
}) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={thickness}
          className={cn("stroke-chart-track", trackClassName)}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={thickness}
          strokeLinecap="round"
          className={cn(
            tone === "accent" && "stroke-accent",
            tone === "success" && "stroke-success",
            tone === "warning" && "stroke-warning",
            tone === "danger" && "stroke-danger",
            tone === "info" && "stroke-info",
            tone === "future" && "stroke-future",
            tone === "neutral" && "stroke-neutral",
          )}
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={progressFill}
        />
      </svg>
      {children ? (
        <span className="absolute inset-0 flex items-center justify-center">
          {children}
        </span>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   SegmentedProgress — one rail split into semantic segments. Used by eval runs
   (passed / blocked / incomplete) and job queues (done / running / queued).
   ------------------------------------------------------------------------ */

export interface ProgressSegment {
  key: string;
  label: string;
  value: number;
  tone: StatusTone;
}

export function SegmentedProgress({
  segments,
  total,
  size = "md",
  className,
  showLegend = true,
}: {
  segments: ProgressSegment[];
  /** Defaults to the sum of segments. Pass a larger total to show "remaining". */
  total?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
  showLegend?: boolean;
}) {
  const sum = segments.reduce((a, s) => a + s.value, 0);
  const denom = total ?? sum;

  return (
    <div className={cn("w-full", className)}>
      <div
        className={cn(
          "flex w-full overflow-hidden rounded-full bg-chart-track",
          size === "sm" && "h-1.5",
          size === "md" && "h-2",
          size === "lg" && "h-2.5",
        )}
      >
        {segments.map((s) => {
          const pct = denom > 0 ? (s.value / denom) * 100 : 0;
          if (pct <= 0) return null;
          return (
            <motion.div
              key={s.key}
              className={cn(
                toneClasses[s.tone].solid,
                "h-full first:rounded-s-full last:rounded-e-full",
              )}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={progressFill}
              title={`${s.label}: ${s.value}`}
            />
          );
        })}
      </div>
      {showLegend ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {segments.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-xs">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  toneClasses[s.tone].solid,
                )}
                aria-hidden
              />
              <span className="text-fg-tertiary">{s.label}</span>
              <span className="font-medium text-fg tnum">{s.value}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
