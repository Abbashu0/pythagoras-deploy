import { NextRequest } from "next/server";
import {
  assertTrustedMutationRequest,
  clearAdminSessionCookie,
  getAdminAuthService,
  getAdminSessionTokenFromRequest,
} from "@/server/admin-auth";
import { adminAuthErrorResponse, noStoreJson } from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const mutation = assertTrustedMutationRequest(request);
    getAdminAuthService().logout(getAdminSessionTokenFromRequest(request));
    const response = noStoreJson({ ok: true });
    clearAdminSessionCookie(response, mutation.secure);
    return response;
  } catch (error) {
    return adminAuthErrorResponse(error, "logout");
  }
}
