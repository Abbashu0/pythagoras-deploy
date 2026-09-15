import type { NextRequest } from "next/server";

import { AIAdminDirectService } from "@/server/ai/admin-direct-service";
import { getContentDatabase } from "@/server/content";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
} from "../../../../_shared";
import { assertFields, requiredRevision, requiredText } from "../../../_helpers";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ providerId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const actor = requireLocalAdminMutation(request);
    const { providerId } = await context.params;
    const body = await readLocalJsonBody(request);
    assertFields(body, ["apiKey", "expectedRevision"]);
    const provider = await AIAdminDirectService.forDatabase(
      getContentDatabase(),
    ).replaceCredential({
      providerId,
      apiKey: requiredText(body, "apiKey"),
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
    const provider = await AIAdminDirectService.forDatabase(
      getContentDatabase(),
    ).revokeCredential({
      providerId,
      expectedRevision: requiredRevision(body),
      actor,
    });
    return localJson({ ok: true, provider });
  } catch (error) {
    return localApiError(error);
  }
}
