import type { NextRequest } from "next/server";
import { getAdminActor } from "@/server/admin-auth";
import { getQuestionEditorService } from "@/server/question-editor";
import { questionEditorApiError, questionEditorJson, requireQuestionEditorAdmin } from "../../../_shared";

export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ packageId: string }> }) {
  try {
    const authentication = requireQuestionEditorAdmin(request);
    const { packageId } = await context.params;
    const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
    return questionEditorJson({ ok: true, ...getQuestionEditorService().listQuestions(packageId, getAdminActor(authentication), offset, limit) });
  } catch (error) { return questionEditorApiError(error); }
}
