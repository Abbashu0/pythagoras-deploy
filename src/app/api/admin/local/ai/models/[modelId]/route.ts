import type { NextRequest } from "next/server";

import { AIAdminDirectService } from "@/server/ai/admin-direct-service";
import { getContentDatabase } from "@/server/content";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
  requireLocalAdminRead,
} from "../../../_shared";
import { assertFields, requiredNumber, requiredRevision, requiredText } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ modelId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    requireLocalAdminRead(request);
    const { modelId } = await context.params;
    const model = AIAdminDirectService.forDatabase(getContentDatabase()).getModel(modelId);
    return localJson({ ok: true, model });
  } catch (error) {
    return localApiError(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const actor = requireLocalAdminMutation(request);
    const { modelId } = await context.params;
    const body = await readLocalJsonBody(request);
    const service = AIAdminDirectService.forDatabase(getContentDatabase());
    if (typeof body.enabled === "boolean") {
      assertFields(body, ["enabled", "expectedRevision"]);
      const model = service.setModelEnabled({
        modelId,
        enabled: body.enabled,
        expectedRevision: requiredRevision(body),
        actor,
      });
      return localJson({ ok: true, model });
    }
    assertFields(body, ["providerModelId", "contextWindowTokens", "maxOutputTokens", "inputModalities", "expectedRevision"]);
    const model = service.updateModel({
      modelId,
      providerModelId: requiredText(body, "providerModelId"),
      contextWindowTokens: requiredNumber(body, "contextWindowTokens"),
      maxOutputTokens: requiredNumber(body, "maxOutputTokens"),
      inputModalities: body.inputModalities,
      expectedRevision: requiredRevision(body),
      actor,
    });
    return localJson({ ok: true, model });
  } catch (error) {
    return localApiError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    requireLocalAdminMutation(request);
    const { modelId } = await context.params;
    const body = await readLocalJsonBody(request);
    assertFields(body, ["expectedRevision"]);
    AIAdminDirectService.forDatabase(getContentDatabase()).deleteModel({
      modelId,
      expectedRevision: requiredRevision(body),
    });
    return localJson({ ok: true, modelId });
  } catch (error) {
    return localApiError(error);
  }
}
