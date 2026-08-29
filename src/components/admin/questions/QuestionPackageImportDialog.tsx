"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileInput, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { QuestionPackageInspection } from "@/server/question-packages";
import type { CompactQuestionPackageStageResult, QuestionPackageImportPreflight } from "@/server/question-import";

export function QuestionPackageImportDialog({ assetId, inspection }: { assetId: string; inspection: QuestionPackageInspection }) {
  const [open, setOpen] = useState(false);
  const [preflight, setPreflight] = useState<QuestionPackageImportPreflight | null>(null);
  const [result, setResult] = useState<CompactQuestionPackageStageResult | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligibleInspection = inspection.status === "VALID" || inspection.status === "VALID_WITH_WARNINGS";

  const openPreflight = async () => {
    setOpen(true); setBusy(true); setError(null); setResult(null); setAcknowledged(false);
    try {
      const response = await fetch(`/api/admin/question-packages/preflight/${assetId}`);
      const body = await response.json() as { ok?: boolean; preflight?: QuestionPackageImportPreflight; code?: string };
      if (!response.ok || !body.preflight) throw new Error(body.code ?? "PREFLIGHT_FAILED");
      setPreflight(body.preflight);
    } catch { setError("تعذّر إجراء الفحص المسبق للحزمة."); }
    finally { setBusy(false); }
  };

  const stage = async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/admin/question-packages/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetId, acknowledgeWarnings: acknowledged }) });
      const body = await response.json() as { ok?: boolean; result?: CompactQuestionPackageStageResult; code?: string };
      if (!response.ok || !body.result) throw new Error(body.code ?? "STAGE_FAILED");
      setResult(body.result);
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "QUESTION_IMPORT_ACKNOWLEDGEMENT_REQUIRED" ? "يجب الإقرار بالتحذيرات أولًا." : "تعذّر تجهيز مسودة الاستيراد. لم تُكتب أي بيانات قانونية.");
    } finally { setBusy(false); }
  };

  if (!eligibleInspection) return <p className="mt-3 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-[11px] text-destructive">هذه البيانات ليست حزمة أسئلة صالحة للاستيراد، لذلك لا يتوفر إجراء الاستيراد.</p>;
  return <>
    <Button className="mt-3 w-full" onClick={() => void openPreflight()}><FileInput className="h-4 w-4" /> فحص واستيراد الحزمة</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" dir="rtl">
        <DialogHeader className="text-right"><DialogTitle>الفحص المسبق لاستيراد الحزمة</DialogTitle><DialogDescription>قراءة خادمية جديدة للملف؛ لا يُنشأ أي محتوى قانوني في هذه الخطوة.</DialogDescription></DialogHeader>
        {busy && !preflight ? <div className="grid min-h-48 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : null}
        {error ? <p className="rounded-xl bg-destructive/10 p-3 text-xs text-destructive">{error}</p> : null}
        {preflight && !result ? <PreflightSummary value={preflight} acknowledged={acknowledged} onAcknowledged={setAcknowledged} /> : null}
        {result ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" /><h3 className="mt-3 font-bold">{result.outcome === "ALREADY_IMPORTED" ? "الحزمة منشورة مسبقًا" : result.outcome === "EXISTING_DRAFT" ? "مسودة التحديث موجودة" : result.operation === "UPDATE" ? "تم تجهيز مسودة تحديث الحزمة" : "تم تجهيز مسودة الاستيراد"}</h3><p className="mt-2 text-xs text-muted-foreground">{result.itemCount.toLocaleString("ar-IQ")} عنصر تغيير. لم تتغير البيانات القانونية بعد.</p>{result.changeSetId ? <Button asChild className="mt-4"><Link href={`/admin/review/${result.changeSetId}`}>فتح المسودة في المراجعة</Link></Button> : null}</div> : null}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>إغلاق</Button>
          {preflight && !result && preflight.eligible && !preflight.existingChangeSetId ? <Button disabled={busy || (preflight.acknowledgementRequired && !acknowledged)} onClick={() => void stage()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileInput className="h-4 w-4" />} {preflight.operation === "UPDATE" ? "إنشاء مسودة التحديث" : "إنشاء مسودة الاستيراد"}</Button> : null}
          {preflight?.existingChangeSetId && !result ? <Button asChild><Link href={`/admin/review/${preflight.existingChangeSetId}`}>فتح المسودة الموجودة</Link></Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function PreflightSummary({ value, acknowledged, onAcknowledged }: { value: QuestionPackageImportPreflight; acknowledged: boolean; onAcknowledged: (value: boolean) => void }) {
  const c = value.counts;
  return <div className="space-y-4">
    {value.package ? <section className="rounded-2xl border bg-muted/25 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold" dir="auto">{value.package.title}</h3><p className="mt-1 font-mono text-[10px] text-muted-foreground">{value.package.key} · rev {value.package.contentRevision}</p></div><span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold text-primary">{value.package.subjectKey}</span></div><p className="mt-3 text-xs text-muted-foreground">{value.package.bankBrowseEntry.label} · {value.package.bankBrowseMode}</p></section> : null}
    {value.update ? <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">تحديث محكوم للحزمة</h3><span className="font-mono text-xs text-muted-foreground">rev {value.update.contentRevision.from} → {value.update.contentRevision.to}</span></div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{[["أسئلة مضافة", value.update.questionsAdded], ["أسئلة محدثة", value.update.questionsUpdated], ["أسئلة محتفظ بها", value.update.questionsRetained], ["ورود مضافة", value.update.occurrencesAdded], ["ورود محدثة", value.update.occurrencesUpdated], ["صيغ محدثة", value.update.variantsUpdated], ["تصنيفات محدثة", value.update.taxonomyUpdated], ["محتوى غني متغير", value.update.richContentChanged]].map(([label, count]) => <div key={String(label)} className="rounded-xl border bg-background/70 p-2.5"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 font-black">{Number(count).toLocaleString("ar-IQ")}</p></div>)}</div>{value.update.questionsSuperseded || value.update.variantsSuperseded || value.update.occurrencesSuperseded || value.update.taxonomySuperseded ? <p className="mt-3 text-xs font-semibold text-destructive">يوجد موارد ستحتاج مراجعة صريحة؛ لن يتم حذفها ضمنيًا.</p> : null}</section> : null}
    <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["الأسئلة",c.questions],["الصيغ",c.variants],["الورود",c.occurrences],["التصنيفات",c.taxonomy],["مسارات التصفح",c.browseNodes],["الأصول المستخدمة",c.usedAssets],["الأصول المحلولة",c.resolvedAssets],["عناصر التغيير",c.estimatedChangeItems]].map(([label,count]) => <div key={String(label)} className="rounded-xl border p-3"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 font-black">{Number(count).toLocaleString("ar-IQ")}</p></div>)}</section>
    {value.blockers.length ? <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-3"><p className="flex items-center gap-2 text-xs font-bold text-destructive"><AlertTriangle className="h-4 w-4" /> عوائق تمنع الاستيراد</p><ul className="mt-2 space-y-1 text-[11px] text-destructive">{value.blockers.map((item, index) => <li key={`${item.code}-${index}`}>{item.code}: {item.message}</li>)}</ul></section> : null}
    {value.warnings.length ? <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"><p className="text-xs font-bold text-amber-700 dark:text-amber-400">تحذيرات الفحص ({value.warnings.length})</p><ul className="mt-2 max-h-32 space-y-1 overflow-auto text-[11px] text-muted-foreground">{value.warnings.map((item, index) => <li key={`${item.code}-${index}`}>{item.code}: {item.message}</li>)}</ul>{value.acknowledgementRequired ? <label className="mt-3 flex cursor-pointer items-start gap-2 border-t pt-3 text-xs"><Checkbox checked={acknowledged} onCheckedChange={(checked) => onAcknowledged(checked === true)} /><span>راجعت التحذيرات وأفهم أن الحزمة ستدخل كمسودة للمراجعة، لا كمحتوى منشور.</span></label> : null}</section> : null}
    {value.existingChangeSetId ? <p className="rounded-xl bg-blue-500/10 p-3 text-xs text-blue-700 dark:text-blue-300">توجد مسودة نشطة لهذه الحزمة وسيتم فتحها بدل إنشاء نسخة مكررة.</p> : null}
    {value.alreadyImported ? <p className="rounded-xl bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">هذه الحزمة موجودة بالفعل في المحتوى القانوني.</p> : null}
  </div>;
}
