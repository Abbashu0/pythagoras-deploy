"use client";

import * as React from "react";
import * as A from "@radix-ui/react-avatar";
import { cn } from "@/lib/cn";
import type { StatusTone } from "../status/status-registry";
import { toneClasses } from "../status/status-registry";

/* ============================================================================
   Avatar / EntityGlyph
   ---------------------------------------------------------------------------
   People get an Avatar (round, initials fallback).
   Systems and entities get an EntityGlyph (rounded square, monogram or icon)
   so an operator can tell at a glance whether an actor was a human or the
   platform itself — which matters a lot in audit logs.
   ========================================================================== */

const SIZES = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-7 text-2xs",
  lg: "size-9 text-xs",
  xl: "size-12 text-sm",
} as const;

export type AvatarSize = keyof typeof SIZES;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "؟";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[1][0]}`;
}

export function Avatar({
  name,
  src,
  size = "md",
  className,
  ring = false,
}: {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  className?: string;
  ring?: boolean;
}) {
  return (
    <A.Root
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full",
        "bg-inset-strong font-semibold text-fg-secondary",
        ring && "ring-2 ring-[var(--surface)]",
        SIZES[size],
        className,
      )}
    >
      {src ? (
        <A.Image
          src={src}
          alt={name}
          className="size-full object-cover"
          loading="lazy"
        />
      ) : null}
      <A.Fallback delayMs={src ? 200 : 0} className="uppercase">
        {initials(name)}
      </A.Fallback>
    </A.Root>
  );
}

export function AvatarGroup({
  people,
  max = 4,
  size = "sm",
  className,
}: {
  people: { name: string; src?: string | null }[];
  max?: number;
  size?: AvatarSize;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <div className={cn("flex items-center", className)}>
      <div className="flex -space-x-1.5 rtl:space-x-reverse">
        {shown.map((p) => (
          <Avatar key={p.name} name={p.name} src={p.src} size={size} ring />
        ))}
      </div>
      {rest > 0 ? (
        <span className="ms-2 text-xs text-fg-tertiary tnum">+{rest}</span>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   EntityGlyph — rounded-square identity mark for providers, models, agents,
   subjects, jobs. Accepts an icon or falls back to a monogram.
   ------------------------------------------------------------------------ */

const GLYPH_SIZES = {
  xs: "size-5 rounded-[4px] text-[9px] [&_svg]:size-3",
  sm: "size-6 rounded-[5px] text-[10px] [&_svg]:size-3.5",
  md: "size-8 rounded-md text-xs [&_svg]:size-4",
  lg: "size-10 rounded-lg text-sm [&_svg]:size-5",
  xl: "size-12 rounded-lg text-md [&_svg]:size-6",
} as const;

export function EntityGlyph({
  name,
  icon,
  tone = "neutral",
  size = "md",
  variant = "subtle",
  className,
}: {
  name?: string;
  icon?: React.ReactNode;
  tone?: StatusTone;
  size?: keyof typeof GLYPH_SIZES;
  variant?: "subtle" | "solid" | "outline";
  className?: string;
}) {
  const t = toneClasses[tone];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center border font-semibold",
        GLYPH_SIZES[size],
        variant === "subtle" && [t.subtle, t.text, "border-transparent"],
        variant === "solid" && [t.solid, "border-transparent text-on-accent"],
        variant === "outline" && [t.border, t.text, "bg-transparent"],
        className,
      )}
    >
      {icon ?? (name ? initials(name).toUpperCase() : null)}
    </span>
  );
}
