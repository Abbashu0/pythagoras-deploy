import type { NextRequest } from "next/server";
import { getAdminActor } from "@/server/admin-auth";
import { getQuestionEditorService } from "@/server/question-editor";
import { questionEditorApiError, questionEditorJson, requireQuestionEditorAdmin } from "../../_shared";

export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ packageId: string }> }) {
  try {
    const authentication = requireQuestionEditorAdmin(request);
    const { packageId } = await context.params;
    return questionEditorJson({ ok: true, workspace: getQuestionEditorService().getPackage(packageId, getAdminActor(authentication)) });
  } catch (error) { return questionEditorApiError(error); }
}
