import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminActor } from "@/server/admin-auth";
import { CHANGE_OPERATIONS, getChangeManagementService, type ChangeOperation } from "@/server/change-management";
import { changeApiError, changeJson, integer, readChangeJson, requireChangeAdmin } from "../../_shared";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireChangeAdmin(request);
    const body = await readChangeJson(request);
    const { id } = await context.params;
    const result = getChangeManagementService().addItem(id, {
      resourceType: typeof body.resourceType === "string" ? body.resourceType : "",
      resourceId: typeof body.resourceId === "string" ? body.resourceId : "",
      expectedRevision: integer(body.expectedRevision),
      expectedChangeSetRevision: integer(body.expectedChangeSetRevision),
      desired: body.desired,
      operation: CHANGE_OPERATIONS.includes(body.operation as ChangeOperation)
        ? body.operation as ChangeOperation
        : undefined,
    }, getAdminActor(authentication));
    return changeJson({ ok: true, changeSet: result }, { status: 201 });
  } catch (error) { return changeApiError(error); }
}
