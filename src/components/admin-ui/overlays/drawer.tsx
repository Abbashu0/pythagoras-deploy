"use client";

import * as React from "react";
import * as D from "@radix-ui/react-dialog";
import { Drawer as Vaul } from "vaul";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "../primitives/button";
import { ScrollArea } from "../primitives/scroll-area";

/* ============================================================================
   Drawer
   ---------------------------------------------------------------------------
   The default home for "look at this thing while keeping the list in view":
   provider details, review changes, question preview, job details.

   Chosen over a Dialog whenever the operator benefits from the page behind it
   staying legible, and over a full page whenever a route change would lose
   their place in a long list.

   Enters from the inline-end edge (left in Arabic) — see utilities.css.
   Widths are capped so the master list is never fully covered at ≥1280px.
   ========================================================================== */

const WIDTHS = {
  sm: "sm:max-w-[24rem]",
  md: "sm:max-w-[32rem]",
  lg: "sm:max-w-[42rem]",
  xl: "sm:max-w-[52rem]",
  /** Nearly full width — for side-by-side diffs. */
  "2xl": "sm:max-w-[68rem]",
} as const;

export const Drawer = D.Root;
export const DrawerTrigger = D.Trigger;
export const DrawerClose = D.Close;

export interface DrawerContentProps
  extends React.ComponentPropsWithoutRef<typeof D.Content> {
  size?: keyof typeof WIDTHS;
  side?: "start" | "end";
  hideClose?: boolean;
  /** Dim + blur the page behind. Off for non-blocking inspector drawers. */
  overlay?: boolean;
}

export const DrawerContent = React.forwardRef<HTMLDivElement, DrawerContentProps>(
  function DrawerContent(
    {
      size = "md",
      side = "end",
      hideClose = false,
      overlay = true,
      className,
      children,
      ...props
    },
    ref,
  ) {
    return (
      <D.Portal>
        {overlay ? (
          <D.Overlay className="pyth-scrim-anim fixed inset-0 z-[var(--z-overlay)] bg-scrim" />
        ) : null}
        <D.Content
          ref={ref}
          className={cn(
            side === "end" ? "pyth-drawer-end" : "pyth-drawer-start",
            "fixed inset-y-0 z-[var(--z-modal)] flex w-full flex-col bg-surface shadow-xl outline-none",
            side === "end"
              ? "end-0 border-s border-border"
              : "start-0 border-e border-border",
            WIDTHS[size],
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
  },
);

export function DrawerHeader({
  title,
  description,
  eyebrow,
  icon,
  actions,
  className,
  children,
  bordered = true,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
  bordered?: boolean;
}) {
  return (
    <div
      className={cn(
        "shrink-0 px-5 pt-4",
        bordered ? "border-b border-border pb-4" : "pb-2",
        className,
      )}
    >
      <div className="flex items-start gap-3 pe-10">
        {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
        <div className="min-w-0 flex-1">
          {eyebrow ? <div className="eyebrow mb-1">{eyebrow}</div> : null}
          <D.Title className="truncate text-md font-semibold text-fg">
            {title}
          </D.Title>
          {description ? (
            <D.Description className="mt-1 text-xs leading-[1.7] text-fg-tertiary">
              {description}
            </D.Description>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function DrawerBody({
  className,
  scroll = true,
  padding = "md",
  children,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  scroll?: boolean;
  padding?: "none" | "sm" | "md";
}) {
  const inner = (
    <div
      className={cn(
        padding === "sm" && "p-4",
        padding === "md" && "px-5 py-4",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
  if (!scroll) return <div className="min-h-0 flex-1 overflow-hidden">{inner}</div>;
  return <ScrollArea className="min-h-0 flex-1">{inner}</ScrollArea>;
}

export function DrawerFooter({
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
        "flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface-secondary px-5 py-3.5",
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

export const DrawerTitle = D.Title;
export const DrawerDescription = D.Description;

/* ============================================================================
   BottomSheet — the narrow-width fallback for drawers and menus.
   Uses vaul for drag-to-dismiss, which is the one place a physical gesture
   genuinely beats a close button.
   ========================================================================== */

export function BottomSheet({
  open,
  onOpenChange,
  children,
  title,
  description,
  className,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <Vaul.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <Vaul.Portal>
        <Vaul.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-scrim" />
        <Vaul.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-[var(--z-modal)] mt-24 flex max-h-[88dvh] flex-col",
            "rounded-t-2xl border-t border-border bg-surface outline-none",
            className,
          )}
        >
          <div
            aria-hidden
            className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-border-strong"
          />
          {title ? (
            <div className="shrink-0 border-b border-border-subtle px-5 pb-3 pt-3">
              <Vaul.Title className="text-md font-semibold text-fg">
                {title}
              </Vaul.Title>
              {description ? (
                <Vaul.Description className="mt-1 text-xs text-fg-tertiary">
                  {description}
                </Vaul.Description>
              ) : null}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </Vaul.Content>
      </Vaul.Portal>
    </Vaul.Root>
  );
}

export const BottomSheetTrigger = Vaul.Trigger;
export const BottomSheetClose = Vaul.Close;
