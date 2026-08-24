import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminActor } from "@/server/admin-auth";
import { getQuestionPackageImportService, QuestionImportError } from "@/server/question-import";
import { questionApiError, questionJson, readQuestionBody, requireQuestionAdmin } from "../_shared";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireQuestionAdmin(request);
    const body = await readQuestionBody(request);
    if (typeof body.assetId !== "string") throw new QuestionImportError("QUESTION_IMPORT_INVALID", "Asset ID is invalid.");
    const result = await getQuestionPackageImportService().stage(body.assetId, body.acknowledgeWarnings === true, getAdminActor(authentication));
    return questionJson({ ok: true, result });
  } catch (error) { return questionApiError(error); }
}
