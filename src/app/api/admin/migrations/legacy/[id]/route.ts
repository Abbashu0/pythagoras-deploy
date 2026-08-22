import type { NextRequest } from "next/server";
import { getLegacyMigrationService } from "@/server/legacy-migration";
import { legacyErrorResponse, legacyJson, requireLegacyOwner } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { const actor = requireLegacyOwner(request); const { id } = await context.params; return legacyJson({ ok: true, detail: getLegacyMigrationService().get(id, actor) }); }
  catch (error) { return legacyErrorResponse(error); }
}
