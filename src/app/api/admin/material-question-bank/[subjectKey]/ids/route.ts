import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest, getAdminActor } from "@/server/admin-auth";
import { getMaterialQuestionBankService } from "@/server/material-question-bank";
import { materialBankApiError, materialBankJson, requireMaterialBankAdmin } from "../../_shared";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = requireMaterialBankAdmin(request);
    return materialBankJson({ ok: true, id: getMaterialQuestionBankService().prepareNodeId(getAdminActor(authentication)) });
  } catch (error) { return materialBankApiError(error); }
}
