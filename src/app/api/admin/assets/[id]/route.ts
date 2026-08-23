import type { NextRequest } from "next/server";
import { getAssetService, toSafeAssetWithCreator } from "@/server/assets";
import { getCanonicalContentRepository } from "@/server/canonical-content";
import { getQuestionPackageInspectionService } from "@/server/question-packages";
import {
  assetApiErrorResponse,
  noStoreAssetJson,
  requireAssetApiAdmin,
} from "../_shared";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireAssetApiAdmin(request);
    const { id } = await context.params;
    const asset = getAssetService().getByIdWithCreator(id);
    return noStoreAssetJson({
      ok: true,
      asset: {
        ...toSafeAssetWithCreator(asset),
        questionPackageInspection:
          asset.asset.mediaKind === "json"
            ? await getQuestionPackageInspectionService().inspectAsset(id)
            : null,
      },
      usage: getCanonicalContentRepository().getAssetUsage(id),
    });
  } catch (error) {
    return assetApiErrorResponse(error);
  }
}
