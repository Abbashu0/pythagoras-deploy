import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest } from "@/server/admin-auth";
import type { LegacyBrowserSnapshot } from "@/lib/admin/legacy-migration/contracts";
import { getLegacyMigrationService } from "@/server/legacy-migration";
import { legacyErrorResponse, legacyJson, readLegacyJson, requireLegacyOwner } from "../../_shared";

export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutationRequest(request); const actor = requireLegacyOwner(request); const { id } = await context.params; const body = await readLegacyJson(request);
    const result = getLegacyMigrationService().storeSnapshot(id, Number(body.expectedRevision), body.snapshot as LegacyBrowserSnapshot, String(body.sourceFingerprint ?? ""), actor);
    return legacyJson({ ok: true, ...result });
  } catch (error) { return legacyErrorResponse(error); }
}
