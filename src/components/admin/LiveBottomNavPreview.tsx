"use client";

/**
 * LiveBottomNavPreview — a mock of the student app's bottom navigation
 * bar, rendered inside the admin Navigation manager.
 *
 * Shows all 5 (or however many) nav items horizontally with their
 * current draft icons + labels. Updates in real-time as the admin
 * edits label/icon/enabled — what you see here is what students will
 * see once the changes are saved.
 *
 * Disabled items are dimmed (matching the student app's treatment of
 * hidden nav buttons).
 *
 * The bar is centered with a phone-like width (max-w-sm) so the
 * preview reads as "this is the bottom nav of the student app".
 */

import { AppIcon } from "@/lib/admin/app-icons";

/**
 * Minimal item shape this preview can render. Satisfied by both
 * `NavItem` (full nav item) and the editor's `EditableItem` draft.
 */
export interface PreviewNavItem {
  id: string;
  label: string;
  icon: string;
  enabled?: boolean;
  order: number;
}

interface Props {
  items: PreviewNavItem[];
  /** Optional id of the item currently being edited — gets a highlight. */
  activeId?: string | null;
}

export function LiveBottomNavPreview({ items, activeId }: Props) {
  const sorted = [...items].sort((a, b) => a.order - b.order);

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">معاينة حية</h2>
        <span className="text-[10px] text-muted-foreground">
          شريط التنقل السفلي للطلاب
        </span>
      </div>

      <div className="flex justify-center rounded-lg bg-muted/20 py-4">
        <div
          className="flex w-full max-w-sm items-stretch justify-between gap-1 rounded-2xl border border-border bg-card p-2 shadow-sm"
          dir="rtl"
        >
          {sorted.length === 0 ? (
            <div className="grid h-14 flex-1 place-items-center text-xs text-muted-foreground">
              لا توجد عناصر تنقل
            </div>
          ) : (
            sorted.map((item) => {
              const isActive = item.id === activeId;
              const isDisabled = !item.enabled;
              return (
                <div
                  key={item.id}
                  className={`flex flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 transition-all ${
                    isActive
                      ? "bg-primary/10 ring-1 ring-primary/30"
                      : ""
                  } ${isDisabled ? "opacity-40" : ""}`}
                  title={isDisabled ? "معطّل" : item.label}
                >
                  <span
                    className={`grid h-8 w-8 place-items-center rounded-full ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    <AppIcon name={item.icon} className="h-4 w-4" />
                  </span>
                  <span
                    className={`max-w-full truncate text-[10px] leading-none ${
                      isActive
                        ? "font-semibold text-primary"
                        : "text-muted-foreground"
                    }`}
                  >
                    {item.label || "—"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
        هذه معاينة مطابقة لشريط التنقل السفلي في تطبيق الطلاب. التغييرات غير
        المحفوظة تظهر هنا فوراً.
      </p>
    </div>
  );
}
