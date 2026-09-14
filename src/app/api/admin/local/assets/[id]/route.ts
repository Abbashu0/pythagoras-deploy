import type { NextRequest } from "next/server";
import { AdminValidationError, LOCAL_ADMIN_OPERATOR_ID } from "@/server/admin-auth";
import { getAssetService } from "@/server/assets";
import { getContentDatabase } from "@/server/content";
import { toLocalAdminAssetView } from "@/server/assets/admin-view";
import { getQuestionPackageInspectionService } from "@/server/question-packages";
import { getDirectQuestionPackageService, type QuestionPackageImportPreflight } from "@/server/question-import";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
  requireLocalAdminRead,
} from "../../_shared";

export const runtime = "nodejs";

async function inspectQuestionPackage(assetId: string) {
  try {
    return await getQuestionPackageInspectionService().inspectAsset(assetId);
  } catch {
    return null;
  }
}

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
  const asset = await toLocalAdminAssetView(
    database,
    service,
    record,
    record.asset.mediaKind === "json"
      ? await inspectQuestionPackage(record.asset.id)
      : null,
  );
  const integrity = await service.verifyIntegrity(record.asset);
  let questionPackagePreflight: QuestionPackageImportPreflight | null = null;
  if (record.asset.mediaKind === "json") {
    try {
      questionPackagePreflight = await getDirectQuestionPackageService().inspect(id, {
        actorUserId: LOCAL_ADMIN_OPERATOR_ID,
        actorRole: "ADMIN",
      });
    } catch {
      questionPackagePreflight = null;
    }
  }
  if (questionPackagePreflight) {
    const { existingChangeSetId: _existingChangeSetId, ...safePreflight } = questionPackagePreflight;
    return { asset, usage: { references: asset.references }, integrity, questionPackagePreflight: safePreflight };
  }
  return { asset, usage: { references: asset.references }, integrity, questionPackagePreflight: null };
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
