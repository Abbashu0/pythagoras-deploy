"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "../overlays/menu";

/* ============================================================================
   Breadcrumbs
   ---------------------------------------------------------------------------
   RTL detail that is easy to get wrong: the separator must point in the reading
   direction. In Arabic the trail runs right-to-left, so the chevron points
   left. `ChevronLeft` with an `ltr:rotate-180` flip covers both directions from
   one component.

   Long trails collapse in the middle, never at the end: the operator always
   needs the current location and its immediate parent.
   ========================================================================== */

export interface Crumb {
  label: React.ReactNode;
  href?: string;
  /** Small icon before the label — entity type marks. */
  icon?: React.ReactNode;
}

export function Breadcrumbs({
  items,
  className,
  maxVisible = 4,
  size = "sm",
}: {
  items: Crumb[];
  className?: string;
  maxVisible?: number;
  size?: "xs" | "sm";
}) {
  const collapsed = items.length > maxVisible;
  const head = collapsed ? items.slice(0, 1) : items;
  const hidden = collapsed ? items.slice(1, items.length - (maxVisible - 2)) : [];
  const tail = collapsed ? items.slice(items.length - (maxVisible - 2)) : [];

  const render = (crumb: Crumb, isLast: boolean, key: React.Key) => (
    <li key={key} className="flex min-w-0 items-center gap-1">
      {crumb.href && !isLast ? (
        <Link
          href={crumb.href}
          className={cn(
            "inline-flex min-w-0 items-center gap-1.5 truncate rounded-[4px] px-0.5",
            "text-fg-tertiary transition-colors hover:text-fg",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
          )}
        >
          {crumb.icon}
          <span className="truncate">{crumb.label}</span>
        </Link>
      ) : (
        <span
          aria-current={isLast ? "page" : undefined}
          className={cn(
            "inline-flex min-w-0 items-center gap-1.5 truncate px-0.5",
            isLast ? "font-medium text-fg" : "text-fg-tertiary",
          )}
        >
          {crumb.icon}
          <span className="truncate">{crumb.label}</span>
        </span>
      )}
      {!isLast ? <Separator /> : null}
    </li>
  );

  return (
    <nav aria-label="مسار التنقل" className={cn("min-w-0", className)}>
      <ol
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-1",
          size === "xs" ? "text-2xs" : "text-xs",
        )}
      >
        {head.map((c, i) =>
          render(c, !collapsed && i === items.length - 1, `h${i}`),
        )}

        {collapsed ? (
          <li className="flex items-center gap-1">
            <Menu>
              <MenuTrigger asChild>
                <button
                  type="button"
                  aria-label="عرض المسار الكامل"
                  className="inline-flex size-5 items-center justify-center rounded-[4px] text-fg-quaternary transition-colors hover:bg-hover hover:text-fg-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
                >
                  <MoreHorizontal className="size-3.5" aria-hidden />
                </button>
              </MenuTrigger>
              <MenuContent align="start" className="min-w-44">
                {hidden.map((c, i) => (
                  <MenuItem key={i} icon={c.icon} disabled={!c.href}>
                    {c.href ? (
                      <Link href={c.href} className="block truncate">
                        {c.label}
                      </Link>
                    ) : (
                      c.label
                    )}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
            <Separator />
          </li>
        ) : null}

        {tail.map((c, i) => render(c, i === tail.length - 1, `t${i}`))}
      </ol>
    </nav>
  );
}

function Separator() {
  return (
    <ChevronLeft
      className="size-3 shrink-0 text-fg-quaternary ltr:rotate-180"
      aria-hidden
    />
  );
}

/* ---------------------------------------------------------------------------
   EntityNav — previous/next navigation between sibling records. Keeps an
   operator moving through a review queue without returning to the list.
   ------------------------------------------------------------------------ */

export function EntityNav({
  position,
  total,
  onPrevious,
  onNext,
  label = "عنصر",
  className,
}: {
  position: number;
  total: number;
  onPrevious?: () => void;
  onNext?: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-border bg-surface",
        className,
      )}
    >
      <button
        type="button"
        aria-label={`ال${label} السابق`}
        disabled={!onPrevious || position <= 1}
        onClick={onPrevious}
        className="inline-flex size-7 items-center justify-center rounded-s-[5px] text-fg-tertiary transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:text-disabled-fg"
      >
        <ChevronLeft className="size-3.5 rotate-180 rtl:rotate-0" aria-hidden />
      </button>
      <span className="px-1.5 text-2xs text-fg-tertiary tnum">
        {position} / {total}
      </span>
      <button
        type="button"
        aria-label={`ال${label} التالي`}
        disabled={!onNext || position >= total}
        onClick={onNext}
        className="inline-flex size-7 items-center justify-center rounded-e-[5px] text-fg-tertiary transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:text-disabled-fg"
      >
        <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden />
      </button>
    </div>
  );
}
