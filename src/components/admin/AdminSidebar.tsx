"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, ClipboardCheck, Compass, DatabaseBackup, FileQuestion, FolderOpen, ImagePlus, LayoutDashboard, Settings, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SafeAdminIdentity } from "@/server/admin-auth";

interface NavItem { label: string; href: string; icon: LucideIcon; }

const items: NavItem[] = [
  { label: "لوحة التحكم", href: "/admin", icon: LayoutDashboard },
  { label: "مكتبة المحتوى", href: "/admin/library", icon: FolderOpen },
  { label: "مراجعة التغييرات", href: "/admin/review", icon: ClipboardCheck },
  { label: "المواد الدراسية", href: "/admin/materials", icon: BookOpen },
  { label: "إدارة التنقل", href: "/admin/navigation", icon: Compass },
  { label: "إدارة الأدوات", href: "/admin/tools", icon: Wrench },
  { label: "بنك الأسئلة", href: "/admin/questions", icon: FileQuestion },
  { label: "بانرات الصفحة الرئيسية", href: "/admin/banners", icon: ImagePlus },
];

export function AdminSidebar({ identity, open, onClose }: { identity: SafeAdminIdentity; open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const visibleItems = identity.role === "OWNER"
    ? [...items, { label: "ترحيل البيانات المحلية", href: "/admin/system/migration", icon: DatabaseBackup }]
    : items;
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden" onClick={onClose} aria-hidden="true" />}
      <aside className={cn("fixed inset-y-0 right-0 z-50 flex w-64 flex-col border-l bg-card transition-transform duration-300 lg:static lg:translate-x-0", open ? "translate-x-0" : "translate-x-full lg:translate-x-0")} dir="rtl">
        <div className="flex h-16 items-center gap-2.5 border-b px-5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20"><span className="text-lg font-bold">π</span></div>
          <div><div className="text-sm font-bold text-foreground">فيثاغورس</div><div className="text-[10px] text-muted-foreground">لوحة التحكم المحلية</div></div>
        </div>
        <nav className="admin-scroll flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          {visibleItems.map(({ label, href, icon: Icon }) => {
            const active = pathname === href;
            return <Link key={href} href={href} onClick={onClose} className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors", active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}><Icon className="h-4 w-4" /><span>{label}</span></Link>;
          })}
        </nav>
        <div className="border-t px-4 py-3 text-[10px] text-muted-foreground"><Settings className="ml-1 inline h-3 w-3" /> محلي فقط</div>
      </aside>
    </>
  );
}
