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
import { assertFields, requiredRevision, requiredText } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ providerId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    requireLocalAdminRead(request);
    const { providerId } = await context.params;
    const provider = AIAdminDirectService.forDatabase(getContentDatabase()).getProvider(providerId);
    return localJson({ ok: true, provider });
  } catch (error) {
    return localApiError(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const actor = requireLocalAdminMutation(request);
    const { providerId } = await context.params;
    const body = await readLocalJsonBody(request);
    const service = AIAdminDirectService.forDatabase(getContentDatabase());
    if (typeof body.enabled === "boolean") {
      assertFields(body, ["enabled", "expectedRevision"]);
      const provider = service.setProviderEnabled({
        providerId,
        enabled: body.enabled,
        expectedRevision: requiredRevision(body),
        actor,
      });
      return localJson({ ok: true, provider });
    }
    assertFields(body, ["displayName", "baseUrl", "apiFormat", "expectedRevision"]);
    const provider = service.updateProvider({
      providerId,
      displayName: requiredText(body, "displayName"),
      baseUrl: requiredText(body, "baseUrl"),
      apiFormat: body.apiFormat,
      expectedRevision: requiredRevision(body),
      actor,
    });
    return localJson({ ok: true, provider });
  } catch (error) {
    return localApiError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const actor = requireLocalAdminMutation(request);
    const { providerId } = await context.params;
    const body = await readLocalJsonBody(request);
    assertFields(body, ["expectedRevision"]);
    await AIAdminDirectService.forDatabase(getContentDatabase()).deleteProvider({
      providerId,
      expectedRevision: requiredRevision(body),
      actor,
    });
    return localJson({ ok: true, providerId });
  } catch (error) {
    return localApiError(error);
  }
}
