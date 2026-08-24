import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest } from "@/server/admin-auth";
import { getQuestionEditorService } from "@/server/question-editor";
import { questionEditorApiError, questionEditorJson, readQuestionEditorBody, requireQuestionEditorAdmin } from "../../../_shared";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    assertTrustedMutationRequest(request);
    requireQuestionEditorAdmin(request);
    const body = await readQuestionEditorBody(request);
    return questionEditorJson({ ok: true, ids: getQuestionEditorService().prepareIds({ blocks: number(body.blocks), verses: number(body.verses), occurrences: number(body.occurrences), taxonomy: number(body.taxonomy), browse: number(body.browse) }) });
  } catch (error) { return questionEditorApiError(error); }
}
function number(value: unknown) { return typeof value === "number" ? value : 0; }
