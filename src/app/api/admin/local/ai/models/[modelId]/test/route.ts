import type { NextRequest } from "next/server";

import { AIAdminDirectService } from "@/server/ai/admin-direct-service";
import { getContentDatabase } from "@/server/content";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
} from "../../../../_shared";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ modelId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    requireLocalAdminMutation(request);
    await readLocalJsonBody(request);
    const { modelId } = await context.params;
    const result = await AIAdminDirectService.forDatabase(getContentDatabase()).testModel(modelId);
    // A failed diagnostic is a valid test result, not a malformed Admin API
    // request; keep it in the bounded result DTO so the UI can show a mapped
    // operator-facing reason without exposing provider response content.
    return localJson({ ok: true, result });
  } catch (error) {
    return localApiError(error);
  }
}
