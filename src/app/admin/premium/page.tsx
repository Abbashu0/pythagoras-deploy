"use client";

/**
 * Admin — Premium management page (/admin/premium)
 *
 * Features:
 *   - Revenue overview (monthly revenue, active count, conversion rate)
 *   - Subscription table (user, plan, status, price, dates)
 *   - Filter by status (all / active / cancelled / expired)
 *
 * Data comes from /api/premium (Prisma).
 */

import { useCallback, useEffect, useState } from "react";
import {
  Crown,
  TrendingUp,
  Users,
  DollarSign,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface SubscriptionRow {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  plan: string;
  status: string;
  price: number;
  startedAt: string;
  endsAt: string | null;
  paymentMethod: string | null;
}

interface PremiumData {
  subscriptions: SubscriptionRow[];
  stats: {
    activeCount: number;
    monthlyRevenue: number;
    totalUsers: number;
    conversionRate: number;
  };
}

export default function AdminPremiumPage() {
  const [data, setData] = useState<PremiumData | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/premium?${params}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch (e) {
      console.error("[admin/premium] fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const stats = data?.stats;
  const subscriptions = data?.subscriptions || [];

  const planLabel = (plan: string) =>
    plan === "monthly" ? "شهري" : plan === "yearly" ? "سنوي" : plan === "lifetime" ? "مدى الحياة" : plan;

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
      active: { label: "نشط", color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", icon: <CheckCircle2 className="h-3 w-3" /> },
      cancelled: { label: "ملغى", color: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400", icon: <XCircle className="h-3 w-3" /> },
      expired: { label: "منتهي", color: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400", icon: <Clock className="h-3 w-3" /> },
      pending: { label: "معلّق", color: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400", icon: <Clock className="h-3 w-3" /> },
    };
    const s = map[status] || { label: status, color: "border-border bg-muted text-muted-foreground", icon: null };
    return (
      <Badge variant="outline" className={`gap-1 text-[9px] ${s.color}`}>
        {s.icon}
        {s.label}
      </Badge>
    );
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
      {/* ---------- Revenue overview ---------- */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard icon={<DollarSign className="h-4 w-4" />} label="الإيراد الشهري" value={`${(stats?.monthlyRevenue || 0).toLocaleString("en")} ل.س`} valueClassName="text-emerald-500" />
        <StatCard icon={<Crown className="h-4 w-4" />} label="مشتركون نشطون" value={String(stats?.activeCount || 0)} valueClassName="text-amber-500" />
        <StatCard icon={<Users className="h-4 w-4" />} label="إجمالي المستخدمين" value={String(stats?.totalUsers || 0)} />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="معدل التحويل" value={`${(stats?.conversionRate || 0).toFixed(1)}%`} valueClassName="text-blue-500" />
      </div>

      {/* ---------- Filters ---------- */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex gap-1.5">
          {[
            { value: "", label: "الكل" },
            { value: "active", label: "نشط" },
            { value: "cancelled", label: "ملغى" },
            { value: "expired", label: "منتهي" },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                statusFilter === opt.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/40"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading} className="ml-auto h-8 gap-1 text-xs">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          تحديث
        </Button>
      </div>

      {/* ---------- Subscriptions table ---------- */}
      <Card>
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="grid place-items-center gap-2 py-16 text-center text-xs text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              جارٍ تحميل الاشتراكات…
            </div>
          ) : subscriptions.length === 0 ? (
            <div className="grid place-items-center gap-2 py-16 text-center text-xs text-muted-foreground">
              <Crown className="h-8 w-8 opacity-30" />
              لا توجد اشتراكات Premium بعد.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="p-3 font-medium">المستخدم</th>
                    <th className="p-3 font-medium">الخطة</th>
                    <th className="p-3 font-medium">الحالة</th>
                    <th className="p-3 font-medium">السعر</th>
                    <th className="p-3 font-medium">تاريخ البدء</th>
                    <th className="p-3 font-medium">تاريخ الانتهاء</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((sub) => (
                    <tr key={sub.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                      <td className="p-3">
                        <div className="font-medium text-foreground">{sub.userName || "بدون اسم"}</div>
                        <div className="text-[10px] text-muted-foreground">{sub.userEmail || "—"}</div>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-[9px]">{planLabel(sub.plan)}</Badge>
                      </td>
                      <td className="p-3">{statusBadge(sub.status)}</td>
                      <td className="p-3 tabular-nums text-muted-foreground">
                        {sub.price > 0 ? `${sub.price.toLocaleString("en")} ل.س` : "—"}
                      </td>
                      <td className="p-3 text-[10px] tabular-nums text-muted-foreground">
                        {new Date(sub.startedAt).toLocaleDateString("ar-EG", { day: "2-digit", month: "2-digit", year: "numeric" })}
                      </td>
                      <td className="p-3 text-[10px] tabular-nums text-muted-foreground">
                        {sub.endsAt ? new Date(sub.endsAt).toLocaleDateString("ar-EG", { day: "2-digit", month: "2-digit", year: "numeric" }) : "مدى الحياة"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, valueClassName }: { icon: React.ReactNode; label: string; value: string; valueClassName?: string }) {
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
