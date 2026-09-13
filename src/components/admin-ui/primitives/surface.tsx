"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/* ============================================================================
   Surfaces
   ---------------------------------------------------------------------------
   The system has exactly four surface roles. Nesting is capped at two levels;
   a Well inside a Panel is fine, a Panel inside a Panel inside a Panel is a
   design error and this API makes it awkward on purpose.

   - Panel   : the primary container for a block of content.
   - Well    : an inset region inside a Panel (code, diff, read-only payload).
   - Tile    : a compact bordered cell for grids of small items.
   - Sheet   : a floating surface (dialogs/menus own this, not pages).
   ========================================================================== */

const panelVariants = cva("relative", {
  variants: {
    variant: {
      /** Default: hairline border, no shadow. Calm and flat. */
      outlined: "border border-border bg-surface",
      /** Raised: for panels that float over the canvas (inspector, drawer). */
      raised: "border border-border bg-surface shadow-sm",
      /** Ghost: grouping without chrome. Prefer this over a third border. */
      ghost: "bg-transparent",
      /** Tonal: gently separated from the canvas without a border. */
      tonal: "bg-surface-secondary",
      /** Inset: a recessed region. */
      inset: "border border-border-subtle bg-inset",
    },
    radius: {
      none: "rounded-none",
      md: "rounded-md",
      lg: "rounded-lg",
      xl: "rounded-xl",
    },
    padding: {
      none: "",
      xs: "p-2",
      sm: "p-3",
      md: "p-4",
      lg: "p-5",
      xl: "p-6",
    },
    /** Clips children — needed when a table or image reaches the edge. */
    clip: { true: "overflow-hidden", false: "" },
  },
  defaultVariants: {
    variant: "outlined",
    radius: "lg",
    padding: "none",
    clip: false,
  },
});

export interface PanelProps
  extends React.ComponentPropsWithoutRef<"div">,
    VariantProps<typeof panelVariants> {
  asChild?: boolean;
}

export const Panel = React.forwardRef<HTMLDivElement, PanelProps>(
  function Panel(
    { variant, radius, padding, clip, className, children, ...props },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          panelVariants({ variant, radius, padding, clip }),
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

/* ---------------------------------------------------------------------------
   PanelHeader — title row with optional description and trailing actions.
   The border is drawn only when there is body content beneath it.
   ------------------------------------------------------------------------ */

export interface PanelHeaderProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Small label above the title (entity type, group). */
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  /** Draw a separator under the header. */
  bordered?: boolean;
  density?: "compact" | "default";
  /** Renders title as an h2/h3 — pass the right level for the page outline. */
  as?: "h2" | "h3" | "h4" | "div";
}

export function PanelHeader({
  title,
  description,
  eyebrow,
  actions,
  icon,
  bordered = true,
  density = "default",
  as: Heading = "h3",
  className,
  children,
  ...props
}: PanelHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4",
        density === "compact" ? "px-3.5 py-2.5" : "px-4 py-3.5",
        bordered && "border-b border-border-subtle",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? (
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-fg-tertiary [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          {eyebrow ? <div className="eyebrow mb-1">{eyebrow}</div> : null}
          {title ? (
            <Heading
              className={cn(
                "min-w-0 truncate font-semibold text-fg",
                density === "compact" ? "text-sm" : "text-md",
              )}
            >
              {title}
            </Heading>
          ) : null}
          {description ? (
            <p className="mt-1 max-w-prose text-xs leading-[1.7] text-fg-tertiary">
              {description}
            </p>
          ) : null}
          {children}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
      ) : null}
    </div>
  );
}

export function PanelBody({
  className,
  padding = "md",
  children,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  padding?: "none" | "sm" | "md" | "lg";
}) {
  return (
    <div
      className={cn(
        padding === "sm" && "p-3.5",
        padding === "md" && "p-4",
        padding === "lg" && "p-5",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function PanelFooter({
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
        "flex items-center gap-2 border-t border-border-subtle bg-surface-secondary px-4 py-3",
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

/* ---------------------------------------------------------------------------
   Well — recessed region for machine output: payloads, diffs, raw metadata.
   ------------------------------------------------------------------------ */

export function Well({
  className,
  padding = "sm",
  children,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  padding?: "none" | "xs" | "sm" | "md";
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border-subtle bg-inset",
        padding === "xs" && "p-2",
        padding === "sm" && "p-3",
        padding === "md" && "p-4",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Tile — small bordered cell used in grids (capabilities, quick actions).
   ------------------------------------------------------------------------ */

const tileVariants = cva(
  [
    "group/tile relative flex flex-col rounded-md border text-start transition-colors duration-[var(--dur-fast)]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
  ],
  {
    variants: {
      interactive: {
        true: "cursor-pointer border-border bg-surface hover:border-border-strong hover:bg-hover",
        false: "border-border bg-surface",
      },
      selected: {
        true: "border-accent-border bg-accent-subtle",
        false: "",
      },
      padding: { sm: "p-2.5", md: "p-3", lg: "p-4" },
    },
    defaultVariants: { interactive: false, selected: false, padding: "md" },
  },
);

export interface TileProps
  extends React.ComponentPropsWithoutRef<"div">,
    VariantProps<typeof tileVariants> {}

export const Tile = React.forwardRef<HTMLDivElement, TileProps>(function Tile(
  { interactive, selected, padding, className, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-selected={selected || undefined}
      className={cn(
        tileVariants({ interactive, selected, padding }),
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});

/* ---------------------------------------------------------------------------
   Definition list — the workhorse for "overview" panels. Label/value pairs
   with correct RTL alignment and consistent baseline rhythm.
   ------------------------------------------------------------------------ */

export function DefinitionList({
  className,
  columns = 1,
  density = "default",
  children,
  ...props
}: React.ComponentPropsWithoutRef<"dl"> & {
  columns?: 1 | 2 | 3;
  density?: "compact" | "default";
}) {
  return (
    <dl
      className={cn(
        "grid",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
        density === "compact" ? "gap-x-6 gap-y-2.5" : "gap-x-8 gap-y-4",
        className,
      )}
      {...props}
    >
      {children}
    </dl>
  );
}

export function DefinitionItem({
  label,
  labelEn,
  children,
  hint,
  className,
  inline = false,
}: {
  label: React.ReactNode;
  /** Optional English technical label, shown small and monospaced. */
  labelEn?: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  /** Label and value on one line — for dense inspector panels. */
  inline?: boolean;
}) {
  return (
    <div
      className={cn(
        inline
          ? "flex min-w-0 items-baseline justify-between gap-3"
          : "min-w-0",
        className,
      )}
    >
      <dt
        className={cn(
          "flex items-baseline gap-1.5 text-xs text-fg-tertiary",
          !inline && "mb-1",
        )}
      >
        <span>{label}</span>
        {labelEn ? (
          <span dir="ltr" className="font-mono text-[10px] text-fg-quaternary">
            {labelEn}
          </span>
        ) : null}
      </dt>
      <dd
        className={cn(
          "min-w-0 text-sm text-fg",
          inline && "text-end font-medium",
        )}
      >
        {children}
        {hint ? (
          <p className="mt-0.5 text-xs text-fg-quaternary">{hint}</p>
        ) : null}
      </dd>
    </div>
  );
}
