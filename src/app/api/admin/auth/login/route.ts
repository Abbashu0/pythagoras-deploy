import { NextRequest } from "next/server";
import {
  assertTrustedMutationRequest,
  getAdminAuthService,
  getLoginAttemptKey,
  readAdminAuthJsonBody,
  setAdminSessionCookie,
  toSafeAdminIdentity,
} from "@/server/admin-auth";
import { adminAuthErrorResponse, noStoreJson } from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const mutation = assertTrustedMutationRequest(request);
    const body = await readAdminAuthJsonBody(request);
    const result = await getAdminAuthService().login({
      email: body.email,
      password: body.password,
      attemptKey: getLoginAttemptKey(body.email),
    });
    const response = noStoreJson({
      ok: true,
      identity: toSafeAdminIdentity(result.authentication.user),
    });
    setAdminSessionCookie(response, result, mutation.secure);
    return response;
  } catch (error) {
    return adminAuthErrorResponse(error, "login");
  }
}
