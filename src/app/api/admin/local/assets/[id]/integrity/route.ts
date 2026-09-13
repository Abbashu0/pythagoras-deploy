import type { NextRequest } from "next/server";
import { getAssetService } from "@/server/assets";
import { localApiError, localJson, requireLocalAdminRead } from "../../../_shared";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireLocalAdminRead(request);
    const result = await getAssetService().verifyIntegrity((await context.params).id);
    return localJson({
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
    return localApiError(error);
  }
}
