import type { NextRequest } from "next/server";
import { AdminValidationError, getLocalAdminActor } from "@/server/admin-auth";
import { getDirectMaterialQuestionBankService } from "@/server/material-question-bank";
import { getContentDatabase } from "@/server/content";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
  requireLocalAdminRead,
} from "../../../../_shared";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ subjectKey: string }> },
) {
  try {
    requireLocalAdminRead(request);
    const database = getContentDatabase();
    const actor = getLocalAdminActor(database);
    const workspace = getDirectMaterialQuestionBankService().getWorkspace(
      (await context.params).subjectKey,
      actor,
    );
    return localJson({ ok: true, workspace });
  } catch (error) {
    return localApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ subjectKey: string }> },
) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    const allowed = new Set([
      "layout",
      "expectedRevision",
      "packageSources",
      "acknowledgeWarnings",
      "acknowledgeCrossSubject",
    ]);
    if (Object.keys(body).some((key) => !allowed.has(key))) {
      throw new AdminValidationError("Material Question Bank request contains unsupported fields.");
    }
    if (!("layout" in body) || !("expectedRevision" in body)) {
      throw new AdminValidationError("Material Question Bank layout and revision are required.");
    }
    const workspace = await getDirectMaterialQuestionBankService().save(
      (await context.params).subjectKey,
      body.layout,
      body.expectedRevision,
      body.packageSources ?? [],
      {
        acknowledgeWarnings: body.acknowledgeWarnings === true,
        acknowledgeCrossSubject: body.acknowledgeCrossSubject === true,
      },
      actor,
    );
    return localJson({ ok: true, workspace });
  } catch (error) {
    return localApiError(error);
  }
}
