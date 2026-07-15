"use client";

/**
 * Admin — Analytics & Health Dashboard (/admin/analytics)
 *
 * Features:
 *   - System Health checks (Database, Analytics, Premium, Storage, Errors)
 *   - Performance Metrics (response time per check + average)
 *   - System info (version, uptime, last check time)
 *   - Auto-refresh every 30s
 *   - Visual status indicators (healthy=green, warning=amber, error=red)
 *
 * Data comes from /api/health.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Database,
  BarChart3,
  Crown,
  HardDrive,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Clock,
  Zap,
  Gauge,
  Server,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface HealthCheck {
  label: string;
  status: "healthy" | "warning" | "error";
  detail: string;
  responseTimeMs: number;
}

interface HealthData {
  status: "healthy" | "warning" | "error";
  checks: HealthCheck[];
  performance: {
    totalResponseTimeMs: number;
    avgCheckTimeMs: number;
  };
  version: string;
  timestamp: string;
  uptime: string;
}

const CHECK_ICONS: Record<string, LucideIcon> = {
  "قاعدة البيانات": Database,
  "التحليلات": BarChart3,
  "Premium": Crown,
  "التخزين": HardDrive,
  "الأخطاء": AlertTriangle,
};

const STATUS_CONFIG = {
  healthy: {
    icon: CheckCircle2,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    label: "سليم",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    label: "تحذير",
  },
  error: {
    icon: XCircle,
    color: "text-red-500",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    label: "خطأ",
  },
};

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok) {
        setData(await res.json());
        setLastRefresh(new Date());
      }
    } catch (e) {
      console.error("[admin/analytics] fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, 30000); // auto-refresh every 30s
    return () => clearInterval(id);
  }, [fetchHealth]);

  const overallStatus = data?.status || "healthy";
  const overallConfig = STATUS_CONFIG[overallStatus];
  const OverallIcon = overallConfig.icon;

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* ---------- Overall Status Banner ---------- */}
      <Card className={`border-2 ${overallConfig.border} ${overallConfig.bg}`}>
        <CardContent className="flex items-center gap-4 p-5">
          <div className={`grid h-14 w-14 flex-shrink-0 place-items-center rounded-xl ${overallConfig.bg} ${overallConfig.color}`}>
            {loading ? (
              <Loader2 className="h-7 w-7 animate-spin" />
            ) : (
              <OverallIcon className="h-7 w-7" />
            )}
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-foreground">
              {loading ? "جارٍ الفحص…" : overallStatus === "healthy" ? "النظام يعمل بشكل سليم" : overallStatus === "warning" ? "يوجد تحذيرات في النظام" : "يوجد أخطاء في النظام"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {lastRefresh ? `آخر فحص: ${lastRefresh.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "لم يُفحص بعد"}
              {data?.uptime && ` · تشغيل: ${data.uptime}`}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={fetchHealth} disabled={loading} className="gap-1.5 text-xs">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            تحديث
          </Button>
        </CardContent>
      </Card>

      {/* ---------- Performance Summary ---------- */}
      {data && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <PerfCard
            icon={<Gauge className="h-4 w-4" />}
            label="زمن الاستجابة الكلي"
            value={`${data.performance.totalResponseTimeMs}ms`}
            tier={data.performance.totalResponseTimeMs < 500 ? "good" : data.performance.totalResponseTimeMs < 2000 ? "ok" : "slow"}
          />
          <PerfCard
            icon={<Zap className="h-4 w-4" />}
            label="متوسط زمن الفحص"
            value={`${data.performance.avgCheckTimeMs}ms`}
            tier={data.performance.avgCheckTimeMs < 100 ? "good" : data.performance.avgCheckTimeMs < 500 ? "ok" : "slow"}
          />
          <PerfCard
            icon={<Server className="h-4 w-4" />}
            label="الإصدار"
            value={data.version}
            tier="good"
          />
          <PerfCard
            icon={<Clock className="h-4 w-4" />}
            label="مدة التشغيل"
            value={data.uptime}
            tier="good"
          />
        </div>
      )}

      {/* ---------- Health Checks ---------- */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Activity className="h-4 w-4 text-primary" />
          فحوصات النظام
        </h3>
        <div className="space-y-2">
          {loading && !data ? (
            [1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg border bg-card" />
            ))
          ) : (
            data?.checks.map((check) => {
              const config = STATUS_CONFIG[check.status];
              const Icon = CHECK_ICONS[check.label] || Activity;
              const StatusIcon = config.icon;
              return (
                <div
                  key={check.label}
                  className={`flex items-center gap-3 rounded-lg border ${config.border} ${config.bg} px-4 py-3`}
                >
                  <div className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg ${config.bg} ${config.color}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{check.label}</span>
                      <StatusIcon className={`h-4 w-4 ${config.color}`} />
                    </div>
                    <p className="text-xs text-muted-foreground">{check.detail}</p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className={`text-sm font-bold tabular-nums ${config.color}`}>
                      {config.label}
                    </span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {check.responseTimeMs}ms
                    </span>
                  </div>
                  {/* Response time bar */}
                  <div className="hidden h-8 w-24 flex-col justify-center sm:flex">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all ${
                          check.responseTimeMs < 100
                            ? "bg-emerald-500"
                            : check.responseTimeMs < 500
                            ? "bg-amber-500"
                            : "bg-red-500"
                        }`}
                        style={{
                          width: `${Math.min(100, (check.responseTimeMs / 1000) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ---------- Performance Details ---------- */}
      {data && data.checks.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-primary" />
              تفاصيل الأداء
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.checks.map((check) => (
                <div key={check.label} className="flex items-center gap-3">
                  <span className="w-32 flex-shrink-0 text-xs text-muted-foreground">
                    {check.label}
                  </span>
                  <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-muted">
                    <div
                      className={`absolute inset-y-0 right-0 rounded-md transition-all ${
                        check.responseTimeMs < 100
                          ? "bg-emerald-500/60"
                          : check.responseTimeMs < 500
                          ? "bg-amber-500/60"
                          : "bg-red-500/60"
                      }`}
                      style={{
                        width: `${Math.min(100, (check.responseTimeMs / 1000) * 100)}%`,
                      }}
                    />
                    <span className="absolute inset-y-0 right-2 flex items-center text-[10px] font-bold tabular-nums text-foreground">
                      {check.responseTimeMs}ms
                    </span>
                  </div>
                </div>
              ))}
              {/* Average line */}
              <div className="flex items-center gap-3 border-t pt-2">
                <span className="w-32 flex-shrink-0 text-xs font-semibold text-foreground">
                  المتوسط
                </span>
                <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-muted">
                  <div
                    className="absolute inset-y-0 right-0 rounded-md bg-primary/40"
                    style={{
                      width: `${Math.min(100, (data.performance.avgCheckTimeMs / 1000) * 100)}%`,
                    }}
                  />
                  <span className="absolute inset-y-0 right-2 flex items-center text-[10px] font-bold tabular-nums text-foreground">
                    {data.performance.avgCheckTimeMs}ms
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PerfCard({
  icon,
  label,
  value,
  tier,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tier: "good" | "ok" | "slow";
}) {
  const tierColor =
    tier === "good"
      ? "text-emerald-500"
      : tier === "ok"
      ? "text-amber-500"
      : "text-red-500";

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div className={`mt-1 text-lg font-bold tabular-nums ${tierColor}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
