"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/* ============================================================================
   Skeleton
   ---------------------------------------------------------------------------
   Rule: skeleton geometry must match the final content, otherwise the load
   reads as a layout bug. Every list/table/chart in this system ships its own
   skeleton that mirrors its real row heights and column widths.
   ========================================================================== */

export function Skeleton({
  className,
  radius = "sm",
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  radius?: "sm" | "md" | "lg" | "full";
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "pyth-skeleton",
        radius === "sm" && "rounded-sm",
        radius === "md" && "rounded-md",
        radius === "lg" && "rounded-lg",
        radius === "full" && "rounded-full",
        className,
      )}
      {...props}
    />
  );
}

/** Text block with a deliberately short last line. */
export function SkeletonText({
  lines = 3,
  className,
  lineClassName,
}: {
  lines?: number;
  className?: string;
  lineClassName?: string;
}) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            "h-3",
            i === lines - 1 ? "w-[45%]" : i % 2 === 0 ? "w-full" : "w-[88%]",
            lineClassName,
          )}
        />
      ))}
    </div>
  );
}

/** Matches the geometry of a 44px table row with avatar + two text lines. */
export function SkeletonRow({
  columns = [40, 22, 18, 20],
  height = 44,
  className,
}: {
  /** Percentage widths, one per column. */
  columns?: number[];
  height?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 border-b border-border-subtle px-3",
        className,
      )}
      style={{ height }}
      aria-hidden
    >
      {columns.map((w, i) => (
        <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export function SkeletonTable({
  rows = 6,
  columns = [34, 20, 16, 16, 14],
  className,
}: {
  rows?: number;
  columns?: number[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-surface",
        className,
      )}
      aria-hidden
    >
      <div className="flex h-9 items-center gap-4 border-b border-border bg-inset px-3">
        {columns.map((w, i) => (
          <Skeleton
            key={i}
            className="h-2.5 opacity-70"
            style={{ width: `${w * 0.7}%` }}
          />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} columns={columns} className="border-b-0 odd:bg-transparent" />
      ))}
    </div>
  );
}

/** Chart placeholder: axis rails plus a plausible silhouette. */
export function SkeletonChart({
  height = 200,
  className,
  bars = false,
}: {
  height?: number;
  className?: string;
  bars?: boolean;
}) {
  const heights = [52, 74, 45, 88, 63, 96, 71, 58, 82, 66, 91, 49];
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden>
      <div
        className="flex items-end gap-[3%] border-b border-s border-border-subtle ps-1"
        style={{ height }}
      >
        {heights.map((h, i) => (
          <Skeleton
            key={i}
            className={cn("flex-1", bars ? "rounded-t-sm" : "rounded-sm")}
            style={{ height: `${h}%`, opacity: 0.55 + (i % 3) * 0.1 }}
          />
        ))}
      </div>
      <div className="flex justify-between px-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-2 w-8 opacity-60" />
        ))}
      </div>
    </div>
  );
}

/** Metric tile placeholder — label line, value line, trend line. */
export function SkeletonMetric({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)} aria-hidden>
      <Skeleton className="h-2.5 w-20" />
      <Skeleton className="h-6 w-28" />
      <Skeleton className="h-2 w-16 opacity-60" />
    </div>
  );
}

/** Form placeholder — label + control pairs at real control heights. */
export function SkeletonForm({
  fields = 4,
  className,
}: {
  fields?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-5", className)} aria-hidden>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-control-md w-full" radius="md" />
        </div>
      ))}
    </div>
  );
}
