"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArchiveRestore, CheckCircle2, DatabaseBackup, Eye, ImageIcon, LoaderCircle, ScanSearch, ShieldCheck } from "lucide-react";
import { scanCurrentLegacyBrowser } from "@/lib/admin/legacy-migration/browser-scanner";
import type { LegacyBrowserScanResult, LegacyImageCandidate } from "@/lib/admin/legacy-migration/contracts";
import type { LegacyMigrationDetail, LegacyMigrationRun } from "@/server/legacy-migration/contracts";

type ApiPayload = { ok: boolean; code?: string; run?: LegacyMigrationRun; runs?: LegacyMigrationRun[]; detail?: LegacyMigrationDetail; duplicateReadyRun?: LegacyMigrationRun | null };

const statusLabel: Record<string, string> = { DRAFT: "مسودة", IMPORTING: "جارٍ التجهيز", READY: "جاهز للمرحلة التالية", FAILED: "متعذر", CANCELLED: "ملغي", APPLIED: "مطبق" };

async function apiJson(url: string, init?: RequestInit): Promise<ApiPayload> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json() as ApiPayload;
  if (!response.ok) throw new Error(body.code ?? "تعذر إكمال العملية.");
  return body;
}

function extensionFor(candidate: LegacyImageCandidate): string {
  return candidate.mimeType === "image/png" ? "png" : candidate.mimeType === "image/webp" ? "webp" : candidate.mimeType === "image/gif" ? "gif" : "jpg";
}

function LegacyImagePreview({ candidate }: { candidate: LegacyImageCandidate }) {
  const source = useMemo(() => URL.createObjectURL(candidate.blob), [candidate.blob]);
  useEffect(() => {
    return () => URL.revokeObjectURL(source);
  }, [source]);
  return <img src={source} alt="معاينة صورة قديمة" className="aspect-square w-full object-cover" />;
}

export function LegacyMigrationWorkspace() {
  const [scan, setScan] = useState<LegacyBrowserScanResult | null>(null);
  const [runs, setRuns] = useState<LegacyMigrationRun[]>([]);
  const [activeRun, setActiveRun] = useState<LegacyMigrationRun | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<LegacyMigrationDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [includeOrphans, setIncludeOrphans] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    const result = await apiJson("/api/admin/migrations/legacy");
    setRuns(result.runs ?? []);
  }, []);
  useEffect(() => { void loadRuns().catch(() => undefined); }, [loadRuns]);

  const counts = useMemo(() => {
    const sections = scan?.snapshot.sections;
    const count = (value: unknown) => Array.isArray(value) ? value.length : 0;
    return { banners: count(sections?.banners), materials: count(sections?.materials), tools: count(sections?.tools), navigation: count(sections?.navigation), images: scan?.snapshot.references.images.length ?? 0 };
  }, [scan]);

  const startScan = async () => {
    setBusy(true); setError(null); setActiveRun(null); setProgress(0);
    try { setScan(await scanCurrentLegacyBrowser()); }
    catch { setError("تعذر قراءة التخزين المحلي بأمان. لم يتم تعديل أي بيانات."); }
    finally { setBusy(false); }
  };

  const uploadCandidate = async (runId: string, candidate: LegacyImageCandidate, revision: number) => {
    const data = new FormData();
    data.set("file", candidate.blob, `legacy-${candidate.sha256.slice(0, 12)}.${extensionFor(candidate)}`);
    const displayName = candidate.contexts[0] ? `صورة مرحّلة — ${candidate.contexts[0]}` : `صورة قديمة غير مرتبطة — ${candidate.legacyReference}`;
    data.set("displayName", displayName.slice(0, 240));
    data.set("expectedRevision", String(revision));
    data.set("legacyReference", candidate.legacyReference);
    data.set("sourceKind", candidate.sourceKind);
    data.set("referenceContexts", JSON.stringify(candidate.contexts));
    const response = await fetch(`/api/admin/migrations/legacy/${runId}/assets`, { method: "POST", body: data });
    const result = await response.json() as ApiPayload;
    if (!response.ok) throw new Error(result.code ?? "تعذر نسخ صورة قديمة.");
    return result.run!;
  };

  const stage = async () => {
    if (!scan) return;
    setBusy(true); setError(null); setProgress(1);
    try {
      const created = await apiJson("/api/admin/migrations/legacy", { method: "POST", body: JSON.stringify({ sourceOrigin: scan.snapshot.origin }) });
      let run = created.run!; setActiveRun(run);
      const stored = await apiJson(`/api/admin/migrations/legacy/${run.id}/snapshot`, { method: "POST", body: JSON.stringify({ expectedRevision: run.revision, sourceFingerprint: scan.sourceFingerprint, snapshot: scan.snapshot }) });
      run = stored.run!; setActiveRun(run); setProgress(2);
      const candidates = scan.imageCandidates.filter((candidate) => candidate.state === "REFERENCED" || includeOrphans);
      // Two bounded workers; optimistic conflicts are retried against the latest server revision.
      let next = 0;
      const workers = Array.from({ length: Math.min(2, candidates.length) }, async () => {
        while (next < candidates.length) {
          const candidate = candidates[next++];
          let completed = false;
          while (!completed) {
            try {
              const latest = await apiJson(`/api/admin/migrations/legacy/${run.id}`);
              run = await uploadCandidate(run.id, candidate, latest.detail?.run.revision ?? run.revision);
              setActiveRun(run); completed = true;
            } catch (uploadError) {
              if (uploadError instanceof Error && uploadError.message === "LEGACY_MIGRATION_CONFLICT") continue;
              throw uploadError;
            }
          }
        }
      });
      await Promise.all(workers); setProgress(4);
      const final = await apiJson(`/api/admin/migrations/legacy/${run.id}/finalize`, { method: "POST", body: JSON.stringify({ expectedRevision: run.revision }) });
      run = final.run!; setActiveRun(run); setProgress(5); await loadRuns();
    } catch (stageError) { setError(stageError instanceof Error ? stageError.message : "تعذر تجهيز نسخة الترحيل."); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-5 md:p-8" dir="rtl">
      <header className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2"><div className="flex items-center gap-2 text-primary"><DatabaseBackup className="h-5 w-5" /><span className="text-xs font-bold">أداة OWNER محمية</span></div><h1 className="text-2xl font-bold">ترحيل البيانات المحلية</h1><p className="max-w-3xl text-sm leading-7 text-muted-foreground">يجب فتح هذه الصفحة من المتصفح والملف الشخصي الذي يحتوي على تعديلاتك وصورك القديمة. الفحص للقراءة فقط، وهذه المرحلة تنشئ نسخة تجهيز دائمة من دون تبديل بيانات التطبيق أو حذف التخزين القديم.</p></div>
          <button onClick={startScan} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}فحص هذا المتصفح</button>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        {[{ icon: Eye, title: "قراءة فقط", copy: "لا كتابة إلى localStorage أو IndexedDB" }, { icon: ShieldCheck, title: "قائمة مغلقة", copy: "تُقرأ مفاتيح Pythagoras المعروفة فقط" }, { icon: ArchiveRestore, title: "لا يوجد cutover", copy: "يبقى المنتج على التخزين القديم حتى M7" }].map(({ icon: Icon, title, copy }) => <div key={title} className="rounded-xl border bg-card p-4"><Icon className="mb-3 h-5 w-5 text-primary" /><div className="text-sm font-bold">{title}</div><div className="mt-1 text-xs text-muted-foreground">{copy}</div></div>)}
      </div>

      {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><AlertTriangle className="h-4 w-4" />{error}</div>}

      {scan && <section className="space-y-4 rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">نتيجة الفحص</h2><p className="text-xs text-muted-foreground">البصمة: <span className="font-mono">{scan.sourceFingerprint.slice(0, 18)}…</span></p></div><span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600">لم تتغير بيانات المتصفح</span></div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{Object.entries({ "البانرات": counts.banners, "المواد": counts.materials, "الأدوات": counts.tools, "التنقل": counts.navigation, "الصور": counts.images }).map(([label, value]) => <div key={label} className="rounded-xl bg-muted/50 p-3 text-center"><div className="text-xl font-bold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>)}</div>
        <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-bold">المشكلات والملاحظات ({scan.snapshot.issues.length})</summary><div className="mt-3 space-y-2">{scan.snapshot.issues.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد ملاحظات.</p> : scan.snapshot.issues.map((issue, index) => <div key={`${issue.code}-${index}`} className="rounded-lg bg-muted/50 p-3 text-xs"><span className={issue.severity === "ERROR" ? "text-destructive" : issue.severity === "WARNING" ? "text-amber-600" : "text-muted-foreground"}>{issue.severity}</span> · {issue.code} — {issue.message}</div>)}</div></details>
        <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-bold">معاينة الصور ({scan.imageCandidates.length})</summary><div className="mt-3 grid grid-cols-3 gap-3 md:grid-cols-6">{scan.imageCandidates.slice(0, 18).map((candidate) => <div key={candidate.legacyReference} className="overflow-hidden rounded-lg border bg-muted"><LegacyImagePreview candidate={candidate} /><div className="truncate p-1 text-[9px]">{candidate.legacyReference}</div></div>)}</div></details>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={includeOrphans} onChange={(event) => setIncludeOrphans(event.target.checked)} /> تضمين الصور اليتيمة في مكتبة الأصول (لن تُحذف من المتصفح)</label>
        <button onClick={stage} disabled={busy || scan.snapshot.issues.some((issue) => issue.severity === "ERROR")} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"><ImageIcon className="h-4 w-4" />إنشاء نسخة تجهيز ونسخ الصور</button>
        {progress > 0 && <div className="space-y-2"><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress * 20}%` }} /></div><p className="text-xs text-muted-foreground">{progress === 5 ? "اكتمل التجهيز وأصبحت النسخة READY. لم يحدث cutover." : `مرحلة ${progress} من 5`}</p></div>}
        {activeRun?.status === "READY" && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700"><CheckCircle2 className="h-5 w-5" />النسخة جاهزة للمرحلة M7 ومستقلة الآن عن المتصفح المصدر.</div>}
      </section>}

      <section className="rounded-2xl border bg-card p-5"><h2 className="font-bold">محاولات الترحيل السابقة</h2><div className="mt-4 space-y-2">{runs.length === 0 ? <p className="text-sm text-muted-foreground">لا توجد محاولات محفوظة بعد.</p> : runs.map((run) => <button type="button" onClick={async () => { const result = await apiJson(`/api/admin/migrations/legacy/${run.id}`); setSelectedDetail(result.detail ?? null); }} key={run.id} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-right text-xs transition hover:bg-muted/40"><div><div className="font-mono">{run.id}</div><div className="text-muted-foreground">{new Date(run.createdAt).toLocaleString("ar-IQ")} · {run.imageImportedCount}/{run.imageReferenceCount} صور</div></div><span className="rounded-full bg-muted px-3 py-1 font-semibold">{statusLabel[run.status]}</span></button>)}</div>
        {selectedDetail && <div className="mt-4 rounded-xl border bg-muted/30 p-4 text-xs"><div className="mb-2 flex items-center justify-between"><strong>تفاصيل النسخة {statusLabel[selectedDetail.run.status]}</strong><button type="button" onClick={() => setSelectedDetail(null)} className="text-muted-foreground">إغلاق</button></div><div className="grid gap-2 md:grid-cols-3"><span>السجلات: {selectedDetail.run.bannerCount + selectedDetail.run.materialCount + selectedDetail.run.toolCount + selectedDetail.run.navigationCount}</span><span>خرائط الصور: {selectedDetail.assets.length}</span><span>الملاحظات: {selectedDetail.issues.length}</span></div><p className="mt-2 text-muted-foreground">هذه التفاصيل محفوظة على الخادم ويمكن مراجعتها بعد إغلاق المتصفح المصدر. لا تحتوي snapshot على بيانات الصور الثنائية.</p></div>}
      </section>
    </div>
  );
}
