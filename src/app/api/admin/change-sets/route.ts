import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminActor } from "@/server/admin-auth";
import { CHANGE_SET_STATUSES, ChangeManagementError, getChangeManagementService, type ChangeSetStatus } from "@/server/change-management";
import { changeApiError, changeJson, integer, readChangeJson, requireChangeAdmin } from "./_shared";

export const runtime = "nodejs";

function queryInteger(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  return /^\d+$/u.test(value) ? Number(value) : Number.NaN;
}

export async function GET(request: NextRequest) {
  try {
    const authentication = requireChangeAdmin(request);
    const rawStatus = request.nextUrl.searchParams.get("status");
    if (rawStatus && !CHANGE_SET_STATUSES.includes(rawStatus as ChangeSetStatus)) {
      throw new ChangeManagementError("CHANGE_VALIDATION_FAILED", "The requested status is invalid.");
    }
    const status = rawStatus as ChangeSetStatus | null;
    const page = getChangeManagementService().list({
      status: status ?? undefined,
      limit: queryInteger(request.nextUrl.searchParams.get("limit"), 30),
      offset: queryInteger(request.nextUrl.searchParams.get("offset"), 0),
    }, getAdminActor(authentication));
    return changeJson({ ok: true, ...page });
  } catch (error) { return changeApiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireChangeAdmin(request);
    const body = await readChangeJson(request);
    const initial = typeof body.initialItem === "object" && body.initialItem !== null ? body.initialItem as Record<string, unknown> : undefined;
    const details = getChangeManagementService().createChangeSet({
      title: typeof body.title === "string" ? body.title : "",
      description: typeof body.description === "string" ? body.description : undefined,
      submit: body.submit === true,
      initialItem: initial ? {
        resourceType: typeof initial.resourceType === "string" ? initial.resourceType : "",
        resourceId: typeof initial.resourceId === "string" ? initial.resourceId : "",
        expectedRevision: integer(initial.expectedRevision),
        desired: initial.desired,
      } : undefined,
    }, getAdminActor(authentication));
    return changeJson({ ok: true, changeSet: details }, { status: 201 });
  } catch (error) { return changeApiError(error); }
}
