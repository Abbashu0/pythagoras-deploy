"use client";

/**
 * AdminSidebar — Module-grouped navigation sidebar for the admin console.
 *
 * Design inspired by: Vercel Dashboard, Linear, Supabase.
 *
 * Features:
 *   - Module grouping (Dashboard, Content, Marketing, Users, Analytics, Settings)
 *   - Collapsible on mobile (hamburger toggle in TopBar)
 *   - Active route highlighting with subtle accent
 *   - "Coming soon" badges for unimplemented sections
 *   - Storage usage mini-indicator at bottom
 *   - Smooth transitions
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BookOpen,
  ImagePlus,
  Users,
  BarChart3,
  Settings,
  FileQuestion,
  Video,
  FileText,
  Crown,
  Activity,
  Compass,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href?: string;
  icon: LucideIcon;
  available: boolean;
  /** Optional badge text (e.g. "قريباً"). */
  badge?: string;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    label: "نظرة عامة",
    items: [
      { label: "لوحة التحكم", href: "/admin", icon: LayoutDashboard, available: true },
    ],
  },
  {
    id: "content",
    label: "المحتوى",
    items: [
      { label: "المواد الدراسية", href: "/admin/materials", icon: BookOpen, available: true },
      { label: "إدارة التنقل", href: "/admin/navigation", icon: Compass, available: true },
      { label: "إدارة الأدوات", href: "/admin/tools", icon: Wrench, available: true },
      { label: "بنك الأسئلة", href: "/admin/questions", icon: FileQuestion, available: false, badge: "قريباً" },
      { label: "المحاضرات", href: "/admin/lectures", icon: Video, available: false, badge: "قريباً" },
      { label: "الملفات", href: "/admin/pdfs", icon: FileText, available: false, badge: "قريباً" },
    ],
  },
  {
    id: "marketing",
    label: "التسويق",
    items: [
      { label: "بانرات الصفحة الرئيسية", href: "/admin/banners", icon: ImagePlus, available: true },
    ],
  },
  {
    id: "users",
    label: "المستخدمون",
    items: [
      { label: "المستخدمون", href: "/admin/users", icon: Users, available: false, badge: "قريباً" },
      { label: "Premium", href: "/admin/premium", icon: Crown, available: false, badge: "قريباً" },
    ],
  },
  {
    id: "system",
    label: "النظام",
    items: [
      { label: "التحليلات", href: "/admin/analytics", icon: BarChart3, available: false, badge: "قريباً" },
      { label: "السجل", href: "/admin/logs", icon: Activity, available: false, badge: "قريباً" },
      { label: "الإعدادات", href: "/admin/settings", icon: Settings, available: false, badge: "قريباً" },
    ],
  },
];

interface Props {
  /** Mobile sidebar open state. */
  open: boolean;
  /** Close handler (for mobile overlay click). */
  onClose: () => void;
}

export function AdminSidebar({ open, onClose }: Props) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-64 flex-col border-l bg-card transition-transform duration-300 lg:static lg:translate-x-0",
          open ? "translate-x-0" : "translate-x-full lg:translate-x-0"
        )}
        dir="rtl"
      >
        {/* Logo / Brand */}
        <div className="flex h-16 flex-shrink-0 items-center gap-2.5 border-b px-5">
          <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <span className="text-lg font-bold">π</span>
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-foreground">فيثاغورس</div>
            <div className="truncate text-[10px] text-muted-foreground">لوحة التحكم</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="admin-scroll flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.id}>
              <h3 className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.label}
              </h3>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.href === pathname;
                  return (
                    <li key={item.label}>
                      {item.available && item.href ? (
                        <Link
                          href={item.href}
                          onClick={onClose}
                          className={cn(
                            "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-all",
                            isActive
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          )}
                        >
                          <Icon
                            className={cn(
                              "h-4 w-4 flex-shrink-0 transition-colors",
                              isActive
                                ? "text-primary"
                                : "text-muted-foreground/70 group-hover:text-foreground"
                            )}
                          />
                          <span className="flex-1 truncate">{item.label}</span>
                          {isActive && (
                            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                          )}
                        </Link>
                      ) : (
                        <div
                          className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground/50"
                          title="غير متاح حالياً"
                        >
                          <Icon className="h-4 w-4 flex-shrink-0 opacity-40" />
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.badge && (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                              {item.badge}
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer — version + quick info */}
        <div className="flex-shrink-0 border-t px-4 py-3">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>الإصدار 2.0</span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              متصل
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
