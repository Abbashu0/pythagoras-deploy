import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest } from "@/server/admin-auth";
import { getLegacyMigrationService } from "@/server/legacy-migration";
import { legacyErrorResponse, legacyJson, readLegacyJson, requireLegacyOwner } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutationRequest(request);
    const actor = requireLegacyOwner(request);
    const { id } = await context.params;
    const body = await readLegacyJson(request);
    return legacyJson({ ok: true, detail: getLegacyMigrationService().resume(id, String(body.sourceFingerprint ?? ""), actor) });
  } catch (error) {
    return legacyErrorResponse(error);
  }
}
