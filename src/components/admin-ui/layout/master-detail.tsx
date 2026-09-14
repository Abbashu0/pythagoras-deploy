"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { transition } from "@/lib/motion";
import { useMediaQuery, usePersistentState } from "@/lib/hooks";
import { IconButton } from "../primitives/button";
import { ScrollArea } from "../primitives/scroll-area";
import { Drawer, DrawerContent } from "../overlays/drawer";

/* ============================================================================
   MasterDetailLayout
   ---------------------------------------------------------------------------
   The core administration pattern in this system. An operator working through
   providers, models, questions, assets, eval runs or jobs should be able to
   move between records without a route change losing their scroll position,
   their filters or their place in the list.

   Behaviour by width:
     ≥ 1280px  list + detail side by side, both independently scrollable
     ≥ 1024px  same, with a narrower list
     < 1024px  list only; selecting a record opens the detail as a Drawer

   The layout never *replaces* deep links. Pages using it are expected to also
   expose a full detail route; this component only removes the need to navigate
   for routine work.
   ========================================================================== */

export interface MasterDetailLayoutProps {
  /** The list / master pane. */
  master: React.ReactNode;
  /** The detail pane. `null` shows the empty selection state. */
  detail?: React.ReactNode;
  /** Shown in the detail pane when nothing is selected. */
  emptySelection?: React.ReactNode;
  /** Whether a record is currently selected (drives the mobile drawer). */
  selected?: boolean;
  onCloseDetail?: () => void;
  masterWidth?: "sm" | "md" | "lg";
  className?: string;
  /** Toolbar above both panes. */
  toolbar?: React.ReactNode;
  /** Header rendered above the master pane only. */
  masterHeader?: React.ReactNode;
  /** Persisted collapse state key. Omit to disable collapsing. */
  collapseKey?: string;
  /** Title used by the mobile drawer. */
  detailTitle?: string;
}

const MASTER_WIDTHS = {
  sm: "xl:w-[18rem] lg:w-[16rem]",
  md: "xl:w-[22rem] lg:w-[18rem]",
  lg: "xl:w-[26rem] lg:w-[21rem]",
} as const;

export function MasterDetailLayout({
  master,
  detail,
  emptySelection,
  selected = false,
  onCloseDetail,
  masterWidth = "md",
  className,
  toolbar,
  masterHeader,
  collapseKey,
  detailTitle = "التفاصيل",
}: MasterDetailLayoutProps) {
  const isWide = useMediaQuery("(min-width: 1024px)");
  const [collapsed, setCollapsed] = usePersistentState(
    collapseKey ? `pyth-md-collapsed:${collapseKey}` : "pyth-md-collapsed",
    false,
  );

  const masterPane = (
    <div className="flex min-h-0 min-w-0 flex-col">
      {masterHeader}
      <ScrollArea className="min-h-0 flex-1">{master}</ScrollArea>
    </div>
  );

  if (!isWide) {
    return (
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>
        {toolbar}
        <div className="min-h-0 flex-1">{masterPane}</div>
        <Drawer
          open={selected}
          onOpenChange={(open) => !open && onCloseDetail?.()}
        >
          <DrawerContent size="lg" aria-label={detailTitle}>
            {detail}
          </DrawerContent>
        </Drawer>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>
      {toolbar}
      <div className="flex min-h-0 min-w-0 flex-1">
        <motion.div
          animate={{ width: collapsed ? 0 : undefined }}
          transition={transition.panel}
          className={cn(
            "relative shrink-0 border-e border-border bg-surface",
            collapsed ? "w-0 overflow-hidden" : MASTER_WIDTHS[masterWidth],
          )}
        >
          {masterPane}
        </motion.div>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
          {collapseKey ? (
            <IconButton
              label={collapsed ? "إظهار القائمة" : "إخفاء القائمة"}
              size="sm"
              variant="ghost"
              onClick={() => setCollapsed((c) => !c)}
              className="absolute start-2 top-2 z-10"
            >
              {collapsed ? (
                <PanelLeftOpen className="rtl:rotate-180" aria-hidden />
              ) : (
                <PanelLeftClose className="rtl:rotate-180" aria-hidden />
              )}
            </IconButton>
          ) : null}
          <ScrollArea className="min-h-0 flex-1">
            {detail ?? emptySelection}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   SplitPanel — two panes of comparable importance (before/after diff,
   instruction editor + preview). Resizable by drag, with a keyboard fallback.
   ========================================================================== */

export function SplitPanel({
  start,
  end,
  defaultRatio = 0.5,
  minRatio = 0.25,
  maxRatio = 0.75,
  className,
  storageKey,
  /** Stack vertically below this width. */
  stackBelow = "lg",
  startLabel = "اللوحة الأولى",
  endLabel = "اللوحة الثانية",
}: {
  start: React.ReactNode;
  end: React.ReactNode;
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
  className?: string;
  storageKey?: string;
  stackBelow?: "md" | "lg" | "xl";
  startLabel?: string;
  endLabel?: string;
}) {
  const [ratio, setRatio] = usePersistentState(
    storageKey ? `pyth-split:${storageKey}` : "pyth-split",
    defaultRatio,
  );
  const containerRef = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef(false);
  const canSplit = useMediaQuery(
    stackBelow === "md"
      ? "(min-width: 768px)"
      : stackBelow === "lg"
        ? "(min-width: 1024px)"
        : "(min-width: 1280px)",
  );

  const clamp = React.useCallback(
    (r: number) => Math.min(maxRatio, Math.max(minRatio, r)),
    [minRatio, maxRatio],
  );

  React.useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const isRtl =
        getComputedStyle(containerRef.current).direction === "rtl";
      const raw = (e.clientX - rect.left) / rect.width;
      setRatio(clamp(isRtl ? 1 - raw : raw));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [clamp, setRatio]);

  if (!canSplit) {
    return (
      <div className={cn("flex min-w-0 flex-col gap-4", className)}>
        <div className="min-w-0">{start}</div>
        <div className="min-w-0">{end}</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("flex min-h-0 min-w-0 items-stretch", className)}
    >
      <div
        className="min-w-0 overflow-hidden"
        style={{ flexBasis: `${ratio * 100}%` }}
        aria-label={startLabel}
      >
        {start}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(minRatio * 100)}
        aria-valuemax={Math.round(maxRatio * 100)}
        tabIndex={0}
        onPointerDown={() => {
          dragging.current = true;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
        onKeyDown={(e) => {
          const step = 0.04;
          if (e.key === "ArrowLeft") setRatio((r) => clamp(r + step));
          if (e.key === "ArrowRight") setRatio((r) => clamp(r - step));
          if (e.key === "Home") setRatio(defaultRatio);
        }}
        className={cn(
          "group/split relative w-px shrink-0 cursor-col-resize bg-border",
          "transition-colors hover:bg-accent focus-visible:bg-accent",
          "focus-visible:outline-none",
        )}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 -inset-x-1.5 flex items-center justify-center"
        >
          <span className="h-8 w-0.5 rounded-full bg-border-strong opacity-0 transition-opacity group-hover/split:opacity-100 group-focus-visible/split:opacity-100" />
        </span>
      </div>

      <div className="min-w-0 flex-1 overflow-hidden" aria-label={endLabel}>
        {end}
      </div>
    </div>
  );
}

/* ============================================================================
   InspectorPanel — a persistent contextual rail (asset metadata, question
   properties). Unlike a Drawer it does not block the page, and unlike a rail in
   TwoColumnLayout it is dismissible.
   ========================================================================== */

export function InspectorPanel({
  open = true,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "md",
  className,
  actions,
}: {
  open?: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: "sm" | "md" | "lg";
  className?: string;
  actions?: React.ReactNode;
}) {
  if (!open) return null;

  const widths = {
    sm: "w-72",
    md: "w-[var(--inspector-w)]",
    lg: "w-[26rem]",
  } as const;

  return (
    <aside
      className={cn(
        "flex min-h-0 shrink-0 flex-col border-s border-border bg-surface",
        widths[width],
        className,
      )}
    >
      {title ? (
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-fg">{title}</p>
            {subtitle ? (
              <p className="mt-0.5 truncate text-xs text-fg-tertiary">
                {subtitle}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            {onClose ? (
              <IconButton
                label="إغلاق اللوحة"
                size="sm"
                variant="ghost"
                onClick={onClose}
              >
                <X aria-hidden />
              </IconButton>
            ) : null}
          </div>
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 py-4">{children}</div>
      </ScrollArea>
      {footer ? (
        <div className="shrink-0 border-t border-border-subtle bg-surface-secondary px-4 py-3">
          {footer}
        </div>
      ) : null}
    </aside>
  );
}

/* ============================================================================
   SidebarPanel — a secondary in-page navigation rail (policy list, subject
   list, eval suites). Distinct from the app sidebar.
   ========================================================================== */

export function SidebarPanel({
  title,
  actions,
  children,
  footer,
  className,
  width = "sm",
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  width?: "xs" | "sm" | "md";
}) {
  const widths = { xs: "w-52", sm: "w-64", md: "w-72" } as const;
  return (
    <nav
      className={cn(
        "flex min-h-0 shrink-0 flex-col border-e border-border bg-surface",
        widths[width],
        className,
      )}
    >
      {title ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-3 py-2.5">
          <span className="eyebrow">{title}</span>
          {actions}
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1.5">{children}</div>
      </ScrollArea>
      {footer ? (
        <div className="shrink-0 border-t border-border-subtle p-2">{footer}</div>
      ) : null}
    </nav>
  );
}

/** A row inside a SidebarPanel or master list. */
export function ListRow({
  selected = false,
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<"button"> & {
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      data-selected={selected || undefined}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "group/row relative flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-start",
        "transition-colors duration-[var(--dur-fast)]",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]",
        selected
          ? "bg-selected text-fg"
          : "text-fg-secondary hover:bg-hover hover:text-fg",
        className,
      )}
      {...props}
    >
      {selected ? (
        <span
          aria-hidden
          className="absolute inset-y-1.5 start-0 w-[2px] rounded-full bg-accent"
        />
      ) : null}
      {children}
    </button>
  );
}
