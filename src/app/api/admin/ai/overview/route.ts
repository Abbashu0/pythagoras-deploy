import type { NextRequest } from "next/server";
import { getAIAdminReadService } from "@/server/ai/admin-read-service";
import { aiApiError, aiJson, requireAIAdmin } from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    requireAIAdmin(request);
    return aiJson({ ok: true, overview: getAIAdminReadService().getOverview() });
  } catch (error) { return aiApiError(error); }
}
