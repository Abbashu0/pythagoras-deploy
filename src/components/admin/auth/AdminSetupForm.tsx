"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMIN_PASSWORD_MAX_LENGTH, ADMIN_PASSWORD_MIN_LENGTH } from "@/lib/admin-auth-policy";

export function AdminSetupForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("displayName") ?? "");
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");

    if (password !== confirmPassword) {
      setError("كلمتا المرور غير متطابقتين.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, email, password }),
      });
      const result = (await response.json()) as { code?: string };
      if (!response.ok) {
        setError(
          result.code === "ADMIN_SETUP_UNAVAILABLE"
            ? "تم إنشاء حساب المالك بالفعل. انتقل إلى تسجيل الدخول."
            : "تعذر إنشاء حساب المالك. تحقق من البيانات وحاول مجددًا.",
        );
        return;
      }

      router.replace("/admin");
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالخادم المحلي. حاول مجددًا.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} data-admin-auth-form="setup">
      <div className="space-y-2">
        <Label htmlFor="displayName">الاسم الظاهر</Label>
        <Input
          id="displayName"
          name="displayName"
          autoComplete="name"
          minLength={2}
          maxLength={100}
          required
          autoFocus
          placeholder="مثال: عباس"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">البريد الإلكتروني</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          maxLength={254}
          required
          dir="ltr"
          placeholder="owner@example.com"
        />
        <p className="text-[11px] leading-5 text-muted-foreground">
          يُستخدم لتسجيل الدخول فقط في هذه المرحلة، ولا توجد رسائل تحقق أو استعادة بريدية.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="password">كلمة المرور</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={ADMIN_PASSWORD_MIN_LENGTH}
            maxLength={ADMIN_PASSWORD_MAX_LENGTH}
            required
            dir="ltr"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">تأكيد كلمة المرور</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={ADMIN_PASSWORD_MIN_LENGTH}
            maxLength={ADMIN_PASSWORD_MAX_LENGTH}
            required
            dir="ltr"
          />
        </div>
      </div>
      <p className="text-[11px] leading-5 text-muted-foreground">
        استخدم {ADMIN_PASSWORD_MIN_LENGTH} حرفًا على الأقل. العبارات الطويلة مسموحة ولا نفرض تركيبة رموز مصطنعة.
      </p>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive" role="alert" aria-live="polite">
          {error}
        </div>
      )}

      <Button className="w-full" type="submit" disabled={submitting}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
        إنشاء المالك وتأمين لوحة الإدارة
      </Button>
    </form>
  );
}
