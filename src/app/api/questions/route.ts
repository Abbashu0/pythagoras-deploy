/**
 * /api/questions — Question management API
 *
 * GET    /api/questions?packageId=xxx        → list questions in a package
 * GET    /api/questions?search=xxx           → search across all questions
 * GET    /api/questions?id=xxx               → single question
 * POST   /api/questions                      → create question
 * PATCH  /api/questions                      → update question
 * DELETE /api/questions?id=xxx               → delete question
 * POST   /api/questions?reorder=true         → reorder questions in a package
 *        body: { packageId: string, orderedIds: string[] }
 *
 * Uses Repository pattern → BaseRepository → Supabase.
 */

import { NextRequest, NextResponse } from "next/server";
import { questionRepository, packageRepository, historyRepository } from "@/lib/repositories";
import type { WhereFilter } from "@/lib/repositories";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const packageId = searchParams.get("packageId");
    const subjectId = searchParams.get("subjectId");
    const tagId = searchParams.get("tagId");
    const search = searchParams.get("search") || "";
    const limit = parseInt(searchParams.get("limit") || "200", 10);

    if (id) {
      const question = await questionRepository.getById(id);
      if (!question) {
        return NextResponse.json({ error: "Question not found" }, { status: 404 });
      }
      return NextResponse.json({ question });
    }

    const filters: WhereFilter[] = [];
    if (packageId) filters.push({ column: "packageId", value: packageId });
    if (subjectId) filters.push({ column: "subjectId", value: subjectId });
    if (tagId) filters.push({ column: "tags", value: tagId, op: "array-contains" });
    if (search) filters.push({ column: "questionText", value: search, op: "ilike" });

    const questions = await questionRepository.getAll({
      filters,
      orderBy: packageId ? "order" : "updatedAt",
      ascending: true,
      limit,
    });

    return NextResponse.json({ questions, total: questions.length });
  } catch (error) {
    console.error("[api/questions] GET error:", error);
    return NextResponse.json({ questions: [], total: 0 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const isReorder = searchParams.get("reorder") === "true";

    const body = await request.json();

    // ---- Reorder branch ----
    if (isReorder) {
      const { packageId, orderedIds } = body as { packageId: string; orderedIds: string[] };
      if (!packageId || !Array.isArray(orderedIds)) {
        return NextResponse.json(
          { error: "packageId and orderedIds are required for reorder" },
          { status: 400 }
        );
      }
      await questionRepository.reorder(packageId, orderedIds);
      return NextResponse.json({ success: true, reordered: orderedIds.length });
    }

    // ---- Create branch ----
    if (!body.packageId) {
      return NextResponse.json(
        { error: "packageId is required" },
        { status: 400 }
      );
    }

    // Verify the package exists.
    const pkg = await packageRepository.getById(body.packageId);
    if (!pkg) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }

    // Determine the order (append to end).
    const existing = await questionRepository.getByPackage(body.packageId);
    const nextOrder = body.order ?? existing.length;

    const question = await questionRepository.create({
      packageId: body.packageId,
      subjectId: pkg.subjectId,
      sectionId: pkg.sectionId || null,
      topicId: body.topicId || pkg.topicId || null,
      order: nextOrder,
      questionText: body.questionText || "سؤال جديد",
      type: body.type || "short-answer",
      answerText: body.answerText || "",
      options: body.options || [],
      correctOptionIndex: body.correctOptionIndex ?? null,
      explanation: body.explanation || "",
      difficulty: body.difficulty || "medium",
      tags: body.tags || [],
      appearances: body.appearances || [],
      resourceIds: body.resourceIds || [],
      status: body.status || "draft",
      visible: body.visible ?? true,
      version: 1,
      searchText: body.questionText || "",
      keywords: body.keywords || [],
      timesAnswered: 0,
      timesCorrect: 0,
      schemaVersion: 1,
    } as never);

    // Bump the package's question count.
    await packageRepository.update(body.packageId, {
      questionCount: existing.length + 1,
    } as never);

    void historyRepository.log({
      entityType: "question",
      entityId: question.id!,
      action: "created",
      userId: "system",
      userName: "System",
      snapshot: question as unknown as Record<string, unknown>,
    } as never);

    return NextResponse.json({ question }, { status: 201 });
  } catch (error) {
    console.error("[api/questions] POST error:", error);
    return NextResponse.json(
      { error: "Failed to create question", details: String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "Question ID required" }, { status: 400 });
    }

    // Sync searchText with questionText if questionText is being updated.
    if (updates.questionText && !updates.searchText) {
      updates.searchText = updates.questionText;
    }

    const updated = await questionRepository.update(id, updates);
    if (!updated) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    void historyRepository.log({
      entityType: "question",
      entityId: id,
      action: "updated",
      userId: "system",
      userName: "System",
      changes: updates as Record<string, { before: unknown; after: unknown }>,
    } as never);

    return NextResponse.json({ success: true, question: updated });
  } catch (error) {
    console.error("[api/questions] PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update question", details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Question ID required" }, { status: 400 });
    }

    // Get the packageId before delete so we can decrement the count.
    const question = await questionRepository.getById(id);
    if (!question) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    const ok = await questionRepository.delete(id);
    if (!ok) {
      return NextResponse.json({ error: "Failed to delete question" }, { status: 500 });
    }

    // Decrement package question count.
    if (question.packageId) {
      const remaining = await questionRepository.getByPackage(question.packageId);
      await packageRepository.update(question.packageId, {
        questionCount: remaining.length,
      } as never);
    }

    void historyRepository.log({
      entityType: "question",
      entityId: id,
      action: "deleted",
      userId: "system",
      userName: "System",
    } as never);

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("[api/questions] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete question", details: String(error) },
      { status: 500 }
    );
  }
}
