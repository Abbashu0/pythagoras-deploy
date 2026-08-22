import { redirect } from "next/navigation";
import { LegacyMigrationWorkspace } from "@/components/admin/legacy-migration/LegacyMigrationWorkspace";
import { CanonicalCutoverPanel } from "@/components/admin/CanonicalCutoverPanel";
import { getCurrentAdminAuthentication } from "@/server/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function LegacyMigrationPage() {
  const authentication = await getCurrentAdminAuthentication();
  if (!authentication) redirect("/admin/login");
  if (authentication.user.role !== "OWNER") redirect("/admin");
  return <div className="p-4 md:p-8"><CanonicalCutoverPanel /><LegacyMigrationWorkspace /></div>;
}
