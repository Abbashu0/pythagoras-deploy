import type { AdminActor, AdminAuthentication } from "./contracts";
import { AdminAuthorizationError } from "./errors";

export function requireAdmin(
  authentication: AdminAuthentication | null,
): AdminAuthentication {
  if (!authentication) {
    throw new AdminAuthorizationError("ADMIN_AUTH_REQUIRED");
  }
  return authentication;
}

export function requireOwner(
  authentication: AdminAuthentication | null,
): AdminAuthentication {
  const admin = requireAdmin(authentication);
  if (admin.user.role !== "OWNER") {
    throw new AdminAuthorizationError("ADMIN_FORBIDDEN");
  }
  return admin;
}

export function getAdminActor(authentication: AdminAuthentication): AdminActor {
  return {
    actorUserId: authentication.user.id,
    actorRole: authentication.user.role,
  };
}

export function requireOwnerActor(actor: AdminActor): AdminActor {
  if (actor.actorRole !== "OWNER") {
    throw new AdminAuthorizationError("ADMIN_FORBIDDEN");
  }
  return actor;
}
