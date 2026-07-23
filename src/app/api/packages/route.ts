/**
 * /api/packages — Content Package management API
 *
 * GET    /api/packages          → list packages (with search, filter)
 * POST   /api/packages          → create package
 * PATCH  /api/packages          → update package
 * DELETE /api/packages?id=xxx   → delete package
 *
 * Uses the Repository pattern → BaseRepository → Supabase.
 * All camelCase (TS) ↔ snake_case (SQL) conversion is automatic.
 */

import { NextRequest, NextResponse } from "next/server";
import { packageRepository } from "@/lib/repositories";
import { historyRepository } from "@/lib/repositories";
import { validatePackage } from "@/lib/validation";
import type { WhereFilter } from "@/lib/repositories";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "";
    const subjectId = searchParams.get("subjectId") || "";
    const tagId = searchParams.get("tagId") || "";
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    // Build filters — BaseRepository converts camelCase column names to snake_case.
    const filters: WhereFilter[] = [];
    if (status) filters.push({ column: "status", value: status });
    if (subjectId) filters.push({ column: "subjectId", value: subjectId });
    if (tagId) filters.push({ column: "tags", value: tagId, op: "array-contains" });

    // Search filter — if there's a search term, do an ilike on name first.
    if (search) {
      filters.push({ column: "name", value: search, op: "ilike" });
    }

    const packages = await packageRepository.getAll({
      filters,
      orderBy: "updatedAt",
      ascending: false,
      limit,
    });

    return NextResponse.json({ packages, total: packages.length });
  } catch (error) {
    console.error("[api/packages] GET error:", error);
    // If Supabase isn't reachable, return empty so the UI keeps working.
    return NextResponse.json({ packages: [], total: 0 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const report = validatePackage(body);
    if (!report.valid) {
      return NextResponse.json(
        { error: "Validation failed", details: report.errors },
        { status: 400 }
      );
    }

    // BaseRepository strips id/createdAt/updatedAt and lets the DB handle them.
    const newPackage = await packageRepository.create({
      name: body.name,
      description: body.description || "",
      subjectId: body.subjectId || null,
      sectionId: body.sectionId || null,
      topicId: body.topicId || null,
      iconKey: body.iconKey || "package",
      color: body.color || "#6366f1",
      status: body.status || "draft",
      version: 1,
      questionCount: 0,
      resourceCount: 0,
      visible: body.visible ?? false,
      order: body.order ?? 0,
      tags: body.tags || [],
      validationStatus: "pending",
      validationErrors: 0,
      schemaVersion: 1,
    } as never);

    // Log history entry (fire-and-forget — logging never blocks the response).
    void historyRepository.log({
      entityType: "package",
      entityId: newPackage.id!,
      action: "created",
      userId: "system",
      userName: "System",
      snapshot: newPackage as unknown as Record<string, unknown>,
    } as never);

    return NextResponse.json({ package: newPackage }, { status: 201 });
  } catch (error) {
    console.error("[api/packages] POST error:", error);
    return NextResponse.json(
      { error: "Failed to create package", details: String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "Package ID required" }, { status: 400 });
    }

    const updated = await packageRepository.update(id, updates);
    if (!updated) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }

    void historyRepository.log({
      entityType: "package",
      entityId: id,
      action: "updated",
      userId: "system",
      userName: "System",
      changes: updates as Record<string, { before: unknown; after: unknown }>,
    } as never);

    return NextResponse.json({ success: true, package: updated });
  } catch (error) {
    console.error("[api/packages] PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update package", details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Package ID required" }, { status: 400 });
    }

    const ok = await packageRepository.delete(id);
    if (!ok) {
      return NextResponse.json(
        { error: "Failed to delete package" },
        { status: 500 }
      );
    }

    void historyRepository.log({
      entityType: "package",
      entityId: id,
      action: "deleted",
      userId: "system",
      userName: "System",
    } as never);

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("[api/packages] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete package", details: String(error) },
      { status: 500 }
    );
  }
}
