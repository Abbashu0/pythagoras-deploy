"use client";

/**
 * CommandPalette — VS Code-style command palette for the admin console.
 *
 * Opens with Ctrl+K (or Cmd+K on Mac) from anywhere inside /admin.
 * Provides:
 *   - Quick navigation to any admin page
 *   - Quick actions (toggle theme, open activity center, clear history)
 *   - Fuzzy search by Arabic or English label
 *   - Keyboard navigation (↑↓ to move, Enter to select, Esc to close)
 *
 * Inspired by: Linear, Vercel, VS Code command palettes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  LayoutDashboard,
  ImagePlus,
  BookOpen,
  Compass,
  Wrench,
  FileQuestion,
  Activity,
  Sun,
  Moon,
  Trash2,
  Database,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminStore } from "@/lib/admin/use-admin-store";
import { getAdminStore } from "@/lib/admin/admin-store";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenActivity: () => void;
}

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  group: "تنقل" | "إجراءات" | "أقسام";
  action: () => void;
  keywords?: string[];
}

export function CommandPalette({ open, onClose, onOpenActivity }: Props) {
  const router = useRouter();
  const { adminTheme } = useAdminStore();
  const store = getAdminStore();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build commands
  const commands = useMemo<Command[]>(() => {
    const navigate = (href: string) => {
      router.push(href);
      onClose();
    };

    return [
      // Navigation
      { id: "nav-dashboard", label: "لوحة التحكم", icon: LayoutDashboard, group: "تنقل", action: () => navigate("/admin"), keywords: ["dashboard", "home"] },
      { id: "nav-banners", label: "بانرات الصفحة الرئيسية", icon: ImagePlus, group: "تنقل", action: () => navigate("/admin/banners"), keywords: ["banners", "carousel"] },
      { id: "nav-materials", label: "المواد الدراسية", icon: BookOpen, group: "تنقل", action: () => navigate("/admin/materials"), keywords: ["materials", "subjects"] },
      { id: "nav-navigation", label: "إدارة التنقل", icon: Compass, group: "تنقل", action: () => navigate("/admin/navigation"), keywords: ["navigation", "nav"] },
      { id: "nav-tools", label: "إدارة الأدوات", icon: Wrench, group: "تنقل", action: () => navigate("/admin/tools"), keywords: ["tools"] },
      { id: "nav-questions", label: "بنك الأسئلة", icon: FileQuestion, group: "أقسام", action: () => navigate("/admin/questions"), keywords: ["questions", "bank"] },

      // Actions
      { id: "action-activity", label: "فتح مركز النشاط", hint: "السجل الكامل", icon: Activity, group: "إجراءات", action: () => { onOpenActivity(); onClose(); }, keywords: ["activity", "history"] },
      { id: "action-theme", label: adminTheme === "dark" ? "تفعيل الوضع الفاتح" : "تفعيل الوضع الداكن", icon: adminTheme === "dark" ? Sun : Moon, group: "إجراءات", action: () => { store.setAdminTheme(adminTheme === "dark" ? "light" : "dark"); onClose(); }, keywords: ["theme", "dark", "light"] },
      { id: "action-clear-history", label: "مسح سجل النشاط", icon: Trash2, group: "إجراءات", action: () => { store.clearHistory(); onClose(); }, keywords: ["clear", "history", "delete"] },
    ];
  }, [router, onClose, onOpenActivity, adminTheme, store]);

  // Filter commands by query
  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((cmd) => {
      const inLabel = cmd.label.toLowerCase().includes(q);
      const inKeywords = cmd.keywords?.some((k) => k.includes(q));
      return inLabel || inKeywords;
    });
  }, [commands, query]);

  // Clamp selectedIndex to valid range for filtered commands.
  const flatCommands = filteredCommands;
  const safeIndex = flatCommands.length > 0
    ? Math.min(selectedIndex, flatCommands.length - 1)
    : 0;

  // Focus input when palette opens.
  // State reset (query, selectedIndex) is handled by keying the component
  // on `open` from the parent — when `open` changes, the parent re-renders
  // and we reset via the `key` prop. Here we only do DOM side-effects.
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filteredCommands[safeIndex];
        if (cmd) cmd.action();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, filteredCommands, safeIndex, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const selected = listRef.current.querySelector(`[data-index="${safeIndex}"]`);
    if (selected) {
      selected.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [safeIndex, open]);

  // Group filtered commands
  const grouped = useMemo(() => {
    const groups: Record<string, Command[]> = {};
    for (const cmd of filteredCommands) {
      if (!groups[cmd.group]) groups[cmd.group] = [];
      groups[cmd.group].push(cmd);
    }
    return groups;
  }, [filteredCommands]);

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Palette */}
      <div
        className="fixed left-1/2 top-[20%] z-[61] w-full max-w-xl -translate-x-1/2 px-4"
        dir="rtl"
      >
        <div className="overflow-hidden rounded-2xl border bg-card shadow-2xl">
          {/* Search input */}
          <div className="flex items-center gap-2.5 border-b px-4 py-3">
            <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث أو نفّذ أمراً…"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <kbd className="flex-shrink-0 rounded border bg-muted px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">
              Esc
            </kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="admin-scroll max-h-80 overflow-y-auto p-2">
            {flatCommands.length === 0 ? (
              <div className="grid place-items-center gap-2 py-10 text-center text-xs text-muted-foreground">
                <Search className="h-8 w-8 opacity-20" />
                لا توجد نتائج لـ «{query}»
              </div>
            ) : (
              Object.entries(grouped).map(([groupName, cmds]) => (
                <div key={groupName} className="mb-1.5">
                  <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {groupName}
                  </div>
                  {cmds.map((cmd) => {
                    const flatIndex = flatCommands.indexOf(cmd);
                    const isSelected = flatIndex === safeIndex;
                    const Icon = cmd.icon;
                    return (
                      <button
                        key={cmd.id}
                        data-index={flatIndex}
                        type="button"
                        onClick={() => cmd.action()}
                        onMouseEnter={() => setSelectedIndex(flatIndex)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-right transition-colors",
                          isSelected
                            ? "bg-primary/10 text-primary"
                            : "text-foreground hover:bg-muted/50"
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-4 w-4 flex-shrink-0",
                            isSelected ? "text-primary" : "text-muted-foreground"
                          )}
                        />
                        <span className="flex-1 truncate text-xs font-medium">
                          {cmd.label}
                        </span>
                        {cmd.hint && (
                          <span className="text-[10px] text-muted-foreground">
                            {cmd.hint}
                          </span>
                        )}
                        {isSelected && (
                          <CornerDownLeft className="h-3 w-3 flex-shrink-0 text-primary/60" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t px-4 py-2 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-muted px-1 py-0.5 font-mono">
                  <ArrowUp className="inline h-2.5 w-2.5" />
                </kbd>
                <kbd className="rounded border bg-muted px-1 py-0.5 font-mono">
                  <ArrowDown className="inline h-2.5 w-2.5" />
                </kbd>
                تنقّل
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-muted px-1 py-0.5 font-mono">
                  ↵
                </kbd>
                تنفيذ
              </span>
            </div>
            <span>{flatCommands.length} أمر</span>
          </div>
        </div>
      </div>
    </>
  );
}
