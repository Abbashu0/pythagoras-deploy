"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import {
  useHotkey,
  useMediaQuery,
  usePersistentState,
  useResetOn,
} from "@/lib/hooks";
import { Sidebar } from "../navigation/sidebar";
import type { NavSection } from "../navigation/nav-config";
import { Drawer, DrawerContent } from "../overlays/drawer";
import { IconButton } from "../primitives/button";
import { Menu } from "lucide-react";

/* ============================================================================
   AdminShell
   ---------------------------------------------------------------------------
   Composes the sidebar, the top bar and the page area into the frame every
   admin screen lives inside.

   Layout contract:
   - The shell owns the viewport height; only the page area scrolls. That keeps
     the sidebar and top bar pinned without `position: fixed` and its
     accompanying scroll-locking problems.
   - Below 1024px the sidebar becomes a drawer, because a 264px rail on a 900px
     screen is not navigation, it is an obstruction.
   - ⌘B toggles the sidebar. The shortcut lives here rather than in Sidebar so a
     collapsed-state consumer can still opt out.
   ========================================================================== */

export interface AdminShellProps {
  sections: NavSection[];
  pathname: string;
  sidebarHeader?: React.ReactNode;
  sidebarFooter?: React.ReactNode;
  /** The TopBar element. Rendered inside the page column. */
  topBar?: React.ReactNode;
  /** Full-width alert bar between the top bar and the page. */
  systemAlert?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Whether the consumer wants item pinning in the sidebar. */
  pinnable?: boolean;
  /** Right-hand persistent inspector rail. */
  inspector?: React.ReactNode;
  /** Overlays that must live at the shell level: command palette, dialogs. */
  overlays?: React.ReactNode;
}

export function AdminShell({
  sections,
  pathname,
  sidebarHeader,
  sidebarFooter,
  topBar,
  systemAlert,
  children,
  className,
  pinnable = true,
  inspector,
  overlays,
}: AdminShellProps) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [collapsed, setCollapsed] = usePersistentState(
    "pyth-sidebar-collapsed",
    false,
  );
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  useHotkey("mod+b", () => setCollapsed((c) => !c));

  // Navigating closes the mobile drawer. Handled during render rather than in
  // an effect so the drawer never paints open on the new route.
  useResetOn(pathname, () => setMobileNavOpen(false));

  return (
    <div className={cn("flex h-dvh overflow-hidden bg-bg", className)}>
      {isDesktop ? (
        <Sidebar
          sections={sections}
          pathname={pathname}
          header={sidebarHeader}
          footer={sidebarFooter}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          pinnable={pinnable}
        />
      ) : (
        <Drawer open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <DrawerContent size="sm" side="start" aria-label="التنقل">
            <Sidebar
              sections={sections}
              pathname={pathname}
              header={sidebarHeader}
              footer={sidebarFooter}
              collapsed={false}
              className="h-full w-full border-e-0"
              pinnable={pinnable}
            />
          </DrawerContent>
        </Drawer>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {topBar ? (
          <div className="relative shrink-0">
            {!isDesktop ? (
              <IconButton
                label="فتح التنقل"
                size="sm"
                variant="ghost"
                onClick={() => setMobileNavOpen(true)}
                className="absolute start-2 top-2.5 z-[calc(var(--z-topbar)+1)]"
              >
                <Menu aria-hidden />
              </IconButton>
            ) : null}
            <div className={cn(!isDesktop && "[&>header]:ps-11")}>{topBar}</div>
          </div>
        ) : null}

        {systemAlert}

        <div className="flex min-h-0 flex-1">
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
            {children}
          </main>
          {inspector}
        </div>
      </div>

      {overlays}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   ShellScrollArea — for pages that need a fixed header inside the main column
   with only the body scrolling (master/detail, dense tables).
   ------------------------------------------------------------------------ */

export function FixedPage({
  header,
  children,
  footer,
  className,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}>
      {header ? <div className="shrink-0">{header}</div> : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      {footer ? <div className="shrink-0">{footer}</div> : null}
    </div>
  );
}
