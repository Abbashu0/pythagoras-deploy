import type { NextRequest } from "next/server";
import { AdminValidationError } from "@/server/admin-auth";
import {
  CanonicalContentError,
  getDirectMaterialService,
} from "@/server/canonical-content";
import { getCanonicalContentRepository } from "@/server/canonical-content";
import { getContentDatabase } from "@/server/content";
import { toLocalAdminMaterialView } from "@/server/canonical-content/admin-view";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
  requireLocalAdminRead,
} from "../../../_shared";

export const runtime = "nodejs";

const UPDATE_FIELDS = new Set([
  "label",
  "englishTitle",
  "available",
  "assetId",
  "offsetX",
  "offsetY",
  "scale",
  "expectedRevision",
]);

async function view(subjectKey: string) {
  const database = getContentDatabase();
  const material = getCanonicalContentRepository()
    .getSnapshot()
    .materials.find((item) => item.subjectKey === subjectKey);
  if (!material) {
    throw new CanonicalContentError("CANONICAL_NOT_FOUND", "The material was not found.");
  }
  return toLocalAdminMaterialView(database, material);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ subjectKey: string }> },
) {
  try {
    requireLocalAdminRead(request);
    return localJson({
      ok: true,
      material: await view((await context.params).subjectKey),
    });
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
    if (Object.keys(body).some((key) => !UPDATE_FIELDS.has(key))) {
      throw new AdminValidationError("Material request contains unsupported fields.");
    }
    if (!("expectedRevision" in body)) {
      throw new AdminValidationError("Material revision is required.");
    }
    const { expectedRevision, ...input } = body;
    getDirectMaterialService().update(
      (await context.params).subjectKey,
      input,
      expectedRevision,
      actor,
    );
    return localJson({
      ok: true,
      material: await view((await context.params).subjectKey),
    });
  } catch (error) {
    return localApiError(error);
  }
}
