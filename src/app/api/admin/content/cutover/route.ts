import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminActor } from "@/server/admin-auth";
import { getCanonicalContentRepository } from "@/server/canonical-content";
import { getChangeManagementService } from "@/server/change-management";
import { contentApiError, contentJson, requireCanonicalOwner } from "../_shared";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireCanonicalOwner(request);
    const snapshot = getCanonicalContentRepository().getSnapshot();
    if (snapshot.state.runtimeSourceMode === "CANONICAL") return contentJson({ ok: true, alreadyCanonical: true });
    const details = getChangeManagementService().createChangeSet({
      title: "تفعيل المحتوى القانوني لتطبيق الطالب",
      description: "تحويل مصدر قراءة تطبيق الطالب من بيانات المتصفح القديمة إلى المحتوى المنشور في SQLite.",
      submit: true,
      initialItem: { resourceType: "platform.runtime-content", resourceId: "global", expectedRevision: snapshot.state.revision, desired: { runtimeSourceMode: "CANONICAL" } },
    }, getAdminActor(authentication));
    return contentJson({ ok: true, changeSet: details }, { status: 201 });
  } catch (error) { return contentApiError(error); }
}
