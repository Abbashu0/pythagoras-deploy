import type { NextRequest } from "next/server";
import { AIInstructionAdminService } from "@/server/ai/policy/instruction-admin-service";
import { getContentDatabase } from "@/server/content";
import { localJson, readLocalJsonBody, requireLocalAdminMutation, requireLocalAdminRead } from "../../../_shared";
import { assertFields } from "../../_helpers";
import { instructionApiError } from "./_helpers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try { requireLocalAdminRead(request); return localJson({ ok: true, current: new AIInstructionAdminService(getContentDatabase()).current() }); } catch (error) { return instructionApiError(error); }
}
export async function PUT(request: NextRequest) {
  try {
    const actor = requireLocalAdminMutation(request);
    const body = await readLocalJsonBody(request);
    assertFields(body, ["expectedRevision", "sections", "enabled"]);
    const current = new AIInstructionAdminService(getContentDatabase()).publish({ expectedRevision: body.expectedRevision as number, sections: body.sections, enabled: body.enabled as boolean, actor });
    return localJson({ ok: true, current });
  } catch (error) { return instructionApiError(error); }
}
