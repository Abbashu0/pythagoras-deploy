"use client";

import * as React from "react";

import { InlineNote } from "@/components/admin-ui/feedback/banner";
import { Button } from "@/components/admin-ui/primitives/button";
import { Panel, PanelHeader } from "@/components/admin-ui/primitives/surface";

export function Agent1DevPairingPanel({ ready }: { ready: boolean }) {
  const [pairingCode, setPairingCode] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (process.env.NODE_ENV !== "development") return null;

  const issueCode = async () => {
    setBusy(true);
    setPairingCode(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/local/ai/agent-1/dev-pairing", {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        code?: string;
        expiresAt?: number;
      };
      if (!response.ok || body.ok !== true || !body.code || !body.expiresAt) {
        throw new Error(body.code ?? "PAIRING_ISSUE_FAILED");
      }
      setPairingCode(body.code);
    } catch {
      setError("تعذر إنشاء رمز اقتران. تأكد أن Agent 1 يعمل وأن الصفحة مفتوحة محليًا.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel padding="none">
      <PanelHeader
        title="اقتران iPhone للتطوير"
        description="رمز مؤقت لمحادثة Agent 1 من Expo Go. هذه الآلية لا تعمل في الإنتاج."
        bordered
        density="compact"
      />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm leading-6 text-fg-secondary">
          لا يُحفظ سجل الرسائل في خادم المشروع. يُرسل نص المحادثة إلى مزوّد النموذج المحدد، وقد تنطبق عليه سياسة الاحتفاظ لدى ذلك المزوّد. استخدم شبكة محلية موثوقة فقط.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            disabled={!ready || busy}
            onClick={() => void issueCode()}
          >
            {busy ? "جارٍ إنشاء الرمز…" : "إنشاء رمز اقتران"}
          </Button>
          {!ready ? (
            <span className="text-xs text-fg-tertiary">شغّل Agent 1 واختر نموذجًا رئيسيًا جاهزًا أولًا.</span>
          ) : null}
        </div>
        {pairingCode ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-inset px-4 py-3">
            <span className="text-xs text-fg-secondary">صالح لدقيقتين، ويُستخدم مرة واحدة:</span>
            <code dir="ltr" className="select-all font-mono text-base font-semibold tracking-[0.14em] text-fg">
              {pairingCode}
            </code>
          </div>
        ) : null}
        {error ? <InlineNote tone="danger">{error}</InlineNote> : null}
      </div>
    </Panel>
  );
}
