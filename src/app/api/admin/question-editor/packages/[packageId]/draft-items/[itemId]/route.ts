import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminActor } from "@/server/admin-auth";
import { getQuestionEditorService } from "@/server/question-editor";
import { questionEditorApiError, questionEditorJson, requireQuestionEditorAdmin } from "../../../../_shared";

export const runtime = "nodejs";
export async function DELETE(request: NextRequest, context: { params: Promise<{ packageId: string; itemId: string }> }) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireQuestionEditorAdmin(request);
    const { packageId, itemId } = await context.params;
    return questionEditorJson({ ok: true, draft: getQuestionEditorService().removeDraftOnly(packageId, itemId, getAdminActor(authentication)) });
  } catch (error) { return questionEditorApiError(error); }
}
