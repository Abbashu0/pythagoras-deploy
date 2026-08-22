import type { NextRequest } from "next/server";
import { getCanonicalContentRepository } from "@/server/canonical-content";
import { contentApiError, contentJson, requireCanonicalAdmin } from "./_shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    requireCanonicalAdmin(request);
    return contentJson({ ok: true, snapshot: getCanonicalContentRepository().getSnapshot() });
  } catch (error) { return contentApiError(error); }
}
