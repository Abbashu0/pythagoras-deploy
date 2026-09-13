"use client";

import * as React from "react";
import * as S from "@radix-ui/react-separator";
import { cn } from "@/lib/cn";

/* ============================================================================
   Separator / Divider
   ---------------------------------------------------------------------------
   Two things, deliberately named differently:
   - Separator: a semantic hairline between peers.
   - Divider:   a labelled break that introduces a new group.
   If you need a third border to explain a relationship, use whitespace.
   ========================================================================== */

export function Separator({
  orientation = "horizontal",
  decorative = true,
  tone = "subtle",
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof S.Root> & {
  tone?: "subtle" | "default" | "strong";
}) {
  return (
    <S.Root
      orientation={orientation}
      decorative={decorative}
      className={cn(
        "shrink-0",
        tone === "subtle" && "bg-separator",
        tone === "default" && "bg-border",
        tone === "strong" && "bg-border-strong",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}

export function Divider({
  label,
  align = "start",
  className,
  actions,
}: {
  label?: React.ReactNode;
  align?: "start" | "center";
  className?: string;
  actions?: React.ReactNode;
}) {
  if (!label) return <Separator className={className} />;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {align === "center" ? <Separator className="flex-1" /> : null}
      <span className="eyebrow shrink-0">{label}</span>
      <Separator className="flex-1" />
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

/** Vertical hairline used between toolbar clusters. */
export function ToolbarDivider({ className }: { className?: string }) {
  return (
    <Separator
      orientation="vertical"
      className={cn("mx-1 h-5 self-center", className)}
    />
  );
}
