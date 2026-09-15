import type { NextRequest } from "next/server";

import { AI_PROVIDER_API_FORMATS, AI_PROVIDER_API_FORMAT_LABELS } from "@/lib/ai-provider-format";
import { AIAdminDirectService } from "@/server/ai/admin-direct-service";
import { getContentDatabase } from "@/server/content";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
  requireLocalAdminRead,
} from "../../_shared";
import { assertFields, requiredText } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    requireLocalAdminRead(request);
    const service = AIAdminDirectService.forDatabase(getContentDatabase());
    return localJson({
      ok: true,
      providers: service.listProviders(),
      apiFormats: AI_PROVIDER_API_FORMATS,
      apiFormatLabels: AI_PROVIDER_API_FORMAT_LABELS,
    });
  } catch (error) {
    return localApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    assertFields(body, ["displayName", "baseUrl", "apiFormat", "apiKey"]);
    const provider = await AIAdminDirectService.forDatabase(
      getContentDatabase(),
    ).createProvider({
      displayName: requiredText(body, "displayName"),
      baseUrl: requiredText(body, "baseUrl"),
      apiFormat: body.apiFormat,
      apiKey: requiredText(body, "apiKey"),
      actor,
    });
    return localJson({ ok: true, provider }, { status: 201 });
  } catch (error) {
    return localApiError(error);
  }
}
