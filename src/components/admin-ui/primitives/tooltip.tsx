"use client";

import * as React from "react";
import * as T from "@radix-ui/react-tooltip";
import { Info, HelpCircle } from "lucide-react";
import { cn } from "@/lib/cn";

/* ============================================================================
   Tooltip
   ---------------------------------------------------------------------------
   Convention: tooltips carry *supplemental* information only — exact
   timestamps, truncated values, keyboard hints, the reason a control is
   disabled. Never put a control's basic explanation behind a tooltip.
   ========================================================================== */

export interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** ms before showing. Overrides the provider default. */
  delay?: number;
  sideOffset?: number;
  /** Keep the tooltip mounted when the trigger is disabled. */
  disableHoverableContent?: boolean;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Renders nothing when content is empty, so callers can pass optionals. */
  asChild?: boolean;
}

export function Tooltip({
  children,
  content,
  side = "top",
  align = "center",
  delay,
  sideOffset = 6,
  className,
  open,
  onOpenChange,
  asChild = true,
}: TooltipProps) {
  if (content == null || content === "" || content === false) {
    return <>{children}</>;
  }

  return (
    <T.Root delayDuration={delay} open={open} onOpenChange={onOpenChange}>
      <T.Trigger asChild={asChild}>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          className={cn(
            "pyth-overlay-anim z-[var(--z-tooltip)] max-w-[min(20rem,calc(100vw-2rem))]",
            "rounded-md border border-border bg-elevated px-2 py-1.5",
            "text-xs leading-[1.55] text-fg-secondary shadow-lg",
            className,
          )}
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

/**
 * InfoTip — the only sanctioned "?" affordance. Use it for genuinely optional
 * technical nuance next to a field label, never for the field's purpose.
 */
export function InfoTip({
  content,
  variant = "info",
  className,
  label = "معلومات إضافية",
}: {
  content: React.ReactNode;
  variant?: "info" | "help";
  className?: string;
  label?: string;
}) {
  const Icon = variant === "help" ? HelpCircle : Info;
  return (
    <Tooltip content={content}>
      <button
        type="button"
        aria-label={label}
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-full",
          "text-fg-quaternary transition-colors hover:text-fg-secondary",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
          className,
        )}
      >
        <Icon className="size-3.5" aria-hidden />
      </button>
    </Tooltip>
  );
}

/**
 * Wraps a disabled control so the reason is still discoverable. A disabled
 * button never explains itself by being grey; it explains itself here.
 */
export function DisabledReason({
  reason,
  children,
  side = "top",
}: {
  reason: React.ReactNode;
  children: React.ReactNode;
  side?: TooltipProps["side"];
}) {
  return (
    <Tooltip content={reason} side={side} asChild>
      <span className="inline-flex cursor-not-allowed">{children}</span>
    </Tooltip>
  );
}

export const TooltipTitle = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-0.5 font-medium text-fg">{children}</div>
);
