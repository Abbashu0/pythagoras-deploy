/**
 * dashboard-data.ts
 * =================
 * Data layer for the admin dashboard.
 *
 * Currently generates MOCK data (clearly labeled as demo). When a backend
 * arrives, swap the functions to fetch from the API — the dashboard UI
 * won't change.
 *
 * Real data sources used now:
 *   - Banner count → from AdminStore (real)
 *   - Material count → from ContentStore (real)
 *   - Storage stats → from ImageDB.getStats() (real)
 *   - Activity history count → from AdminStore (real)
 *
 * Mock data (labeled "demo"):
 *   - Users (total, new today, DAU/WAU/MAU)
 *   - Premium subscribers + revenue
 *   - Study sessions, quizzes completed, study time
 *   - Banner impressions/clicks/CTR
 */

import { getAdminStore } from "./admin-store";
import { getMaterialsStore, getToolsStore } from "./content-store";
import { getStats, type ImageDBStats } from "./image-db";

// ============================================================
// Types
// ============================================================

export interface DashboardKPI {
  id: string;
  label: string;
  value: string;
  sublabel: string;
  trend: number; // % change vs yesterday
  trendDirection: "up" | "down" | "flat";
  icon: string; // lucide icon name
  color: string; // tailwind color class
  isDemo: boolean;
}

export interface DashboardChartPoint {
  label: string; // e.g. "السبت", "الأحد"
  value: number;
}

export interface BannerAnalyticsRow {
  id: string;
  title: string;
  impressions: number;
  clicks: number;
  ctr: number;
  isDemo: boolean;
}

export interface SystemHealthItem {
  label: string;
  status: "healthy" | "warning" | "error";
  detail: string;
}

export interface DashboardData {
  kpis: DashboardKPI[];
  weeklyActivity: DashboardChartPoint[];
  bannerAnalytics: BannerAnalyticsRow[];
  systemHealth: SystemHealthItem[];
  quickActions: { label: string; href: string; icon: string }[];
  isAllDemo: boolean;
}

// ============================================================
// Helpers
// ============================================================

/** Generate a deterministic pseudo-random number from a seed. */
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/** Get day-of-week label in Arabic. */
function dayLabel(offset: number): string {
  const days = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const today = new Date().getDay();
  return days[(today - offset + 7) % 7];
}

// ============================================================
// Main data generator
// ============================================================

export async function getDashboardData(): Promise<DashboardData> {
  // Real data from stores
  const adminStore = getAdminStore();
  const materialsStore = getMaterialsStore();
  const toolsStore = getToolsStore();

  const banners = adminStore.getSnapshot().banners;
  const materials = materialsStore.getSnapshot().items;
  const tools = toolsStore.getSnapshot().items;
  const history = adminStore.getSnapshot().history;

  let storageStats: ImageDBStats | null = null;
  try {
    storageStats = await getStats();
  } catch {
    /* noop */
  }

  // ---- KPIs ----
  const today = new Date().getDate();
  const kpis: DashboardKPI[] = [
    {
      id: "users",
      label: "إجمالي المستخدمين",
      value: "1,247",
      sublabel: "جديد اليوم: 23",
      trend: 12,
      trendDirection: "up",
      icon: "Users",
      color: "text-blue-500",
      isDemo: true,
    },
    {
      id: "study",
      label: "جلسات الدراسة",
      value: "3,892",
      sublabel: "هذا الأسبوع",
      trend: 8,
      trendDirection: "up",
      icon: "BookOpen",
      color: "text-emerald-500",
      isDemo: true,
    },
    {
      id: "premium",
      label: "Premium",
      value: "89",
      sublabel: "الإيرام: 4,450 ل.س",
      trend: 5,
      trendDirection: "up",
      icon: "Crown",
      color: "text-amber-500",
      isDemo: true,
    },
    {
      id: "banners",
      label: "البانرات النشطة",
      value: String(banners.filter((b) => b.enabled !== false).length),
      sublabel: `إجمالي: ${banners.length}`,
      trend: 0,
      trendDirection: "flat",
      icon: "ImagePlus",
      color: "text-purple-500",
      isDemo: false,
    },
  ];

  // ---- Weekly activity chart (mock) ----
  const weeklyActivity: DashboardChartPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const seed = today + i;
    weeklyActivity.push({
      label: dayLabel(i),
      value: Math.floor(200 + seededRandom(seed) * 400),
    });
  }

  // ---- Banner analytics (real banner count + mock metrics) ----
  const bannerAnalytics: BannerAnalyticsRow[] = banners
    .filter((b) => b.enabled !== false)
    .slice(0, 5)
    .map((b, i) => {
      const seed = today + i + 1;
      const impressions = Math.floor(500 + seededRandom(seed) * 2000);
      const clicks = Math.floor(impressions * (0.03 + seededRandom(seed + 10) * 0.07));
      return {
        id: b.id,
        title: b.title || "بدون عنوان",
        impressions,
        clicks,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        isDemo: true,
      };
    })
    .sort((a, b) => b.clicks - a.clicks);

  // ---- System health ----
  const storageUsed = storageStats?.totalBytes ?? 0;
  const quotaUsed = storageStats?.usageBytes ?? null;
  const quotaTotal = storageStats?.quotaBytes ?? null;
  const storagePct =
    quotaUsed && quotaTotal ? (quotaUsed / quotaTotal) * 100 : null;

  const systemHealth: SystemHealthItem[] = [
    {
      label: "قاعدة البيانات",
      status: "healthy",
      detail: `${storageStats?.count ?? 0} عنصر في IndexedDB`,
    },
    {
      label: "التخزين",
      status:
        storagePct === null
          ? "healthy"
          : storagePct < 50
          ? "healthy"
          : storagePct < 80
          ? "warning"
          : "error",
      detail:
        storagePct !== null
          ? `${storagePct.toFixed(1)}% مستخدم`
          : `${(storageUsed / 1024 / 1024).toFixed(1)} MB`,
    },
    {
      label: "localStorage",
      status: "healthy",
      detail: `${storageStats?.localStorageKeyCount ?? 0} مفاتيح`,
    },
    {
      label: "النشاط",
      status: history.length > 0 ? "healthy" : "warning",
      detail: `${history.length} عملية مسجّلة`,
    },
  ];

  // ---- Quick actions ----
  const quickActions = [
    { label: "إضافة بانر", href: "/admin/banners", icon: "ImagePlus" },
    { label: "تعديل مادة", href: "/admin/materials", icon: "BookOpen" },
    { label: "تعديل التنقل", href: "/admin/navigation", icon: "Compass" },
    { label: "إدارة الأدوات", href: "/admin/tools", icon: "Wrench" },
  ];

  return {
    kpis,
    weeklyActivity,
    bannerAnalytics,
    systemHealth,
    quickActions,
    isAllDemo: true, // most data is mock
  };
}
