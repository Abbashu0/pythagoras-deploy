"use client";

/**
 * AdminPageLayout — shared content layout for admin sub-pages
 * (materials, tools, navigation).
 *
 * In the new AdminShell architecture:
 *   - The shell provides sidebar + topbar + breadcrumbs + theme toggle
 *   - This layout only provides the 3-column content grid:
 *     [list] [editor] [activity history]
 *   - The old header (back button + title + theme toggle) has been removed
 *     — navigation is via the sidebar, breadcrumbs are in the topbar
 *
 * The `loadStore` prop is still called on mount for the page's own store
 * (idempotent — the shell already loaded the shared AdminStore).
 */

import { useEffect, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { ActivityHistory } from "@/components/admin/ActivityHistory";
import { getMaterialsStore, getToolsStore } from "@/lib/admin/content-store";

interface Props {
  /** Optional storage error message — surfaces a warning banner. */
  storageError?: string | null;
  /**
   * Called once on mount (client-only, after hydration). The page uses
   * this to load its own list store. Idempotent on repeat calls.
   */
  loadStore: () => void;
  /** Left column — the reorderable list of items. */
  list: ReactNode;
  /** Middle column — the editor panel. */
  editor: ReactNode;
  /** Bottom strip — the live preview (full-width). */
  preview: ReactNode;
}

export function AdminPageLayout({
  storageError,
  loadStore,
  list,
  editor,
  preview,
}: Props) {
  useEffect(() => {
    loadStore();
    // Hydrate images from IndexedDB for all content stores.
    getMaterialsStore().hydrateImagesFromIDB();
    getToolsStore().hydrateImagesFromIDB();
  }, [loadStore]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      {/* ---------- Storage error warning ---------- */}
      {storageError && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-destructive">تحذير: تعذّر الحفظ</h3>
            <p className="mt-1 text-xs leading-relaxed text-destructive/80">{storageError}</p>
          </div>
        </div>
      )}

      {/* ---------- Main 3-column grid ---------- */}
      <div className="grid grid-cols-12 gap-6">
        <section className="col-span-12 space-y-5 lg:col-span-5">{list}</section>
        <section className="col-span-12 lg:col-span-4">{editor}</section>
        <section className="col-span-12 lg:col-span-3">
          <div className="lg:sticky lg:top-20">
            <ActivityHistory />
          </div>
        </section>
      </div>

      {/* ---------- Bottom: live preview ---------- */}
      <section className="mt-8">{preview}</section>
    </div>
  );
}
