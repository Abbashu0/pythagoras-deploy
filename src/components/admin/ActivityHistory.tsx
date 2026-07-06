"use client";

/**
 * ActivityHistory
 * ----------------
 * Read-only feed of every dashboard action (uploaded, edited, reordered, etc.).
 *
 * Newest entries first. Each row shows date, time, action label, banner title.
 *
 * Data comes from the admin store — components just subscribe via the
 * `useAdminStore` hook. When the backend arrives, the store will fetch this
 * from the audit-log API and the UI won't change.
 */

import { History, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useAdminStore } from "@/lib/admin/use-admin-store";
import { getAdminStore } from "@/lib/admin/admin-store";
import { ActivityAction } from "@/lib/admin/activity-model";

const ACTION_COLORS: Record<ActivityAction, string> = {
  uploaded: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  deleted: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  edited: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  reordered: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  duplicated: "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
  enabled: "border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400",
  disabled: "border-gray-500/30 bg-gray-500/10 text-gray-600 dark:text-gray-400",
};

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

export function ActivityHistory() {
  const { history } = useAdminStore();
  const store = getAdminStore();

  return (
    <div className="flex h-full flex-col rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b p-4">
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
            className="h-7 text-xs text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
            مسح
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1" style={{ maxHeight: 460 }}>
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
                return (
                  <li
                    key={entry.id}
                    className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted/30"
                  >
                    <div className="flex flex-col items-center gap-0.5 pt-0.5">
                      <span className="text-[10px] tabular-nums text-muted-foreground">{date}</span>
                      <span className="text-[10px] tabular-nums text-muted-foreground/70">{time}</span>
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${ACTION_COLORS[entry.action]}`}
                        >
                          {entry.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-foreground">{entry.bannerTitle}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
