import type { NextRequest } from "next/server";
import { getAgent1ActivityStore } from "@/server/ai/agent-1-runtime/activity-store";
import { getContentDatabase } from "@/server/content";
import { localApiError, localJson, requireLocalAdminRead } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    requireLocalAdminRead(request);
    return localJson({ ok: true, ...getAgent1ActivityStore(getContentDatabase()).snapshot() });
  } catch (error) { return localApiError(error); }
}
