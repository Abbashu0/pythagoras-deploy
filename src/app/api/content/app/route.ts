import { NextResponse } from "next/server";
import { getCanonicalContentRepository } from "@/server/canonical-content";

export const runtime = "nodejs";

export async function GET() {
  try {
    const response = NextResponse.json({ ok: true, ...getCanonicalContentRepository().getPublicContent() });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  } catch {
    return NextResponse.json({ ok: false, code: "CONTENT_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
}
