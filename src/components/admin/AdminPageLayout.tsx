"use client";

/**
 * AdminPageLayout — shared content layout for admin sub-pages.
 *
 * NEW LAYOUT (with live preview on the left):
 *
 *   ┌─────────┬──────────────────┬──────────────┐
 *   │         │                  │              │
 *   │ Sidebar │  Editor area     │  Preview     │
 *   │ (right) │  (scrollable)    │  (fixed left)│
 *   │         │  - List          │  [Card][Page]│
 *   │         │  - Editor form   │              │
 *   │         │  - Settings      │              │
 *   │         │                  │              │
 *   └─────────┴──────────────────┴──────────────┘
 *
 * The preview is ALWAYS visible (sticky) while the editor scrolls.
 * The preview panel has a toggle between "بطاقة" (single card) and
 * "صفحة كاملة" (full student app page via iframe).
 */

import { useEffect, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { getMaterialsStore, getToolsStore } from "@/lib/admin/content-store";

interface Props {
  storageError?: string | null;
  loadStore: () => void;
  /** Editor area: list + form + settings (scrollable) */
  editor: ReactNode;
  /** Preview panel content (card mode) */
  cardPreview: ReactNode;
  /** Student app URL for full-page mode */
  fullPageUrl: string;
  /** Label for full-page mode */
  fullPageLabel: string;
  /** Optional children (e.g. DeleteConfirmDialog) */
  children?: ReactNode;
}

export function AdminPageLayout({
  storageError,
  loadStore,
  editor,
  cardPreview,
  fullPageUrl,
  fullPageLabel,
  children,
}: Props) {
  useEffect(() => {
    loadStore();
    getMaterialsStore().hydrateImagesFromIDB();
    getToolsStore().hydrateImagesFromIDB();
  }, [loadStore]);

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
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

      {/* ---------- 2-column: Editor (right) + Preview (left, fixed) ---------- */}
      <div className="grid grid-cols-12 gap-6">
        {/* Editor area — scrollable */}
        <section className="col-span-12 lg:col-span-7 xl:col-span-8">
          {editor}
        </section>

        {/* Preview — fixed on the left */}
        <section className="col-span-12 lg:col-span-5 xl:col-span-4">
          <LivePreviewPanelWrapper
            cardPreview={cardPreview}
            fullPageUrl={fullPageUrl}
            fullPageLabel={fullPageLabel}
          />
        </section>
      </div>

      {/* Optional children (dialogs, etc.) */}
      {children}
    </div>
  );
}

// Lazy import to avoid circular dependency
import { LivePreviewPanel } from "./LivePreviewPanel";

function LivePreviewPanelWrapper(props: {
  cardPreview: ReactNode;
  fullPageUrl: string;
  fullPageLabel: string;
}) {
  return <LivePreviewPanel {...props} />;
}
