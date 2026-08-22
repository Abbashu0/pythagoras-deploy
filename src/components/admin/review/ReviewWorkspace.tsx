"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Check, CheckCircle2, Clock3, FileClock, History, Loader2, RefreshCw, Send, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { reviewApi, type ChangeDetails, type ChangeSummary, type ReviewStatus } from "./types";

const FILTERS: Array<{ value: ReviewStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "الكل" }, { value: "SUBMITTED", label: "بانتظار المراجعة" },
  { value: "NEEDS_CHANGES", label: "تحتاج تعديلات" }, { value: "APPROVED", label: "معتمدة" },
  { value: "CONFLICTED", label: "متعارضة" }, { value: "DRAFT", label: "مسودات" }, { value: "PUBLISHED", label: "منشورة" },
];
const STATUS: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "مسودة", className: "bg-slate-500/10 text-slate-600" }, SUBMITTED: { label: "بانتظار المراجعة", className: "bg-amber-500/10 text-amber-600" },
  NEEDS_CHANGES: { label: "تحتاج تعديلات", className: "bg-orange-500/10 text-orange-600" }, APPROVED: { label: "معتمدة", className: "bg-blue-500/10 text-blue-600" },
  REJECTED: { label: "مرفوضة", className: "bg-destructive/10 text-destructive" }, CONFLICTED: { label: "متعارضة", className: "bg-destructive/10 text-destructive" },
  PUBLISHED: { label: "منشورة", className: "bg-emerald-500/10 text-emerald-600" }, CANCELLED: { label: "ملغاة", className: "bg-muted text-muted-foreground" },
};
type Action = "request-changes" | "reject" | "publish" | null;

export function ReviewWorkspace() {
  const [role, setRole] = useState<"OWNER" | "ADMIN">("ADMIN");
  const [filter, setFilter] = useState<ReviewStatus | "ALL">("ALL");
  const [items, setItems] = useState<ChangeSummary[]>([]);
  const [selected, setSelected] = useState<ChangeDetails | null>(null);
  const [stats, setStats] = useState({ currentPublicationRevision: 0, actionable: 0, published: 0 });
  const [publications, setPublications] = useState<Array<{ publication: { id: string; revision: number; summary: string; publishedAt: number }; publisher: { displayName: string }; itemCount: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async (keepSelection = true) => {
    setLoading(true); setError(null);
    try {
      const query = filter === "ALL" ? "" : `?status=${filter}`;
      const [session, page, statsBody, history] = await Promise.all([
        reviewApi<{ identity: { role: "OWNER" | "ADMIN" } }>("/api/admin/session"),
        reviewApi<{ items: ChangeSummary[] }>(`/api/admin/change-sets${query}`),
        reviewApi<{ stats: typeof stats }>("/api/admin/review/stats"),
        reviewApi<{ items: typeof publications }>("/api/admin/publications?limit=8"),
      ]);
      setRole(session.identity.role); setItems(page.items); setStats(statsBody.stats); setPublications(history.items);
      if (keepSelection && selected) {
        const detail = await reviewApi<{ changeSet: ChangeDetails }>(`/api/admin/change-sets/${selected.changeSet.id}`);
        setSelected(detail.changeSet);
      } else setSelected(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل مساحة المراجعة."); }
    finally { setLoading(false); }
  }, [filter, selected]);

  useEffect(() => { void load(false); }, [filter]);

  const openDetails = async (id: string) => {
    setBusy(true); setError(null);
    try { setSelected((await reviewApi<{ changeSet: ChangeDetails }>(`/api/admin/change-sets/${id}`)).changeSet); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر فتح المقترح."); }
    finally { setBusy(false); }
  };

  const mutate = async (operation: string, body: Record<string, unknown> = {}) => {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await reviewApi(`/api/admin/change-sets/${selected.changeSet.id}/${operation}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: selected.changeSet.revision, ...body }) });
      setAction(null); setNote(""); await load(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تنفيذ العملية."); }
    finally { setBusy(false); }
  };

  const actionableLabel = role === "OWNER" ? "بانتظار قرارك" : "تحتاج إجراءً منك";
  const selectedStatus = selected ? STATUS[selected.changeSet.status] ?? STATUS.DRAFT : null;
  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-6 p-4 sm:p-6 lg:p-8" dir="rtl">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-[11px] font-semibold tracking-[.18em] text-primary">PYTHAGORAS GOVERNANCE</p><h1 className="mt-2 text-2xl font-black sm:text-3xl">مراجعة التغييرات</h1><p className="mt-2 text-sm text-muted-foreground">مسودات موثّقة، مراجعة OWNER، ونشر ذري دون تعديل صامت للمحتوى.</p></div>
        <Button variant="outline" onClick={() => void load(true)} disabled={loading}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> تحديث</Button>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={ShieldCheck} label="دورك الحالي" value={role} /><Metric icon={Clock3} label={actionableLabel} value={String(stats.actionable)} />
        <Metric icon={CheckCircle2} label="منشورة" value={String(stats.published)} /><Metric icon={FileClock} label="مراجعة النشر الحالية" value={`#${stats.currentPublicationRevision}`} />
      </section>
      {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"><AlertTriangle className="h-4 w-4" />{error}</div>}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((entry) => <button key={entry.value} onClick={() => setFilter(entry.value)} className={cn("whitespace-nowrap rounded-full border px-3 py-2 text-xs transition", filter === entry.value ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground")}>{entry.label}</button>)}
      </div>

      <section className="grid min-h-[520px] overflow-hidden rounded-2xl border bg-card lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="border-b lg:border-b-0 lg:border-l">
          <div className="border-b p-4 text-xs font-semibold">المقترحات ({items.length})</div>
          <div className="admin-scroll max-h-[620px] overflow-y-auto p-2">
            {loading ? <div className="grid place-items-center p-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : items.length === 0 ? <p className="p-10 text-center text-xs text-muted-foreground">لا توجد مقترحات ضمن هذا الفلتر.</p> : items.map((entry) => {
              const badge = STATUS[entry.changeSet.status] ?? STATUS.DRAFT;
              return <button key={entry.changeSet.id} onClick={() => void openDetails(entry.changeSet.id)} className={cn("mb-2 w-full rounded-xl border p-3 text-right transition hover:border-primary/40", selected?.changeSet.id === entry.changeSet.id && "border-primary bg-primary/5")}>
                <div className="flex items-start justify-between gap-2"><span className="line-clamp-2 text-sm font-semibold">{entry.changeSet.title}</span><span className={cn("shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold", badge.className)}>{badge.label}</span></div>
                <p className="mt-2 text-[10px] text-muted-foreground">{entry.author.displayName} · {entry.itemCount} تغيير · {entry.areaLabels.join("، ")}</p>
              </button>;
            })}
          </div>
        </div>

        <div className="admin-scroll max-h-[680px] overflow-y-auto p-4 sm:p-6">
          {!selected ? <EmptyState /> : <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><span className={cn("rounded-full px-2.5 py-1 text-[10px] font-semibold", selectedStatus?.className)}>{selectedStatus?.label}</span><span className="text-[10px] text-muted-foreground">نسخة #{selected.changeSet.revision}</span></div><h2 className="mt-3 text-xl font-black">{selected.changeSet.title}</h2><p className="mt-1 text-xs text-muted-foreground">بواسطة {selected.author.displayName} · أساس النشر #{selected.changeSet.basePublicationRevision}</p></div><ActionButtons role={role} details={selected} busy={busy} mutate={mutate} setAction={setAction} /></div>
            {selected.changeSet.description && <p className="mt-5 rounded-xl bg-muted/40 p-4 text-xs leading-6">{selected.changeSet.description}</p>}
            {selected.changeSet.reviewNote && <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"><p className="text-[10px] font-semibold text-amber-600">ملاحظة المراجعة</p><p className="mt-2 text-xs">{selected.changeSet.reviewNote}</p></div>}
            <div className="mt-6 space-y-4">{selected.items.map((item) => <article key={item.id} className="rounded-2xl border p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold">{item.presentation.resourceLabel}</p><p className="mt-1 text-[10px] text-muted-foreground" dir="auto">{item.presentation.resourceSubtitle}</p></div><span className="rounded-full bg-primary/10 px-2 py-1 text-[9px] text-primary">{item.presentation.areaLabel}</span></div><div className="mt-4 space-y-2">{item.presentation.fieldDiffs.map((diff) => <div key={diff.path} className="grid gap-2 rounded-xl bg-muted/35 p-3 sm:grid-cols-[110px_1fr_auto_1fr]"><span className="text-[10px] text-muted-foreground">{diff.label}</span><Value value={diff.before} tone="old" /><ArrowLeftRight className="h-3.5 w-3.5 self-center text-muted-foreground" /><Value value={diff.after} tone="new" /></div>)}</div>{item.conflictDetails && <ConflictPanel details={item.conflictDetails} />}</article>)}</div>
            <section className="mt-6"><h3 className="flex items-center gap-2 text-sm font-bold"><History className="h-4 w-4" />السجل الزمني</h3><div className="mt-3 border-r pr-4">{selected.events.map((event) => <div key={event.id} className="relative pb-4"><span className="absolute -right-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" /><p className="text-xs font-semibold">{eventLabel(event.eventType)}</p><p className="mt-1 text-[10px] text-muted-foreground">{event.actor.displayName} · {new Date(event.createdAt).toLocaleString("ar-IQ")}</p>{event.note && <p className="mt-1 text-xs">{event.note}</p>}</div>)}</div></section>
          </>}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5"><h2 className="text-sm font-bold">سجل النشر</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{publications.length ? publications.map((entry) => <div key={entry.publication.id} className="rounded-xl border p-3"><div className="flex justify-between"><span className="text-xs font-bold">نشر #{entry.publication.revision}</span><span className="text-[10px] text-muted-foreground">{entry.itemCount} عنصر</span></div><p className="mt-2 text-xs text-muted-foreground">{entry.publication.summary}</p><p className="mt-2 text-[10px] text-muted-foreground">{entry.publisher.displayName} · {new Date(entry.publication.publishedAt).toLocaleString("ar-IQ")}</p></div>) : <p className="text-xs text-muted-foreground">لا توجد عمليات نشر بعد.</p>}</div></section>

      <ReviewActionDialog action={action} note={note} setNote={setNote} currentRevision={stats.currentPublicationRevision} busy={busy} onClose={() => { setAction(null); setNote(""); }} onConfirm={() => action && void mutate(action, action === "request-changes" ? { note } : action === "reject" ? { reason: note } : {})} />
    </main>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof ShieldCheck; label: string; value: string }) { return <div className="rounded-2xl border bg-card p-4"><Icon className="h-4 w-4 text-primary" /><p className="mt-3 text-[10px] text-muted-foreground">{label}</p><p className="mt-1 text-lg font-black">{value}</p></div>; }
function EmptyState() { return <div className="grid min-h-[430px] place-items-center text-center"><div><ShieldCheck className="mx-auto h-10 w-10 text-primary/60" /><h2 className="mt-4 font-bold">اختر مقترحًا للمراجعة</h2><p className="mt-2 text-xs text-muted-foreground">ستظهر الفروقات، التعارضات، وسجل القرارات هنا.</p></div></div>; }
function Value({ value, tone }: { value: unknown; tone: "old" | "new" }) { return <span className={cn("rounded-lg px-2 py-1.5 text-xs", tone === "old" ? "bg-destructive/5 text-destructive line-through" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400")} dir="auto">{String(value ?? "—")}</span>; }
function ConflictPanel({ details }: { details: { base?: Record<string, unknown>; current?: Record<string, unknown>; proposed?: Record<string, unknown> } }) { return <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3"><p className="flex items-center gap-2 text-xs font-bold text-destructive"><AlertTriangle className="h-4 w-4" />تعارض يمنع النشر</p><div className="mt-3 grid gap-2 text-[10px] sm:grid-cols-3"><Snapshot label="الأساس" value={details.base} /><Snapshot label="الحالي" value={details.current} /><Snapshot label="المقترح" value={details.proposed} /></div></div>; }
function Snapshot({ label, value }: { label: string; value?: Record<string, unknown> }) { return <div className="rounded-lg bg-background p-2"><span className="text-muted-foreground">{label}</span><pre className="mt-1 overflow-auto whitespace-pre-wrap" dir="auto">{JSON.stringify(value, null, 2)}</pre></div>; }
function ActionButtons({ role, details, busy, mutate, setAction }: { role: "OWNER" | "ADMIN"; details: ChangeDetails; busy: boolean; mutate: (operation: string) => Promise<void>; setAction: (value: Action) => void }) {
  const status = details.changeSet.status;
  return <div className="flex flex-wrap gap-2">{["DRAFT", "NEEDS_CHANGES"].includes(status) && <Button size="sm" disabled={busy} onClick={() => void mutate("submit")}><Send className="h-3.5 w-3.5" />{status === "NEEDS_CHANGES" ? "إعادة الإرسال" : "إرسال للمراجعة"}</Button>}{status === "CONFLICTED" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void mutate("rebase")}><RefreshCw className="h-3.5 w-3.5" />إعادة الأساس</Button>}{role === "OWNER" && status === "SUBMITTED" && <><Button size="sm" disabled={busy} onClick={() => void mutate("approve")}><Check className="h-3.5 w-3.5" />اعتماد</Button><Button size="sm" variant="outline" onClick={() => setAction("request-changes")}>طلب تعديلات</Button><Button size="sm" variant="destructive" onClick={() => setAction("reject")}><X className="h-3.5 w-3.5" />رفض</Button></>}{role === "OWNER" && status === "APPROVED" && <Button size="sm" disabled={busy} onClick={() => setAction("publish")}><CheckCircle2 className="h-3.5 w-3.5" />نشر</Button>}</div>;
}
function ReviewActionDialog({ action, note, setNote, currentRevision, busy, onClose, onConfirm }: { action: Action; note: string; setNote: (value: string) => void; currentRevision: number; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const publish = action === "publish";
  return <Dialog open={Boolean(action)} onOpenChange={(open) => !open && onClose()}><DialogContent dir="rtl"><DialogHeader className="text-right"><DialogTitle>{publish ? "تأكيد النشر" : action === "reject" ? "رفض المقترح" : "طلب تعديلات"}</DialogTitle><DialogDescription>{publish ? `سيتم تطبيق التغييرات ذريًا وإنشاء مراجعة نشر #${currentRevision + 1}.` : "دوّن سببًا واضحًا ليبقى القرار قابلًا للتتبع."}</DialogDescription></DialogHeader>{!publish && <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="اكتب الملاحظة هنا…" className="min-h-28" />}<DialogFooter className="gap-2"><Button variant="outline" onClick={onClose}>إلغاء</Button><Button variant={action === "reject" ? "destructive" : "default"} disabled={busy || (!publish && !note.trim())} onClick={onConfirm}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{publish ? "نشر الآن" : "تأكيد القرار"}</Button></DialogFooter></DialogContent></Dialog>;
}
function eventLabel(type: string): string { return ({ CREATED: "إنشاء المسودة", ITEM_ADDED: "إضافة تغيير", ITEM_UPDATED: "تحديث التغيير", SUBMITTED: "إرسال للمراجعة", RESUBMITTED: "إعادة الإرسال", REQUESTED_CHANGES: "طلب تعديلات", APPROVED: "اعتماد", REJECTED: "رفض", CONFLICT_DETECTED: "اكتشاف تعارض", REBASED: "إعادة الأساس", PUBLISHED: "نشر", CANCELLED: "إلغاء" } as Record<string, string>)[type] ?? type; }
