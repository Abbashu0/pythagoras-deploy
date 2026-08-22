import type { NextRequest } from "next/server";
import { assertTrustedMutationRequest } from "@/server/admin-auth";
import { getLegacyMigrationService } from "@/server/legacy-migration";
import { legacyErrorResponse, legacyJson, readLegacyJson, requireLegacyOwner } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = requireLegacyOwner(request);
    const fingerprint = request.nextUrl.searchParams.get("fingerprint");
    if (fingerprint) return legacyJson({ ok: true, readyRun: getLegacyMigrationService().findReadyByFingerprint(fingerprint, actor) });
    return legacyJson({ ok: true, runs: getLegacyMigrationService().list(actor) });
  }
  catch (error) { return legacyErrorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutationRequest(request);
    const actor = requireLegacyOwner(request);
    const body = await readLegacyJson(request);
    const run = getLegacyMigrationService().createRun(String(body.sourceOrigin ?? ""), actor);
    return legacyJson({ ok: true, run }, { status: 201 });
  } catch (error) { return legacyErrorResponse(error); }
}
