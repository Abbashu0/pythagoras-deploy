"use client";

import * as React from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import * as CM from "@radix-ui/react-context-menu";
import { Check, ChevronLeft, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton, type ButtonProps } from "../primitives/button";
import { Shortcut } from "../primitives/kbd";

/* ============================================================================
   Menus
   ---------------------------------------------------------------------------
   A menu is for *secondary* actions. If an action is one of the two or three
   things an operator does on this screen, it belongs on the surface as a
   button — not hidden behind "⋯". The old admin buried Edit and Delete in
   menus and that is precisely the failure this system is correcting.

   What legitimately belongs in a menu:
   - low-frequency variants (Duplicate configuration, Export)
   - destructive actions that already have a visible entry point elsewhere
   - per-row overflow when a table has more than 3 row actions

   Chevrons for submenus point *inline-start* in RTL: ChevronLeft is correct.
   ========================================================================== */

const itemBase = [
  "group/mi relative flex cursor-pointer select-none items-center gap-2.5 rounded-[5px]",
  "px-2 py-[7px] text-sm text-fg outline-none",
  "transition-colors duration-[var(--dur-fast)]",
  "data-[highlighted]:bg-hover data-[highlighted]:text-fg",
  "data-[disabled]:pointer-events-none data-[disabled]:text-disabled-fg",
  "[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-fg-tertiary",
  "data-[highlighted]:[&>svg]:text-fg-secondary",
].join(" ");

const dangerItem = [
  "text-danger-text [&>svg]:text-danger-text",
  "data-[highlighted]:bg-danger-subtle data-[highlighted]:text-danger-text",
  "data-[highlighted]:[&>svg]:text-danger-text",
].join(" ");

const contentBase = [
  "pyth-overlay-anim z-[var(--z-dropdown)] min-w-[12rem] overflow-hidden",
  "rounded-lg border border-border bg-elevated p-1 shadow-lg",
  "max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto",
].join(" ");

/* ---- Dropdown ----------------------------------------------------------- */

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;
export const MenuGroup = DM.Group;
export const MenuRadioGroup = DM.RadioGroup;
export const MenuSub = DM.Sub;

export const MenuContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DM.Content>
>(function MenuContent({ className, sideOffset = 6, align = "end", ...props }, ref) {
  return (
    <DM.Portal>
      <DM.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        collisionPadding={12}
        className={cn(contentBase, className)}
        {...props}
      />
    </DM.Portal>
  );
});

export interface MenuItemProps
  extends React.ComponentPropsWithoutRef<typeof DM.Item> {
  icon?: React.ReactNode;
  shortcut?: string;
  /** Destructive tone. Still requires a confirmation step downstream. */
  danger?: boolean;
  /** Secondary line under the label, for consequences worth stating. */
  hint?: React.ReactNode;
  trailing?: React.ReactNode;
}

export const MenuItem = React.forwardRef<HTMLDivElement, MenuItemProps>(
  function MenuItem(
    { className, icon, shortcut, danger, hint, trailing, children, ...props },
    ref,
  ) {
    return (
      <DM.Item
        ref={ref}
        className={cn(itemBase, danger && dangerItem, hint && "items-start py-2", className)}
        {...props}
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{children}</span>
          {hint ? (
            <span className="mt-0.5 block text-2xs leading-snug text-fg-quaternary">
              {hint}
            </span>
          ) : null}
        </span>
        {shortcut ? (
          <Shortcut keys={shortcut} size="sm" muted className="ms-auto" />
        ) : null}
        {trailing}
      </DM.Item>
    );
  },
);

export const MenuCheckboxItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DM.CheckboxItem> & { shortcut?: string }
>(function MenuCheckboxItem({ className, children, shortcut, ...props }, ref) {
  return (
    <DM.CheckboxItem
      ref={ref}
      className={cn(itemBase, "ps-2", className)}
      {...props}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <DM.ItemIndicator>
          <Check className="size-3.5 text-accent" aria-hidden />
        </DM.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut ? <Shortcut keys={shortcut} size="sm" muted /> : null}
    </DM.CheckboxItem>
  );
});

export const MenuRadioItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DM.RadioItem>
>(function MenuRadioItem({ className, children, ...props }, ref) {
  return (
    <DM.RadioItem ref={ref} className={cn(itemBase, "ps-2", className)} {...props}>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <DM.ItemIndicator>
          <span className="size-1.5 rounded-full bg-accent" />
        </DM.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </DM.RadioItem>
  );
});

export function MenuLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DM.Label>) {
  return (
    <DM.Label
      className={cn("eyebrow px-2 pb-1 pt-2 first:pt-1", className)}
      {...props}
    />
  );
}

export function MenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DM.Separator>) {
  return (
    <DM.Separator
      className={cn("-mx-1 my-1 h-px bg-separator", className)}
      {...props}
    />
  );
}

export const MenuSubTrigger = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DM.SubTrigger> & {
    icon?: React.ReactNode;
  }
>(function MenuSubTrigger({ className, icon, children, ...props }, ref) {
  return (
    <DM.SubTrigger
      ref={ref}
      className={cn(itemBase, "data-[state=open]:bg-hover", className)}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {/* Points toward the inline start, i.e. where the submenu opens in RTL. */}
      <ChevronLeft className="size-3.5 text-fg-quaternary rtl:rotate-0 ltr:rotate-180" aria-hidden />
    </DM.SubTrigger>
  );
});

export const MenuSubContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DM.SubContent>
>(function MenuSubContent({ className, ...props }, ref) {
  return (
    <DM.Portal>
      <DM.SubContent
        ref={ref}
        sideOffset={2}
        alignOffset={-4}
        collisionPadding={12}
        className={cn(contentBase, className)}
        {...props}
      />
    </DM.Portal>
  );
});

/* ---- Overflow trigger --------------------------------------------------- */

export const MenuOverflowTrigger = React.forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "children"> & { label?: string }
>(function MenuOverflowTrigger(
  { label = "إجراءات إضافية", size = "sm", className, ...props },
  ref,
) {
  return (
    <IconButton
      ref={ref}
      label={label}
      size={size}
      variant="ghost"
      className={cn("data-[state=open]:bg-hover-strong", className)}
      {...props}
    >
      <MoreHorizontal aria-hidden />
    </IconButton>
  );
});

/* ---- Context menu ------------------------------------------------------- */

export const ContextMenu = CM.Root;
export const ContextMenuTrigger = CM.Trigger;

export const ContextMenuContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof CM.Content>
>(function ContextMenuContent({ className, ...props }, ref) {
  return (
    <CM.Portal>
      <CM.Content
        ref={ref}
        collisionPadding={12}
        className={cn(contentBase, className)}
        {...props}
      />
    </CM.Portal>
  );
});

export const ContextMenuItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof CM.Item> & {
    icon?: React.ReactNode;
    shortcut?: string;
    danger?: boolean;
  }
>(function ContextMenuItem(
  { className, icon, shortcut, danger, children, ...props },
  ref,
) {
  return (
    <CM.Item
      ref={ref}
      className={cn(itemBase, danger && dangerItem, className)}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut ? <Shortcut keys={shortcut} size="sm" muted /> : null}
    </CM.Item>
  );
});

export function ContextMenuLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof CM.Label>) {
  return (
    <CM.Label className={cn("eyebrow px-2 pb-1 pt-1.5", className)} {...props} />
  );
}

export function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof CM.Separator>) {
  return (
    <CM.Separator
      className={cn("-mx-1 my-1 h-px bg-separator", className)}
      {...props}
    />
  );
}
