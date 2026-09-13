"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import {
  formatCompact,
  formatDate,
  formatExact,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import { Tooltip } from "../primitives/tooltip";
import { CategoryLegend } from "./chart-primitives";

/* ============================================================================
   Matrix & flow visualisations
   ---------------------------------------------------------------------------
   These are drawn with CSS grid / SVG rather than a chart library, because each
   one is fundamentally a *table with colour*, and building them from primitives
   keeps them RTL-correct, keyboard-navigable and token-driven.

   CalendarHeatmap  activity density over weeks — study sessions, publications
   CohortMatrix     retention by cohort × period
   FunnelChart      stage-to-stage conversion with drop-off called out
   PipelineFlow     an operational pipeline with counts and status per stage
   ========================================================================== */

const HEAT_VARS = [
  "var(--heat-0)",
  "var(--heat-1)",
  "var(--heat-2)",
  "var(--heat-3)",
  "var(--heat-4)",
  "var(--heat-5)",
] as const;

function heatColor(value: number, max: number): string {
  if (value <= 0 || max <= 0) return HEAT_VARS[0];
  const ratio = value / max;
  const step = Math.min(5, Math.max(1, Math.ceil(ratio * 5)));
  return HEAT_VARS[step];
}

/* ---------------------------------------------------------------------------
   CalendarHeatmap
   Weeks run as columns; in RTL the grid flows right-to-left so the most recent
   week sits at the inline start, which is where an operator looks first.
   ------------------------------------------------------------------------ */

export interface HeatmapDay {
  date: Date | string;
  value: number;
}

export function CalendarHeatmap({
  days,
  weeks = 18,
  cellSize = 12,
  gap = 3,
  valueLabel = "حدث",
  className,
  onDayClick,
  showLegend = true,
}: {
  days: HeatmapDay[];
  weeks?: number;
  cellSize?: number;
  gap?: number;
  valueLabel?: string;
  className?: string;
  onDayClick?: (day: HeatmapDay) => void;
  showLegend?: boolean;
}) {
  const byDay = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const d of days) {
      const key = new Date(d.date).toISOString().slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + d.value);
    }
    return map;
  }, [days]);

  const max = React.useMemo(
    () => Math.max(1, ...[...byDay.values()]),
    [byDay],
  );

  /** Columns of 7 days, oldest column first, each column starting Saturday. */
  const columns = React.useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Walk back to the most recent Saturday.
    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + ((6 - today.getDay() + 7) % 7));

    const cols: { date: Date; value: number; future: boolean }[][] = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const col: { date: Date; value: number; future: boolean }[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(endOfWeek);
        date.setDate(endOfWeek.getDate() - w * 7 - (6 - d));
        const key = date.toISOString().slice(0, 10);
        col.push({
          date,
          value: byDay.get(key) ?? 0,
          future: date > today,
        });
      }
      cols.push(col);
    }
    return cols;
  }, [byDay, weeks]);

  const monthFmt = new Intl.DateTimeFormat("ar-IQ", { month: "short" });

  return (
    <div className={cn("min-w-0", className)}>
      <div className="pyth-chart overflow-x-auto pb-1">
        <div className="inline-flex flex-col gap-1">
          {/* Month labels */}
          <div className="flex" style={{ gap }}>
            {columns.map((col, i) => {
              const first = col[0].date;
              const prev = columns[i - 1]?.[0].date;
              const newMonth =
                i === 0 || (prev && first.getMonth() !== prev.getMonth());
              return (
                <span
                  key={i}
                  className="text-[9px] text-fg-quaternary"
                  style={{ width: cellSize, minWidth: cellSize }}
                >
                  {newMonth ? monthFmt.format(first) : ""}
                </span>
              );
            })}
          </div>

          <div className="flex" style={{ gap }}>
            {columns.map((col, ci) => (
              <div key={ci} className="flex flex-col" style={{ gap }}>
                {col.map((cell, ri) => (
                  <Tooltip
                    key={ri}
                    content={
                      cell.future ? null : (
                        <span className="block">
                          <span className="block font-medium text-fg tnum">
                            {formatNumber(cell.value)} {valueLabel}
                          </span>
                          <span className="block text-fg-tertiary">
                            {formatDate(cell.date)}
                          </span>
                        </span>
                      )
                    }
                    delay={80}
                  >
                    <button
                      type="button"
                      disabled={cell.future || !onDayClick}
                      onClick={() =>
                        onDayClick?.({ date: cell.date, value: cell.value })
                      }
                      aria-label={`${formatDate(cell.date)}: ${cell.value}`}
                      className={cn(
                        "rounded-[2.5px] transition-transform",
                        !cell.future &&
                          onDayClick &&
                          "hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
                        cell.future && "opacity-30",
                      )}
                      style={{
                        width: cellSize,
                        height: cellSize,
                        backgroundColor: cell.future
                          ? "transparent"
                          : heatColor(cell.value, max),
                        border: cell.future
                          ? "1px dashed var(--border)"
                          : cell.value === 0
                            ? "1px solid var(--border-subtle)"
                            : "none",
                      }}
                    />
                  </Tooltip>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {showLegend ? (
        <div className="mt-2.5 flex items-center gap-1.5 text-2xs text-fg-quaternary">
          <span>أقل</span>
          {HEAT_VARS.map((v, i) => (
            <span
              key={i}
              aria-hidden
              className="size-2.5 rounded-[2px]"
              style={{
                backgroundColor: v,
                border: i === 0 ? "1px solid var(--border-subtle)" : "none",
              }}
            />
          ))}
          <span>أكثر</span>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   CohortMatrix — retention. Rows are cohorts, columns are periods since start.
   ------------------------------------------------------------------------ */

export interface CohortRow {
  label: string;
  /** Cohort size at period 0. */
  size: number;
  /** Retention ratios per period, index 0 = period 0 (always 1). */
  values: (number | null)[];
}

export function CohortMatrix({
  rows,
  periodLabel = (i) => `أ${i}`,
  className,
  cellHeight = 30,
  maxPeriods,
}: {
  rows: CohortRow[];
  periodLabel?: (index: number) => string;
  className?: string;
  cellHeight?: number;
  maxPeriods?: number;
}) {
  const periods =
    maxPeriods ?? Math.max(...rows.map((r) => r.values.length), 1);

  return (
    <div className={cn("min-w-0 overflow-x-auto", className)}>
      <table className="w-full border-separate border-spacing-0.5 text-2xs">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky start-0 z-10 bg-surface pe-2 text-start font-medium text-fg-tertiary"
            >
              الفوج
            </th>
            <th scope="col" className="px-2 text-end font-medium text-fg-tertiary">
              الحجم
            </th>
            {Array.from({ length: periods }).map((_, i) => (
              <th
                key={i}
                scope="col"
                className="min-w-11 text-center font-medium text-fg-quaternary tnum"
              >
                {periodLabel(i)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th
                scope="row"
                className="sticky start-0 z-10 whitespace-nowrap bg-surface pe-2 text-start font-normal text-fg-secondary"
              >
                {row.label}
              </th>
              <td className="px-2 text-end text-fg-tertiary tnum">
                {formatCompact(row.size)}
              </td>
              {Array.from({ length: periods }).map((_, i) => {
                const v = row.values[i];
                if (v == null) {
                  return (
                    <td key={i} className="p-0">
                      <div
                        className="rounded-[3px] border border-dashed border-border-subtle"
                        style={{ height: cellHeight }}
                      />
                    </td>
                  );
                }
                return (
                  <td key={i} className="p-0">
                    <Tooltip
                      content={
                        <span className="block">
                          <span className="block font-medium text-fg">
                            {formatPercent(v, { decimals: 1 })}
                          </span>
                          <span className="block text-fg-tertiary tnum">
                            {formatNumber(Math.round(v * row.size))} من{" "}
                            {formatNumber(row.size)}
                          </span>
                        </span>
                      }
                      delay={80}
                    >
                      <div
                        className="flex items-center justify-center rounded-[3px] font-medium tnum"
                        style={{
                          height: cellHeight,
                          backgroundColor: heatColor(v, 1),
                          color:
                            v > 0.6
                              ? "var(--text-on-accent)"
                              : "var(--text-secondary)",
                        }}
                      >
                        {formatPercent(v, { decimals: 0 })}
                      </div>
                    </Tooltip>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   FunnelChart — stages with explicit drop-off. Built as stacked bars rather
   than a trapezoid because the trapezoid shape distorts small differences.
   ------------------------------------------------------------------------ */

export interface FunnelStage {
  key: string;
  label: string;
  value: number;
  /** Optional explanation of the drop-off into the next stage. */
  dropReason?: string;
}

export function FunnelChart({
  stages,
  valueFormatter = (v) => formatCompact(v),
  className,
  showDropOff = true,
}: {
  stages: FunnelStage[];
  valueFormatter?: (value: number) => string;
  className?: string;
  showDropOff?: boolean;
}) {
  const top = stages[0]?.value ?? 0;

  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      {stages.map((stage, i) => {
        const pctOfTop = top > 0 ? stage.value / top : 0;
        const prev = stages[i - 1];
        const stepRatio =
          prev && prev.value > 0 ? stage.value / prev.value : null;
        const drop = prev ? prev.value - stage.value : 0;

        return (
          <div key={stage.key}>
            {i > 0 && showDropOff && drop > 0 ? (
              <div className="flex items-center gap-2 py-1 ps-3">
                <span className="h-3 w-px bg-border" aria-hidden />
                <span className="text-2xs text-danger-text tnum">
                  −{valueFormatter(drop)}
                </span>
                {stage.dropReason ? (
                  <span className="truncate text-2xs text-fg-quaternary">
                    {stage.dropReason}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="group/stage">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-xs text-fg-secondary">
                    {stage.label}
                  </span>
                  {stepRatio != null ? (
                    <span
                      className={cn(
                        "shrink-0 text-2xs tnum",
                        stepRatio >= 0.9
                          ? "text-success-text"
                          : stepRatio >= 0.7
                            ? "text-fg-quaternary"
                            : "text-warning-text",
                      )}
                    >
                      {formatPercent(stepRatio, { decimals: 0 })}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs font-medium text-fg tnum">
                  {valueFormatter(stage.value)}
                </span>
              </div>
              <div className="h-6 w-full overflow-hidden rounded-[4px] bg-chart-track">
                <div
                  className="h-full rounded-[4px] transition-[width] duration-[400ms] ease-[var(--ease-in-out)]"
                  style={{
                    width: `${Math.max(pctOfTop * 100, 1.5)}%`,
                    backgroundColor: `var(--chart-${Math.min(i + 1, 8)})`,
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   PipelineFlow
   ---------------------------------------------------------------------------
   The retrieval diagnostic: Query → Lexical → Semantic → Fusion → Rerank →
   Evidence. Deliberately *not* a node graph: a clean horizontal sequence of
   stages with counts, timings and per-stage status is what an operator needs to
   answer "where did this query lose its evidence?".
   ------------------------------------------------------------------------ */

export interface PipelineStage {
  key: string;
  label: string;
  /** Primary count for this stage. */
  count?: number;
  countLabel?: string;
  /** Stage timing. */
  durationMs?: number;
  state: "ok" | "warning" | "failed" | "skipped" | "running";
  /** Extra key/value detail shown under the stage. */
  detail?: { label: string; value: React.ReactNode }[];
  note?: string;
}

const STAGE_STYLE = {
  ok: {
    border: "border-border",
    bg: "bg-surface",
    dot: "bg-chart-positive",
    text: "text-fg",
  },
  warning: {
    border: "border-warning-border",
    bg: "bg-warning-subtle",
    dot: "bg-chart-warning",
    text: "text-warning-text",
  },
  failed: {
    border: "border-danger-border",
    bg: "bg-danger-subtle",
    dot: "bg-chart-negative",
    text: "text-danger-text",
  },
  skipped: {
    border: "border-border-subtle border-dashed",
    bg: "bg-inset",
    dot: "bg-neutral",
    text: "text-fg-quaternary",
  },
  running: {
    border: "border-info-border",
    bg: "bg-info-subtle",
    dot: "bg-info",
    text: "text-info-text",
  },
} as const;

export function PipelineFlow({
  stages,
  className,
  /** Total end-to-end duration, shown as a summary. */
  totalMs,
  compact = false,
}: {
  stages: PipelineStage[];
  className?: string;
  totalMs?: number;
  compact?: boolean;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex min-w-0 items-stretch gap-0 overflow-x-auto pb-1">
        {stages.map((stage, i) => {
          const style = STAGE_STYLE[stage.state];
          return (
            <React.Fragment key={stage.key}>
              {i > 0 ? (
                <div
                  className="flex shrink-0 items-center px-1.5"
                  aria-hidden
                >
                  {/* Flow arrow points along the pipeline; the pipeline itself
                      reads right-to-left in Arabic, matching the text. */}
                  <svg
                    width="18"
                    height="10"
                    viewBox="0 0 18 10"
                    className="text-border-strong rtl:rotate-180"
                    fill="none"
                  >
                    <path
                      d="M0 5h13M9.5 1.5 13 5l-3.5 3.5"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              ) : null}

              <div
                className={cn(
                  "flex min-w-0 flex-1 flex-col rounded-lg border",
                  style.border,
                  style.bg,
                  compact ? "min-w-28 p-2.5" : "min-w-32 p-3",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      style.dot,
                      stage.state === "running" && "pyth-live-dot",
                    )}
                  />
                  <span className="min-w-0 truncate text-2xs font-medium text-fg-tertiary">
                    {stage.label}
                  </span>
                </div>

                {stage.count != null ? (
                  <div className="mt-1.5 flex items-baseline gap-1">
                    <span
                      className={cn(
                        "text-md font-semibold tracking-tighter tnum",
                        style.text,
                      )}
                    >
                      {formatNumber(stage.count)}
                    </span>
                    {stage.countLabel ? (
                      <span className="text-2xs text-fg-quaternary">
                        {stage.countLabel}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <div className={cn("mt-1.5 text-xs font-medium", style.text)}>
                    {stage.state === "skipped"
                      ? "متجاوَز"
                      : stage.state === "failed"
                        ? "فشل"
                        : stage.state === "running"
                          ? "جارٍ"
                          : "تم"}
                  </div>
                )}

                {stage.durationMs != null ? (
                  <span className="mt-0.5 text-[10px] text-fg-quaternary tnum">
                    {stage.durationMs} ms
                  </span>
                ) : null}

                {stage.detail?.length && !compact ? (
                  <dl className="mt-2 space-y-0.5 border-t border-border-subtle pt-1.5">
                    {stage.detail.map((d) => (
                      <div
                        key={d.label}
                        className="flex items-baseline justify-between gap-2 text-[10px]"
                      >
                        <dt className="truncate text-fg-quaternary">{d.label}</dt>
                        <dd className="shrink-0 text-fg-tertiary tnum">
                          {d.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}

                {stage.note ? (
                  <p className={cn("mt-1.5 text-[10px] leading-snug", style.text)}>
                    {stage.note}
                  </p>
                ) : null}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {totalMs != null ? (
        <p className="mt-2 text-2xs text-fg-quaternary tnum">
          الزمن الكلي: {totalMs} ms
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   StackedShareBar — a single 100% bar showing composition. Used for "share of
   requests by provider" where a donut would be overkill.
   ------------------------------------------------------------------------ */

export function StackedShareBar({
  segments,
  height = 10,
  className,
  showLegend = true,
  valueFormatter = (v) => formatCompact(v),
}: {
  segments: { key: string; label: string; value: number; color?: string }[];
  height?: number;
  className?: string;
  showLegend?: boolean;
  valueFormatter?: (value: number) => string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const resolved = segments.map((s, i) => ({
    ...s,
    color: s.color ?? `var(--chart-${(i % 8) + 1})`,
  }));

  return (
    <div className={cn("min-w-0", className)}>
      <div
        className="flex w-full overflow-hidden rounded-full bg-chart-track"
        style={{ height }}
      >
        {resolved.map((s) => {
          const pct = total > 0 ? (s.value / total) * 100 : 0;
          if (pct <= 0) return null;
          return (
            <Tooltip
              key={s.key}
              content={
                <span>
                  {s.label}: {valueFormatter(s.value)} ·{" "}
                  {formatPercent(pct / 100, { decimals: 1 })}
                </span>
              }
            >
              <div
                className="h-full transition-[width] duration-[400ms] ease-[var(--ease-in-out)] first:rounded-s-full last:rounded-e-full"
                style={{ width: `${pct}%`, backgroundColor: s.color }}
              />
            </Tooltip>
          );
        })}
      </div>
      {showLegend ? (
        <CategoryLegend
          className="mt-2.5"
          columns={resolved.length > 4 ? 2 : 1}
          items={resolved.map((s) => ({
            label: s.label,
            color: s.color,
            value: (
              <span className="tnum">
                {valueFormatter(s.value)}
                <span className="ms-1.5 text-fg-quaternary">
                  {formatPercent(total > 0 ? s.value / total : 0, {
                    decimals: 0,
                  })}
                </span>
              </span>
            ),
          }))}
        />
      ) : null}
    </div>
  );
}

export { formatExact };
