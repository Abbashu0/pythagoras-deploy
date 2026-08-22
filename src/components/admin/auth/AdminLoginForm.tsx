"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMIN_PASSWORD_MAX_LENGTH } from "@/lib/admin-auth-policy";

export function AdminLoginForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = (await response.json()) as {
        code?: string;
        retryAfter?: number;
      };
      if (!response.ok) {
        setError(
          result.code === "ADMIN_RATE_LIMITED"
            ? `محاولات كثيرة. انتظر ${result.retryAfter ?? 1} ثانية ثم حاول مجددًا.`
            : "تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور وحاول مجددًا.",
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
    <form className="space-y-4" onSubmit={handleSubmit} data-admin-auth-form="login">
      <div className="space-y-2">
        <Label htmlFor="email">البريد الإلكتروني</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          maxLength={254}
          required
          autoFocus
          dir="ltr"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">كلمة المرور</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={ADMIN_PASSWORD_MAX_LENGTH}
          required
          dir="ltr"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive" role="alert" aria-live="polite">
          {error}
        </div>
      )}

      <Button className="w-full" type="submit" disabled={submitting}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        تسجيل الدخول
      </Button>
    </form>
  );
}
