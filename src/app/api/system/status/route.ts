import { NextResponse } from "next/server";
import { getContentDatabaseStatus } from "@/server/content";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const status = getContentDatabaseStatus();
    return NextResponse.json({
      ok: true,
      contentFoundation: status,
    });
  } catch (error) {
    console.error("[content-foundation] status check failed", error);
    return NextResponse.json(
      {
        ok: false,
        code: "CONTENT_STORAGE_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
}
