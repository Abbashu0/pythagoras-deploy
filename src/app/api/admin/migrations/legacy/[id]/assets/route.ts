import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest } from "@/server/admin-auth";
import { parseAssetUpload, removeParsedAssetUpload, resolveMaximumAssetBytes } from "@/server/assets";
import { getContentDatabase } from "@/server/content";
import { getLegacyMigrationService } from "@/server/legacy-migration";
import { legacyErrorResponse, legacyJson, requireLegacyOwner } from "../../_shared";

export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  let stagedPath: string | undefined;
  try {
    assertTrustedMutationRequest(request); const actor = requireLegacyOwner(request); const { id } = await context.params;
    const upload = await parseAssetUpload(request, getContentDatabase().paths.tempDirectory, resolveMaximumAssetBytes(), { additionalFields: ["expectedRevision", "legacyReference", "sourceKind", "referenceContexts"] });
    stagedPath = upload.filePath;
    const fields = upload.fields ?? {};
    const contexts = JSON.parse(fields.referenceContexts ?? "[]") as unknown;
    if (!Array.isArray(contexts) || contexts.some((value) => typeof value !== "string")) throw new Error("INVALID_JSON");
    const result = await getLegacyMigrationService().stageAsset({ runId: id, expectedRevision: Number(fields.expectedRevision), legacyReference: fields.legacyReference ?? "", sourceKind: fields.sourceKind as "INDEXED_DB" | "INLINE", referenceContexts: contexts, filePath: upload.filePath, originalFilename: upload.originalFilename, displayName: upload.displayName ?? upload.originalFilename, actor });
    return legacyJson({ ok: true, run: result.run, mapping: result.mapping, assetId: result.assetId, reused: result.reused });
  } catch (error) { return legacyErrorResponse(error); }
  finally { if (stagedPath) await removeParsedAssetUpload(stagedPath); }
}
