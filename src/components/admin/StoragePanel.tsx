"use client";

/**
 * StoragePanel
 * -------------
 * Admin widget showing live storage statistics for the entire platform —
 * IndexedDB (images now, questions/files later), localStorage (metadata),
 * and the browser storage quota.
 *
 * Features:
 *   • Quota overview: total available, used, free (with progress bar)
 *   • IndexedDB breakdown: image count, total bytes, avg, min, max
 *   • Category breakdown: images by type (banner / mat / tool / other)
 *   • localStorage breakdown: total bytes, key count
 *   • Last activity: most recent image added + timestamp
 *   • Maintenance actions: cleanup orphans, export, import
 *
 * Renamed from "مساحة تخزين الصور" to "مساحة التخزين" because future
 * updates will store questions, files, and other admin data here too —
 * not just images.
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
  Layers,
  Clock,
  TrendingUp,
  Archive,
  Gauge,
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
  className?: string;
}

type BusyAction = "cleanup" | "export" | "import" | "clear" | null;

/** Translate a key prefix to an Arabic label. */
function prefixLabel(prefix: string): string {
  switch (prefix) {
    case "banner":
      return "بانرات";
    case "mat":
      return "مواد دراسية";
    case "tool":
      return "أدوات";
    default:
      return prefix;
  }
}

export function StoragePanel({ className }: Props) {
  const { toast } = useToast();
  const [stats, setStats] = useState<ImageDBStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [errors, setErrors] = useState<number>(0);
  const importInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [refresh]);

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
  const smallestBytes = stats?.smallestBytes ?? 0;
  const averageBytes = stats?.averageBytes ?? 0;
  const lastAddedKey = stats?.lastAddedKey ?? null;
  const lastAddedAt = stats?.lastAddedAt ?? null;
  const quotaBytes = stats?.quotaBytes ?? null;
  const usageBytes = stats?.usageBytes ?? null;
  const localStorageBytes = stats?.localStorageBytes ?? 0;
  const localStorageKeyCount = stats?.localStorageKeyCount ?? 0;
  const byCategory = stats?.byCategory ?? [];

  // Quota progress (browser storage estimate)
  const quotaPct =
    quotaBytes && usageBytes && quotaBytes > 0
      ? Math.min(100, (usageBytes / quotaBytes) * 100)
      : null;
  const freeBytes = quotaBytes && usageBytes ? quotaBytes - usageBytes : null;

  const quotaTier: "ok" | "warn" | "danger" =
    quotaPct === null
      ? "ok"
      : quotaPct < 50
      ? "ok"
      : quotaPct < 80
      ? "warn"
      : "danger";

  const tierColor =
    quotaTier === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : quotaTier === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";

  const tierLabel =
    quotaTier === "ok"
      ? "ضمن النطاق المريح"
      : quotaTier === "warn"
      ? "استخدام متوسط"
      : "استخدام عالٍ — يُنصح بالتنظيف";

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">مساحة التخزين</CardTitle>
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

      <CardContent className="space-y-5">
        {/* ---------- Quota Overview ---------- */}
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Gauge className="h-3.5 w-3.5 text-primary" />
            المساحة الإجمالية (حسب المتصفح)
          </div>
          {quotaBytes !== null && usageBytes !== null ? (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[10px] text-muted-foreground">الإجمالي</div>
                  <div className="text-sm font-bold tabular-nums text-foreground">
                    {formatBytes(quotaBytes)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">المستخدم</div>
                  <div className={`text-sm font-bold tabular-nums ${tierColor}`}>
                    {formatBytes(usageBytes)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">المتاح</div>
                  <div className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {freeBytes ? formatBytes(freeBytes) : "—"}
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <Progress
                  value={quotaPct ?? 0}
                  className={`h-2 ${
                    quotaTier === "ok"
                      ? "[&_[data-slot=progress-indicator]]:bg-emerald-500"
                      : quotaTier === "warn"
                      ? "[&_[data-slot=progress-indicator]]:bg-amber-500"
                      : "[&_[data-slot=progress-indicator]]:bg-red-500"
                  }`}
                />
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{quotaPct !== null ? `${quotaPct.toFixed(1)}% مستخدم` : ""}</span>
                  <span className={tierColor}>{tierLabel}</span>
                </div>
              </div>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              المتصفح لا يدعم تقدير المساحة. استخدم إحصائيات IndexedDB أدناه.
            </p>
          )}
        </div>

        {/* ---------- IndexedDB Stats Grid ---------- */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
            <Layers className="h-3.5 w-3.5 text-primary" />
            قاعدة بيانات IndexedDB
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard
              icon={<ImageIcon className="h-4 w-4" />}
              label="عدد العناصر"
              value={loading ? "…" : String(count)}
            />
            <StatCard
              icon={<HardDrive className="h-4 w-4" />}
              label="الحجم الكلي"
              value={loading ? "…" : formatBytes(totalBytes)}
              valueClassName={tierColor}
            />
            <StatCard
              icon={<TrendingUp className="h-4 w-4" />}
              label="المتوسط"
              value={loading ? "…" : formatBytes(averageBytes)}
            />
            <StatCard
              icon={<Archive className="h-4 w-4" />}
              label="أصغر / أكبر"
              value={
                loading
                  ? "…"
                  : count > 0
                  ? `${formatBytes(smallestBytes)} / ${formatBytes(largestBytes)}`
                  : "—"
              }
              hint={largestKey || undefined}
            />
          </div>
        </div>

        {/* ---------- Category Breakdown ---------- */}
        {byCategory.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
              <Archive className="h-3.5 w-3.5 text-primary" />
              التفصيل حسب النوع
            </div>
            <div className="space-y-1.5">
              {byCategory.map((cat) => {
                const pct =
                  totalBytes > 0 ? (cat.bytes / totalBytes) * 100 : 0;
                return (
                  <div
                    key={cat.prefix}
                    className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5"
                  >
                    <span className="w-20 flex-shrink-0 text-[11px] font-medium text-foreground">
                      {prefixLabel(cat.prefix)}
                    </span>
                    <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="absolute inset-y-0 right-0 rounded-full bg-primary/60"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-24 flex-shrink-0 text-left text-[10px] tabular-nums text-muted-foreground">
                      {cat.count} × {formatBytes(cat.bytes)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ---------- localStorage Stats ---------- */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
            <HardDrive className="h-3.5 w-3.5 text-primary" />
            localStorage (بيانات الإعدادات)
          </div>
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              icon={<HardDrive className="h-4 w-4" />}
              label="الحجم"
              value={loading ? "…" : formatBytes(localStorageBytes)}
            />
            <StatCard
              icon={<Layers className="h-4 w-4" />}
              label="عدد المفاتيح"
              value={loading ? "…" : String(localStorageKeyCount)}
            />
          </div>
        </div>

        {/* ---------- Last Activity ---------- */}
        {lastAddedKey && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-[11px]">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">آخر إضافة:</span>
            <span className="font-medium text-foreground">{lastAddedKey}</span>
            {lastAddedAt && (
              <span className="mr-auto text-muted-foreground">
                {new Date(lastAddedAt).toLocaleString("ar", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            )}
          </div>
        )}

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
        <div className="flex flex-wrap gap-2 border-t pt-3">
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
            تنظيف العناصر غير المستخدمة
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
            تصدير
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
            استيراد
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
