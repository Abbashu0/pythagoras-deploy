/**
 * /api/users — User management API
 *
 * GET  /api/users          → list users (with pagination, search, filter)
 * GET  /api/users/:id      → single user (not implemented — use list)
 * POST /api/users          → create user (manual registration by admin)
 * PATCH /api/users         → update user (role, active status, etc.)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const role = searchParams.get("role") || "";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { email: { contains: search } },
        { name: { contains: search } },
        { displayName: { contains: search } },
      ];
    }
    if (role) where.role = role;

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        include: { subscriptions: { where: { status: "active" } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.user.count({ where }),
    ]);

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        displayName: u.displayName,
        role: u.role,
        grade: u.grade,
        isActive: u.isActive,
        isPremium: u.subscriptions.length > 0,
        createdAt: u.createdAt,
      })),
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error("[api/users] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, name, role, grade, displayName } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "User already exists" }, { status: 409 });
    }

    const user = await db.user.create({
      data: {
        email,
        name: name || null,
        role: role || "student",
        grade: grade || null,
        displayName: displayName || null,
      },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    console.error("[api/users] POST error:", error);
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }
}
