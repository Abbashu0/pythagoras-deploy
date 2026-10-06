import type { NextRequest } from "next/server";
import { getAgent1ActivityStore } from "@/server/ai/agent-1-runtime/activity-store";
import { ACTIVITY_RESULT_FILTERS, ACTIVITY_WINDOWS, type Agent1ActivityResultFilter, type Agent1ActivityWindow } from "@/server/ai/agent-1-runtime/activity-contracts";
import { getContentDatabase } from "@/server/content";
import { localApiError, localJson, requireLocalAdminRead } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    requireLocalAdminRead(request);
    const window = request.nextUrl.searchParams.get("window") ?? "5m";
    const modelConfigId = request.nextUrl.searchParams.get("model");
    const resultFilter = request.nextUrl.searchParams.get("result") ?? "all";
    if (!Object.hasOwn(ACTIVITY_WINDOWS, window) || !ACTIVITY_RESULT_FILTERS.includes(resultFilter as Agent1ActivityResultFilter) ||
      (modelConfigId !== null && !/^[a-f0-9-]{36}$/i.test(modelConfigId))) {
      return localJson({ ok: false, message: "نطاق المراقبة غير صالح." }, { status: 400 });
    }
    return localJson({ ok: true, ...getAgent1ActivityStore(getContentDatabase()).snapshot({ window: window as Agent1ActivityWindow, modelConfigId, resultFilter: resultFilter as Agent1ActivityResultFilter }) });
  } catch (error) { return localApiError(error); }
}
