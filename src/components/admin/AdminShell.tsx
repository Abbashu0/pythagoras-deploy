"use client";

/**
 * AdminShell — the master layout wrapper for the entire admin console.
 */

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AdminSidebar } from "./AdminSidebar";
import { AdminTopBar } from "./AdminTopBar";
import { ActivityCenterDrawer } from "./ActivityCenterDrawer";
import { CommandPalette } from "./CommandPalette";
import { NotificationsDrawer } from "./NotificationsDrawer";
import { useAdminStore } from "@/lib/admin/use-admin-store";
import { getAdminStore } from "@/lib/admin/admin-store";
import type { SafeAdminIdentity } from "@/server/admin-auth/contracts";

interface Props {
  children: ReactNode;
  identity: SafeAdminIdentity;
}

export function AdminShell({ children, identity }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const { adminTheme } = useAdminStore();
  const store = getAdminStore();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", adminTheme === "dark");
  }, [adminTheme]);

  useEffect(() => {
    // The M6 migration workspace must inspect the source browser before any
    // legacy store hydration can normalize/persist that source state.
    if (pathname === "/admin/system/migration") return;
    store.loadFromStorage();
    store.hydrateImagesFromIDB();
  }, [pathname, store]);

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

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const response = await fetch("/api/admin/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed");
      router.replace("/admin/login");
      router.refresh();
    } catch {
      setLoggingOut(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background" dir="rtl">
      <AdminSidebar identity={identity} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminTopBar
          identity={identity}
          onMenuClick={() => setSidebarOpen(true)}
          onActivityClick={() => setActivityOpen(true)}
          onNotificationsClick={() => setNotificationsOpen(true)}
          onSearchNavigate={(href) => router.push(href)}
          onLogout={handleLogout}
          loggingOut={loggingOut}
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
