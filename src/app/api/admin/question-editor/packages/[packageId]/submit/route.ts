import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminActor } from "@/server/admin-auth";
import { getQuestionEditorService } from "@/server/question-editor";
import { questionEditorApiError, questionEditorJson, readQuestionEditorBody, requireQuestionEditorAdmin } from "../../../_shared";

export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ packageId: string }> }) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireQuestionEditorAdmin(request);
    const { packageId } = await context.params;
    const body = await readQuestionEditorBody(request);
    return questionEditorJson({ ok: true, changeSet: getQuestionEditorService().submit(packageId, Number(body.expectedRevision), getAdminActor(authentication)) });
  } catch (error) { return questionEditorApiError(error); }
}
