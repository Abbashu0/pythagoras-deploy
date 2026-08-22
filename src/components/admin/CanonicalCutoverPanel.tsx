"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Database, Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { CanonicalContentSnapshot } from "@/server/canonical-content/contracts";

export function CanonicalCutoverPanel() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<CanonicalContentSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void fetch("/api/admin/content", { cache: "no-store" }).then(async (response) => {
    const body = await response.json() as { snapshot?: CanonicalContentSnapshot };
    if (response.ok && body.snapshot) setSnapshot(body.snapshot);
  }); }, []);
  const create = async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/admin/content/cutover", { method: "POST" });
      const body = await response.json() as { changeSet?: { changeSet: { id: string } }; alreadyCanonical?: boolean; code?: string };
      if (!response.ok) throw new Error(body.code ?? "تعذر إنشاء قرار التحويل.");
      if (body.changeSet) router.push(`/admin/review/${body.changeSet.changeSet.id}`);
      else router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر إنشاء قرار التحويل."); setBusy(false); }
  };
  return <section className="mb-6 rounded-3xl border bg-card p-5 shadow-sm" dir="rtl">
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div className="flex gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary"><Database className="h-5 w-5"/></div><div><p className="text-xs font-semibold text-primary">M7 · مصدر تطبيق الطالب</p><h2 className="text-lg font-black">التحويل المنضبط إلى المحتوى القانوني</h2><p className="mt-1 max-w-2xl text-xs leading-6 text-muted-foreground">هذا الإجراء لا يقرأ أو يحذف بيانات المتصفح. ينشئ Change Set مستقلًا، ثم يتطلب اعتماد OWNER ونشره. تُنشأ نسخة SQLite احتياطية تلقائيًا لحظة النشر.</p></div></div>
      {snapshot?.state.runtimeSourceMode === "CANONICAL" ? <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-600"><CheckCircle2 className="h-4 w-4"/>المصدر القانوني مفعّل</span> : <Button disabled={!snapshot || busy} onClick={() => void create()}>{busy ? <Loader2 className="ml-2 h-4 w-4 animate-spin"/> : <ShieldCheck className="ml-2 h-4 w-4"/>}إنشاء قرار التحويل للمراجعة</Button>}
    </div>{error ? <p className="mt-3 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">{error}</p> : null}
  </section>;
}
