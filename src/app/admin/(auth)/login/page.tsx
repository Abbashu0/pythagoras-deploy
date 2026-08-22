import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminAuthFrame } from "@/components/admin/auth/AdminAuthFrame";
import { AdminLoginForm } from "@/components/admin/auth/AdminLoginForm";
import {
  getAdminAuthService,
  getCurrentAdminAuthentication,
} from "@/server/admin-auth";

export const metadata: Metadata = { title: "تسجيل الدخول · Pythagoras Admin" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminLoginPage() {
  const authentication = await getCurrentAdminAuthentication();
  if (authentication) redirect("/admin");
  if (getAdminAuthService().isSetupRequired()) redirect("/admin/setup");

  return (
    <AdminAuthFrame
      eyebrow="Pythagoras Admin"
      title="تسجيل الدخول"
      description="استخدم هوية الإدارة المحلية للوصول إلى لوحة التحكم. الجلسة محفوظة على الخادم وليست داخل تخزين المتصفح."
    >
      <AdminLoginForm />
    </AdminAuthFrame>
  );
}
