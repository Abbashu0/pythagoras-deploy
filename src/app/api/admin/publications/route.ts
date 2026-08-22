import type { NextRequest } from "next/server";
import { getAdminActor } from "@/server/admin-auth";
import { getChangeManagementService } from "@/server/change-management";
import { changeApiError, changeJson, requireChangeAdmin } from "../change-sets/_shared";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const authentication = requireChangeAdmin(request);
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 30);
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? 0);
    return changeJson({ ok: true, ...getChangeManagementService().listPublications(limit, offset, getAdminActor(authentication)) });
  } catch (error) { return changeApiError(error); }
}
