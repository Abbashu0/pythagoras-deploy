import type { NextRequest } from "next/server";
import { getAdminActor } from "@/server/admin-auth";
import { getChangeManagementService } from "@/server/change-management";
import { changeApiError, changeJson, requireChangeAdmin } from "../../change-sets/_shared";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const authentication = requireChangeAdmin(request);
    return changeJson({ ok: true, stats: getChangeManagementService().getReviewStats(getAdminActor(authentication)) });
  } catch (error) { return changeApiError(error); }
}
