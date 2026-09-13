"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import {
  getStatus,
  toneClasses,
  type StatusKey,
  type StatusTone,
} from "./status-registry";

/* ============================================================================
   StatusBadge / StatusDot / StatusText
   ---------------------------------------------------------------------------
   One primitive, four visual densities. Pages choose a density based on the
   surrounding information density — never a different colour system.

   - `dot`    : list rows, table cells, sidebars. Smallest footprint.
   - `subtle` : default. Tonal chip with a glyph.
   - `outline`: on tinted backgrounds where a tonal fill would disappear.
   - `solid`  : reserved for a single critical state per view.
   ========================================================================== */

const badgeVariants = cva(
  [
    "inline-flex shrink-0 items-center gap-1.5 font-medium",
    "whitespace-nowrap align-middle",
  ],
  {
    variants: {
      appearance: {
        dot: "gap-1.5",
        subtle: "rounded-full border border-transparent",
        outline: "rounded-full border bg-transparent",
        solid: "rounded-full text-on-accent",
        plain: "",
      },
      size: {
        sm: "text-2xs",
        md: "text-xs",
      },
    },
    compoundVariants: [
      { appearance: "subtle", size: "sm", class: "h-[18px] px-1.5" },
      { appearance: "subtle", size: "md", class: "h-[22px] px-2" },
      { appearance: "outline", size: "sm", class: "h-[18px] px-1.5" },
      { appearance: "outline", size: "md", class: "h-[22px] px-2" },
      { appearance: "solid", size: "sm", class: "h-[18px] px-1.5" },
      { appearance: "solid", size: "md", class: "h-[22px] px-2" },
    ],
    defaultVariants: { appearance: "subtle", size: "md" },
  },
);

export interface StatusBadgeProps
  extends Omit<React.ComponentPropsWithoutRef<"span">, "children">,
    VariantProps<typeof badgeVariants> {
  status: StatusKey;
  /** Override the registry label (e.g. "متصل · ٢٤٠ms"). */
  label?: React.ReactNode;
  /** Hide the text and rely on the glyph + accessible name. Dense tables only. */
  iconOnly?: boolean;
  /** Show the English secondary label after the Arabic one. */
  showEnglish?: boolean;
  /** Suppress the glyph (dot appearance already carries shape). */
  hideIcon?: boolean;
}

export const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  function StatusBadge(
    {
      status,
      label,
      appearance = "subtle",
      size = "md",
      iconOnly = false,
      showEnglish = false,
      hideIcon = false,
      className,
      ...props
    },
    ref,
  ) {
    const def = getStatus(status);
    const tone = toneClasses[def.tone];
    const Icon = def.icon;
    const text = label ?? def.label;
    const iconSize = size === "sm" ? "size-3" : "size-3.5";

    return (
      <span
        ref={ref}
        data-status={status}
        data-tone={def.tone}
        title={iconOnly ? def.label : undefined}
        className={cn(
          badgeVariants({ appearance, size }),
          tone.text,
          appearance === "subtle" && tone.subtle,
          appearance === "outline" && tone.border,
          appearance === "solid" && [tone.solid, "text-on-accent"],
          className,
        )}
        {...props}
      >
        {appearance === "dot" ? (
          <StatusDot status={status} size={size ?? "md"} />
        ) : hideIcon ? null : (
          <Icon
            className={cn(
              iconSize,
              def.spin && "animate-spin motion-reduce:animate-none",
            )}
            aria-hidden
          />
        )}
        {iconOnly ? (
          <span className="sr-only">{def.label}</span>
        ) : (
          <span className="truncate">
            {text}
            {showEnglish && def.labelEn ? (
              <span
                dir="ltr"
                className="ms-1 font-mono text-[0.9em] opacity-60"
              >
                {def.labelEn}
              </span>
            ) : null}
          </span>
        )}
      </span>
    );
  },
);

/* ---------------------------------------------------------------------------
   StatusDot — shape as well as colour, so it survives colour blindness:
   filled = settled, ring = pending/inert, pulsing = live.
   ------------------------------------------------------------------------ */

export function StatusDot({
  status,
  size = "md",
  className,
}: {
  status: StatusKey;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const def = getStatus(status);
  const tone = toneClasses[def.tone];
  const px = size === "sm" ? "size-1.5" : size === "lg" ? "size-2.5" : "size-2";
  const hollow =
    def.tone === "neutral" ||
    status === "queued" ||
    status === "unpublished" ||
    status === "inactive";

  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-block shrink-0 rounded-full",
        px,
        hollow
          ? "border-[1.5px] border-current bg-transparent"
          : [tone.dot, def.pulse && "pyth-live-dot"],
        !hollow && tone.text,
        className,
      )}
    />
  );
}

/* ---------------------------------------------------------------------------
   StatusText — glyph + label with no chrome. For definition rows where a chip
   would add unnecessary visual weight.
   ------------------------------------------------------------------------ */

export function StatusText({
  status,
  label,
  className,
  size = "md",
}: {
  status: StatusKey;
  label?: React.ReactNode;
  className?: string;
  size?: "sm" | "md";
}) {
  const def = getStatus(status);
  const tone = toneClasses[def.tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-medium",
        size === "sm" ? "text-xs" : "text-sm",
        tone.text,
        className,
      )}
    >
      <StatusDot status={status} size={size === "sm" ? "sm" : "md"} />
      <span className="truncate">{label ?? def.label}</span>
    </span>
  );
}

/* ---------------------------------------------------------------------------
   Badge — the non-status chip. Counts, capabilities, taxonomy, versions.
   Kept in the same file so the two never drift apart visually.
   ------------------------------------------------------------------------ */

const chipVariants = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap align-middle font-medium",
  {
    variants: {
      variant: {
        subtle: "border border-transparent",
        outline: "border bg-transparent",
        solid: "text-on-accent",
        inset: "border border-border-subtle bg-inset",
      },
      size: {
        sm: "h-[18px] rounded-sm px-1.5 text-2xs",
        md: "h-[22px] rounded-sm px-2 text-xs",
        lg: "h-[26px] rounded-md px-2.5 text-xs",
      },
      shape: {
        rounded: "",
        pill: "rounded-full",
      },
    },
    defaultVariants: { variant: "subtle", size: "md", shape: "rounded" },
  },
);

export interface BadgeProps
  extends React.ComponentPropsWithoutRef<"span">,
    VariantProps<typeof chipVariants> {
  tone?: StatusTone;
  icon?: React.ReactNode;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  function Badge(
    {
      tone = "neutral",
      variant,
      size,
      shape,
      icon,
      className,
      children,
      ...props
    },
    ref,
  ) {
    const t = toneClasses[tone];
    return (
      <span
        ref={ref}
        className={cn(
          chipVariants({ variant, size, shape }),
          variant !== "inset" && t.text,
          variant === "subtle" && t.subtle,
          variant === "outline" && t.border,
          variant === "solid" && [t.solid, "text-on-accent"],
          variant === "inset" && "text-fg-secondary",
          "[&_svg]:size-3 [&_svg]:shrink-0",
          className,
        )}
        {...props}
      >
        {icon}
        <span className="truncate">{children}</span>
      </span>
    );
  },
);

/** Numeric counter used in sidebars, tabs and filter chips. */
export function CountBadge({
  value,
  tone = "neutral",
  max = 99,
  className,
}: {
  value: number;
  tone?: StatusTone;
  max?: number;
  className?: string;
}) {
  const t = toneClasses[tone];
  return (
    <span
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-2xs font-semibold tnum",
        t.subtle,
        t.text,
        className,
      )}
    >
      {value > max ? `${max}+` : value}
    </span>
  );
}
