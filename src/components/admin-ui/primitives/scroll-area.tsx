"use client";

import * as React from "react";
import * as SA from "@radix-ui/react-scroll-area";
import { cn } from "@/lib/cn";

/* ============================================================================
   ScrollArea
   ---------------------------------------------------------------------------
   Radix handles RTL scrollbar placement via the Direction provider. We keep
   the bar thin and tonal so long sidebars and drawers stay quiet.
   ========================================================================== */

export interface ScrollAreaProps
  extends React.ComponentPropsWithoutRef<typeof SA.Root> {
  viewportClassName?: string;
  orientation?: "vertical" | "horizontal" | "both";
  /** Fade the top/bottom edges to signal more content. */
  fade?: boolean;
  viewportRef?: React.Ref<HTMLDivElement>;
}

export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  function ScrollArea(
    {
      className,
      viewportClassName,
      orientation = "vertical",
      fade = false,
      children,
      viewportRef,
      ...props
    },
    ref,
  ) {
    return (
      <SA.Root
        ref={ref}
        scrollHideDelay={400}
        className={cn("relative overflow-hidden", className)}
        {...props}
      >
        <SA.Viewport
          ref={viewportRef}
          className={cn(
            "size-full rounded-[inherit] [&>div]:!block",
            fade && "mask-fade-y",
            viewportClassName,
          )}
        >
          {children}
        </SA.Viewport>
        {orientation !== "horizontal" ? <Bar orientation="vertical" /> : null}
        {orientation !== "vertical" ? <Bar orientation="horizontal" /> : null}
        <SA.Corner />
      </SA.Root>
    );
  },
);

function Bar({ orientation }: { orientation: "vertical" | "horizontal" }) {
  return (
    <SA.Scrollbar
      orientation={orientation}
      className={cn(
        "flex touch-none select-none p-0.5 transition-opacity duration-[var(--dur-medium)]",
        "data-[state=hidden]:opacity-0",
        orientation === "vertical" ? "w-2" : "h-2 flex-col",
      )}
    >
      <SA.Thumb className="relative flex-1 rounded-full bg-border-strong transition-colors hover:bg-fg-quaternary" />
    </SA.Scrollbar>
  );
}
