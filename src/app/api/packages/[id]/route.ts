/**
 * /api/packages/[id] — Single package details
 *
 * GET /api/packages/[id]
 *   → Returns the package + its sections (filtered by subject) + topics (by section).
 *
 * DELETE /api/packages/[id]
 *   → Delete the package (cascades to questions via FK).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  packageRepository,
  subjectRepository,
  sectionRepository,
  topicRepository,
  questionRepository,
} from "@/lib/repositories";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Package ID required" }, { status: 400 });
    }

    const pkg = await packageRepository.getById(id);
    if (!pkg) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }

    // Parallel fetch: subject, sections, topics, questions count.
    const [subject, sections, topics, questionsCount] = await Promise.all([
      pkg.subjectId ? subjectRepository.getById(pkg.subjectId) : Promise.resolve(null),
      pkg.subjectId ? sectionRepository.getBySubject(pkg.subjectId) : Promise.resolve([]),
      pkg.sectionId ? topicRepository.getBySection(pkg.sectionId) : Promise.resolve([]),
      questionRepository.count([{ column: "packageId", value: id }]),
    ]);

    return NextResponse.json({
      package: pkg,
      subject,
      sections,
      topics,
      questionsCount,
    });
  } catch (error) {
    console.error("[api/packages/[id]] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch package", details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Package ID required" }, { status: 400 });
    }

    const ok = await packageRepository.delete(id);
    if (!ok) {
      return NextResponse.json({ error: "Failed to delete package" }, { status: 500 });
    }

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("[api/packages/[id]] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete package", details: String(error) },
      { status: 500 }
    );
  }
}
