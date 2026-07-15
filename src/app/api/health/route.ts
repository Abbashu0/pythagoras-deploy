/**
 * /api/health — System health check endpoint
 *
 * Returns the overall health of the Pythagoras platform:
 *   - Database connectivity (Prisma ping)
 *   - User count + premium count
 *   - Analytics event count (last 24h)
 *   - Storage info (db file size)
 *   - Error events (last 24h)
 *   - Performance (response time of each check)
 *   - Version info
 *
 * Used by /admin/analytics (Health Dashboard).
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stat } from "fs/promises";
import path from "path";

interface HealthCheck {
  label: string;
  status: "healthy" | "warning" | "error";
  detail: string;
  responseTimeMs: number;
}

async function timedCheck<T>(
  label: string,
  fn: () => Promise<T>,
  detailFn: (result: T) => { detail: string; status: "healthy" | "warning" | "error" }
): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const result = await fn();
    const elapsed = Date.now() - start;
    const { detail, status } = detailFn(result);
    return { label, status, detail, responseTimeMs: elapsed };
  } catch (e) {
    const elapsed = Date.now() - start;
    return {
      label,
      status: "error",
      detail: e instanceof Error ? e.message : "Unknown error",
      responseTimeMs: elapsed,
    };
  }
}

export async function GET() {
  const checks: HealthCheck[] = [];
  const overallStart = Date.now();

  // 1. Database connectivity
  checks.push(
    await timedCheck(
      "قاعدة البيانات",
      async () => {
        await db.$queryRaw`SELECT 1`;
        const userCount = await db.user.count();
        return { userCount };
      },
      (r) => ({
        detail: `${r.userCount} مستخدم مسجّل`,
        status: "healthy" as const,
      })
    )
  );

  // 2. Analytics events (last 24h)
  checks.push(
    await timedCheck(
      "التحليلات",
      async () => {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const count = await db.analyticsEvent.count({
          where: { timestamp: { gte: yesterday } },
        });
        return { count };
      },
      (r) => ({
        detail: `${r.count} حدث في آخر 24 ساعة`,
        status: r.count > 0 ? ("healthy" as const) : ("warning" as const),
      })
    )
  );

  // 3. Premium subscriptions
  checks.push(
    await timedCheck(
      "Premium",
      async () => {
        const count = await db.premiumSubscription.count({
          where: { status: "active" },
        });
        return { count };
      },
      (r) => ({
        detail: `${r.count} مشترك نشط`,
        status: "healthy" as const,
      })
    )
  );

  // 4. Storage (db file size)
  checks.push(
    await timedCheck(
      "التخزين",
      async () => {
        const dbPath = path.join(process.cwd(), "db", "custom.db");
        const stats = await stat(dbPath);
        return { sizeBytes: stats.size };
      },
      (r) => {
        const sizeMB = (r.sizeBytes / 1024 / 1024).toFixed(2);
        return {
          detail: `${sizeMB} MB`,
          status: r.sizeBytes < 100 * 1024 * 1024 ? ("healthy" as const) : ("warning" as const),
        };
      }
    )
  );

  // 5. Error events (last 24h)
  checks.push(
    await timedCheck(
      "الأخطاء",
      async () => {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const errorCount = await db.analyticsEvent.count({
          where: {
            timestamp: { gte: yesterday },
            type: { contains: "error" },
          },
        });
        return { errorCount };
      },
      (r) => ({
        detail: r.errorCount === 0 ? "لا أخطاء في آخر 24 ساعة" : `${r.errorCount} خطأ`,
        status: r.errorCount === 0 ? ("healthy" as const) : r.errorCount < 10 ? ("warning" as const) : ("error" as const),
      })
    )
  );

  // Overall status
  const hasError = checks.some((c) => c.status === "error");
  const hasWarning = checks.some((c) => c.status === "warning");
  const overallStatus = hasError ? "error" : hasWarning ? "warning" : "healthy";

  // Performance summary
  const totalResponseTime = Date.now() - overallStart;
  const avgResponseTime = Math.round(
    checks.reduce((sum, c) => sum + c.responseTimeMs, 0) / checks.length
  );

  return NextResponse.json({
    status: overallStatus,
    checks,
    performance: {
      totalResponseTimeMs: totalResponseTime,
      avgCheckTimeMs: avgResponseTime,
    },
    version: "2.0",
    timestamp: new Date().toISOString(),
    uptime: process.uptime ? `${Math.round(process.uptime())}s` : "unknown",
  });
}
