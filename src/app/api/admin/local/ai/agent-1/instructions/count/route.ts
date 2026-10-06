import type { NextRequest } from "next/server";
import { getInstructionTokenService } from "@/server/ai/policy/instruction-token-service";
import { getContentDatabase } from "@/server/content";
import { localJson, readLocalJsonBody, requireLocalAdminMutation } from "../../../../_shared";
import { assertFields } from "../../../_helpers";
import { instructionApiError } from "../_helpers";
import { SQLiteAIInstructionPolicyRepository } from "@/server/ai/policy/instruction-repository";
import { AIPolicyError } from "@/server/ai/policy/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    assertFields(body, ["sections", "revision"]);
    const database = getContentDatabase();
    const counter = getInstructionTokenService(database);
    if (Object.hasOwn(body, "revision")) {
      if (Object.hasOwn(body, "sections") || !Number.isSafeInteger(body.revision) || (body.revision as number) < 1) throw new AIPolicyError("AI_POLICY_INVALID", "Invalid revision count request.");
      const repository = new SQLiteAIInstructionPolicyRepository(database);
      const policy = repository.getByScope("GLOBAL", null);
      const revision = policy ? repository.getRevision(policy.id, body.revision as number) : null;
      if (!revision) throw new AIPolicyError("AI_POLICY_NOT_FOUND", "The Instruction Policy revision was not found.");
      return localJson({ ok: true, result: await counter.countRevision(revision, request.signal) });
    }
    return localJson({ ok: true, result: await counter.count(body.sections, request.signal) });
  } catch (error) { return instructionApiError(error); }
}
