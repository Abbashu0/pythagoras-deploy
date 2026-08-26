"use client";

import { useEffect, useState } from "react";

type Health = { canonicalQuestionCount: number; indexedQuestionCount: number; indexedSegmentCount: number; healthy: boolean };
export function QuestionSearchMaintenancePanel() {
  const [health, setHealth] = useState<Health | null>(null); const [busy, setBusy] = useState(false);
  const load = () => fetch("/api/admin/system/question-search", { cache: "no-store" }).then((r) => r.json()).then((body) => setHealth(body.ok ? body : null)).catch(() => setHealth(null));
  useEffect(() => { load(); }, []);
  const rebuild = async () => { setBusy(true); try { const response = await fetch("/api/admin/system/question-search/rebuild", { method: "POST", headers: { Origin: window.location.origin } }); const body = await response.json(); if (body.ok) setHealth(body); } finally { setBusy(false); } };
  return <section className="rounded-xl border bg-card p-5" dir="rtl"><h2 className="text-lg font-semibold">فهرس بحث الأسئلة</h2><p className="mt-1 text-sm text-muted-foreground">فهرس قابل لإعادة البناء من الأسئلة المنشورة، ولا يحتوي على مصدر المحتوى الأصلي.</p><div className="mt-4 grid gap-2 text-sm sm:grid-cols-3"><span>أسئلة منشورة: {health?.canonicalQuestionCount ?? "—"}</span><span>مفهرسة: {health?.indexedQuestionCount ?? "—"}</span><span>مقاطع: {health?.indexedSegmentCount ?? "—"}</span></div><button type="button" onClick={rebuild} disabled={busy} className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60">{busy ? "جارٍ إعادة البناء…" : "إعادة بناء فهرس بحث الأسئلة"}</button></section>;
}
