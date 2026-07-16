"use client";

/**
 * LivePreviewPanel — fixed preview panel with two modes:
 *
 *   1. "بطاقة" (Card): Shows the single card/banner preview component.
 *      Updates live as the admin types (uses draft state directly).
 *
 *   2. "صفحة كاملة" (Full Page): Shows the actual student app page
 *      via an iframe. Loads the REAL page (not a copy) so any design
 *      changes in the student app CSS/JS reflect automatically.
 *      The iframe is non-interactive (pointer-events: none) — it's
 *      a visual preview only. The carousel auto-slides because that's
 *      JS-driven (doesn't need clicks).
 *
 * Layout: Fixed on the left side of the page, always visible while
 * the editor scrolls on the right.
 *
 * The toggle is a simple two-button switch at the top of the panel.
 */

import { useState, type ReactNode } from "react";
import { Square, Layout, ExternalLink, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** The card-mode preview (MaterialCardPreview, LiveCarouselPreview, etc.) */
  cardPreview: ReactNode;
  /** The student app URL for full-page mode (e.g. "/pythagoras/index.html#materials") */
  fullPageUrl: string;
  /** Label for the full-page mode (e.g. "صفحة المواد", "الصفحة الرئيسية") */
  fullPageLabel: string;
}

export function LivePreviewPanel({ cardPreview, fullPageUrl, fullPageLabel }: Props) {
  const [mode, setMode] = useState<"card" | "page">("card");
  const [iframeKey, setIframeKey] = useState(0);

  return (
    <div className="sticky top-20 flex h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-xl border bg-card">
      {/* ---------- Header with toggle ---------- */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b px-3 py-2.5">
        <div className="flex rounded-lg border p-0.5">
          <button
            onClick={() => setMode("card")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-medium transition-colors",
              mode === "card"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Square className="h-3 w-3" />
            بطاقة
          </button>
          <button
            onClick={() => setMode("page")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-medium transition-colors",
              mode === "page"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Layout className="h-3 w-3" />
            صفحة كاملة
          </button>
        </div>

        {/* Action buttons */}
        <div className="mr-auto flex items-center gap-1">
          {mode === "page" && (
            <>
              <button
                onClick={() => setIframeKey((k) => k + 1)}
                className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                title="إعادة تحميل"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
              <a
                href={fullPageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                title="فتح في تبويب جديد"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </>
          )}
        </div>
      </div>

      {/* ---------- Preview content ---------- */}
      <div className="admin-scroll relative min-h-0 flex-1 overflow-y-auto">
        {mode === "card" ? (
          <div className="flex min-h-full items-start justify-center p-4">
            {cardPreview}
          </div>
        ) : (
          <div className="relative h-full">
            {/* Full-page iframe — non-interactive */}
            <iframe
              key={iframeKey}
              src={fullPageUrl}
              className="h-full w-full border-0"
              style={{
                pointerEvents: "none",
                minHeight: "100%",
              }}
              title={fullPageLabel}
              loading="lazy"
            />
            {/* Overlay label showing which page this is */}
            <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[10px] font-medium text-white backdrop-blur">
              {fullPageLabel} — معاينة فقط
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
