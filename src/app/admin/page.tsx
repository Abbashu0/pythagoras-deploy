"use client";

/**
 * Admin Dashboard — /admin
 *
 * In the new AdminShell architecture, this page renders the DashboardView
 * component inside the shell's main content area.
 *
 * The shell provides:
 *   - Sidebar navigation
 *   - TopBar with breadcrumbs + theme toggle + activity center
 *   - Theme management
 *
 * This page provides:
 *   - DashboardView: KPIs, weekly chart, banner analytics, system health,
 *     quick actions, storage panel
 */

import { useEffect } from "react";
import { getAdminStore } from "@/lib/admin/admin-store";
import { DashboardView } from "@/components/admin/DashboardView";
import { migrateLegacyImages } from "@/lib/admin/image-migrate";

export default function AdminDashboardPage() {
  const store = getAdminStore();

  // Mount: run legacy image migration (loadFromStorage + hydrate handled by shell)
  useEffect(() => {
    migrateLegacyImages()
      .then((res) => {
        if (res.migrated > 0) {
          console.info(`[image-migrate] Migrated ${res.migrated} images.`);
          store.loadFromStorage();
          store.hydrateImagesFromIDB();
        }
      })
      .catch((e) => console.warn("[image-migrate] Migration failed:", e));
  }, [store]);

  return <DashboardView />;
}
