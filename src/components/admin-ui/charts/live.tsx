"use client";

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/cn";
import { formatCompact, formatTime } from "@/lib/format";
import { useReducedMotion } from "@/lib/hooks";
import { chartAnimationMs } from "@/lib/motion";
import { EmptyState } from "../feedback/empty-state";
import { SegmentedControl } from "../forms/segmented";
import { ChartContainer, ChartLegend, gridDefaults, makeChartTooltip, seriesColor, type ChartSeries } from "./chart-primitives";
import { StatusText } from "../status/status-badge";

export interface LiveTelemetryPoint {
  timestamp: number | string;
  [seriesKey: string]: number | string | null;
}

export type LiveTelemetryStatus = "live" | "reconnecting" | "delayed" | "paused";
export type LiveTimeWindow = "1m" | "5m" | "15m" | "1h";

export const DEFAULT_LIVE_TIME_WINDOWS: LiveTimeWindow[] = ["1m", "5m", "15m", "1h"];

const WINDOW_MS: Record<LiveTimeWindow, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
};

const WINDOW_LABELS: Record<LiveTimeWindow, string> = {
  "1m": "1د",
  "5m": "5د",
  "15m": "15د",
  "1h": "1س",
};

export function LivePulseIndicator({
  status,
  label,
  className,
}: {
  status: LiveTelemetryStatus;
  label?: React.ReactNode;
  className?: string;
}) {
  const statusKey = status === "live"
    ? "running"
    : status === "reconnecting"
      ? "testing"
      : status === "delayed"
        ? "stale"
        : "inactive";
  const statusLabel = label ?? ({
    live: "مباشر",
    reconnecting: "جارٍ إعادة الاتصال",
    delayed: "متأخر",
    paused: "متوقف مؤقتًا",
  } satisfies Record<LiveTelemetryStatus, string>)[status];

  return (
    <StatusText
      status={statusKey}
      label={statusLabel}
      size="sm"
      className={cn("whitespace-nowrap", className)}
    />
  );
}

export interface LiveTelemetryChartProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  data: LiveTelemetryPoint[];
  series: ChartSeries[];
  status?: LiveTelemetryStatus;
  statusLabel?: React.ReactNode;
  timeWindow?: LiveTimeWindow;
  onTimeWindowChange?: (window: LiveTimeWindow) => void;
  showTimeWindow?: boolean;
  showLegend?: boolean;
  loading?: boolean;
  error?: { message?: string } | null;
  onRetry?: () => void;
  emptyState?: React.ReactNode;
  footnote?: React.ReactNode;
  valueUnit?: string;
  formatValue?: (value: number) => string;
  formatTimestamp?: (value: number | string) => string;
  allowDecimals?: boolean;
  startAtZero?: boolean;
  chartLabel?: string;
  className?: string;
}

/**
 * APCL live-chart contract adapted to the Admin app's existing chart frame.
 * It only renders caller-owned measurements; it never polls or manufactures
 * samples. The plot remains LTR while its frame and controls inherit RTL.
 */
export function LiveTelemetryChart({
  title,
  description,
  data,
  series,
  status = "paused",
  statusLabel,
  timeWindow,
  onTimeWindowChange,
  showTimeWindow = true,
  showLegend = true,
  loading = false,
  error = null,
  onRetry,
  emptyState,
  footnote,
  valueUnit,
  formatValue = formatCompact,
  formatTimestamp = formatTime,
  allowDecimals = true,
  startAtZero = false,
  chartLabel,
  className,
}: LiveTelemetryChartProps) {
  const [localWindow, setLocalWindow] = React.useState<LiveTimeWindow>("5m");
  const activeWindow = timeWindow ?? localWindow;
  const changeWindow = (next: LiveTimeWindow) => {
    if (timeWindow === undefined) setLocalWindow(next);
    onTimeWindowChange?.(next);
  };
  const visible = React.useMemo(
    () => filterToWindow(data, activeWindow),
    [activeWindow, data],
  );
  const latestValue = latestNumericValue(visible, series[0]?.key);
  const reducedMotion = useReducedMotion();
  const plotData = visible.map((point) => ({
    ...point,
    plottedAt: formatTimestamp(point.timestamp),
  }));
  const tooltip = React.useMemo(
    () => makeChartTooltip({
      series,
      labelFormatter: (value) => String(value),
      valueFormatter: (value) => formatValue(value),
    }),
    [formatValue, series],
  );
  const actions = showTimeWindow ? (
    <SegmentedControl
      size="sm"
      value={activeWindow}
      onValueChange={(value) => changeWindow(value as LiveTimeWindow)}
      aria-label="نافذة القياس الحي"
      options={DEFAULT_LIVE_TIME_WINDOWS.map((window) => ({
        value: window,
        label: WINDOW_LABELS[window],
        tooltip: `آخر ${WINDOW_LABELS[window]}`,
      }))}
    />
  ) : null;

  return (
    <ChartContainer
      title={title}
      description={description}
      value={latestValue == null ? "—" : `${formatValue(latestValue)}${valueUnit ? ` ${valueUnit}` : ""}`}
      trend={
        <LivePulseIndicator
          status={visible.length > 0 ? status : "paused"}
          label={visible.length > 0 ? statusLabel : "بانتظار قياس فعلي"}
        />
      }
      actions={actions}
      legend={showLegend && series.length > 0 ? <ChartLegend series={series} compact /> : undefined}
      height={230}
      loading={loading}
      error={error}
      onRetry={onRetry}
      empty={visible.length === 0}
      emptyState={emptyState ?? (
        <EmptyState
          size="sm"
          title="لا توجد قياسات في هذه النافذة."
          description="سيظهر الرسم بعد وصول قياس حقيقي من مسار Agent 1."
        />
      )}
      footnote={footnote}
      className={className}
    >
      <RechartsLineChart
        data={plotData}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        accessibilityLayer
        aria-label={chartLabel ?? String(title)}
      >
        <CartesianGrid {...gridDefaults} />
        <XAxis
          dataKey="plottedAt"
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
        />
        <YAxis
          width={40}
          allowDecimals={allowDecimals}
          domain={startAtZero ? [0, "auto"] : ["auto", "auto"]}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
          tickFormatter={formatValue}
        />
        <RechartsTooltip content={tooltip} />
        {series.map((item, index) => (
          <Line
            key={item.key}
            type="monotone"
            dataKey={item.key}
            name={item.label}
            stroke={seriesColor(item, index)}
            strokeWidth={2}
            strokeDasharray={item.dashed ? "5 4" : undefined}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={!reducedMotion}
            animationDuration={chartAnimationMs}
            connectNulls={false}
          />
        ))}
      </RechartsLineChart>
    </ChartContainer>
  );
}

export function LiveMetricChart({
  data,
  series,
  ...props
}: Omit<LiveTelemetryChartProps, "series"> & { series: ChartSeries }) {
  const values = React.useMemo(
    () => data.map((point) => point[series.key]).filter((value): value is number => typeof value === "number"),
    [data, series.key],
  );
  return (
    <LiveTelemetryChart
      {...props}
      data={data}
      series={[series]}
      valueUnit={series.unit}
      startAtZero
      statusLabel={values.length > 0 ? undefined : "بانتظار قياس فعلي"}
    />
  );
}

function filterToWindow(
  data: LiveTelemetryPoint[],
  window: LiveTimeWindow,
): LiveTelemetryPoint[] {
  const stamped = data.flatMap((point) => {
    const timestamp = toTimestamp(point.timestamp);
    return timestamp == null ? [] : [{ point, timestamp }];
  });
  if (!stamped.length) return [];
  const latest = stamped[stamped.length - 1].timestamp;
  const cutoff = latest - WINDOW_MS[window];
  return stamped
    .filter(({ timestamp }) => timestamp >= cutoff)
    .map(({ point }) => point);
}

function latestNumericValue(
  data: LiveTelemetryPoint[],
  key?: string,
): number | null {
  if (!key) return null;
  for (let index = data.length - 1; index >= 0; index -= 1) {
    const value = data[index][key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function toTimestamp(value: number | string): number | null {
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}
