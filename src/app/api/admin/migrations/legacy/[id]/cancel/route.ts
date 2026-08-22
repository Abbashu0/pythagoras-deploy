import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest } from "@/server/admin-auth";
import { getLegacyMigrationService } from "@/server/legacy-migration";
import { legacyErrorResponse, legacyJson, readLegacyJson, requireLegacyOwner } from "../../_shared";

export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { assertTrustedMutationRequest(request); const actor = requireLegacyOwner(request); const { id } = await context.params; const body = await readLegacyJson(request); return legacyJson({ ok: true, run: getLegacyMigrationService().cancel(id, Number(body.expectedRevision), actor) }); }
  catch (error) { return legacyErrorResponse(error); }
}
