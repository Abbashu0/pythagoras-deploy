"use client";

import type { ReactNode } from "react";
import { Loader2, RotateCcw, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CanonicalContentSnapshot } from "@/server/canonical-content/contracts";

export function CanonicalWorkspaceFrame({
  title,
  subtitle,
  source,
  loading,
  saving,
  dirty,
  error,
  onReset,
  onSave,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  source: CanonicalContentSnapshot | null;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  onReset: () => void;
  onSave: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  if (loading) return <div className="grid min-h-[60vh] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>;
  return <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 lg:px-8" dir="rtl">
    <header className="flex flex-col gap-4 rounded-3xl border bg-card p-5 shadow-sm xl:flex-row xl:items-center xl:justify-between">
      <div><p className="text-xs font-semibold text-primary">محرر متخصص · محتوى Canonical</p><h1 className="mt-1 text-2xl font-black">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{subtitle}</p></div>
      <div className="flex flex-wrap gap-2">{actions}<Button variant="outline" disabled={!dirty || saving} onClick={onReset}><RotateCcw className="ml-2 h-4 w-4"/>تراجع عن المسودة</Button><Button disabled={!dirty || saving} onClick={onSave}>{saving ? <Loader2 className="ml-2 h-4 w-4 animate-spin"/> : <Save className="ml-2 h-4 w-4"/>}حفظ كمسودة مراجعة</Button></div>
    </header>
    {source?.state.runtimeSourceMode === "LEGACY" ? <div className="rounded-2xl border border-amber-400/35 bg-amber-400/10 p-4 text-sm text-amber-800 dark:text-amber-200">تطبيق الطالب ما زال على المصدر القديم. أي تعديل هنا يبقى Change Set حتى اعتماد OWNER ونشره، ولا يغيّر بيانات المتصفح.</div> : null}
    {error ? <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
    {children}
    <div className="flex items-center gap-2 rounded-2xl border bg-card/60 p-3 text-xs text-muted-foreground"><Send className="h-4 w-4 text-primary"/>التعديلات على الشاشة محلية مؤقتًا؛ زر الحفظ ينشئ Change Set واحدًا ولا يغيّر المحتوى المنشور مباشرة.</div>
  </div>;
}

export function PendingBadge({ visible }: { visible: boolean }) {
  return visible ? <span className="inline-flex rounded-full bg-amber-400/15 px-2.5 py-1 text-[10px] font-bold text-amber-700 dark:text-amber-300">بانتظار المراجعة</span> : null;
}
