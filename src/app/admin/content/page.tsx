"use client";

/**
 * Admin — Content Studio (/admin/content)
 *
 * The main workspace for managing content packages.
 *
 * Features:
 *   - Package Library grid with premium cards
 *   - Search (by name, subject, topic, UUID)
 *   - Filters (status, subject)
 *   - Empty state with "Create Package" + "Import Package"
 *   - Live metrics (total, published, draft, questions count)
 *   - Create new package button
 *
 * Data from /api/packages + /api/subjects (Supabase via Repository pattern).
 */

import { useCallback, useEffect, useState } from "react";
import {
  Package as PackageIcon,
  Search,
  Plus,
  Loader2,
  RefreshCw,
  Upload,
  FileQuestion,
  CheckCircle2,
  Archive,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PackageCard } from "@/components/admin/PackageCard";
import { useToast } from "@/hooks/use-toast";
import type { Package as PackageType, Subject } from "@/lib/entities";

const STATUS_FILTERS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "", label: "الكل", icon: PackageIcon },
  { value: "draft", label: "مسودة", icon: Archive },
  { value: "review", label: "مراجعة", icon: AlertCircle },
  { value: "ready", label: "جاهز", icon: CheckCircle2 },
  { value: "published", label: "منشور", icon: CheckCircle2 },
  { value: "archived", label: "مؤرشف", icon: Archive },
];

export default function ContentStudioPage() {
  const { toast } = useToast();
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");

  // Load subjects once for the filter dropdown + name resolution.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/subjects?all=true", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setSubjects(data.subjects || []);
        }
      } catch (e) {
        console.error("[content] failed to load subjects:", e);
      }
    })();
  }, []);

  const fetchPackages = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      if (subjectFilter) params.set("subjectId", subjectFilter);

      const res = await fetch(`/api/packages?${params}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setPackages(data.packages || []);
      }
    } catch (e) {
      console.error("[content] fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, subjectFilter]);

  useEffect(() => {
    const timer = setTimeout(fetchPackages, 300);
    return () => clearTimeout(timer);
  }, [fetchPackages]);

  // Stats
  const totalPackages = packages.length;
  const publishedCount = packages.filter((p) => p.status === "published").length;
  const draftCount = packages.filter((p) => p.status === "draft").length;
  const totalQuestions = packages.reduce((sum, p) => sum + (p.questionCount || 0), 0);

  const handleCreate = async () => {
    // Pick the first subject if none selected.
    const fallbackSubjectId = subjectFilter || subjects[0]?.id;
    if (!fallbackSubjectId) {
      toast({
        title: "لا توجد مواد",
        description: "أضف مادة أولاً قبل إنشاء حزمة.",
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await fetch("/api/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "حزمة جديدة",
          subjectId: fallbackSubjectId,
          sectionId: null,
          iconKey: "package",
          color: "#6366f1",
          status: "draft",
        }),
      });
      if (res.ok) {
        toast({ title: "تم إنشاء الحزمة", description: "يمكنك الآن تعديلها وإضافة الأسئلة." });
        fetchPackages();
      } else {
        const err = await res.json().catch(() => ({}));
        toast({
          title: "فشل الإنشاء",
          description: err.error || "تحقق من البيانات وحاول مجدداً.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "فشل الإنشاء", variant: "destructive" });
    }
  };

  const handleDuplicate = async (pkg: PackageType) => {
    try {
      const res = await fetch("/api/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${pkg.name} (نسخة)`,
          subjectId: pkg.subjectId,
          sectionId: pkg.sectionId || null,
          topicId: pkg.topicId || null,
          iconKey: pkg.iconKey,
          color: pkg.color,
          status: "draft",
          order: pkg.order,
          tags: pkg.tags || [],
        }),
      });
      if (res.ok) {
        toast({ title: "تم التكرار", description: `تم إنشاء نسخة من «${pkg.name}».` });
        fetchPackages();
      }
    } catch {
      toast({ title: "فشل التكرار", variant: "destructive" });
    }
  };

  const handleArchive = async (pkg: PackageType) => {
    try {
      await fetch("/api/packages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pkg.id, status: "archived" }),
      });
      toast({ title: "تمت الأرشفة", description: `أُرشفت «${pkg.name}».` });
      fetchPackages();
    } catch {
      toast({ title: "فشلت الأرشفة", variant: "destructive" });
    }
  };

  const handleDelete = async (pkg: PackageType) => {
    try {
      await fetch(`/api/packages?id=${pkg.id}`, { method: "DELETE" });
      toast({ title: "تم الحذف", description: `حُذفت «${pkg.name}».` });
      fetchPackages();
    } catch {
      toast({ title: "فشل الحذف", variant: "destructive" });
    }
  };

  const getSubjectName = (subjectId?: string) => {
    if (!subjectId) return "—";
    const subject = subjects.find((s) => s.id === subjectId);
    return subject?.name || subjectId;
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      {/* ---------- Stats ---------- */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard icon={<PackageIcon className="h-4 w-4" />} label="إجمالي الحزم" value={String(totalPackages)} />
        <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="منشورة" value={String(publishedCount)} valueClassName="text-emerald-500" />
        <StatCard icon={<Archive className="h-4 w-4" />} label="مسودات" value={String(draftCount)} valueClassName="text-amber-500" />
        <StatCard icon={<FileQuestion className="h-4 w-4" />} label="إجمالي الأسئلة" value={String(totalQuestions)} valueClassName="text-blue-500" />
      </div>

      {/* ---------- Toolbar: search + filters + actions ---------- */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو الموضوع…"
            className="pr-8 text-xs"
            dir="rtl"
          />
        </div>

        {/* Status filter */}
        <div className="flex gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                statusFilter === f.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/40"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Subject filter */}
        <select
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground"
        >
          <option value="">كل المواد</option>
          {subjects.filter((s) => s.available).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <Button variant="ghost" size="sm" onClick={fetchPackages} disabled={loading} className="gap-1 text-xs">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>

        <Button size="sm" onClick={handleCreate} className="gap-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" />
          حزمة جديدة
        </Button>
      </div>

      {/* ---------- Package Library ---------- */}
      {loading ? (
        <div className="grid place-items-center gap-2 py-20 text-center text-sm text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          جارٍ تحميل الحزم…
        </div>
      ) : packages.length === 0 ? (
        /* Empty state */
        <div className="grid place-items-center gap-4 py-20 text-center">
          <div className="grid h-20 w-20 place-items-center rounded-2xl bg-muted">
            <PackageIcon className="h-10 w-10 text-muted-foreground/40" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-foreground">لا توجد حزم محتوى</h3>
            <p className="max-w-sm text-xs text-muted-foreground">
              ابدأ بإنشاء حزمة محتوى جديدة أو استورد حزمة موجودة. الحزم تحتوي على
              الأسئلة والموارد والمصادر الخاصة بكل مادة.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate} className="gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              إنشاء حزمة
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" disabled>
              <Upload className="h-3.5 w-3.5" />
              استيراد حزمة
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {packages.map((pkg) => (
            <PackageCard
              key={pkg.id}
              pkg={pkg}
              subjectName={getSubjectName(pkg.subjectId)}
              onDuplicate={() => handleDuplicate(pkg)}
              onArchive={() => handleArchive(pkg)}
              onDelete={() => handleDelete(pkg)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  valueClassName,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div className={`mt-1 text-xl font-bold tabular-nums ${valueClassName || "text-foreground"}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
