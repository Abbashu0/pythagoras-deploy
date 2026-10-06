import type { NextRequest } from "next/server";
import { AIInstructionAdminService } from "@/server/ai/policy/instruction-admin-service";
import { AIPolicyError } from "@/server/ai/policy/errors";
import { getContentDatabase } from "@/server/content";
import { localJson, requireLocalAdminRead } from "../../../../_shared";
import { instructionApiError } from "../_helpers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    requireLocalAdminRead(request);
    const raw = request.nextUrl.searchParams.get("before");
    const before = raw === null ? undefined : Number(raw);
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new AIPolicyError("AI_POLICY_INVALID", "Invalid history cursor.");
    return localJson({ ok: true, ...new AIInstructionAdminService(getContentDatabase()).history(before) });
  } catch (error) { return instructionApiError(error); }
}
