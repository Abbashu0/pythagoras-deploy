import { getMaterialQuestionBankService } from "@/server/material-question-bank";
import { integerQuery, publicQuestionBankError, publicQuestionBankJson } from "../../../../_shared";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ subjectKey: string; bankNodeId: string }> }) {
  try {
    const { subjectKey, bankNodeId } = await context.params;
    const url = new URL(request.url);
    const page = getMaterialQuestionBankService().listPublicQuestions(subjectKey, bankNodeId, integerQuery(url.searchParams.get("offset"), 0), integerQuery(url.searchParams.get("limit"), 50));
    return publicQuestionBankJson({ ok: true, page });
  } catch (error) { return publicQuestionBankError(error); }
}
