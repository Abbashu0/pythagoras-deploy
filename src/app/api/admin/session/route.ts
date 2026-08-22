import { NextRequest } from "next/server";
import {
  getAdminAuthService,
  getAdminSessionTokenFromRequest,
  toSafeAdminIdentity,
} from "@/server/admin-auth";
import { noStoreJson } from "../auth/_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authentication = getAdminAuthService().authenticateSessionToken(
    getAdminSessionTokenFromRequest(request),
  );
  if (!authentication) {
    return noStoreJson(
      { ok: false, code: "ADMIN_AUTH_REQUIRED" },
      { status: 401 },
    );
  }

  return noStoreJson({
    ok: true,
    identity: toSafeAdminIdentity(authentication.user),
  });
}
