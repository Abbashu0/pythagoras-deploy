import type { NextRequest } from "next/server";
import { LOCAL_ADMIN_OPERATOR_ID } from "@/server/admin-auth";
import { getDirectQuestionPackageService } from "@/server/question-import";
import { localApiError, localJson, requireLocalAdminRead } from "../../../_shared";

export const runtime = "nodejs";

const LOCAL_ACTOR = { actorUserId: LOCAL_ADMIN_OPERATOR_ID, actorRole: "ADMIN" as const };

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    requireLocalAdminRead(request);
    const preflight = await getDirectQuestionPackageService().inspect(
      (await context.params).assetId,
      LOCAL_ACTOR,
    );
    const { existingChangeSetId: _existingChangeSetId, ...safePreflight } = preflight;
    return localJson({ ok: true, preflight: safePreflight });
  } catch (error) {
    return localApiError(error);
  }
}
