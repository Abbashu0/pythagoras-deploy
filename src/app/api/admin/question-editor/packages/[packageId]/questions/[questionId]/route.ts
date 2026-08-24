import type { NextRequest } from "next/server";
import { getAdminActor } from "@/server/admin-auth";
import { getQuestionEditorService } from "@/server/question-editor";
import { questionEditorApiError, questionEditorJson, requireQuestionEditorAdmin } from "../../../../_shared";

export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ packageId: string; questionId: string }> }) {
  try {
    const authentication = requireQuestionEditorAdmin(request);
    const { packageId, questionId } = await context.params;
    return questionEditorJson({ ok: true, question: getQuestionEditorService().getQuestion(packageId, questionId, getAdminActor(authentication)) });
  } catch (error) { return questionEditorApiError(error); }
}
