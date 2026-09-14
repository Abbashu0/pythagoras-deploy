"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  formatCompact,
  formatCurrency,
  formatDuration,
  formatExact,
  formatNumber,
  formatPercent,
  formatRelativeShort,
} from "@/lib/format";
import { Tooltip } from "../primitives/tooltip";
import { Mono, CopyButton } from "../primitives/mono";
import { EntityGlyph } from "../primitives/avatar";
import { StatusBadge, StatusDot, Badge } from "../status/status-badge";
import type { StatusKey, StatusTone } from "../status/status-registry";
import { ProgressBar } from "../primitives/progress";

/* ============================================================================
   Table cells
   ---------------------------------------------------------------------------
   A small vocabulary of cell renderers, so the same kind of value looks the
   same in every table in the product. Each one solves a specific scanning
   problem:

   - PrimaryCell   the row's identity: bold label + quiet secondary line
   - MonoCell      technical ids, LTR-isolated, copy on hover
   - NumberCell    end-aligned tabular figures with optional unit
   - CurrencyCell  costs, with sub-cent precision where it matters
   - PercentCell   ratios with an optional threshold tone
   - DateCell      relative label, exact timestamp in the tooltip
   - StatusCell    the shared status primitive, sized for a row
   - TrendCell     delta with direction and semantic colour
   - MetricBarCell a value plus an inline bar, for share-of-total columns
   ========================================================================== */

export function PrimaryCell({
  label,
  secondary,
  href,
  icon,
  glyph,
  status,
  className,
  onClick,
  badges,
}: {
  label: React.ReactNode;
  secondary?: React.ReactNode;
  href?: string;
  icon?: React.ReactNode;
  /** Monogram / entity mark before the label. */
  glyph?: { name?: string; icon?: React.ReactNode; tone?: StatusTone };
  status?: StatusKey;
  className?: string;
  onClick?: () => void;
  badges?: React.ReactNode;
}) {
  const body = (
    <span className="flex min-w-0 items-center gap-2.5">
      {glyph ? (
        <EntityGlyph
          size="sm"
          name={glyph.name}
          icon={glyph.icon}
          tone={glyph.tone ?? "neutral"}
        />
      ) : icon ? (
        <span className="shrink-0 text-fg-tertiary [&_svg]:size-4">{icon}</span>
      ) : null}
      {status ? <StatusDot status={status} size="sm" /> : null}
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate font-medium text-fg">{label}</span>
          {badges}
        </span>
        {secondary ? (
          <span className="mt-0.5 block truncate text-2xs text-fg-quaternary">
            {secondary}
          </span>
        ) : null}
      </span>
    </span>
  );

  if (href) {
    return (
      <Link
        href={href}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "-mx-1 block min-w-0 rounded-[4px] px-1 hover:underline",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
          className,
        )}
      >
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cn(
          "-mx-1 block min-w-0 rounded-[4px] px-1 text-start hover:underline",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
          className,
        )}
      >
        {body}
      </button>
    );
  }
  return <span className={cn("block min-w-0", className)}>{body}</span>;
}

export function MonoCell({
  value,
  truncate = 30,
  copyable = true,
  className,
  href,
}: {
  value: string;
  truncate?: number;
  copyable?: boolean;
  className?: string;
  href?: string;
}) {
  const short = value.length > truncate ? `${value.slice(0, truncate - 1)}…` : value;
  return (
    <span className={cn("group/mc inline-flex min-w-0 items-center gap-1", className)}>
      <Tooltip content={short !== value ? value : null}>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 hover:underline"
          >
            <Mono>{short}</Mono>
          </a>
        ) : (
          <Mono>{short}</Mono>
        )}
      </Tooltip>
      {copyable ? (
        <span className="opacity-0 transition-opacity group-hover/mc:opacity-100 focus-within:opacity-100">
          <CopyButton value={value} size="xs" />
        </span>
      ) : null}
    </span>
  );
}

export function NumberCell({
  value,
  unit,
  compact = false,
  decimals = 0,
  muted = false,
  emptyLabel = "—",
  className,
}: {
  value: number | null | undefined;
  unit?: React.ReactNode;
  compact?: boolean;
  decimals?: number;
  muted?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  if (value == null)
    return <span className="text-fg-quaternary">{emptyLabel}</span>;
  return (
    <span className={cn("tnum", muted ? "text-fg-tertiary" : "text-fg", className)}>
      {compact ? formatCompact(value) : formatNumber(value, { decimals })}
      {unit ? (
        <span className="ms-1 text-2xs text-fg-quaternary">{unit}</span>
      ) : null}
    </span>
  );
}

export function CurrencyCell({
  value,
  currency = "USD",
  emphasis = false,
  emptyLabel = "—",
  className,
}: {
  value: number | null | undefined;
  currency?: string;
  emphasis?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  if (value == null)
    return <span className="text-fg-quaternary">{emptyLabel}</span>;
  return (
    <span
      dir="ltr"
      className={cn(
        "ltr-island tnum",
        emphasis ? "font-medium text-fg" : "text-fg-secondary",
        className,
      )}
    >
      {formatCurrency(value, { currency })}
    </span>
  );
}

export function PercentCell({
  value,
  decimals = 1,
  alreadyScaled = false,
  /** Below `warn` → warning tone, below `bad` → danger tone. */
  thresholds,
  className,
}: {
  value: number | null | undefined;
  decimals?: number;
  alreadyScaled?: boolean;
  thresholds?: { warn: number; bad: number };
  className?: string;
}) {
  if (value == null) return <span className="text-fg-quaternary">—</span>;
  const normalised = alreadyScaled ? value / 100 : value;
  const tone =
    thresholds == null
      ? "text-fg"
      : normalised < thresholds.bad
        ? "text-danger-text font-medium"
        : normalised < thresholds.warn
          ? "text-warning-text"
          : "text-fg";
  return (
    <span className={cn("tnum", tone, className)}>
      {formatPercent(value, { decimals, alreadyScaled })}
    </span>
  );
}

export function DurationCell({
  ms,
  thresholds,
  className,
}: {
  ms: number | null | undefined;
  /** Above `warn` → warning, above `bad` → danger. */
  thresholds?: { warn: number; bad: number };
  className?: string;
}) {
  if (ms == null) return <span className="text-fg-quaternary">—</span>;
  const tone =
    thresholds == null
      ? "text-fg-secondary"
      : ms > thresholds.bad
        ? "text-danger-text font-medium"
        : ms > thresholds.warn
          ? "text-warning-text"
          : "text-fg-secondary";
  return <span className={cn("tnum", tone, className)}>{formatDuration(ms)}</span>;
}

export function DateCell({
  value,
  emptyLabel = "—",
  className,
  relative = true,
}: {
  value: Date | string | number | null | undefined;
  emptyLabel?: string;
  className?: string;
  relative?: boolean;
}) {
  if (value == null)
    return <span className="text-fg-quaternary">{emptyLabel}</span>;
  return (
    <Tooltip content={formatExact(value)}>
      <span
        className={cn("cursor-default whitespace-nowrap text-fg-tertiary tnum", className)}
      >
        {relative
          ? formatRelativeShort(value)
          : new Date(value).toLocaleDateString("ar-IQ-u-nu-latn")}
      </span>
    </Tooltip>
  );
}

export function StatusCell({
  status,
  label,
  appearance = "dot",
  className,
}: {
  status: StatusKey;
  label?: React.ReactNode;
  appearance?: "dot" | "subtle" | "outline";
  className?: string;
}) {
  return (
    <StatusBadge
      status={status}
      label={label}
      appearance={appearance}
      size="sm"
      className={className}
    />
  );
}

export function TrendCell({
  delta,
  /** Percentage vs. absolute. */
  format = "percent",
  /** For metrics where a decrease is good (latency, cost, failures). */
  inverted = false,
  className,
}: {
  delta: number | null | undefined;
  format?: "percent" | "number";
  inverted?: boolean;
  className?: string;
}) {
  if (delta == null) return <span className="text-fg-quaternary">—</span>;

  const flat = Math.abs(delta) < (format === "percent" ? 0.0005 : 0.5);
  const positive = delta > 0;
  const good = inverted ? !positive : positive;
  const Icon = flat ? Minus : positive ? ArrowUp : ArrowDown;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tnum",
        flat
          ? "text-fg-quaternary"
          : good
            ? "text-success-text"
            : "text-danger-text",
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {format === "percent"
        ? formatPercent(Math.abs(delta), { decimals: 1 })
        : formatNumber(Math.abs(delta))}
    </span>
  );
}

/** Value plus an inline bar — for "share of requests" style columns. */
export function MetricBarCell({
  value,
  total,
  tone = "accent",
  label,
  className,
}: {
  value: number;
  total: number;
  tone?: StatusTone;
  label?: React.ReactNode;
  className?: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span className="w-14 shrink-0 text-end text-fg tnum">
        {label ?? formatCompact(value)}
      </span>
      <ProgressBar
        value={pct}
        tone={tone}
        size="xs"
        animate={false}
        className="min-w-16 flex-1"
      />
      <span className="w-9 shrink-0 text-end text-2xs text-fg-quaternary tnum">
        {formatPercent(pct, { decimals: 0, alreadyScaled: true })}
      </span>
    </span>
  );
}

/** Two-value comparison inside one cell (before → after). */
export function ComparisonCell({
  from,
  to,
  format = (v) => formatNumber(v),
  inverted = false,
  className,
}: {
  from: number;
  to: number;
  format?: (value: number) => string;
  inverted?: boolean;
  className?: string;
}) {
  const improved = inverted ? to < from : to > from;
  const same = from === to;
  return (
    <span className={cn("inline-flex items-center gap-1.5 tnum", className)}>
      <span className="text-fg-quaternary">{format(from)}</span>
      <ArrowRight className="size-3 shrink-0 text-fg-quaternary rtl:rotate-180" aria-hidden />
      <span
        className={cn(
          "font-medium",
          same
            ? "text-fg"
            : improved
              ? "text-success-text"
              : "text-danger-text",
        )}
      >
        {format(to)}
      </span>
    </span>
  );
}

/** Capability / tag list that collapses gracefully in a narrow column. */
export function TagsCell({
  tags,
  max = 3,
  tone = "neutral",
  className,
}: {
  tags: string[];
  max?: number;
  tone?: StatusTone;
  className?: string;
}) {
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {shown.map((t) => (
        <Badge key={t} size="sm" variant="inset" tone={tone}>
          {t}
        </Badge>
      ))}
      {rest > 0 ? (
        <Tooltip content={tags.slice(max).join(" · ")}>
          <span className="cursor-default text-2xs text-fg-quaternary tnum">
            +{rest}
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}

/** Actor cell for audit tables — distinguishes humans from the system. */
export function ActorCell({
  name,
  kind = "user",
  detail,
  className,
}: {
  name: string;
  kind?: "user" | "system" | "agent";
  detail?: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <EntityGlyph
        size="xs"
        name={kind === "user" ? name : undefined}
        tone={kind === "system" ? "neutral" : kind === "agent" ? "accent" : "neutral"}
        variant={kind === "user" ? "subtle" : "outline"}
      />
      <span className="min-w-0">
        <span className="block truncate text-sm text-fg-secondary">{name}</span>
        {detail ? (
          <span className="block truncate text-2xs text-fg-quaternary">
            {detail}
          </span>
        ) : null}
      </span>
    </span>
  );
}
