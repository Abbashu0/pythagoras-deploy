"use client";

import * as React from "react";
import * as P from "@radix-ui/react-popover";
import * as H from "@radix-ui/react-hover-card";
import { cn } from "@/lib/cn";

/* ============================================================================
   Popover / HoverCard
   ---------------------------------------------------------------------------
   Popover  : click-opened, focusable, may contain controls.
   HoverCard: hover-opened, read-only preview. Never put an action inside one —
              a pointer-only affordance is not reachable by keyboard.
   ========================================================================== */

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export const PopoverClose = P.Close;

export interface PopoverContentProps
  extends React.ComponentPropsWithoutRef<typeof P.Content> {
  padding?: "none" | "sm" | "md";
  width?: number | string;
}

export const PopoverContent = React.forwardRef<
  HTMLDivElement,
  PopoverContentProps
>(function PopoverContent(
  {
    className,
    align = "start",
    sideOffset = 6,
    padding = "md",
    width,
    style,
    children,
    ...props
  },
  ref,
) {
  return (
    <P.Portal>
      <P.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          "pyth-overlay-anim z-[var(--z-popover)] overflow-hidden rounded-lg border border-border bg-elevated shadow-lg",
          "max-h-[min(28rem,var(--radix-popover-content-available-height))]",
          padding === "sm" && "p-2",
          padding === "md" && "p-3.5",
          className,
        )}
        style={{ width, ...style }}
        {...props}
      >
        {children}
      </P.Content>
    </P.Portal>
  );
});

export function PopoverHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-fg">{title}</p>
        {description ? (
          <p className="mt-0.5 text-xs leading-[1.6] text-fg-tertiary">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   HoverCard — entity previews on hover (a model name in a table, an actor in
   an audit row). Read-only by contract.
   ------------------------------------------------------------------------ */

export function HoverCard({
  children,
  content,
  openDelay = 320,
  closeDelay = 120,
  side = "top",
  align = "center",
  width = 300,
  className,
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  openDelay?: number;
  closeDelay?: number;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  width?: number;
  className?: string;
}) {
  return (
    <H.Root openDelay={openDelay} closeDelay={closeDelay}>
      <H.Trigger asChild>{children}</H.Trigger>
      <H.Portal>
        <H.Content
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={12}
          className={cn(
            "pyth-overlay-anim z-[var(--z-popover)] rounded-lg border border-border bg-elevated p-3.5 shadow-lg",
            className,
          )}
          style={{ width }}
        >
          {content}
        </H.Content>
      </H.Portal>
    </H.Root>
  );
}
