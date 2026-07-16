/**
 * POST /api/events
 * ================
 * Receives analytics events from the student app (and any other client).
 *
 * Body: { events: AnalyticsEventInput[] }
 *
 * The client batches events and sends them periodically (every 30s or
 * on page unload) to minimize network overhead.
 *
 * Each event is stored in the AnalyticsEvent Prisma table.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

interface EventInput {
  type: string;
  userId?: string;
  sessionId?: string;
  entityId?: string;
  platform?: string;
  version?: string;
  device?: string;
  metadata?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const events: EventInput[] = body.events || [];

    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: "No events provided" }, { status: 400 });
    }

    // Validate and sanitize each event
    const sanitized = events.map((e) => ({
      type: String(e.type || "unknown").slice(0, 100),
      userId: e.userId ? String(e.userId).slice(0, 200) : null,
      sessionId: e.sessionId ? String(e.sessionId).slice(0, 200) : null,
      entityId: e.entityId ? String(e.entityId).slice(0, 200) : null,
      platform: e.platform ? String(e.platform).slice(0, 50) : null,
      version: e.version ? String(e.version).slice(0, 50) : null,
      device: e.device ? String(e.device).slice(0, 500) : null,
      metadata: e.metadata ? String(e.metadata).slice(0, 2000) : null,
    }));

    // Insert all events in a single transaction
    await db.analyticsEvent.createMany({
      data: sanitized,
    });

    return NextResponse.json({
      success: true,
      count: sanitized.length,
    });
  } catch (error) {
    console.error("[api/events] POST error:", error);
    return NextResponse.json(
      { error: "Failed to store events" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/analytics
 * ==================
 * Returns aggregated analytics data for the dashboard.
 *
 * Query params:
 *   ?range=daily|weekly|monthly  (default: weekly)
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get("range") || "weekly";

    // Determine date range
    const now = new Date();
    let startDate = new Date();
    switch (range) {
      case "daily":
        startDate.setDate(now.getDate() - 1);
        break;
      case "monthly":
        startDate.setMonth(now.getMonth() - 1);
        break;
      case "yearly":
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      case "all":
        // From the beginning of time (or 2020)
        startDate = new Date("2020-01-01");
        break;
      case "weekly":
      default:
        startDate.setDate(now.getDate() - 7);
        break;
    }

    // Get total counts by event type
    const eventTypeCounts = await db.analyticsEvent.groupBy({
      by: ["type"],
      where: { timestamp: { gte: startDate } },
      _count: { type: true },
    });

    // Get daily activity (events per day for chart)
    const allEvents = await db.analyticsEvent.findMany({
      where: { timestamp: { gte: startDate } },
      select: { type: true, timestamp: true },
      orderBy: { timestamp: "asc" },
    });

    // Group by day
    const dayMap = new Map<string, number>();
    for (const e of allEvents) {
      const dayKey = e.timestamp.toISOString().slice(0, 10);
      dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + 1);
    }

    const dailyActivity = Array.from(dayMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Get unique users
    const uniqueUsers = await db.analyticsEvent.findMany({
      where: {
        timestamp: { gte: startDate },
        userId: { not: null },
      },
      select: { userId: true },
      distinct: ["userId"],
    });

    // Banner analytics
    const bannerEvents = await db.analyticsEvent.findMany({
      where: {
        timestamp: { gte: startDate },
        type: { in: ["banner_impression", "banner_click"] },
      },
      select: { type: true, entityId: true },
    });

    const bannerStats = new Map<string, { impressions: number; clicks: number }>();
    for (const e of bannerEvents) {
      if (!e.entityId) continue;
      const stats = bannerStats.get(e.entityId) || { impressions: 0, clicks: 0 };
      if (e.type === "banner_impression") stats.impressions++;
      if (e.type === "banner_click") stats.clicks++;
      bannerStats.set(e.entityId, stats);
    }

    const bannerAnalytics = Array.from(bannerStats.entries()).map(([id, s]) => ({
      bannerId: id,
      impressions: s.impressions,
      clicks: s.clicks,
      ctr: s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0,
    }));

    return NextResponse.json({
      range,
      startDate: startDate.toISOString(),
      endDate: now.toISOString(),
      totalEvents: allEvents.length,
      uniqueUsers: uniqueUsers.length,
      eventTypeCounts: eventTypeCounts.map((c) => ({
        type: c.type,
        count: c._count.type,
      })),
      dailyActivity,
      bannerAnalytics,
    });
  } catch (error) {
    console.error("[api/analytics] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}
