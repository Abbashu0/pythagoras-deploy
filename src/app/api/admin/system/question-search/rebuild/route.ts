import { assertTrustedMutationRequest, getAdminActor, getCurrentAdminAuthentication } from "@/server/admin-auth";
import { getQuestionSearchService } from "@/server/question-search";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertTrustedMutationRequest(request);
    const authentication = await getCurrentAdminAuthentication(); const actor = authentication ? getAdminActor(authentication) : null;
    if (!actor || actor.actorRole !== "OWNER") return NextResponse.json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
    const service = getQuestionSearchService(); service.rebuildAll();
    return NextResponse.json({ ok: true, ...service.getHealth() });
  } catch { return NextResponse.json({ ok: false, code: "QUESTION_SEARCH_REBUILD_FAILED" }, { status: 400 }); }
}
