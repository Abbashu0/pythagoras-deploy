import type { NextRequest } from "next/server";
import { getAssetService } from "@/server/assets";
import {
  assetApiErrorResponse,
  noStoreAssetJson,
  requireAssetApiAdmin,
} from "../../_shared";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireAssetApiAdmin(request);
    const { id } = await context.params;
    const result = await getAssetService().verifyIntegrity(id);
    return noStoreAssetJson({
      ok: true,
      integrity: {
        assetId: result.assetId,
        healthy: result.ok,
        status: result.status,
        expectedByteSize: result.expectedByteSize,
        actualByteSize: result.actualByteSize,
      },
    });
  } catch (error) {
    return assetApiErrorResponse(error);
  }
}
