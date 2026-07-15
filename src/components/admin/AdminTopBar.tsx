"use client";

/**
 * AdminTopBar — global top bar for the admin console.
 *
 * Contains:
 *   - Mobile hamburger (toggles sidebar)
 *   - Breadcrumbs (dynamic based on current route)
 *   - Global search trigger (opens Command Palette — Milestone 4)
 *   - Activity Center button (opens drawer — Milestone 3)
 *   - Notifications button (coming soon)
 *   - Theme toggle (light/dark)
 *   - Admin profile avatar
 */

import { usePathname } from "next/navigation";
import {
  Menu,
  Search,
  Bell,
  Activity,
  Sun,
  Moon,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdminStore } from "@/lib/admin/use-admin-store";
import { getAdminStore } from "@/lib/admin/admin-store";

interface Props {
  /** Mobile sidebar toggle. */
  onMenuClick: () => void;
  /** Activity Center toggle. */
  onActivityClick: () => void;
  /** Command Palette / Search toggle. */
  onSearchClick: () => void;
}

/** Route → breadcrumb segments mapping. */
const BREADCRUMB_MAP: Record<string, { label: string; parent?: string; parentLabel?: string }> = {
  "/admin": { label: "لوحة التحكم" },
  "/admin/banners": { label: "البانرات", parent: "/admin", parentLabel: "التسويق" },
  "/admin/materials": { label: "المواد الدراسية", parent: "/admin", parentLabel: "المحتوى" },
  "/admin/tools": { label: "الأدوات", parent: "/admin", parentLabel: "المحتوى" },
  "/admin/navigation": { label: "التنقل", parent: "/admin", parentLabel: "المحتوى" },
};

export function AdminTopBar({ onMenuClick, onActivityClick, onSearchClick }: Props) {
  const pathname = usePathname();
  const { adminTheme } = useAdminStore();
  const store = getAdminStore();

  const crumb = BREADCRUMB_MAP[pathname] || { label: "لوحة التحكم" };

  const handleToggleTheme = () => {
    store.setAdminTheme(adminTheme === "dark" ? "light" : "dark");
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 flex-shrink-0 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur-lg">
      {/* Mobile menu button */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onMenuClick}
        aria-label="القائمة"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-sm" dir="rtl">
        {crumb.parentLabel && (
          <>
            <span className="text-muted-foreground">{crumb.parentLabel}</span>
            <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground/50" />
          </>
        )}
        <span className="font-semibold text-foreground">{crumb.label}</span>
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Global Search trigger — opens Command Palette */}
      <button
        type="button"
        onClick={onSearchClick}
        className="hidden items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted sm:flex"
        title="بحث عام (Ctrl+K)"
      >
        <Search className="h-3.5 w-3.5" />
        <span>بحث…</span>
        <kbd className="rounded border bg-muted px-1 text-[9px] font-mono">⌘K</kbd>
      </button>

      {/* Mobile search button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onSearchClick}
        className="sm:hidden"
        aria-label="بحث"
      >
        <Search className="h-5 w-5" />
      </Button>

      {/* Activity Center button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onActivityClick}
        className="relative"
        aria-label="مركز النشاط"
        title="مركز النشاط"
      >
        <Activity className="h-5 w-5" />
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-card" />
      </Button>

      {/* Notifications */}
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        aria-label="التنبيهات"
        title="التنبيهات — قريباً"
      >
        <Bell className="h-5 w-5" />
      </Button>

      {/* Theme toggle */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleToggleTheme}
        aria-label={adminTheme === "dark" ? "وضع فاتح" : "وضع داكن"}
        title={adminTheme === "dark" ? "وضع فاتح" : "وضع داكن"}
      >
        {adminTheme === "dark" ? (
          <Sun className="h-5 w-5" />
        ) : (
          <Moon className="h-5 w-5" />
        )}
      </Button>

      {/* Admin profile */}
      <div className="flex items-center gap-2 border-r pr-3">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary ring-1 ring-primary/20">
          أ
        </div>
        <div className="hidden sm:block">
          <div className="text-xs font-semibold text-foreground">المدير</div>
          <div className="text-[10px] text-muted-foreground">admin@pythagoras</div>
        </div>
      </div>
    </header>
  );
}
