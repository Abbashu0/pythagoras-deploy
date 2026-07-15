"use client";

/**
 * AdminShell — the master layout wrapper for the entire admin console.
 *
 * Structure:
 *   ┌──────────────────────────────────────────────────┐
 *   │              │  TopBar (sticky)                   │
 *   │   Sidebar    ├────────────────────────────────────┤
 *   │   (fixed)    │                                    │
 *   │              │  Main Content (scrollable)         │
 *   │              │                                    │
 *   └──────────────┴────────────────────────────────────┘
 *
 * The sidebar is fixed on desktop (lg+) and slide-in on mobile.
 * The topbar is sticky and contains breadcrumbs + global tools.
 * The main content area is the children (each page's content).
 *
 * CRITICAL: This shell is ADDITIVE — it wraps existing pages without
 * modifying their internal logic. Existing pages continue to work
 * exactly as before, just inside a better frame.
 */

import { useEffect, useState, type ReactNode } from "react";
import { AdminSidebar } from "./AdminSidebar";
import { AdminTopBar } from "./AdminTopBar";
import { useAdminStore } from "@/lib/admin/use-admin-store";
import { getAdminStore } from "@/lib/admin/admin-store";

interface Props {
  children: ReactNode;
}

export function AdminShell({ children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const { adminTheme } = useAdminStore();
  const store = getAdminStore();

  // Apply theme to <html> — same pattern as before, just centralized.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", adminTheme === "dark");
  }, [adminTheme]);

  // Load store on mount (same as before, just centralized).
  useEffect(() => {
    store.loadFromStorage();
    store.hydrateImagesFromIDB();
  }, [store]);

  return (
    <div className="flex h-screen overflow-hidden bg-background" dir="rtl">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminTopBar
          onMenuClick={() => setSidebarOpen(true)}
          onActivityClick={() => setActivityOpen((v) => !v)}
        />

        <main className="admin-scroll flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
