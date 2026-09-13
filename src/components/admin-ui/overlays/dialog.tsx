"use client";

import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "../primitives/button";
import { ScrollArea } from "../primitives/scroll-area";

/* ============================================================================
   Dialog
   ---------------------------------------------------------------------------
   When to reach for a Dialog: a short, self-contained decision or a small form
   (≤ 6 fields) that the operator must finish before continuing.

   When NOT to: multi-section editing, anything with tabs, anything the operator
   needs to compare against the page behind it. Those belong in a Drawer
   (side-by-side context) or a full page (deep work).

   Sizes are capped at `xl`; if a dialog needs more than that, it is a page.
   ========================================================================== */

const SIZES = {
  sm: "max-w-[26rem]",
  md: "max-w-[32rem]",
  lg: "max-w-[42rem]",
  xl: "max-w-[56rem]",
} as const;

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  modal?: boolean;
}

export function Dialog({ children, ...props }: DialogProps) {
  return <D.Root {...props}>{children}</D.Root>;
}

export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogOverlay({ className }: { className?: string }) {
  return (
    <D.Overlay
      className={cn(
        "pyth-scrim-anim fixed inset-0 z-[var(--z-overlay)] bg-scrim backdrop-blur-[1px]",
        className,
      )}
    />
  );
}

export interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof D.Content> {
  size?: keyof typeof SIZES;
  /** Hide the default close button (confirmation flows that must be answered). */
  hideClose?: boolean;
}

export const DialogContent = React.forwardRef<
  HTMLDivElement,
  DialogContentProps
>(function DialogContent(
  {
    size = "md",
    hideClose = false,
    className,
    children,
    ...props
  },
  ref,
) {
  return (
    <D.Portal>
      <DialogOverlay />
      <D.Content
        ref={ref}
        className={cn(
          "pyth-dialog-anim fixed left-1/2 top-1/2 z-[var(--z-modal)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2",
          "flex max-h-[min(85dvh,48rem)] flex-col overflow-hidden rounded-xl border border-border bg-elevated shadow-xl",
          SIZES[size],
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <D.Close asChild>
            <IconButton
              label="إغلاق"
              size="sm"
              variant="ghost"
              className="absolute end-3 top-3 z-10"
            >
              <X aria-hidden />
            </IconButton>
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  );
});

export function DialogHeader({
  title,
  description,
  icon,
  className,
  children,
  bordered = false,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
  bordered?: boolean;
}) {
  return (
    <div
      className={cn(
        "shrink-0 px-5 pb-3 pe-14 pt-5",
        bordered && "border-b border-border-subtle pb-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
        <div className="min-w-0">
          <D.Title className="text-md font-semibold leading-snug text-fg">
            {title}
          </D.Title>
          {description ? (
            <D.Description className="mt-1.5 text-sm leading-[1.7] text-fg-secondary">
              {description}
            </D.Description>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}

export function DialogBody({
  className,
  scroll = true,
  children,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & { scroll?: boolean }) {
  if (!scroll) {
    return (
      <div className={cn("px-5 py-1", className)} {...props}>
        {children}
      </div>
    );
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className={cn("px-5 py-1", className)} {...props}>
        {children}
      </div>
    </ScrollArea>
  );
}

export function DialogFooter({
  className,
  align = "end",
  children,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  align?: "start" | "between" | "end";
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-2 border-t border-border-subtle bg-surface-secondary px-5 py-3.5",
        align === "end" && "justify-end",
        align === "between" && "justify-between",
        align === "start" && "justify-start",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Accessible title for dialogs that render their own visual header. */
export const DialogTitle = D.Title;
export const DialogDescription = D.Description;
