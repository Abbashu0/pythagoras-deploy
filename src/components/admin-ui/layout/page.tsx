"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { Separator } from "../primitives/separator";

/* ============================================================================
   Page structure
   ---------------------------------------------------------------------------
   The header of an admin page is not a billboard. It answers three questions
   in as little vertical space as possible:
     where am I, what is the state of this thing, what can I do to it.

   Two headers exist on purpose:
   - PageHeader        : list and overview pages. Title + description + actions.
   - CompactPageHeader : entity detail pages. Breadcrumb + title + inline status
                         + actions on a single 44px row, because a detail page's
                         real content starts immediately below.

   Deliberately absent: a "welcome back" band, a decorative hero, an oversized
   page title. A 21px semibold title is enough at 1440px; anything larger just
   pushes the operator's data below the fold.
   ========================================================================== */

/* ---------------------------------------------------------------------------
   PageShell — the scroll container and width constraint for one page.
   ------------------------------------------------------------------------ */

const shellVariants = cva("flex min-h-0 min-w-0 flex-1 flex-col", {
  variants: {
    width: {
      /** Full available width, capped at --content-max. Dashboards, tables. */
      wide: "mx-auto w-full max-w-content",
      /** Forms and settings — long lines hurt Arabic readability. */
      narrow: "mx-auto w-full max-w-narrow",
      /** Documentation-style prose. */
      reading: "mx-auto w-full max-w-reading",
      /** No cap — master/detail and full-bleed tables manage their own width. */
      full: "w-full",
    },
    padding: {
      none: "",
      tight: "px-4 py-4 sm:px-5",
      default: "px-5 py-6 sm:px-gutter",
      loose: "px-5 py-8 sm:px-gutter",
    },
  },
  defaultVariants: { width: "wide", padding: "default" },
});

export interface PageShellProps
  extends React.ComponentPropsWithoutRef<"div">,
    VariantProps<typeof shellVariants> {}

export function PageShell({
  width,
  padding,
  className,
  children,
  ...props
}: PageShellProps) {
  return (
    <div className={cn(shellVariants({ width, padding }), className)} {...props}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   PageHeader
   ------------------------------------------------------------------------ */

export interface PageHeaderProps {
  title: React.ReactNode;
  /** One sentence. If it needs two, it belongs in the content. */
  description?: React.ReactNode;
  /** Breadcrumb or location line above the title. */
  breadcrumb?: React.ReactNode;
  /** Small caps label above the title — entity type or group. */
  eyebrow?: React.ReactNode;
  /** Status chips rendered inline after the title. */
  status?: React.ReactNode;
  /** Primary + secondary actions, inline-end. */
  actions?: React.ReactNode;
  /** Local navigation (Tabs) docked to the bottom of the header. */
  tabs?: React.ReactNode;
  /** Metadata row under the title — ids, timestamps, owners. */
  meta?: React.ReactNode;
  /** Entity glyph or avatar before the title. */
  icon?: React.ReactNode;
  className?: string;
  bordered?: boolean;
  children?: React.ReactNode;
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  eyebrow,
  status,
  actions,
  tabs,
  meta,
  icon,
  className,
  bordered = false,
  children,
}: PageHeaderProps) {
  return (
    <header className={cn("min-w-0", bordered && "border-b border-border", className)}>
      {breadcrumb ? <div className="mb-2.5">{breadcrumb}</div> : null}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
          <div className="min-w-0">
            {eyebrow ? <div className="eyebrow mb-1.5">{eyebrow}</div> : null}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="min-w-0 text-xl font-semibold tracking-tighter text-fg">
                {title}
              </h1>
              {status}
            </div>
            {description ? (
              <p className="mt-2 max-w-prose text-sm leading-[1.75] text-fg-secondary">
                {description}
              </p>
            ) : null}
            {meta ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-tertiary">
                {meta}
              </div>
            ) : null}
          </div>
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {children ? <div className="mt-4">{children}</div> : null}
      {tabs ? <div className="mt-5">{tabs}</div> : null}
    </header>
  );
}

/* ---------------------------------------------------------------------------
   CompactPageHeader — one dense row for entity detail pages.
   ------------------------------------------------------------------------ */

export interface CompactPageHeaderProps {
  title: React.ReactNode;
  breadcrumb?: React.ReactNode;
  status?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  /** Technical id / secondary line shown next to the title. */
  subtitle?: React.ReactNode;
  tabs?: React.ReactNode;
  className?: string;
  /** Sticks to the top of the scroll container. */
  sticky?: boolean;
  /** Previous / next entity navigation. */
  entityNav?: React.ReactNode;
}

export function CompactPageHeader({
  title,
  breadcrumb,
  status,
  actions,
  icon,
  subtitle,
  tabs,
  className,
  sticky = false,
  entityNav,
}: CompactPageHeaderProps) {
  return (
    <header
      className={cn(
        "min-w-0 border-b border-border bg-bg/85 backdrop-blur-sm",
        sticky && "sticky top-0 z-[var(--z-sticky)]",
        className,
      )}
    >
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-2 sm:px-gutter">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {breadcrumb ? (
            <>
              <div className="hidden shrink-0 lg:block">{breadcrumb}</div>
              <Separator
                orientation="vertical"
                className="hidden h-4 shrink-0 lg:block"
              />
            </>
          ) : null}
          {icon ? <span className="shrink-0">{icon}</span> : null}
          <h1 className="min-w-0 truncate text-md font-semibold text-fg">
            {title}
          </h1>
          {subtitle ? <span className="min-w-0 shrink-0">{subtitle}</span> : null}
          {status ? <span className="shrink-0">{status}</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {entityNav}
          {actions}
        </div>
      </div>
      {tabs ? <div className="px-5 sm:px-gutter">{tabs}</div> : null}
    </header>
  );
}

/* ---------------------------------------------------------------------------
   Section / SectionHeader
   ------------------------------------------------------------------------ */

export interface SectionProps
  extends Omit<React.ComponentPropsWithoutRef<"section">, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
  /** Space above the section. `none` when it is the first on the page. */
  spacing?: "none" | "sm" | "md" | "lg";
  /** Heading level for the page outline. */
  as?: "h2" | "h3";
  /** Draw a separator under the header. */
  divided?: boolean;
  /** Collapsible sections keep long settings pages navigable. */
  headerClassName?: string;
}

export function Section({
  title,
  description,
  actions,
  eyebrow,
  spacing = "lg",
  as: Heading = "h2",
  divided = false,
  className,
  headerClassName,
  children,
  ...props
}: SectionProps) {
  return (
    <section
      className={cn(
        "min-w-0",
        spacing === "sm" && "mt-5",
        spacing === "md" && "mt-7",
        spacing === "lg" && "mt-9",
        className,
      )}
      {...props}
    >
      {title || actions ? (
        <div
          className={cn(
            "mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2",
            divided && "border-b border-border pb-3",
            headerClassName,
          )}
        >
          <div className="min-w-0">
            {eyebrow ? <div className="eyebrow mb-1.5">{eyebrow}</div> : null}
            {title ? (
              <Heading className="text-lg font-semibold tracking-tighter text-fg">
                {title}
              </Heading>
            ) : null}
            {description ? (
              <p className="mt-1.5 max-w-prose text-sm leading-[1.75] text-fg-secondary">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Smaller heading for a group inside a Section or Panel. */
export function SubSection({
  title,
  description,
  actions,
  className,
  children,
  spacing = "md",
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
  spacing?: "none" | "sm" | "md";
}) {
  return (
    <div
      className={cn(
        "min-w-0",
        spacing === "sm" && "mt-4",
        spacing === "md" && "mt-6",
        className,
      )}
    >
      {title ? (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-fg">{title}</h3>
            {description ? (
              <p className="mt-1 max-w-prose text-xs leading-[1.7] text-fg-tertiary">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Grids and stacks
   ------------------------------------------------------------------------ */

export function ContentGrid({
  columns = 2,
  gap = "md",
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  columns?: 1 | 2 | 3 | 4 | 6;
  gap?: "sm" | "md" | "lg";
}) {
  return (
    <div
      className={cn(
        "grid min-w-0",
        gap === "sm" && "gap-3",
        gap === "md" && "gap-4",
        gap === "lg" && "gap-5",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 lg:grid-cols-2",
        columns === 3 && "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
        columns === 4 && "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4",
        columns === 6 && "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * TwoColumnLayout — main content plus a narrower rail. The rail collapses under
 * the main column below `lg`, which is the right behaviour for a summary rail
 * but not for a table: those use MasterDetailLayout instead.
 */
export function TwoColumnLayout({
  children,
  aside,
  asideWidth = "md",
  asidePosition = "end",
  gap = "lg",
  className,
  /** Keep the rail visible while the main column scrolls. */
  stickyAside = false,
}: {
  children: React.ReactNode;
  aside: React.ReactNode;
  asideWidth?: "sm" | "md" | "lg";
  asidePosition?: "start" | "end";
  gap?: "md" | "lg" | "xl";
  className?: string;
  stickyAside?: boolean;
}) {
  const widths = {
    sm: "lg:w-64",
    md: "lg:w-80",
    lg: "lg:w-96",
  } as const;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col lg:flex-row",
        asidePosition === "start" && "lg:flex-row-reverse",
        gap === "md" && "gap-5",
        gap === "lg" && "gap-6",
        gap === "xl" && "gap-8",
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <aside
        className={cn(
          "min-w-0 shrink-0",
          widths[asideWidth],
          stickyAside && "lg:sticky lg:top-4 lg:self-start",
        )}
      >
        {aside}
      </aside>
    </div>
  );
}

/** Vertical stack with a consistent rhythm. */
export function Stack({
  gap = "md",
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  gap?: "xs" | "sm" | "md" | "lg" | "xl";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col",
        gap === "xs" && "gap-1.5",
        gap === "sm" && "gap-2.5",
        gap === "md" && "gap-4",
        gap === "lg" && "gap-5",
        gap === "xl" && "gap-7",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Horizontal row that wraps to a stack on narrow widths. */
export function ResponsiveStack({
  gap = "md",
  align = "center",
  breakpoint = "sm",
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  gap?: "xs" | "sm" | "md" | "lg";
  align?: "start" | "center" | "end" | "stretch";
  breakpoint?: "sm" | "md" | "lg";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col",
        breakpoint === "sm" && "sm:flex-row",
        breakpoint === "md" && "md:flex-row",
        breakpoint === "lg" && "lg:flex-row",
        gap === "xs" && "gap-1.5",
        gap === "sm" && "gap-2.5",
        gap === "md" && "gap-4",
        gap === "lg" && "gap-5",
        align === "start" && "sm:items-start",
        align === "center" && "sm:items-center",
        align === "end" && "sm:items-end",
        align === "stretch" && "sm:items-stretch",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Toolbar / FilterBar
   ------------------------------------------------------------------------ */

export function Toolbar({
  className,
  children,
  sticky = false,
  bordered = true,
  density = "default",
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  sticky?: boolean;
  bordered?: boolean;
  density?: "compact" | "default";
}) {
  return (
    <div
      role="toolbar"
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-2",
        density === "compact" ? "py-2" : "py-2.5",
        bordered && "border-b border-border",
        sticky && "sticky top-0 z-[var(--z-sticky)] bg-bg/90 backdrop-blur-sm",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Pushes the following toolbar items to the inline end. */
export function ToolbarSpacer() {
  return <span className="ms-auto" aria-hidden />;
}

/* ---------------------------------------------------------------------------
   StickyActionBar — form footers that stay reachable on long pages.
   ------------------------------------------------------------------------ */

export function StickyActionBar({
  children,
  className,
  position = "bottom",
  /** Left slot: usually a state summary ("٣ تغييرات غير محفوظة"). */
  info,
}: {
  children: React.ReactNode;
  className?: string;
  position?: "top" | "bottom";
  info?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "sticky z-[var(--z-sticky)] -mx-5 mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-border bg-bg/92 px-5 py-3 backdrop-blur-sm sm:-mx-gutter sm:px-gutter",
        position === "bottom" ? "bottom-0 border-t" : "top-0 border-b",
        className,
      )}
    >
      <div className="min-w-0 text-xs text-fg-tertiary">{info}</div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** Non-sticky footer for panels and drawers. */
export function ActionBar({
  children,
  info,
  className,
  align = "end",
}: {
  children: React.ReactNode;
  info?: React.ReactNode;
  className?: string;
  align?: "start" | "between" | "end";
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle pt-4",
        align === "end" && "justify-end",
        align === "between" && "justify-between",
        align === "start" && "justify-start",
        className,
      )}
    >
      {info ? (
        <div className="min-w-0 flex-1 text-xs text-fg-tertiary">{info}</div>
      ) : null}
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
