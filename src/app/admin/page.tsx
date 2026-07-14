"use client";

/**
 * Admin Dashboard — section landing page (/admin)
 * ================================================
 *
 * This is the new dashboard entry point. It presents a grid of 8 admin
 * "sections" (Banners, Subjects, Icons, Question Bank, Lectures, Files,
 * Announcements, Settings). Only the Banners section is available today;
 * the rest are placeholders that show a "قريباً" (coming soon) toast when
 * clicked.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Header: "لوحة التحكم" + subtitle      [☀ / ☾ theme toggle] │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  Grid of 8 section cards (responsive: 1 → 2 → 3 → 4 cols)   │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Theme:
 *   - Source of truth: AdminStore.adminTheme ("light" | "dark").
 *   - We subscribe to the store via `useAdminStore()` and read `adminTheme`
 *     from the snapshot — no local mirror state. The Sun/Moon icon flips
 *     reactively when the store emits.
 *   - On mount we call `store.loadFromStorage()` (client-only, after
 *     hydration) so the persisted theme is read and emitted. A separate
 *     effect toggles the `dark` class on `document.documentElement`
 *     whenever `adminTheme` changes — pure external-system sync (no
 *     setState), so it satisfies react-hooks/set-state-in-effect.
 *   - Toggling the button calls `store.setAdminTheme(...)` (persists +
 *     notifies subscribers); the icon and <html> class update reactively.
 *
 * Routing:
 *   - Available sections: `router.push(href)` — server-side route.
 *   - Unavailable sections: a shadcn toast tells the user it's coming.
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
  Moon,
  Sun,
  ArrowLeft,
  type LucideIcon,
} from "lucide-react";
import { getAdminStore } from "@/lib/admin/admin-store";
import { useAdminStore } from "@/lib/admin/use-admin-store";
import { useToast } from "@/hooks/use-toast";
import { StoragePanel } from "@/components/admin/StoragePanel";
import { migrateLegacyImages } from "@/lib/admin/image-migrate";

interface AdminSection {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  available: boolean;
  /** Route to navigate to when the section is available. */
  href?: string;
}

const SECTIONS: AdminSection[] = [
  {
    id: "banners",
    title: "بانرات الصفحة الرئيسية",
    description: "إدارة البانرات الترويجية في الكاروسيل — رفع، ترتيب، تفعيل.",
    icon: ImagePlus,
    available: true,
    href: "/admin/banners",
  },
  {
    id: "navigation",
    title: "إدارة التنقل",
    description: "تعديل ترتيب وأيقونات الـ Bottom Navigation للطلاب.",
    icon: Compass,
    available: true,
    href: "/admin/navigation",
  },
  {
    id: "materials",
    title: "إدارة المواد",
    description: "تعديل ترتيب وأيقونات المواد الدراسية للطلاب.",
    icon: BookOpen,
    available: true,
    href: "/admin/materials",
  },
  {
    id: "tools",
    title: "إدارة الأدوات",
    description: "تعديل ترتيب وأيقونات أدوات الطالب (التكرار، بومودورو…).",
    icon: Wrench,
    available: true,
    href: "/admin/tools",
  },
  {
    id: "icons",
    title: "إدارة الأيقونات",
    description: "مكتبة أيقونات المنصة المستخدمة في البانرات والمواد.",
    icon: Palette,
    available: false,
  },
  {
    id: "questions",
    title: "إدارة بنك الأسئلة",
    description: "إضافة وتصنيف الأسئلة لمختلف المواد والفصول.",
    icon: FileQuestion,
    available: false,
  },
  {
    id: "lectures",
    title: "إدارة المحاضرات",
    description: "رفع وترتيب المحاضرات المرئية وتعيينها للمواد.",
    icon: Video,
    available: false,
  },
  {
    id: "settings",
    title: "الإعدادات العامة",
    description: "إعدادات المنصة العامة، الألوان، والتفضيلات.",
    icon: Settings,
    available: false,
  },
];

export default function AdminDashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const store = getAdminStore();

  // Subscribe to the store so the Sun/Moon icon flips reactively when the
  // theme changes. We read `adminTheme` from the snapshot rather than
  // keeping a local mirror — the store is the single source of truth.
  const { adminTheme } = useAdminStore();

  // ---------- Mount: load persisted state ----------
  // loadFromStorage() runs AFTER hydration so SSR HTML matches the initial
  // client render. The store then emits a new snapshot and `adminTheme`
  // re-reads reactively (no local setState needed).
  useEffect(() => {
    store.loadFromStorage();
    store.hydrateImagesFromIDB();
    // Run one-time legacy image migration in the background.
    migrateLegacyImages()
      .then((res) => {
        if (res.migrated > 0) {
          console.info(
            `[image-migrate] Migrated ${res.migrated} images from localStorage to IndexedDB.`
          );
          store.loadFromStorage();
          store.hydrateImagesFromIDB();
        }
      })
      .catch((e) => {
        console.warn("[image-migrate] Migration failed:", e);
      });
  }, [store]);

  // ---------- External system sync: apply theme to <html> ----------
  // This effect updates an EXTERNAL system (the DOM) based on React state —
  // no setState call inside, so it satisfies react-hooks/set-state-in-effect.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", adminTheme === "dark");
  }, [adminTheme]);

  const handleToggleTheme = () => {
    store.setAdminTheme(adminTheme === "dark" ? "light" : "dark");
  };

  const handleSectionClick = (section: AdminSection) => {
    if (section.available && section.href) {
      router.push(section.href);
      return;
    }
    toast({
      title: "قريباً",
      description: "هذا القسم سيكون متوفراً في تحديث لاحق.",
    });
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
      {/* ---------- Header ---------- */}
      <header className="mb-8 flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            لوحة التحكم
          </h1>
          <p className="text-sm text-muted-foreground">
            منصة فيثاغورس — إدارة المحتوى
          </p>
        </div>

        <button
          type="button"
          onClick={handleToggleTheme}
          aria-label={adminTheme === "dark" ? "تفعيل الوضع الفاتح" : "تفعيل الوضع الداكن"}
          title={adminTheme === "dark" ? "وضع فاتح" : "وضع داكن"}
          className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-muted"
        >
          {adminTheme === "dark" ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
          )}
        </button>
      </header>

      {/* ---------- Section grid ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              type="button"
              data-available={section.available ? "true" : "false"}
              onClick={() => handleSectionClick(section)}
              className="admin-section-card group text-right"
              aria-label={section.title}
            >
              {/* Top row: icon + open affordance */}
              <div className="flex items-start justify-between">
                <div
                  className={`grid h-12 w-12 flex-shrink-0 place-items-center rounded-xl transition-colors ${
                    section.available
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="h-6 w-6" />
                </div>

                {/* "فتح" affordance — visible on hover (CSS-driven) */}
                <span className="admin-section-open inline-flex items-center gap-1 text-xs font-medium text-primary">
                  فتح
                  <ArrowLeft className="h-3.5 w-3.5" />
                </span>
              </div>

              {/* Title + description */}
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-foreground">
                  {section.title}
                </h2>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {section.description}
                </p>
              </div>

              {/* Status footer */}
              <div className="mt-auto flex items-center gap-2 pt-2">
                {section.available ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    متاح
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    قريباً
                  </span>
                )}
              </div>
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
