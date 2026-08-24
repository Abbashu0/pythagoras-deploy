import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminActor } from "@/server/admin-auth";
import { getChangeManagementService } from "@/server/change-management";
import { getContentDatabase } from "@/server/content";
import { createPreCutoverBackup } from "@/server/canonical-content/backup";
import { changeApiError, changeJson, integer, readChangeJson, requireChangeAdmin, requireChangeOwner } from "../_shared";

type Transition = "submit" | "requestChanges" | "reject" | "approve" | "publish" | "cancel" | "rebase";

export async function runTransition(request: NextRequest, id: string, transition: Transition) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = transition === "requestChanges" || transition === "reject" || transition === "approve" || transition === "publish"
      ? requireChangeOwner(request)
      : requireChangeAdmin(request);
    const body = await readChangeJson(request);
    const service = getChangeManagementService();
    const actor = getAdminActor(authentication);
    const revision = integer(body.expectedRevision);
    if (transition === "publish") {
      const details = service.getDetails(id, actor);
      if (details.items.some((item) => item.resourceType === "platform.runtime-content")) {
        await createPreCutoverBackup(getContentDatabase());
      }
    }
    if (transition === "publish") {
      const result = service.publish(id, revision, actor);
      if (request.nextUrl.searchParams.get("compact") === "1") {
        return changeJson({ ok: true, result: { changeSet: result.changeSet.changeSet, itemCount: result.changeSet.itemCount, areaLabels: result.changeSet.areaLabels, publicationRevision: result.publicationRevision } });
      }
      return changeJson({ ok: true, ...result });
    }
    const result = transition === "submit" ? service.submit(id, revision, actor)
      : transition === "requestChanges" ? service.requestChanges(id, revision, typeof body.note === "string" ? body.note : "", actor)
        : transition === "reject" ? service.reject(id, revision, typeof body.reason === "string" ? body.reason : "", actor)
          : transition === "approve" ? service.approve(id, revision, actor)
            : transition === "cancel" ? service.cancel(id, revision, actor)
              : service.rebase(id, revision, actor);
    if (request.nextUrl.searchParams.get("compact") === "1") {
      return changeJson({ ok: true, result: { changeSet: result.changeSet, itemCount: result.itemCount, areaLabels: result.areaLabels } });
    }
    return changeJson({ ok: true, changeSet: result });
  } catch (error) {
    return changeApiError(error);
  }
}
