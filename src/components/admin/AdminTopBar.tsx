"use client";

/**
 * AdminTopBar — global top bar for the admin console.
 *
 * Contains:
 *   - Mobile hamburger (toggles sidebar)
 *   - Breadcrumbs (dynamic based on current route)
 *   - Centered inline search bar (opens Command Palette dropdown with suggestions)
 *   - Activity Center button (opens drawer)
 *   - Notifications button (opens notifications panel)
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
  X,
  LayoutDashboard,
  ImagePlus,
  BookOpen,
  Compass,
  Wrench,
  FileQuestion,
  CornerDownLeft,
  type LucideIcon,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useAdminStore } from "@/lib/admin/use-admin-store";
import { getAdminStore } from "@/lib/admin/admin-store";
import { cn } from "@/lib/utils";

interface Props {
  onMenuClick: () => void;
  onActivityClick: () => void;
  onNotificationsClick: () => void;
  onSearchNavigate: (href: string) => void;
}

const BREADCRUMB_MAP: Record<string, { label: string; parent?: string; parentLabel?: string }> = {
  "/admin": { label: "لوحة التحكم" },
  "/admin/banners": { label: "البانرات", parent: "/admin", parentLabel: "التسويق" },
  "/admin/materials": { label: "المواد الدراسية", parent: "/admin", parentLabel: "المحتوى" },
  "/admin/tools": { label: "الأدوات", parent: "/admin", parentLabel: "المحتوى" },
  "/admin/navigation": { label: "التنقل", parent: "/admin", parentLabel: "المحتوى" },
  "/admin/questions": { label: "بنك الأسئلة", parent: "/admin", parentLabel: "المحتوى" },
};

// Search suggestions — all navigable pages + quick actions
interface SearchSuggestion {
  label: string;
  href: string;
  icon: LucideIcon;
  group: string;
  keywords: string[];
}

const SUGGESTIONS: SearchSuggestion[] = [
  { label: "لوحة التحكم", href: "/admin", icon: LayoutDashboard, group: "تنقل", keywords: ["dashboard", "home"] },
  { label: "بانرات الصفحة الرئيسية", href: "/admin/banners", icon: ImagePlus, group: "تنقل", keywords: ["banners", "carousel"] },
  { label: "المواد الدراسية", href: "/admin/materials", icon: BookOpen, group: "تنقل", keywords: ["materials", "subjects"] },
  { label: "إدارة التنقل", href: "/admin/navigation", icon: Compass, group: "تنقل", keywords: ["navigation", "nav"] },
  { label: "إدارة الأدوات", href: "/admin/tools", icon: Wrench, group: "تنقل", keywords: ["tools"] },
  { label: "بنك الأسئلة", href: "/admin/questions", icon: FileQuestion, group: "تنقل", keywords: ["questions", "bank"] },
];

export function AdminTopBar({ onMenuClick, onActivityClick, onNotificationsClick, onSearchNavigate }: Props) {
  const pathname = usePathname();
  const { adminTheme } = useAdminStore();
  const store = getAdminStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchRef = useRef<HTMLDivElement>(null);

  const crumb = BREADCRUMB_MAP[pathname] || { label: "لوحة التحكم" };

  const handleToggleTheme = () => {
    store.setAdminTheme(adminTheme === "dark" ? "light" : "dark");
  };

  // Filter suggestions
  const filtered = searchQuery.trim()
    ? SUGGESTIONS.filter(
        (s) =>
          s.label.includes(searchQuery) ||
          s.keywords.some((k) => k.includes(searchQuery.toLowerCase()))
      )
    : SUGGESTIONS;

  // Keyboard navigation within search
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = filtered[selectedIndex];
      if (selected) {
        onSearchNavigate(selected.href);
        setSearchQuery("");
        setSearchFocused(false);
      }
    } else if (e.key === "Escape") {
      setSearchFocused(false);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

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
      <nav className="flex flex-shrink-0 items-center gap-1.5 text-sm" dir="rtl">
        {crumb.parentLabel && (
          <>
            <span className="hidden text-muted-foreground sm:inline">{crumb.parentLabel}</span>
            <ChevronLeft className="hidden h-3.5 w-3.5 text-muted-foreground/50 sm:inline" />
          </>
        )}
        <span className="font-semibold text-foreground">{crumb.label}</span>
      </nav>

      {/* Centered Search — inline, expandable */}
      <div ref={searchRef} className="relative mx-auto w-full max-w-md">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onFocus={() => setSearchFocused(true)}
            onKeyDown={handleSearchKeyDown}
            placeholder="بحث أو تنقّل…"
            className="h-9 w-full rounded-lg border border-border bg-background pr-9 pl-16 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
            dir="rtl"
          />
          <div className="absolute left-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {searchQuery ? (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSearchFocused(false);
                }}
                className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            ) : (
              <kbd className="rounded border bg-muted px-1 py-0.5 text-[8px] font-mono text-muted-foreground">
                ⌘K
              </kbd>
            )}
          </div>
        </div>

        {/* Search dropdown */}
        {searchFocused && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border bg-card shadow-2xl">
            <div className="max-h-80 overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="grid place-items-center gap-1 py-8 text-center text-xs text-muted-foreground">
                  <Search className="h-6 w-6 opacity-20" />
                  لا توجد نتائج لـ «{searchQuery}»
                </div>
              ) : (
                filtered.map((s, i) => {
                  const Icon = s.icon;
                  const isSelected = i === selectedIndex;
                  return (
                    <button
                      key={s.href}
                      onClick={() => {
                        onSearchNavigate(s.href);
                        setSearchQuery("");
                        setSearchFocused(false);
                      }}
                      onMouseEnter={() => setSelectedIndex(i)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-right transition-colors",
                        isSelected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted/50"
                      )}
                    >
                      <Icon className={cn("h-4 w-4 flex-shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
                      <span className="flex-1 truncate text-xs font-medium">{s.label}</span>
                      {isSelected && <CornerDownLeft className="h-3 w-3 text-primary/60" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Activity Center button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onActivityClick}
        className="relative flex-shrink-0"
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
        onClick={onNotificationsClick}
        className="relative flex-shrink-0"
        aria-label="التنبيهات"
        title="التنبيهات"
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
        className="flex-shrink-0"
      >
        {adminTheme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </Button>

      {/* Admin profile */}
      <div className="flex flex-shrink-0 items-center gap-2 border-r pr-3">
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
