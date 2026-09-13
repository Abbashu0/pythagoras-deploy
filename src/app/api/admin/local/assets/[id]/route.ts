import type { NextRequest } from "next/server";
import { AdminValidationError } from "@/server/admin-auth";
import { getAssetService } from "@/server/assets";
import { getContentDatabase } from "@/server/content";
import { toLocalAdminAssetView } from "@/server/assets/admin-view";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
  requireLocalAdminRead,
} from "../../_shared";

export const runtime = "nodejs";

function expectedRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new AdminValidationError("Asset revision is invalid.");
  }
  return value;
}

async function detail(id: string) {
  const database = getContentDatabase();
  const service = getAssetService();
  const record = service.getByIdWithCreator(id);
  const asset = await toLocalAdminAssetView(database, service, record);
  const integrity = await service.verifyIntegrity(record.asset);
  return { asset, usage: { references: asset.references }, integrity };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireLocalAdminRead(request);
    return localJson({ ok: true, ...(await detail((await context.params).id)) });
  } catch (error) {
    return localApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    const keys = Object.keys(body).sort().join(",");
    if (keys !== "displayName,expectedRevision") {
      throw new AdminValidationError("Asset update contains unsupported fields.");
    }
    if (typeof body.displayName !== "string") {
      throw new AdminValidationError("Asset display name is invalid.");
    }
    const id = (await context.params).id;
    const service = getAssetService();
    service.updateDisplayName(
      id,
      body.displayName,
      expectedRevision(body.expectedRevision),
      actor,
    );
    return localJson({ ok: true, ...(await detail(id)) });
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
      throw new AdminValidationError("Asset delete contains unsupported fields.");
    }
    const result = await getAssetService().delete(
      (await context.params).id,
      expectedRevision(body.expectedRevision),
      actor,
    );
    return localJson({ ok: true, deleted: true, storageCleanup: result.storageCleanup });
  } catch (error) {
    return localApiError(error);
  }
}
