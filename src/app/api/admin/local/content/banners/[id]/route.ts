import type { NextRequest } from "next/server";
import { AdminValidationError } from "@/server/admin-auth";
import { getDirectBannerService } from "@/server/canonical-content";
import { toLocalAdminBannerView } from "../_view";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
} from "../../../_shared";

export const runtime = "nodejs";

const UPDATE_FIELDS = new Set([
  "title",
  "assetId",
  "startsAt",
  "endsAt",
  "offsetX",
  "offsetY",
  "scale",
  "enabled",
  "expectedRevision",
]);

function expectedRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new AdminValidationError("Banner revision is invalid.");
  }
  return value;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    if (Object.keys(body).some((key) => !UPDATE_FIELDS.has(key))) {
      throw new AdminValidationError("Banner request contains unsupported fields.");
    }
    if (!("expectedRevision" in body)) {
      throw new AdminValidationError("Banner revision is required.");
    }
    const { id } = await context.params;
    const { expectedRevision: revision, ...input } = body;
    const banner = getDirectBannerService().update(
      id,
      input,
      expectedRevision(revision),
      actor,
    );
    return localJson({ ok: true, banner: await toLocalAdminBannerView(banner) });
  } catch (error) {
    return localApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    if (Object.keys(body).length !== 1 || !("expectedRevision" in body)) {
      throw new AdminValidationError("Banner revision is required.");
    }
    getDirectBannerService().delete(
      (await context.params).id,
      expectedRevision(body.expectedRevision),
      actor,
    );
    return localJson({ ok: true, deleted: true });
  } catch (error) {
    return localApiError(error);
  }
}
