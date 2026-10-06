import type { NextRequest } from "next/server";

import { AIAgent1RuntimeError } from "@/server/ai/agent-1-runtime/errors";
import { AIAgent1RuntimeService } from "@/server/ai/agent-1-runtime/service";
import { getContentDatabase } from "@/server/content";
import {
  localApiError,
  localJson,
  readLocalJsonBody,
  requireLocalAdminMutation,
  requireLocalAdminRead,
} from "../../../_shared";
import { assertFields } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    requireLocalAdminRead(request);
    const snapshot = AIAgent1RuntimeService.forDatabase(
      getContentDatabase(), { executionBoundary: "DEVELOPMENT_STATELESS_CHAT" },
    ).getSnapshot();
    return localJson({ ok: true, ...snapshot });
  } catch (error) {
    return localApiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    assertFields(body, [
      "expectedRevision",
      "primaryModelConfigId",
      "fallbackModelConfigIds",
    ]);
    if (
      !Object.hasOwn(body, "primaryModelConfigId") ||
      (body.primaryModelConfigId !== null &&
        typeof body.primaryModelConfigId !== "string") ||
      !Array.isArray(body.fallbackModelConfigIds) ||
      body.fallbackModelConfigIds.some((id) => typeof id !== "string")
    ) {
      throw new AIAgent1RuntimeError(
        "AI_AGENT_1_RUNTIME_INVALID",
        "The Agent 1 route payload is invalid.",
      );
    }
    const snapshot = AIAgent1RuntimeService.forDatabase(
      getContentDatabase(), { executionBoundary: "DEVELOPMENT_STATELESS_CHAT" },
    ).saveRoute({
      actor,
      expectedRevision: requiredAgent1Revision(body.expectedRevision),
      primaryModelConfigId: body.primaryModelConfigId as string | null,
      fallbackModelConfigIds: body.fallbackModelConfigIds as string[],
    });
    return localJson({ ok: true, ...snapshot });
  } catch (error) {
    return localApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    assertFields(body, ["enabled", "expectedRevision"]);
    if (typeof body.enabled !== "boolean") {
      throw new AIAgent1RuntimeError(
        "AI_AGENT_1_RUNTIME_INVALID",
        "The Agent 1 enabled payload is invalid.",
      );
    }
    const snapshot = AIAgent1RuntimeService.forDatabase(
      getContentDatabase(), { executionBoundary: "DEVELOPMENT_STATELESS_CHAT" },
    ).setEnabled({
      actor,
      enabled: body.enabled,
      expectedRevision: requiredAgent1Revision(body.expectedRevision),
    });
    return localJson({ ok: true, ...snapshot });
  } catch (error) {
    return localApiError(error);
  }
}

function requiredAgent1Revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new AIAgent1RuntimeError(
      "AI_AGENT_1_RUNTIME_INVALID",
      "A valid non-negative expectedRevision is required.",
    );
  }
  return value as number;
}
