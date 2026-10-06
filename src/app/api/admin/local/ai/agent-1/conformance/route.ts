import type { NextRequest } from "next/server";
import { Agent1InstructionConformanceService } from "@/server/ai/agent-1-runtime/instruction-conformance-service";
import { AIAgent1RuntimeService } from "@/server/ai/agent-1-runtime/service";
import { AIAgent1RuntimeError } from "@/server/ai/agent-1-runtime/errors";
import { getContentDatabase } from "@/server/content";
import { localApiError, localJson, readLocalJsonBody, requireLocalAdminMutation } from "../../../_shared";
import { assertFields } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Local Admin only. Model roles, probes and statuses are wholly server-owned. */
export async function POST(request: NextRequest) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    assertFields(body, ["modelConfigId", "expectedModelRevision", "expectedProviderRevision"]);
    if (typeof body.modelConfigId !== "string" || !body.modelConfigId.trim() || body.modelConfigId.length > 120 || !Number.isSafeInteger(body.expectedModelRevision) || (body.expectedModelRevision as number) < 1 || !Number.isSafeInteger(body.expectedProviderRevision) || (body.expectedProviderRevision as number) < 1) {
      throw new AIAgent1RuntimeError("AI_AGENT_1_RUNTIME_INVALID", "The instruction probe configuration identity is invalid.");
    }
    const database = getContentDatabase();
    const authority = await new Agent1InstructionConformanceService(database).probe({ modelConfigId: body.modelConfigId, expectedModelRevision: body.expectedModelRevision as number, expectedProviderRevision: body.expectedProviderRevision as number, actor, signal: request.signal, executionBoundary: "DEVELOPMENT_CONFORMANCE_PROBE" });
    return localJson({ ok: true, authority, snapshot: AIAgent1RuntimeService.forDatabase(database, { executionBoundary: "DEVELOPMENT_STATELESS_CHAT" }).getSnapshot() });
  } catch (error) { return localApiError(error); }
}
