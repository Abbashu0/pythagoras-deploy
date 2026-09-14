import type { NextRequest } from "next/server";
import { AdminValidationError } from "@/server/admin-auth";
import { getDirectMaterialService } from "@/server/canonical-content";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
  requireLocalAdminRead,
} from "../../../_shared";

export const runtime = "nodejs";

const SETTINGS_FIELDS = new Set([
  "fadeIntensity",
  "textVerticalPosition",
  "textScale",
  "cardHeight",
  "expectedRevision",
]);

export async function GET(request: NextRequest) {
  try {
    requireLocalAdminRead(request);
    return localJson({ ok: true, settings: getDirectMaterialService().getSettings() });
  } catch (error) {
    return localApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    if (Object.keys(body).some((key) => !SETTINGS_FIELDS.has(key))) {
      throw new AdminValidationError("Material settings contain unsupported fields.");
    }
    if (!("expectedRevision" in body)) {
      throw new AdminValidationError("Material settings revision is required.");
    }
    const { expectedRevision, ...input } = body;
    return localJson({
      ok: true,
      settings: getDirectMaterialService().updateSettings(input, expectedRevision, actor),
    });
  } catch (error) {
    return localApiError(error);
  }
}
