import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminAuthFrame } from "@/components/admin/auth/AdminAuthFrame";
import { AdminSetupForm } from "@/components/admin/auth/AdminSetupForm";
import {
  getAdminAuthService,
  getCurrentAdminAuthentication,
} from "@/server/admin-auth";

export const metadata: Metadata = { title: "إعداد المالك · Pythagoras Admin" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminSetupPage() {
  const authentication = await getCurrentAdminAuthentication();
  if (authentication) redirect("/admin");
  if (!getAdminAuthService().isSetupRequired()) redirect("/admin/login");

  return (
    <AdminAuthFrame
      eyebrow="الإعداد الأول الآمن"
      title="إنشاء مالك المنصة"
      description="أنشئ الهوية الوحيدة التي تملك الصلاحية النهائية لإدارة Pythagoras. لا توجد بيانات دخول افتراضية."
    >
      <AdminSetupForm />
    </AdminAuthFrame>
  );
}
