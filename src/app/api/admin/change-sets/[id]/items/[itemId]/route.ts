import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminActor } from "@/server/admin-auth";
import { getChangeManagementService } from "@/server/change-management";
import { changeApiError, changeJson, integer, readChangeJson, requireChangeAdmin } from "../../../_shared";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireChangeAdmin(request);
    const body = await readChangeJson(request);
    const { id, itemId } = await context.params;
    const result = getChangeManagementService().updateItem(id, itemId, {
      desired: body.desired,
      expectedItemRevision: integer(body.expectedItemRevision),
      expectedChangeSetRevision: integer(body.expectedChangeSetRevision),
    }, getAdminActor(authentication));
    return changeJson({ ok: true, changeSet: result });
  } catch (error) { return changeApiError(error); }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireChangeAdmin(request);
    const body = await readChangeJson(request);
    const { id, itemId } = await context.params;
    const result = getChangeManagementService().removeItem(id, itemId, integer(body.expectedChangeSetRevision), getAdminActor(authentication));
    return changeJson({ ok: true, changeSet: result });
  } catch (error) { return changeApiError(error); }
}
