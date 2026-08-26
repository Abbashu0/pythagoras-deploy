import { getAdminActor, getCurrentAdminAuthentication } from "@/server/admin-auth";
import { getQuestionSearchService } from "@/server/question-search";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const authentication = await getCurrentAdminAuthentication(); const actor = authentication ? getAdminActor(authentication) : null;
  if (!actor || actor.actorRole !== "OWNER") return NextResponse.json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  return NextResponse.json({ ok: true, ...getQuestionSearchService().getHealth() });
}
