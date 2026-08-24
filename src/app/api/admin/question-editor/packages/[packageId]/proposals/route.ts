import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminActor } from "@/server/admin-auth";
import { getQuestionEditorService, QUESTION_EDITOR_RESOURCE_TYPES, type QuestionEditorProposal, QuestionEditorError } from "@/server/question-editor";
import { questionEditorApiError, questionEditorJson, readQuestionEditorBody, requireQuestionEditorAdmin } from "../../../_shared";

export const runtime = "nodejs";
export async function PUT(request: NextRequest, context: { params: Promise<{ packageId: string }> }) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireQuestionEditorAdmin(request);
    const { packageId } = await context.params;
    const body = await readQuestionEditorBody(request);
    if (typeof body.resourceType !== "string" || !QUESTION_EDITOR_RESOURCE_TYPES.includes(body.resourceType as never) || typeof body.resourceId !== "string" || !body.desired || typeof body.desired !== "object" || Array.isArray(body.desired)) {
      throw new QuestionEditorError("QUESTION_EDITOR_INVALID", "Question editor proposal is invalid.");
    }
    const proposal = { resourceType: body.resourceType, resourceId: body.resourceId, desired: body.desired } as QuestionEditorProposal;
    return questionEditorJson({ ok: true, draft: getQuestionEditorService().save(packageId, proposal, getAdminActor(authentication)) });
  } catch (error) { return questionEditorApiError(error); }
}
