import type { NextRequest } from "next/server";

import { AIAdminDirectService } from "@/server/ai/admin-direct-service";
import { getContentDatabase } from "@/server/content";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
  requireLocalAdminRead,
} from "../../../../_shared";
import { assertFields, requiredNumber, requiredText } from "../../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ providerId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    requireLocalAdminRead(request);
    const { providerId } = await context.params;
    const models = AIAdminDirectService.forDatabase(getContentDatabase()).listModels(providerId);
    return localJson({ ok: true, models });
  } catch (error) {
    return localApiError(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const actor = requireLocalAdminMutation(request);
    const { providerId } = await context.params;
    const body = await readLocalJsonBody(request);
    assertFields(body, ["providerModelId", "contextWindowTokens", "maxOutputTokens", "inputModalities"]);
    const model = AIAdminDirectService.forDatabase(getContentDatabase()).createModel({
      providerId,
      providerModelId: requiredText(body, "providerModelId"),
      contextWindowTokens: requiredNumber(body, "contextWindowTokens"),
      maxOutputTokens: requiredNumber(body, "maxOutputTokens"),
      inputModalities: body.inputModalities,
      actor,
    });
    return localJson({ ok: true, model }, { status: 201 });
  } catch (error) {
    return localApiError(error);
  }
}
