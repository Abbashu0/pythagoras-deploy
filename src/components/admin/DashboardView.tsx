"use client";

/**
 * DashboardView — the new admin dashboard that replaces the old section-cards
 * grid on /admin.
 *
 * Layout:
 *   ┌───────────────────────────────────────────────┐
 *   │  KPI Row (4 cards: Users / Study / Premium / Banners)  │
 *   ├──────────────────────────┬────────────────────┤
 *   │  Weekly Activity Chart    │  Quick Actions     │
 *   ├──────────────────────────┴────────────────────┤
 *   │  Banner Analytics Table                        │
 *   ├────────────────────────────────────────────────┤
 *   │  System Health + Storage Panel                 │
 *   └────────────────────────────────────────────────┘
 *
 * Data comes from dashboard-data.ts (mock for now, real sources mixed in).
 * When backend arrives, only dashboard-data.ts changes — UI stays the same.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  BookOpen,
  Crown,
  ImagePlus,
  Compass,
  Wrench,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  ArrowLeft,
  Database,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StoragePanel } from "@/components/admin/StoragePanel";
import {
  getDashboardData,
  type DashboardData,
} from "@/lib/admin/dashboard-data";

const ICONS: Record<string, LucideIcon> = {
  Users,
  BookOpen,
  Crown,
  ImagePlus,
  Compass,
  Wrench,
};

const HEALTH_ICONS: Record<string, LucideIcon> = {
  Database,
  HardDrive,
  Activity,
  CheckCircle2,
};

export function DashboardView() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getDashboardData().then((d) => {
      if (!cancelled) {
        setData(d);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !data) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl border bg-card"
            />
          ))}
        </div>
      </div>
    );
  }

  const maxActivity = Math.max(...data.weeklyActivity.map((p) => p.value), 1);

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* ---------- Demo data banner ---------- */}
      {data.isAllDemo && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs text-blue-600 dark:text-blue-400">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            البيانات المعروضة تجريبية (Demo). ستُستبدل ببيانات حقيقية عند ربط
            الـ backend.
          </span>
        </div>
      )}

      {/* ---------- KPI Row ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data.kpis.map((kpi) => {
          const Icon = ICONS[kpi.icon] || Activity;
          const TrendIcon =
            kpi.trendDirection === "up"
              ? TrendingUp
              : kpi.trendDirection === "down"
              ? TrendingDown
              : Minus;
          const trendColor =
            kpi.trendDirection === "up"
              ? "text-emerald-500"
              : kpi.trendDirection === "down"
              ? "text-red-500"
              : "text-muted-foreground";
          return (
            <Card key={kpi.id} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className={`grid h-10 w-10 place-items-center rounded-lg bg-muted ${kpi.color}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  {kpi.isDemo && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[8px] font-medium text-muted-foreground">
                      تجريبي
                    </span>
                  )}
                </div>
                <div className="mt-3 space-y-0.5">
                  <div className="text-2xl font-bold tabular-nums text-foreground">
                    {kpi.value}
                  </div>
                  <div className="text-xs text-muted-foreground">{kpi.label}</div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-muted-foreground">
                      {kpi.sublabel}
                    </span>
                    <span className={`flex items-center gap-0.5 text-[10px] font-medium ${trendColor}`}>
                      <TrendIcon className="h-3 w-3" />
                      {kpi.trend !== 0 ? `${kpi.trend}%` : "—"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ---------- Activity Chart + Quick Actions ---------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Weekly Activity Chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-primary" />
              النشاط الأسبوعي
              <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                آخر 7 أيام
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-between gap-2" dir="ltr">
              {data.weeklyActivity.map((point, i) => {
                const heightPct = (point.value / maxActivity) * 100;
                const isToday = i === data.weeklyActivity.length - 1;
                return (
                  <div
                    key={i}
                    className="flex flex-1 flex-col items-center gap-1.5"
                  >
                    <span className="text-[9px] tabular-nums text-muted-foreground">
                      {point.value}
                    </span>
                    <div className="flex h-32 w-full items-end">
                      <div
                        className={`w-full rounded-t-md transition-all duration-500 ${
                          isToday
                            ? "bg-primary"
                            : "bg-primary/30 hover:bg-primary/50"
                        }`}
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {point.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">إجراءات سريعة</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.quickActions.map((action) => {
              const Icon = ICONS[action.icon] || Activity;
              return (
                <button
                  key={action.label}
                  onClick={() => router.push(action.href)}
                  className="flex w-full items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-right transition-all hover:border-primary/40 hover:bg-muted/40"
                >
                  <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="flex-1 text-xs font-medium text-foreground">
                    {action.label}
                  </span>
                  <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* ---------- Banner Analytics ---------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ImagePlus className="h-4 w-4 text-primary" />
            أداء البانرات
            <span className="ml-auto text-[10px] font-normal text-muted-foreground">
              تجريبي
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.bannerAnalytics.length === 0 ? (
            <div className="grid place-items-center gap-2 py-8 text-center text-xs text-muted-foreground">
              <ImagePlus className="h-8 w-8 opacity-30" />
              لا توجد بانرات نشطة لعرض التحليلات.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="pb-2 pr-2 font-medium">البانر</th>
                    <th className="pb-2 px-2 font-medium">الظهور</th>
                    <th className="pb-2 px-2 font-medium">النقرات</th>
                    <th className="pb-2 px-2 font-medium">CTR</th>
                    <th className="pb-2 pl-2 font-medium">الأداء</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bannerAnalytics.map((row, i) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/50 last:border-0"
                    >
                      <td className="py-2.5 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded bg-muted text-[9px] font-bold text-muted-foreground">
                            {i + 1}
                          </span>
                          <span className="truncate font-medium text-foreground">
                            {row.title}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-2 tabular-nums text-muted-foreground">
                        {row.impressions.toLocaleString("en")}
                      </td>
                      <td className="py-2.5 px-2 tabular-nums text-muted-foreground">
                        {row.clicks.toLocaleString("en")}
                      </td>
                      <td className="py-2.5 px-2">
                        <span
                          className={`font-medium tabular-nums ${
                            row.ctr >= 5
                              ? "text-emerald-500"
                              : row.ctr >= 3
                              ? "text-amber-500"
                              : "text-red-500"
                          }`}
                        >
                          {row.ctr.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-2.5 pl-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full ${
                              row.ctr >= 5
                                ? "bg-emerald-500"
                                : row.ctr >= 3
                                ? "bg-amber-500"
                                : "bg-red-500"
                            }`}
                            style={{
                              width: `${Math.min(100, (row.ctr / 10) * 100)}%`,
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- System Health + Storage ---------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* System Health */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              حالة النظام
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.systemHealth.map((item) => {
              const StatusIcon =
                item.status === "healthy"
                  ? CheckCircle2
                  : item.status === "warning"
                  ? AlertTriangle
                  : XCircle;
              const statusColor =
                item.status === "healthy"
                  ? "text-emerald-500"
                  : item.status === "warning"
                  ? "text-amber-500"
                  : "text-red-500";
              return (
                <div
                  key={item.label}
                  className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2"
                >
                  <StatusIcon className={`h-4 w-4 flex-shrink-0 ${statusColor}`} />
                  <span className="flex-1 text-xs font-medium text-foreground">
                    {item.label}
                  </span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {item.detail}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Storage Panel (existing component) */}
        <StoragePanel />
      </div>
    </div>
  );
}
