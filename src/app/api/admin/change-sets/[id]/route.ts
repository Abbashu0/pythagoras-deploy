import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminActor } from "@/server/admin-auth";
import { getChangeManagementService } from "@/server/change-management";
import { changeApiError, changeJson, integer, readChangeJson, requireChangeAdmin } from "../_shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const authentication = requireChangeAdmin(request);
    const { id } = await context.params;
    const limitValue = request.nextUrl.searchParams.get("itemsLimit");
    const offsetValue = request.nextUrl.searchParams.get("itemsOffset");
    const service = getChangeManagementService();
    const actor = getAdminActor(authentication);
    const changeSet = limitValue !== null || offsetValue !== null
      ? service.getDetailsPage(id, actor, Number(limitValue ?? 25), Number(offsetValue ?? 0))
      : service.getDetails(id, actor);
    return changeJson({ ok: true, changeSet, questionTaxonomyLabels: service.getQuestionTaxonomyLabels(id, actor) });
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
