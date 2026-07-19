"use client";

/**
 * AdminPageLayout — shared content layout for admin sub-pages
 * (materials, tools, navigation).
 *
 * In the new AdminShell architecture:
 *   - The shell provides sidebar + topbar + breadcrumbs + theme toggle
 *   - Activity history is now GLOBAL (ActivityCenterDrawer) — no longer
 *     a per-page sidebar column
 *   - This layout provides a 2-column content grid:
 *     [list] [editor]
 *   - The preview strip stays at the bottom (full-width)
 */

import { useEffect, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { getMaterialsStore, getToolsStore } from "@/lib/admin/content-store";

interface Props {
  /** Optional storage error message — surfaces a warning banner. */
  storageError?: string | null;
  /**
   * Called once on mount (client-only, after hydration). The page uses
   * this to load its own list store. Idempotent.
   */
  loadStore: () => void;
  /** Left column — the reorderable list of items. */
  list: ReactNode;
  /** Right column — the editor panel (wider now, no activity sidebar). */
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
    getMaterialsStore().hydrateImagesFromIDB();
    getToolsStore().hydrateImagesFromIDB();
  }, [loadStore]);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
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

      {/* ---------- Main 2-column grid (list + editor) ---------- */}
      <div className="grid grid-cols-12 gap-6">
        <section className="col-span-12 space-y-5 lg:col-span-5">{list}</section>
        <section className="col-span-12 lg:col-span-7">{editor}</section>
      </div>

      {/* ---------- Bottom: live preview ---------- */}
      <section className="mt-8">{preview}</section>
    </div>
  );
}
