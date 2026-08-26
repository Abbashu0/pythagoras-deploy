import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminActor } from "@/server/admin-auth";
import { getMaterialQuestionBankService } from "@/server/material-question-bank";
import { materialBankApiError, materialBankJson, readMaterialBankBody, requireMaterialBankAdmin } from "../../_shared";

export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ subjectKey: string }> }) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireMaterialBankAdmin(request);
    const { subjectKey } = await context.params;
    const body = await readMaterialBankBody(request);
    return materialBankJson({ ok: true, changeSet: getMaterialQuestionBankService().submit(subjectKey, Number(body.expectedRevision), getAdminActor(authentication)) });
  } catch (error) { return materialBankApiError(error); }
}
