import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  getAdminAuthService,
  getCurrentAdminAuthentication,
  toSafeAdminIdentity,
} from "@/server/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authService = getAdminAuthService();
  if (authService.isSetupRequired()) {
    redirect("/admin/setup");
  }

  const authentication = await getCurrentAdminAuthentication();
  if (!authentication) {
    redirect("/admin/login");
  }

  return (
    <AdminShell identity={toSafeAdminIdentity(authentication.user)}>
      {children}
    </AdminShell>
  );
}
