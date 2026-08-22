"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArchiveRestore, CheckCircle2, DatabaseBackup, Eye, ImageIcon, LoaderCircle, ScanSearch, ShieldCheck } from "lucide-react";
import { scanCurrentLegacyBrowser } from "@/lib/admin/legacy-migration/browser-scanner";
import type { LegacyBrowserScanResult, LegacyImageBinaryReader, LegacyImageCandidate } from "@/lib/admin/legacy-migration/contracts";
import type { LegacyMigrationDetail, LegacyMigrationRun } from "@/server/legacy-migration/contracts";

type ApiPayload = {
  ok: boolean;
  code?: string;
  run?: LegacyMigrationRun;
  runs?: LegacyMigrationRun[];
  detail?: LegacyMigrationDetail;
  readyRun?: LegacyMigrationRun | null;
  duplicateReadyRun?: LegacyMigrationRun | null;
};

const statusLabel: Record<string, string> = {
  DRAFT: "مسودة",
  IMPORTING: "جارٍ التجهيز",
  READY: "جاهز للمرحلة التالية",
  FAILED: "حالة محجوزة — المصدر ثابت",
  CANCELLED: "ملغي",
  APPLIED: "مطبق",
};

async function apiJson(url: string, init?: RequestInit): Promise<ApiPayload> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json() as ApiPayload;
  if (!response.ok) throw new Error(body.code ?? "تعذر إكمال العملية.");
  return body;
}

function extensionFor(candidate: LegacyImageCandidate): string {
  return candidate.mimeType === "image/png" ? "png" : candidate.mimeType === "image/webp" ? "webp" : candidate.mimeType === "image/gif" ? "gif" : "jpg";
}

function runMetrics(detail: LegacyMigrationDetail | null | undefined) {
  const required = detail?.run.snapshot?.references.images.filter((image) => image.state === "REFERENCED") ?? [];
  const requiredReferences = new Set(required.map((image) => image.legacyReference));
  const requiredMapped = detail?.assets.filter((mapping) => requiredReferences.has(mapping.legacyReference)).length ?? 0;
  const optionalOrphans = detail?.assets.filter((mapping) => !requiredReferences.has(mapping.legacyReference)).length ?? 0;
  return { required: required.length, requiredMapped, optionalOrphans };
}

function LazyLegacyImagePreview({ candidate, reader }: { candidate: LegacyImageCandidate; reader: LegacyImageBinaryReader }) {
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    void reader.readBlob(candidate.legacyReference, candidate.sourceKind).then((blob) => {
      if (!alive) return;
      objectUrl = URL.createObjectURL(blob);
      setSource(objectUrl);
    }).catch(() => { if (alive) setFailed(true); });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [candidate.legacyReference, candidate.sourceKind, reader]);
  if (failed) return <div className="grid aspect-square place-items-center p-2 text-center text-[10px] text-destructive">تعذرت المعاينة</div>;
  if (!source) return <div className="grid aspect-square place-items-center"><LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  return <img src={source} alt="معاينة صورة قديمة" className="aspect-square w-full object-cover" />;
}

export function LegacyMigrationWorkspace() {
  const [scan, setScan] = useState<LegacyBrowserScanResult | null>(null);
  const [runs, setRuns] = useState<LegacyMigrationRun[]>([]);
  const [runDetails, setRunDetails] = useState<Record<string, LegacyMigrationDetail>>({});
  const [activeRun, setActiveRun] = useState<LegacyMigrationRun | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<LegacyMigrationDetail | null>(null);
  const [duplicateReady, setDuplicateReady] = useState<LegacyMigrationRun | null>(null);
  const [previewReference, setPreviewReference] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requiredProgress, setRequiredProgress] = useState({ mapped: 0, total: 0, optional: 0 });
  const [includeOrphans, setIncludeOrphans] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    const result = await apiJson("/api/admin/migrations/legacy");
    const nextRuns = result.runs ?? [];
    setRuns(nextRuns);
    const details = await Promise.all(nextRuns.map(async (run) => (await apiJson(`/api/admin/migrations/legacy/${run.id}`)).detail!));
    setRunDetails(Object.fromEntries(details.map((detail) => [detail.run.id, detail])));
  }, []);
  useEffect(() => { void loadRuns().catch(() => undefined); }, [loadRuns]);

  const counts = useMemo(() => {
    const sections = scan?.snapshot.sections;
    const count = (value: unknown) => Array.isArray(value) ? value.length : 0;
    return {
      banners: count(sections?.banners), materials: count(sections?.materials), tools: count(sections?.tools), navigation: count(sections?.navigation),
      requiredImages: scan?.snapshot.references.images.filter((image) => image.state === "REFERENCED").length ?? 0,
      orphanImages: scan?.snapshot.references.images.filter((image) => image.state === "ORPHAN").length ?? 0,
    };
  }, [scan]);

  const scanBrowser = async () => {
    const nextScan = await scanCurrentLegacyBrowser();
    const existing = await apiJson(`/api/admin/migrations/legacy?fingerprint=${encodeURIComponent(nextScan.sourceFingerprint)}`);
    setScan(nextScan);
    setDuplicateReady(existing.readyRun ?? null);
    setPreviewReference(null);
    return nextScan;
  };

  const startScan = async () => {
    setBusy(true); setError(null); setActiveRun(null); setRequiredProgress({ mapped: 0, total: 0, optional: 0 });
    try { await scanBrowser(); }
    catch { setError("تعذر قراءة التخزين المحلي بأمان. لم يتم تعديل أي بيانات."); }
    finally { setBusy(false); }
  };

  const uploadCandidate = async (runId: string, candidate: LegacyImageCandidate, revision: number, sourceScan: LegacyBrowserScanResult) => {
    const blob = await sourceScan.imageReader.readBlob(candidate.legacyReference, candidate.sourceKind);
    const data = new FormData();
    data.set("file", blob, `legacy-${candidate.sha256.slice(0, 12)}.${extensionFor(candidate)}`);
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

  const stageMissing = async (run: LegacyMigrationRun, sourceScan: LegacyBrowserScanResult, existing: LegacyMigrationDetail["assets"]) => {
    const alreadyMapped = new Set(existing.map((mapping) => mapping.legacyReference));
    const requiredTotal = sourceScan.imageCandidates.filter((candidate) => candidate.state === "REFERENCED").length;
    let requiredMapped = sourceScan.imageCandidates.filter((candidate) => candidate.state === "REFERENCED" && alreadyMapped.has(candidate.legacyReference)).length;
    let optionalMapped = sourceScan.imageCandidates.filter((candidate) => candidate.state === "ORPHAN" && alreadyMapped.has(candidate.legacyReference)).length;
    setRequiredProgress({ mapped: requiredMapped, total: requiredTotal, optional: optionalMapped });
    const candidates = sourceScan.imageCandidates
      .filter((candidate) => !alreadyMapped.has(candidate.legacyReference) && (candidate.state === "REFERENCED" || includeOrphans))
      .sort((left, right) => Number(right.state === "REFERENCED") - Number(left.state === "REFERENCED"));
    let next = 0;
    const workers = Array.from({ length: Math.min(2, candidates.length) }, async () => {
      while (next < candidates.length) {
        const candidate = candidates[next++];
        let completed = false;
        while (!completed) {
          try {
            const latest = await apiJson(`/api/admin/migrations/legacy/${run.id}`);
            run = await uploadCandidate(run.id, candidate, latest.detail?.run.revision ?? run.revision, sourceScan);
            setActiveRun(run);
            if (candidate.state === "REFERENCED") requiredMapped += 1; else optionalMapped += 1;
            setRequiredProgress({ mapped: requiredMapped, total: requiredTotal, optional: optionalMapped });
            completed = true;
          } catch (uploadError) {
            if (uploadError instanceof Error && uploadError.message === "LEGACY_MIGRATION_CONFLICT") continue;
            throw uploadError;
          }
        }
      }
    });
    await Promise.all(workers);
    const latest = await apiJson(`/api/admin/migrations/legacy/${run.id}`);
    run = latest.detail!.run;
    const final = await apiJson(`/api/admin/migrations/legacy/${run.id}/finalize`, { method: "POST", body: JSON.stringify({ expectedRevision: run.revision }) });
    setActiveRun(final.run!);
    setSelectedDetail((await apiJson(`/api/admin/migrations/legacy/${run.id}`)).detail ?? null);
    await loadRuns();
  };

  const stageNew = async () => {
    if (!scan || duplicateReady) return;
    setBusy(true); setError(null);
    try {
      const created = await apiJson("/api/admin/migrations/legacy", { method: "POST", body: JSON.stringify({ sourceOrigin: scan.snapshot.origin }) });
      let run = created.run!; setActiveRun(run);
      const stored = await apiJson(`/api/admin/migrations/legacy/${run.id}/snapshot`, { method: "POST", body: JSON.stringify({ expectedRevision: run.revision, sourceFingerprint: scan.sourceFingerprint, snapshot: scan.snapshot }) });
      run = stored.run!; setActiveRun(run);
      if (stored.duplicateReadyRun) {
        await apiJson(`/api/admin/migrations/legacy/${run.id}/cancel`, { method: "POST", body: JSON.stringify({ expectedRevision: run.revision }) });
        setDuplicateReady(stored.duplicateReadyRun);
        await loadRuns();
        return;
      }
      await stageMissing(run, scan, []);
    } catch (stageError) { setError(stageError instanceof Error ? stageError.message : "تعذر تجهيز نسخة الترحيل."); }
    finally { setBusy(false); }
  };

  const resumeRun = async (run: LegacyMigrationRun) => {
    setBusy(true); setError(null); setActiveRun(run);
    try {
      const currentScan = await scanBrowser();
      if (run.sourceFingerprint !== currentScan.sourceFingerprint) {
        setError("تغيرت البيانات المحلية منذ إنشاء نسخة الترحيل. لا يمكن متابعة هذه النسخة؛ أنشئ محاولة جديدة من الفحص الحالي.");
        return;
      }
      const resumed = await apiJson(`/api/admin/migrations/legacy/${run.id}/resume`, { method: "POST", body: JSON.stringify({ sourceFingerprint: currentScan.sourceFingerprint }) });
      setSelectedDetail(resumed.detail ?? null);
      await stageMissing(resumed.detail!.run, currentScan, resumed.detail!.assets);
    } catch (resumeError) {
      setError(resumeError instanceof Error && resumeError.message === "LEGACY_MIGRATION_SOURCE_CHANGED" ? "تغيرت البيانات المحلية منذ إنشاء نسخة الترحيل." : resumeError instanceof Error ? resumeError.message : "تعذر استئناف الترحيل.");
    } finally { setBusy(false); }
  };

  const openRun = async (run: LegacyMigrationRun) => {
    const result = await apiJson(`/api/admin/migrations/legacy/${run.id}`);
    setSelectedDetail(result.detail ?? null);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-5 md:p-8" dir="rtl">
      <header className="rounded-2xl border bg-card p-6 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div className="space-y-2"><div className="flex items-center gap-2 text-primary"><DatabaseBackup className="h-5 w-5" /><span className="text-xs font-bold">أداة OWNER محمية</span></div><h1 className="text-2xl font-bold">ترحيل البيانات المحلية</h1><p className="max-w-3xl text-sm leading-7 text-muted-foreground">افتح هذه الصفحة من ملف المتصفح الذي يحتوي على تعديلاتك وصورك القديمة. الفحص للقراءة فقط، ويخزن بيانات وصفية دون الاحتفاظ بكل الصور في الذاكرة، ولا يطبق أي cutover.</p></div><button onClick={startScan} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}فحص هذا المتصفح</button></div></header>

      <div className="grid gap-3 md:grid-cols-3">{[{ icon: Eye, title: "قراءة فقط", copy: "لا كتابة إلى localStorage أو IndexedDB" }, { icon: ShieldCheck, title: "ذاكرة محدودة", copy: "تُقرأ كل صورة عند فحصها أو رفعها فقط" }, { icon: ArchiveRestore, title: "لا يوجد cutover", copy: "يبقى المنتج على التخزين القديم حتى M7" }].map(({ icon: Icon, title, copy }) => <div key={title} className="rounded-xl border bg-card p-4"><Icon className="mb-3 h-5 w-5 text-primary" /><div className="text-sm font-bold">{title}</div><div className="mt-1 text-xs text-muted-foreground">{copy}</div></div>)}</div>
      {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"><AlertTriangle className="h-4 w-4" />{error}</div>}

      {scan && <section className="space-y-4 rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">نتيجة الفحص</h2><p className="text-xs text-muted-foreground">البصمة: <span className="font-mono">{scan.sourceFingerprint.slice(0, 18)}…</span></p></div><span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600">لم تتغير بيانات المتصفح</span></div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">{Object.entries({ "البانرات": counts.banners, "المواد": counts.materials, "الأدوات": counts.tools, "التنقل": counts.navigation, "الصور المطلوبة": counts.requiredImages, "الصور اليتيمة": counts.orphanImages }).map(([label, value]) => <div key={label} className="rounded-xl bg-muted/50 p-3 text-center"><div className="text-xl font-bold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>)}</div>
        <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-bold">المشكلات والملاحظات ({scan.snapshot.issues.length})</summary><div className="mt-3 space-y-2">{scan.snapshot.issues.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد ملاحظات.</p> : scan.snapshot.issues.map((issue, index) => <div key={`${issue.code}-${index}`} className="rounded-lg bg-muted/50 p-3 text-xs"><span className={issue.severity === "ERROR" ? "text-destructive" : issue.severity === "WARNING" ? "text-amber-600" : "text-muted-foreground"}>{issue.severity}</span> · {issue.code} — {issue.message}</div>)}</div></details>
        <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-bold">معاينة الصور عند الطلب ({scan.imageCandidates.length})</summary><div className="mt-3 grid grid-cols-3 gap-3 md:grid-cols-6">{scan.imageCandidates.slice(0, 18).map((candidate) => <div key={candidate.legacyReference} className="overflow-hidden rounded-lg border bg-muted">{previewReference === candidate.legacyReference ? <LazyLegacyImagePreview candidate={candidate} reader={scan.imageReader} /> : <button type="button" onClick={() => setPreviewReference(candidate.legacyReference)} className="grid aspect-square w-full place-items-center text-[10px] text-muted-foreground"><Eye className="mb-1 h-4 w-4" />تحميل المعاينة</button>}<div className="truncate p-1 text-[9px]">{candidate.legacyReference}</div></div>)}</div></details>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={includeOrphans} onChange={(event) => setIncludeOrphans(event.target.checked)} /> تضمين الصور اليتيمة في مكتبة الأصول (اختياري، ولن تُحذف من المتصفح)</label>
        {duplicateReady ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700"><span>هذه النسخة المحلية محفوظة مسبقًا وجاهزة.</span><button type="button" onClick={() => void openRun(duplicateReady)} className="rounded-lg border px-3 py-2 font-semibold">فتح النسخة الجاهزة</button></div> : <button onClick={stageNew} disabled={busy || scan.snapshot.issues.some((issue) => issue.severity === "ERROR")} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"><ImageIcon className="h-4 w-4" />إنشاء نسخة تجهيز ونسخ الصور</button>}
        {requiredProgress.total > 0 && <div className="space-y-2"><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, (requiredProgress.mapped / requiredProgress.total) * 100)}%` }} /></div><p className="text-xs text-muted-foreground">{requiredProgress.mapped} من {requiredProgress.total} صور مطلوبة · أصول يتيمة اختيارية منسوخة: {requiredProgress.optional}</p></div>}
        {activeRun?.status === "READY" && <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700"><CheckCircle2 className="h-5 w-5" />اكتمل التجهيز وأصبحت النسخة READY. لم يحدث cutover.</div>}
      </section>}

      <section className="rounded-2xl border bg-card p-5"><h2 className="font-bold">محاولات الترحيل السابقة</h2><div className="mt-4 space-y-2">{runs.length === 0 ? <p className="text-sm text-muted-foreground">لا توجد محاولات محفوظة بعد.</p> : runs.map((run) => { const metrics = runMetrics(runDetails[run.id]); return <div key={run.id} className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-xs"><button type="button" onClick={() => void openRun(run)} className="min-w-0 flex-1 text-right"><div className="truncate font-mono">{run.id}</div><div className="text-muted-foreground">{new Date(run.createdAt).toLocaleString("ar-IQ")} · الصور المطلوبة: {metrics.requiredMapped} من {metrics.required} · اليتيمة الاختيارية: {metrics.optionalOrphans}</div></button><div className="flex items-center gap-2"><span className="rounded-full bg-muted px-3 py-1 font-semibold">{statusLabel[run.status]}</span>{run.status === "IMPORTING" && <button type="button" disabled={busy} onClick={() => void resumeRun(run)} className="rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50">متابعة الترحيل</button>}</div></div>; })}</div>
        {selectedDetail && <div className="mt-4 rounded-xl border bg-muted/30 p-4 text-xs"><div className="mb-2 flex items-center justify-between"><strong>تفاصيل النسخة {statusLabel[selectedDetail.run.status]}</strong><button type="button" onClick={() => setSelectedDetail(null)} className="text-muted-foreground">إغلاق</button></div><div className="grid gap-2 md:grid-cols-3"><span>السجلات: {selectedDetail.run.bannerCount + selectedDetail.run.materialCount + selectedDetail.run.toolCount + selectedDetail.run.navigationCount}</span><span>الصور المطلوبة: {runMetrics(selectedDetail).requiredMapped} من {runMetrics(selectedDetail).required}</span><span>الصور اليتيمة الاختيارية: {runMetrics(selectedDetail).optionalOrphans}</span></div><p className="mt-2 text-muted-foreground">المصدر ثابت بعد أول حفظ. إدخالات الخرائط مستقلة ولا تغير revision؛ أما الحفظ النهائي والإلغاء فيبطلان أي دفعة قديمة. READY تعني تجهيزًا آمنًا فقط.</p></div>}
      </section>
    </div>
  );
}
