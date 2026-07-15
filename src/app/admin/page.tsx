"use client";

/**
 * Admin Dashboard — section landing page (/admin)
 *
 * In the new AdminShell layout, this page renders inside the shell's main
 * content area. The shell provides:
 *   - Sidebar navigation (no more back button needed)
 *   - TopBar with breadcrumbs + theme toggle + activity center
 *   - Theme management (no more per-page theme effects)
 *
 * This page keeps its existing functionality:
 *   - Section cards grid (visual navigation + status)
 *   - StoragePanel (live storage stats)
 *   - Legacy image migration on mount
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ImagePlus,
  BookOpen,
  Compass,
  Wrench,
  Palette,
  FileQuestion,
  Video,
  Settings,
  ArrowLeft,
  type LucideIcon,
} from "lucide-react";
import { getAdminStore } from "@/lib/admin/admin-store";
import { useToast } from "@/hooks/use-toast";
import { StoragePanel } from "@/components/admin/StoragePanel";
import { migrateLegacyImages } from "@/lib/admin/image-migrate";

interface AdminSection {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  available: boolean;
  href?: string;
}

const SECTIONS: AdminSection[] = [
  { id: "banners", title: "بانرات الصفحة الرئيسية", description: "إدارة البانرات الترويجية في الكاروسيل — رفع، ترتيب، تفعيل.", icon: ImagePlus, available: true, href: "/admin/banners" },
  { id: "navigation", title: "إدارة التنقل", description: "تعديل ترتيب وأيقونات الـ Bottom Navigation للطلاب.", icon: Compass, available: true, href: "/admin/navigation" },
  { id: "materials", title: "إدارة المواد", description: "تعديل صور وعناوين المواد الدراسية للطلاب.", icon: BookOpen, available: true, href: "/admin/materials" },
  { id: "tools", title: "إدارة الأدوات", description: "تعديل ترتيب وأيقونات أدوات الطالب (التكرار، بومودورو…).", icon: Wrench, available: true, href: "/admin/tools" },
  { id: "icons", title: "إدارة الأيقونات", description: "مكتبة أيقونات المنصة المستخدمة في البانرات والمواد.", icon: Palette, available: false },
  { id: "questions", title: "إدارة بنك الأسئلة", description: "إضافة وتصنيف الأسئلة لمختلف المواد والفصول.", icon: FileQuestion, available: false },
  { id: "lectures", title: "إدارة المحاضرات", description: "رفع وترتيب المحاضرات المرئية وتعيينها للمواد.", icon: Video, available: false },
  { id: "settings", title: "الإعدادات العامة", description: "إعدادات المنصة العامة، الألوان، والتفضيلات.", icon: Settings, available: false },
];

export default function AdminDashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const store = getAdminStore();

  // Mount: run legacy image migration (loadFromStorage + hydrate handled by shell)
  useEffect(() => {
    migrateLegacyImages()
      .then((res) => {
        if (res.migrated > 0) {
          console.info(`[image-migrate] Migrated ${res.migrated} images.`);
          store.loadFromStorage();
          store.hydrateImagesFromIDB();
        }
      })
      .catch((e) => console.warn("[image-migrate] Migration failed:", e));
  }, [store]);

  const handleSectionClick = (section: AdminSection) => {
    if (section.available && section.href) {
      router.push(section.href);
      return;
    }
    toast({ title: "قريباً", description: "هذا القسم سيكون متوفراً في تحديث لاحق." });
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
      {/* ---------- Section grid ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => handleSectionClick(section)}
              className="group flex flex-col gap-4 rounded-2xl border bg-card p-5 text-right transition-all hover:shadow-lg hover:-translate-y-0.5"
              aria-label={section.title}
            >
              <div className="flex items-start justify-between">
                <div className={`grid h-12 w-12 flex-shrink-0 place-items-center rounded-xl transition-colors ${section.available ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                  <Icon className="h-6 w-6" />
                </div>
                {section.available ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> متاح
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> قريباً
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                <h2 className="text-base font-semibold text-foreground">{section.title}</h2>
                <p className="text-xs leading-relaxed text-muted-foreground">{section.description}</p>
              </div>
              {section.available && (
                <div className="mt-auto flex items-center gap-1 border-t pt-3 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  فتح القسم <ArrowLeft className="h-3.5 w-3.5" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ---------- Storage panel ---------- */}
      <div className="mt-8">
        <StoragePanel />
      </div>
    </div>
  );
}
