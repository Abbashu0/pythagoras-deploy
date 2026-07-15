"use client";

/**
 * ActivityCenterDrawer — global slide-in panel for the Activity Center.
 *
 * Opens from the right side (RTL) via the Activity button in the TopBar.
 * Contains:
 *   - Search box (filter by title/action)
 *   - Type filter chips (All / Edited / Uploaded / Deleted / Reordered / Settings)
 *   - Scrollable timeline of activity entries
 *   - Each entry has an icon, badge, timestamp, and optional expandable
 *     change summary
 *   - "Clear all" button at the bottom
 *
 * The drawer reuses the same AdminStore history data that ActivityHistory
 * uses — it's a different VIEW of the same data, not a separate system.
 * The original ActivityHistory card can still appear in page sidebars
 * for quick reference.
 *
 * Inspired by: Linear's activity drawer, Vercel's notification panel.
 */

import { useMemo, useState } from "react";
import {
  X,
  Search,
  Trash2,
  History,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  Upload,
  Edit,
  Trash,
  ArrowUpDown,
  Settings,
  Copy,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAdminStore } from "@/lib/admin/use-admin-store";
import { getAdminStore } from "@/lib/admin/admin-store";
import {
  ActivityAction,
  ACTIVITY_ICONS,
  ACTIVITY_LABELS,
} from "@/lib/admin/activity-model";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

const ACTION_COLORS: Record<ActivityAction, string> = {
  uploaded: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  deleted: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  edited: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  reordered: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  duplicated: "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
  enabled: "border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400",
  disabled: "border-gray-500/30 bg-gray-500/10 text-gray-600 dark:text-gray-400",
  settings: "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
};

const FILTER_CHIPS: { id: ActivityAction | "all"; label: string; icon: LucideIcon }[] = [
  { id: "all", label: "الكل", icon: History },
  { id: "uploaded", label: "رفع", icon: Upload },
  { id: "edited", label: "تعديل", icon: Edit },
  { id: "deleted", label: "حذف", icon: Trash },
  { id: "reordered", label: "ترتيب", icon: ArrowUpDown },
  { id: "duplicated", label: "تكرار", icon: Copy },
  { id: "settings", label: "إعدادات", icon: Settings },
];

function formatDateTime(iso: string) {
  try {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString("ar-EG", { day: "2-digit", month: "2-digit", year: "numeric" }),
      time: d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };
  } catch {
    return { date: "—", time: "—" };
  }
}

export function ActivityCenterDrawer({ open, onClose }: Props) {
  const { history } = useAdminStore();
  const store = getAdminStore();
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActivityAction | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filteredHistory = useMemo(() => {
    let result = history;
    if (activeFilter !== "all") {
      result = result.filter((e) => e.action === activeFilter);
    }
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery) {
      result = result.filter(
        (e) =>
          e.bannerTitle?.toLowerCase().includes(normalizedQuery) ||
          ACTIVITY_LABELS[e.action]?.toLowerCase().includes(normalizedQuery)
      );
    }
    return result;
  }, [history, activeFilter, query]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-full max-w-md flex-col border-r bg-card shadow-2xl transition-transform duration-300",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        dir="rtl"
      >
        {/* ---------- Header ---------- */}
        <div className="flex flex-shrink-0 items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <History className="h-5 w-5 text-primary" />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-card" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">مركز النشاط</h2>
              <p className="text-[10px] text-muted-foreground">
                {history.length} عملية مسجّلة
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* ---------- Search + Filters ---------- */}
        <div className="flex-shrink-0 space-y-2 border-b px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث في النشاط…"
              className="h-8 w-full rounded-md border border-border bg-background pr-8 pl-2 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute left-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Filter chips */}
          <div className="flex flex-wrap gap-1.5">
            {FILTER_CHIPS.map((chip) => {
              const Icon = chip.icon;
              const isActive = activeFilter === chip.id;
              const count =
                chip.id === "all"
                  ? history.length
                  : history.filter((e) => e.action === chip.id).length;
              return (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setActiveFilter(chip.id)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                    isActive
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-muted/40 hover:text-foreground"
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {chip.label}
                  <span
                    className={cn(
                      "rounded-full px-1 text-[8px] tabular-nums",
                      isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ---------- Timeline ---------- */}
        <div className="admin-scroll min-h-0 flex-1 overflow-y-auto p-3">
          {filteredHistory.length === 0 ? (
            <div className="grid place-items-center gap-2 py-16 text-center text-xs text-muted-foreground">
              <History className="h-10 w-10 opacity-20" />
              {query || activeFilter !== "all"
                ? "لا توجد نتائج مطابقة."
                : "لا يوجد نشاط بعد."}
            </div>
          ) : (
            <ol className="space-y-1">
              {filteredHistory.map((entry) => {
                const { date, time } = formatDateTime(entry.at);
                const hasSummary =
                  Array.isArray(entry.changeSummary) && entry.changeSummary.length > 0;
                const isExpanded = expanded.has(entry.id);
                return (
                  <li
                    key={entry.id}
                    className="rounded-lg px-2 py-2 transition-colors hover:bg-muted/30"
                  >
                    <div className="flex items-start gap-2.5">
                      {/* Icon */}
                      <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-md border border-border bg-muted text-sm">
                        {ACTIVITY_ICONS[entry.action]}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <Badge
                            variant="outline"
                            className={cn("text-[9px]", ACTION_COLORS[entry.action])}
                          >
                            {ACTIVITY_LABELS[entry.action]}
                          </Badge>
                          <div className="flex flex-col items-end gap-0.5 text-[9px] tabular-nums text-muted-foreground">
                            <span>{date}</span>
                            <span className="text-muted-foreground/70">{time}</span>
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

        {/* ---------- Footer ---------- */}
        {history.length > 0 && (
          <div className="flex-shrink-0 border-t px-4 py-2.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                store.clearHistory();
              }}
              className="h-7 w-full gap-1.5 text-xs text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
              مسح السجل
            </Button>
          </div>
        )}
      </aside>
    </>
  );
}
