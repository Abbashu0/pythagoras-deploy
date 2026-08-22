import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import type {
  AdminAuthentication,
  AuthenticatedSessionResult,
} from "./contracts";
import { getAdminAuthService } from "./service";

export const ADMIN_SESSION_COOKIE_NAME = "pythagoras_admin_session";

export function getAdminSessionTokenFromRequest(
  request: NextRequest,
): string | undefined {
  return request.cookies.get(ADMIN_SESSION_COOKIE_NAME)?.value;
}

export async function getCurrentAdminAuthentication(): Promise<AdminAuthentication | null> {
  const cookieStore = await cookies();
  return getAdminAuthService().authenticateSessionToken(
    cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value,
  );
}

export function setAdminSessionCookie(
  response: NextResponse,
  result: AuthenticatedSessionResult,
  secure: boolean,
): void {
  const maxAge = Math.max(
    0,
    Math.floor((result.authentication.expiresAt - Date.now()) / 1000),
  );
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE_NAME,
    value: result.rawToken,
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge,
    expires: new Date(result.authentication.expiresAt),
  });
}

export function clearAdminSessionCookie(
  response: NextResponse,
  secure: boolean,
): void {
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}
