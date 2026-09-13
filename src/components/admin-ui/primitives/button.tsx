"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, ChevronDown, Loader2, AlertCircle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { statusSwap } from "@/lib/motion";
import type { AsyncActionState } from "@/lib/hooks";

/* ============================================================================
   Button
   ---------------------------------------------------------------------------
   Why it exists: one interaction surface with a fixed vocabulary of emphasis
   levels, so an operator can always tell what the primary action on a screen
   is without reading every label.

   Geometry contract: `loading` and `success` never change the button's box.
   The label stays in flow (opacity 0) and the indicator is absolutely centred
   on top, so toolbars never reflow mid-request.
   ========================================================================== */

const buttonVariants = cva(
  [
    "group/btn relative inline-flex shrink-0 select-none items-center justify-center gap-1.5",
    "whitespace-nowrap font-medium",
    "transition-[background-color,border-color,color,box-shadow,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
    "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
    "disabled:pointer-events-none disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:opacity-55",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        /** The one obvious action. At most one per view region. */
        primary: [
          "bg-accent text-on-accent shadow-xs",
          "hover:bg-accent-hover active:bg-accent-active",
        ],
        /** Bordered neutral — the default for most toolbar actions. */
        secondary: [
          "border border-border bg-surface text-fg shadow-xs",
          "hover:bg-hover hover:border-border-strong active:bg-active",
        ],
        /** Tonal, borderless. For grouped actions inside a panel. */
        quiet: ["bg-hover text-fg", "hover:bg-hover-strong active:bg-active"],
        /** No chrome until hovered. Row actions, icon affordances. */
        ghost: [
          "text-fg-secondary hover:bg-hover hover:text-fg active:bg-active",
        ],
        /** Outline with accent text — for "add" affordances in empty states. */
        outline: [
          "border border-dashed border-border-strong bg-transparent text-fg-secondary",
          "hover:border-accent-border hover:bg-accent-subtle hover:text-accent-text",
        ],
        /** Accent, but tonal rather than solid. Secondary CTA. */
        accentSubtle: [
          "bg-accent-subtle text-accent-text",
          "hover:bg-accent-subtle-hover active:bg-accent-subtle-hover",
        ],
        /** Irreversible, confirmed action. Solid red is earned, not default. */
        destructive: [
          "bg-danger text-on-accent shadow-xs",
          "hover:bg-danger-hover active:bg-danger-hover",
        ],
        /** Entry point to a destructive flow (opens confirmation). */
        dangerGhost: [
          "text-danger-text hover:bg-danger-subtle active:bg-danger-subtle",
        ],
        dangerOutline: [
          "border border-danger-border bg-surface text-danger-text shadow-xs",
          "hover:bg-danger-subtle",
        ],
        /** Inline text action inside prose or a metadata row. */
        link: [
          "h-auto p-0 text-accent-text underline decoration-[var(--accent-border)] decoration-1 underline-offset-[3px]",
          "hover:decoration-[var(--accent)]",
        ],
      },
      size: {
        xs: "h-control-xs rounded-sm px-1.5 text-2xs [&_svg]:size-3",
        sm: "h-control-sm rounded-sm px-2 text-xs [&_svg]:size-3.5",
        md: "h-control-md rounded-md px-2.5 text-sm [&_svg]:size-4",
        lg: "h-control-lg rounded-md px-3.5 text-sm [&_svg]:size-4",
        xl: "h-control-xl rounded-lg px-5 text-base [&_svg]:size-[18px]",
      },
      /** Square, label-free. Always needs an accessible name. */
      iconOnly: {
        true: "gap-0 px-0",
        false: "",
      },
      block: {
        true: "w-full",
        false: "",
      },
    },
    compoundVariants: [
      { iconOnly: true, size: "xs", class: "w-control-xs" },
      { iconOnly: true, size: "sm", class: "w-control-sm" },
      { iconOnly: true, size: "md", class: "w-control-md" },
      { iconOnly: true, size: "lg", class: "w-control-lg" },
      { iconOnly: true, size: "xl", class: "w-control-xl" },
      { variant: "link", size: "xs", class: "h-auto" },
      { variant: "link", size: "sm", class: "h-auto" },
      { variant: "link", size: "md", class: "h-auto" },
      { variant: "link", size: "lg", class: "h-auto" },
      { variant: "link", size: "xl", class: "h-auto" },
    ],
    defaultVariants: {
      variant: "secondary",
      size: "md",
      iconOnly: false,
      block: false,
    },
  },
);

export type ButtonVariant = NonNullable<
  VariantProps<typeof buttonVariants>["variant"]
>;
export type ButtonSize = NonNullable<
  VariantProps<typeof buttonVariants>["size"]
>;

export interface ButtonProps
  extends Omit<React.ComponentPropsWithoutRef<"button">, "children">,
    VariantProps<typeof buttonVariants> {
  children?: React.ReactNode;
  /** Render as the child element (links, menu triggers). */
  asChild?: boolean;
  /** Leading icon — sits at the inline start in both directions. */
  icon?: React.ReactNode;
  /** Trailing icon. Use for chevrons and external-link marks. */
  trailingIcon?: React.ReactNode;
  /** Shows a spinner without changing the box. Also blocks clicks. */
  loading?: boolean;
  /** Replaces the label with a check for ~1.4s after a successful action. */
  success?: boolean;
  /** Replaces the label with an alert glyph after a failed action. */
  failed?: boolean;
  /** Convenience: drives loading/success/failed from useAsyncAction. */
  state?: AsyncActionState;
  /** Announced while loading; also used as the aria-live message. */
  loadingLabel?: string;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant,
      size,
      iconOnly,
      block,
      asChild = false,
      icon,
      trailingIcon,
      loading = false,
      success = false,
      failed = false,
      state,
      loadingLabel = "جارٍ التنفيذ…",
      children,
      disabled,
      type = "button",
      ...props
    },
    ref,
  ) {
    const isLoading = loading || state === "pending";
    const isSuccess = success || state === "success";
    const isFailed = failed || state === "error";
    const overlay = isLoading ? "loading" : isSuccess ? "success" : isFailed ? "failed" : null;

    if (asChild) {
      return (
        <Slot
          className={cn(
            buttonVariants({ variant, size, iconOnly, block }),
            className,
          )}
          {...props}
        >
          {children as React.ReactElement}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || isLoading}
        data-loading={isLoading || undefined}
        data-state={overlay ?? "idle"}
        className={cn(
          buttonVariants({ variant, size, iconOnly, block }),
          className,
        )}
        {...props}
      >
        {/* Label layer — stays in flow so the box never resizes. */}
        <span
          className={cn(
            "inline-flex items-center justify-center gap-1.5",
            overlay && "invisible",
          )}
        >
          {icon}
          {children != null && children !== false ? (
            <span className="truncate">{children}</span>
          ) : null}
          {trailingIcon}
        </span>

        {/* Indicator layer — absolutely centred over the reserved box. */}
        <AnimatePresence initial={false}>
          {overlay ? (
            <motion.span
              key={overlay}
              variants={statusSwap}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="absolute inset-0 inline-flex items-center justify-center gap-1.5"
            >
              {overlay === "loading" ? (
                <Loader2
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : overlay === "success" ? (
                <Check aria-hidden />
              ) : (
                <AlertCircle aria-hidden />
              )}
            </motion.span>
          ) : null}
        </AnimatePresence>

        {isLoading ? (
          <span className="sr-only" role="status">
            {loadingLabel}
          </span>
        ) : null}
      </button>
    );
  },
);

/* ============================================================================
   IconButton — a Button that requires an accessible label.
   ========================================================================== */

export interface IconButtonProps extends Omit<ButtonProps, "iconOnly"> {
  /** Required: icon-only controls must still be announced. */
  label: string;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ label, variant = "ghost", children, ...props }, ref) {
    return (
      <Button
        ref={ref}
        iconOnly
        variant={variant}
        aria-label={label}
        {...props}
      >
        {children}
      </Button>
    );
  },
);

/* ============================================================================
   ButtonGroup — segmented row of buttons sharing one border.
   ========================================================================== */

export function ButtonGroup({
  className,
  attached = true,
  children,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & { attached?: boolean }) {
  return (
    <div
      role="group"
      className={cn(
        "inline-flex items-center",
        attached
          ? [
              "[&>*]:rounded-none",
              "[&>*:first-child]:rounded-s-md [&>*:last-child]:rounded-e-md",
              "[&>*:not(:first-child)]:-ms-px",
              "[&>*:focus-visible]:z-10 [&>*:hover]:z-10",
            ]
          : "gap-1.5",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* ============================================================================
   SplitButton — a default action plus a menu of related actions.
   The divider makes the two hit targets visually distinct, which matters a
   lot at 28–32px control heights.
   ========================================================================== */

export interface SplitButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  /** The dropdown trigger. Wrap it in your menu's Trigger with asChild. */
  menu: React.ReactNode;
  variant?: Extract<ButtonVariant, "primary" | "secondary" | "quiet">;
  size?: ButtonSize;
  icon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}

export function SplitButton({
  children,
  onClick,
  menu,
  variant = "primary",
  size = "md",
  icon,
  loading,
  disabled,
  className,
}: SplitButtonProps) {
  return (
    <div className={cn("inline-flex items-stretch", className)}>
      <Button
        variant={variant}
        size={size}
        icon={icon}
        loading={loading}
        disabled={disabled}
        onClick={onClick}
        className="rounded-e-none"
      >
        {children}
      </Button>
      <span
        aria-hidden
        className={cn(
          "w-px self-stretch",
          variant === "primary"
            ? "bg-[color-mix(in_oklab,var(--text-on-accent)_28%,transparent)]"
            : "bg-border",
        )}
      />
      {menu}
    </div>
  );
}

/** The trailing half of a SplitButton. Pass as your menu Trigger child. */
export const SplitButtonTrigger = React.forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "children"> & { label?: string }
>(function SplitButtonTrigger(
  { label = "خيارات إضافية", variant = "primary", size = "md", className, ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      iconOnly
      aria-label={label}
      className={cn("rounded-s-none", className)}
      {...props}
    >
      <ChevronDown aria-hidden />
    </Button>
  );
});

/** Button that visually announces it opens a menu. */
export const DropdownButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function DropdownButton({ children, ...props }, ref) {
    return (
      <Button
        ref={ref}
        trailingIcon={
          <ChevronDown
            className="opacity-60 transition-transform duration-[var(--dur-fast)] group-data-[state=open]/btn:rotate-180"
            aria-hidden
          />
        }
        {...props}
      >
        {children}
      </Button>
    );
  },
);

export { Button, IconButton, buttonVariants };
