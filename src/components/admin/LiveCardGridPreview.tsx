"use client";

/**
 * LiveCardGridPreview — a mock of the student app's materials grid /
 * tools list, rendered inside the admin Materials + Tools managers.
 *
 * Shows all items as a responsive card grid with their current draft
 * icons + labels. Updates in real-time as the admin edits name/icon/
 * availability — what you see here is what students will see once the
 * changes are saved.
 *
 * Unavailable items are dimmed + show a "معطّل" badge so the admin
 * can see at a glance which items the students won't see yet.
 */

import { AppIcon } from "@/lib/admin/app-icons";

/**
 * Minimal item shape this preview can render. Satisfied by both
 * `ContentItem` (full content item) and the editor's `EditableItem` draft.
 */
export interface PreviewContentItem {
  id: string;
  label: string;
  icon: string;
  available?: boolean;
  order: number;
}

interface Props {
  items: PreviewContentItem[];
  /** Optional id of the item currently being edited — gets a highlight. */
  activeId?: string | null;
  /** Label shown in the preview header (e.g. "شبكة المواد" / "قائمة الأدوات"). */
  headerLabel: string;
  /** Layout style — grid for materials, list for tools. */
  variant?: "grid" | "list";
}

export function LiveCardGridPreview({
  items,
  activeId,
  headerLabel,
  variant = "grid",
}: Props) {
  const sorted = [...items].sort((a, b) => a.order - b.order);

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">معاينة حية</h2>
        <span className="text-[10px] text-muted-foreground">{headerLabel}</span>
      </div>

      {variant === "grid" ? (
        <div
          className="grid grid-cols-2 gap-3 rounded-lg bg-muted/20 p-3 sm:grid-cols-4"
          dir="rtl"
        >
          {sorted.length === 0 ? (
            <div className="col-span-full grid h-20 place-items-center text-xs text-muted-foreground">
              لا توجد عناصر
            </div>
          ) : (
            sorted.map((item) => {
              const isActive = item.id === activeId;
              const isOff = !item.available;
              return (
                <div
                  key={item.id}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border bg-card p-3 text-center transition-all ${
                    isActive
                      ? "border-primary ring-1 ring-primary/30"
                      : "border-border"
                  } ${isOff ? "opacity-50" : ""}`}
                >
                  <span
                    className={`grid h-10 w-10 place-items-center rounded-full ${
                      isOff
                        ? "bg-muted text-muted-foreground"
                        : "bg-primary/10 text-primary"
                    }`}
                  >
                    <AppIcon name={item.icon} className="h-5 w-5" />
                  </span>
                  <span className="line-clamp-2 text-[11px] font-medium leading-tight text-foreground">
                    {item.label || "—"}
                  </span>
                  {isOff && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                      معطّل
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div
          className="flex flex-col gap-2 rounded-lg bg-muted/20 p-3"
          dir="rtl"
        >
          {sorted.length === 0 ? (
            <div className="grid h-20 place-items-center text-xs text-muted-foreground">
              لا توجد عناصر
            </div>
          ) : (
            sorted.map((item) => {
              const isActive = item.id === activeId;
              const isOff = !item.available;
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 rounded-lg border bg-card p-2.5 transition-all ${
                    isActive
                      ? "border-primary ring-1 ring-primary/30"
                      : "border-border"
                  } ${isOff ? "opacity-60" : ""}`}
                >
                  <span
                    className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg ${
                      isOff
                        ? "bg-muted text-muted-foreground"
                        : "bg-primary/10 text-primary"
                    }`}
                  >
                    <AppIcon name={item.icon} className="h-4 w-4" />
                  </span>
                  <span className="flex-1 truncate text-xs font-medium text-foreground">
                    {item.label || "—"}
                  </span>
                  {isOff ? (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                      معطّل
                    </span>
                  ) : (
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-600 dark:text-emerald-400">
                      متاح
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
        هذه معاينة مطابقة لما يراه الطلاب. التغييرات غير المحفوظة تظهر هنا فوراً.
      </p>
    </div>
  );
}
