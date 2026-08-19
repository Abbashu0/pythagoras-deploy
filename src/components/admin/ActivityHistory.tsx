"use client";

/**
 * ActivityHistory
 * ----------------
 * Read-only feed of every dashboard action (uploaded, edited, reordered, etc.).
 *
 * Newest entries first. Each row shows date/time, action label, banner title,
 * and an optional expandable change-summary (for "edited" / "settings" entries).
 *
 * Architecture:
 *   - NO ScrollArea component — we use a plain div with overflow-y-auto so we
 *     have full control over the scroll container's flex sizing (the shadcn
 *     ScrollArea wraps content in a Radix primitive that fights with flex:1).
 *   - The Card has a fixed maxHeight (calc(100vh - 120px)) so the history
 *     column never grows taller than the viewport. Inside, a flex-shrink-0
 *     header sits at the top, and the scrollable list takes flex:1 below.
 *   - Each entry is wrapped in `admin-log-entry` for a subtle slide-in
 *     animation when new entries appear at the top.
 *
 * Data comes from the admin store — components just subscribe via the
 * `useAdminStore` hook. When the backend arrives, the store will fetch this
 * from the audit-log API and the UI won't change.
 */

import { useEffect, useState } from "react";
import { History, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAdminStore } from "@/lib/admin/use-admin-store";
import { getAdminStore } from "@/lib/admin/admin-store";
import { getImageSync, preloadAllImages } from "@/lib/admin/image-db";
import {
  ActivityAction,
  ACTIVITY_ICONS,
  ACTIVITY_LABELS,
} from "@/lib/admin/activity-model";

const ACTION_COLORS: Record<ActivityAction, string> = {
  uploaded:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  deleted: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  edited: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  reordered:
    "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  duplicated:
    "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
  enabled: "border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400",
  disabled:
    "border-gray-500/30 bg-gray-500/10 text-gray-600 dark:text-gray-400",
  settings: "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
};

function formatDateTime(iso: string) {
  try {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString("ar-EG", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
      time: d.toLocaleTimeString("ar-EG", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    };
  } catch {
    return { date: "—", time: "—" };
  }
}

/**
 * Resolve an activity entry's thumbnail to one of:
 *   - { kind: "image", src: <dataUrl> }  — render as <img>
 *   - { kind: "css", background: <css> } — render as div with CSS background
 *   - { kind: "icon" }                   — render the action icon fallback
 *
 * Handles `idb:<imageKey>` references (resolved synchronously from the
 * ImageDB in-memory cache), legacy `data:` URLs, and gradient CSS strings.
 */
function resolveThumbnail(
  thumb: string
):
  | { kind: "image"; src: string }
  | { kind: "css"; background: string }
  | { kind: "icon" } {
  if (!thumb) return { kind: "icon" };

  if (thumb.startsWith("idb:")) {
    const key = thumb.slice(4);
    const dataUrl = getImageSync(key);
    if (dataUrl) return { kind: "image", src: dataUrl };
    return { kind: "icon" };
  }

  if (thumb.startsWith("data:") || thumb.startsWith("http")) {
    return { kind: "image", src: thumb };
  }

  if (
    thumb.startsWith("linear-gradient") ||
    thumb.startsWith("radial-gradient") ||
    thumb.startsWith("#") ||
    thumb.startsWith("rgb")
  ) {
    return { kind: "css", background: thumb };
  }

  if (thumb.startsWith("/")) {
    return { kind: "image", src: thumb };
  }

  return { kind: "icon" };
}

export function ActivityHistory() {
  const { history } = useAdminStore();
  const store = getAdminStore();
  // Track which entries are expanded (showing change summary). Keyed by id.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Force a re-render once IndexedDB images are preloaded so idb: thumbnails
  // resolve to real data URLs (getImageSync returns "" before preload).
  const [, setImagesLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    preloadAllImages().then(() => {
      if (!cancelled) setImagesLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      className="flex flex-col rounded-xl border bg-card overflow-hidden"
      style={{
        height: "600px",
        maxHeight: "600px",
        minWidth: "280px",
        position: "sticky",
        top: "1rem",
      }}
    >
      {/* Header — fixed at top */}
      <div className="flex flex-shrink-0 items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">سجل النشاط</h3>
          <Badge variant="secondary" className="text-[10px]">
            {history.length}
          </Badge>
        </div>
        {history.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => store.clearHistory()}
            className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
            مسح
          </Button>
        )}
      </div>

      {/* Scrollable list — plain div, not ScrollArea, for flex control */}
      <div className="admin-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="p-2">
          {history.length === 0 ? (
            <div className="grid place-items-center gap-2 py-12 text-center text-xs text-muted-foreground">
              <History className="h-8 w-8 opacity-30" />
              لا يوجد نشاط بعد
            </div>
          ) : (
            <ol className="space-y-1">
              {history.map((entry) => {
                const { date, time } = formatDateTime(entry.at);
                const hasSummary =
                  Array.isArray(entry.changeSummary) &&
                  entry.changeSummary.length > 0;
                const isExpanded = expanded.has(entry.id);
                return (
                  <li
                    key={entry.id}
                    className="admin-log-entry rounded-lg px-2 py-2 transition-colors hover:bg-muted/30"
                  >
                    <div className="flex items-start gap-3">
                      {/* Thumbnail (or icon placeholder if no thumbnail) */}
                      <div className="flex-shrink-0">
                        {(() => {
                          const thumb = resolveThumbnail(entry.thumbnail);
                          if (thumb.kind === "image") {
                            return (
                              <img
                                src={thumb.src}
                                alt={entry.bannerTitle}
                                className="h-9 w-9 rounded-md border border-border object-cover"
                              />
                            );
                          }
                          if (thumb.kind === "css") {
                            return (
                              <div
                                className="h-9 w-9 rounded-md border border-border"
                                style={{ background: thumb.background }}
                                aria-label={entry.bannerTitle}
                              />
                            );
                          }
                          return (
                            <div className="grid h-9 w-9 place-items-center rounded-md border border-border bg-muted text-base">
                              {ACTIVITY_ICONS[entry.action]}
                            </div>
                          );
                        })()}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${ACTION_COLORS[entry.action]}`}
                          >
                            {ACTIVITY_LABELS[entry.action]}
                          </Badge>
                          <div className="flex flex-col items-end gap-0.5 pt-0.5 text-[10px] tabular-nums text-muted-foreground">
                            <span>{date}</span>
                            <span className="text-muted-foreground/70">
                              {time}
                            </span>
                          </div>
                        </div>
                        <p className="truncate text-xs font-medium text-foreground">
                          {entry.bannerTitle}
                        </p>

                        {/* Expandable change summary */}
                        {hasSummary && (
                          <button
                            type="button"
                            onClick={() => toggleExpand(entry.id)}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                            {isExpanded ? "إخفاء التفاصيل" : "عرض التفاصيل"}
                          </button>
                        )}
                        {hasSummary && isExpanded && (
                          <ul className="mt-1 space-y-0.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
                            {entry.changeSummary!.map((line, i) => (
                              <li
                                key={i}
                                className="text-[10px] leading-relaxed text-muted-foreground"
                                dir="rtl"
                              >
                                • {line}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
