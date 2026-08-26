import { getMaterialQuestionBankService } from "@/server/material-question-bank";
import { integerQuery, publicQuestionBankError, publicQuestionBankJson } from "../../../../_shared";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ subjectKey: string; bankNodeId: string }> }) {
  try {
    const { subjectKey, bankNodeId } = await context.params;
    const url = new URL(request.url);
    const result = getMaterialQuestionBankService().searchPublicQuestions(
      subjectKey,
      bankNodeId,
      url.searchParams.get("q") ?? "",
      integerQuery(url.searchParams.get("offset"), 0),
      integerQuery(url.searchParams.get("limit"), 25),
    );
    return publicQuestionBankJson({ ok: true, ...result });
  } catch (error) { return publicQuestionBankError(error); }
}
