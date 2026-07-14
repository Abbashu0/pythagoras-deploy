"use client";

/**
 * StoragePanel
 * -------------
 * Admin widget that shows live IndexedDB image-storage statistics and
 * provides maintenance actions:
 *   • Cleanup orphans — deletes images whose key isn't referenced by
 *     any banner/material in localStorage.
 *   • Export media — downloads all images as a single JSON file
 *     (backup / transfer to another device).
 *   • Import media — restores an exported JSON file.
 *   • Refresh stats — re-reads the cache + meta store.
 *
 * The panel auto-refreshes on a 5-second interval while mounted, so
 * the user sees uploads from other tabs reflected here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HardDrive,
  Trash2,
  Download,
  Upload,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ImageIcon,
  Database,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { formatBytes } from "@/lib/admin/image-compress";
import {
  getStats,
  cleanupOrphans,
  exportAllImages,
  importAllImages,
  clearAllImages,
  getLastErrors,
  type ImageDBStats,
} from "@/lib/admin/image-db";
import { collectReferencedImageKeys } from "@/lib/admin/image-migrate";

interface Props {
  /** Optional className override. */
  className?: string;
}

type BusyAction = "cleanup" | "export" | "import" | "clear" | null;

export function StoragePanel({ className }: Props) {
  const { toast } = useToast();
  const [stats, setStats] = useState<ImageDBStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [errors, setErrors] = useState<number>(0);
  const importInputRef = useRef<HTMLInputElement>(null);

  // ---------- Refresh stats from IndexedDB ----------
  const refresh = useCallback(async () => {
    try {
      const s = await getStats();
      setStats(s);
      setErrors(getLastErrors().length);
    } catch (e) {
      console.error("[StoragePanel] refresh failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + 5s polling.
  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // ---------- Cleanup orphaned images ----------
  const handleCleanup = useCallback(async () => {
    if (busy) return;
    setBusy("cleanup");
    try {
      const referenced = collectReferencedImageKeys();
      const deleted = await cleanupOrphans(referenced);
      await refresh();
      if (deleted === 0) {
        toast({
          title: "لا توجد صور غير مستخدمة",
          description: "جميع الصور المخزّنة مرتبطة بعناصر موجودة.",
        });
      } else {
        toast({
          title: "تم التنظيف",
          description: `تم حذف ${deleted} صورة غير مستخدمة.`,
        });
      }
    } catch (e) {
      toast({
        title: "فشل التنظيف",
        description: e instanceof Error ? e.message : "خطأ غير معروف",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }, [busy, refresh, toast]);

  // ---------- Export all images ----------
  const handleExport = useCallback(async () => {
    if (busy) return;
    setBusy("export");
    try {
      const bundle = await exportAllImages();
      if (bundle.count === 0) {
        toast({
          title: "لا توجد صور للتصدير",
          description: "لم يتم رفع أي صور بعد.",
        });
        return;
      }
      const json = JSON.stringify(bundle, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      a.href = url;
      a.download = `pythagoras-media-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: "تم التصدير",
        description: `تم تصدير ${bundle.count} صورة (${formatBytes(bundle.totalBytes)}).`,
      });
    } catch (e) {
      toast({
        title: "فشل التصدير",
        description: e instanceof Error ? e.message : "خطأ غير معروف",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }, [busy, toast]);

  // ---------- Import images from JSON ----------
  const handleImport = useCallback(
    async (file: File) => {
      if (busy) return;
      setBusy("import");
      try {
        const text = await file.text();
        const bundle = JSON.parse(text);
        const result = await importAllImages(bundle);
        await refresh();
        if (result.failed > 0) {
          toast({
            title: "اكتمل الاستيراد مع تحذيرات",
            description: `تم استيراد ${result.imported} صورة، فشل ${result.failed}.`,
            variant: "destructive",
          });
        } else {
          toast({
            title: "تم الاستيراد",
            description: `تم استيراد ${result.imported} صورة بنجاح.`,
          });
        }
      } catch (e) {
        toast({
          title: "فشل الاستيراد",
          description:
            e instanceof Error
              ? e.message
              : "ملف غير صالح. تأكد من اختيار ملف تم تصديره من هذه اللوحة.",
          variant: "destructive",
        });
      } finally {
        setBusy(null);
      }
    },
    [busy, refresh, toast]
  );

  const onImportInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) handleImport(f);
      e.target.value = "";
    },
    [handleImport]
  );

  // ---------- Derived display values ----------
  const count = stats?.count ?? 0;
  const totalBytes = stats?.totalBytes ?? 0;
  const largestBytes = stats?.largestBytes ?? 0;
  const largestKey = stats?.largestKey ?? null;
  const lastAddedKey = stats?.lastAddedKey ?? null;
  const lastAddedAt = stats?.lastAddedAt ?? null;

  // Qualitative usage tier (green/amber/red based on rough thresholds).
  const usageTier: "ok" | "warn" | "danger" =
    totalBytes < 50 * 1024 * 1024
      ? "ok"
      : totalBytes < 200 * 1024 * 1024
      ? "warn"
      : "danger";

  const tierColor =
    usageTier === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : usageTier === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";

  const tierLabel =
    usageTier === "ok"
      ? "ضمن النطاق المريح"
      : usageTier === "warn"
      ? "استخدام متوسط"
      : "استخدام عالٍ — يُنصح بالتنظيف";

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">مساحة تخزين الصور</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={loading}
            className="h-7 gap-1 px-2 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            تحديث
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ---------- Stats grid ---------- */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<ImageIcon className="h-4 w-4" />}
            label="عدد الصور"
            value={loading ? "…" : String(count)}
          />
          <StatCard
            icon={<HardDrive className="h-4 w-4" />}
            label="المساحة المستخدمة"
            value={loading ? "…" : formatBytes(totalBytes)}
            valueClassName={tierColor}
          />
          <StatCard
            icon={<AlertTriangle className="h-4 w-4" />}
            label="أكبر صورة"
            value={
              loading
                ? "…"
                : largestKey
                ? formatBytes(largestBytes)
                : "—"
            }
            hint={largestKey || undefined}
          />
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="آخر صورة مضافة"
            value={
              loading
                ? "…"
                : lastAddedKey
                ? lastAddedKey
                : "—"
            }
            hint={
              lastAddedAt
                ? new Date(lastAddedAt).toLocaleString("ar", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })
                : undefined
            }
          />
        </div>

        {/* ---------- Usage tier indicator ---------- */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>مستوى الاستخدام</span>
            <span className={tierColor}>{tierLabel}</span>
          </div>
          <Progress
            value={Math.min(
              100,
              (totalBytes / (500 * 1024 * 1024)) * 100
            )}
            className={`h-1.5 ${
              usageTier === "ok"
                ? "[&_[data-slot=progress-indicator]]:bg-emerald-500"
                : usageTier === "warn"
                ? "[&_[data-slot=progress-indicator]]:bg-amber-500"
                : "[&_[data-slot=progress-indicator]]:bg-red-500"
            }`}
          />
        </div>

        {/* ---------- Errors indicator ---------- */}
        {errors > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>
              يوجد {errors} خطأ مسجّل في عمليات التخزين الأخيرة. افتح
              Console للمتصفح للاطلاع على التفاصيل.
            </span>
          </div>
        )}

        {/* ---------- Actions ---------- */}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCleanup}
            disabled={busy !== null}
            className="h-8 gap-1.5 text-xs"
          >
            {busy === "cleanup" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            تنظيف الصور غير المستخدمة
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={busy !== null}
            className="h-8 gap-1.5 text-xs"
          >
            {busy === "export" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            تصدير الصور
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => importInputRef.current?.click()}
            className="h-8 gap-1.5 text-xs"
          >
            {busy === "import" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            استيراد الصور
          </Button>

          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            onChange={onImportInputChange}
            className="hidden"
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Sub-component: stat card
// ============================================================

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  valueClassName?: string;
}

function StatCard({ icon, label, value, hint, valueClassName }: StatCardProps) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={`mt-1 truncate text-sm font-semibold text-foreground ${
          valueClassName || ""
        }`}
        title={hint || value}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground" title={hint}>
          {hint}
        </div>
      )}
    </div>
  );
}
