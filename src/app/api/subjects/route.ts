/**
 * /api/subjects — Subjects API
 *
 * GET    /api/subjects           → list subjects (active only by default)
 * GET    /api/subjects?all=true  → list all subjects (including inactive)
 * GET    /api/subjects?id=xxx    → single subject
 * POST   /api/subjects           → create subject
 * PATCH  /api/subjects           → update subject
 * DELETE /api/subjects?id=xxx    → delete subject
 */

import { NextRequest, NextResponse } from "next/server";
import { subjectRepository } from "@/lib/repositories";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const all = searchParams.get("all") === "true";

    if (id) {
      const subject = await subjectRepository.getById(id);
      if (!subject) {
        return NextResponse.json({ error: "Subject not found" }, { status: 404 });
      }
      return NextResponse.json({ subject });
    }

    const subjects = all
      ? await subjectRepository.getAll({ orderBy: "order", ascending: true })
      : await subjectRepository.getActive();

    return NextResponse.json({ subjects, total: subjects.length });
  } catch (error) {
    console.error("[api/subjects] GET error:", error);
    return NextResponse.json({ subjects: [], total: 0 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.name) {
      return NextResponse.json({ error: "Subject name is required" }, { status: 400 });
    }

    const subject = await subjectRepository.create({
      name: body.name,
      englishName: body.englishName || "",
      iconKey: body.iconKey || "book",
      color: body.color || "#6366f1",
      available: body.available ?? true,
      order: body.order ?? 0,
      description: body.description || "",
      schemaVersion: 1,
    } as never);

    return NextResponse.json({ subject }, { status: 201 });
  } catch (error) {
    console.error("[api/subjects] POST error:", error);
    return NextResponse.json(
      { error: "Failed to create subject", details: String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "Subject ID required" }, { status: 400 });
    }

    const updated = await subjectRepository.update(id, updates);
    if (!updated) {
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, subject: updated });
  } catch (error) {
    console.error("[api/subjects] PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update subject", details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Subject ID required" }, { status: 400 });
    }

    const ok = await subjectRepository.delete(id);
    if (!ok) {
      return NextResponse.json({ error: "Failed to delete subject" }, { status: 500 });
    }

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("[api/subjects] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete subject", details: String(error) },
      { status: 500 }
    );
  }
}
