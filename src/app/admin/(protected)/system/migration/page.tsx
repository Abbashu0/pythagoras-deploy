import { redirect } from "next/navigation";
import { LegacyMigrationWorkspace } from "@/components/admin/legacy-migration/LegacyMigrationWorkspace";
import { getCurrentAdminAuthentication } from "@/server/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function LegacyMigrationPage() {
  const authentication = await getCurrentAdminAuthentication();
  if (!authentication) redirect("/admin/login");
  if (authentication.user.role !== "OWNER") redirect("/admin");
  return <LegacyMigrationWorkspace />;
}
