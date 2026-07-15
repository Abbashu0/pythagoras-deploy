/**
 * /api/premium — Premium subscription management API
 *
 * GET  /api/premium  → list subscriptions + revenue stats
 * POST /api/premium  → create subscription (admin grants premium)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "";

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const [subscriptions, stats] = await Promise.all([
      db.premiumSubscription.findMany({
        where,
        include: { user: { select: { email: true, name: true, displayName: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      // Revenue stats
      db.premiumSubscription.aggregate({
        where: { status: "active" },
        _sum: { price: true },
        _count: true,
      }),
    ]);

    // Monthly revenue (current active subscriptions' prices)
    const monthlyRevenue = stats._sum.price || 0;
    const activeCount = stats._count;

    // Total users for conversion rate
    const totalUsers = await db.user.count();

    return NextResponse.json({
      subscriptions: subscriptions.map((s) => ({
        id: s.id,
        userId: s.userId,
        userEmail: s.user?.email,
        userName: s.user?.displayName || s.user?.name,
        plan: s.plan,
        status: s.status,
        price: s.price,
        startedAt: s.startedAt,
        endsAt: s.endsAt,
        paymentMethod: s.paymentMethod,
      })),
      stats: {
        activeCount,
        monthlyRevenue,
        totalUsers,
        conversionRate: totalUsers > 0 ? (activeCount / totalUsers) * 100 : 0,
      },
    });
  } catch (error) {
    console.error("[api/premium] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch subscriptions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, plan, price, paymentMethod, durationDays } = body;

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const endsAt = durationDays
      ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)
      : null;

    const subscription = await db.premiumSubscription.create({
      data: {
        userId,
        plan: plan || "monthly",
        status: "active",
        price: price || 0,
        paymentMethod: paymentMethod || "manual",
        endsAt,
      },
    });

    return NextResponse.json({ subscription }, { status: 201 });
  } catch (error) {
    console.error("[api/premium] POST error:", error);
    return NextResponse.json({ error: "Failed to create subscription" }, { status: 500 });
  }
}
