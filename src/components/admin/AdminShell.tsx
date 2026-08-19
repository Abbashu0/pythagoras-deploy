"use client";

/**
 * AdminShell — the master layout wrapper for the entire admin console.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AdminSidebar } from "./AdminSidebar";
import { AdminTopBar } from "./AdminTopBar";
import { ActivityCenterDrawer } from "./ActivityCenterDrawer";
import { CommandPalette } from "./CommandPalette";
import { NotificationsDrawer } from "./NotificationsDrawer";
import { useAdminStore } from "@/lib/admin/use-admin-store";
import { getAdminStore } from "@/lib/admin/admin-store";

interface Props {
  children: ReactNode;
}

export function AdminShell({ children }: Props) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { adminTheme } = useAdminStore();
  const store = getAdminStore();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", adminTheme === "dark");
  }, [adminTheme]);

  useEffect(() => {
    store.loadFromStorage();
    store.hydrateImagesFromIDB();
  }, [store]);

  // Global Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background" dir="rtl">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminTopBar
          onMenuClick={() => setSidebarOpen(true)}
          onActivityClick={() => setActivityOpen(true)}
          onNotificationsClick={() => setNotificationsOpen(true)}
          onSearchNavigate={(href) => router.push(href)}
        />

        <main className="admin-scroll flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      <ActivityCenterDrawer open={activityOpen} onClose={() => setActivityOpen(false)} />
      <NotificationsDrawer open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenActivity={() => setActivityOpen(true)}
      />
    </div>
  );
}
