import type { NextRequest } from "next/server";
import { getAdminActor } from "@/server/admin-auth";
import { getQuestionEditorService } from "@/server/question-editor";
import { questionEditorApiError, questionEditorJson, requireQuestionEditorAdmin } from "../_shared";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const authentication = requireQuestionEditorAdmin(request);
    return questionEditorJson({ ok: true, ...getQuestionEditorService().listPackages(getAdminActor(authentication)) });
  } catch (error) { return questionEditorApiError(error); }
}
