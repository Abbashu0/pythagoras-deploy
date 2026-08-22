import type { NextRequest } from "next/server";
import { v7 as uuidv7 } from "uuid";
import { assertTrustedMutationRequest, getAdminActor } from "@/server/admin-auth";
import { CANONICAL_RESOURCE_TYPES } from "@/server/canonical-content/change-adapters";
import { CanonicalContentError } from "@/server/canonical-content/errors";
import { getChangeManagementService, type ChangeOperation } from "@/server/change-management";
import { contentApiError, contentJson, requireCanonicalAdmin } from "../_shared";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireCanonicalAdmin(request);
    const body = await request.json() as Record<string, unknown>;
    if (!Array.isArray(body.initialItems) || body.initialItems.length < 1 || body.initialItems.length > 100) throw new Error("INVALID_CANONICAL_CHANGE_ITEMS");
    const initialItems = body.initialItems.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_CANONICAL_CHANGE_ITEM");
      const item = raw as Record<string, unknown>;
      if (!CANONICAL_RESOURCE_TYPES.includes(item.resourceType as (typeof CANONICAL_RESOURCE_TYPES)[number])) throw new Error("INVALID_CANONICAL_RESOURCE_TYPE");
      if (item.resourceType === "platform.runtime-content") throw new CanonicalContentError("CANONICAL_AUTHORIZATION_FAILED", "Runtime cutover is available only through the dedicated OWNER endpoint.");
      const operation: ChangeOperation = item.operation === "CREATE" ? "CREATE" : "UPDATE";
      return { resourceType: String(item.resourceType), resourceId: operation === "CREATE" ? uuidv7() : String(item.resourceId ?? ""), expectedRevision: operation === "CREATE" ? 0 : Number(item.expectedRevision), desired: item.desired, operation };
    });
    const details = getChangeManagementService().createChangeSet({ title: typeof body.title === "string" ? body.title : "تحديث المحتوى", description: typeof body.description === "string" ? body.description : undefined, initialItems }, getAdminActor(authentication));
    return contentJson({ ok: true, changeSet: details }, { status: 201 });
  } catch (error) { return contentApiError(error); }
}
