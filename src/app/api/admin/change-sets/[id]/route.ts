import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminActor } from "@/server/admin-auth";
import { getChangeManagementService } from "@/server/change-management";
import { changeApiError, changeJson, integer, readChangeJson, requireChangeAdmin } from "../_shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const authentication = requireChangeAdmin(request);
    const { id } = await context.params;
    return changeJson({ ok: true, changeSet: getChangeManagementService().getDetails(id, getAdminActor(authentication)) });
  } catch (error) { return changeApiError(error); }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireChangeAdmin(request);
    const body = await readChangeJson(request);
    const { id } = await context.params;
    const result = getChangeManagementService().updateDetails(
      id,
      typeof body.title === "string" ? body.title : "",
      typeof body.description === "string" ? body.description : undefined,
      integer(body.expectedRevision),
      getAdminActor(authentication),
    );
    return changeJson({ ok: true, changeSet: result });
  } catch (error) { return changeApiError(error); }
}
