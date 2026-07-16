"use client";

/**
 * NotificationsDrawer — slide-in panel for system notifications.
 *
 * Shows important alerts:
 *   - New user registered
 *   - Premium subscription purchased
 *   - Storage approaching limit
 *   - Banner expiring soon
 *   - System errors
 *
 * For now, shows a placeholder with "no notifications" since the backend
 * notification system isn't built yet. The structure is ready for when
 * real notifications arrive.
 */

import { X, Bell, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NotificationsDrawer({ open, onClose }: Props) {
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
          "fixed inset-y-0 left-0 z-50 flex w-full max-w-sm flex-col border-r bg-card shadow-2xl transition-transform duration-300",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-sm font-bold text-foreground">التنبيهات</h2>
              <p className="text-[10px] text-muted-foreground">إشعارات النظام المهمة</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="admin-scroll flex-1 overflow-y-auto p-4">
          {/* Empty state */}
          <div className="grid place-items-center gap-3 py-16 text-center">
            <div className="grid h-16 w-16 place-items-center rounded-full bg-muted">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">لا توجد تنبيهات</p>
              <p className="max-w-[200px] text-xs text-muted-foreground">
                ستظهر هنا التنبيهات المهمة مثل تسجيل مستخدمين جدد،
                شراء اشتراكات Premium، أو تحذيرات النظام.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t px-4 py-2.5">
          <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" disabled>
            تعليم الكل كمقروء
          </Button>
        </div>
      </aside>
    </>
  );
}
