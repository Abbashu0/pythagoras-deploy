import { NextRequest } from "next/server";
import {
  assertTrustedMutationRequest,
  getAdminAuthService,
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
    const result = await getAdminAuthService().setupInitialOwner({
      displayName: body.displayName,
      email: body.email,
      password: body.password,
    });
    const response = noStoreJson(
      {
        ok: true,
        identity: toSafeAdminIdentity(result.authentication.user),
      },
      { status: 201 },
    );
    setAdminSessionCookie(response, result, mutation.secure);
    return response;
  } catch (error) {
    return adminAuthErrorResponse(error, "setup");
  }
}
