import { ArrowLeft, CheckCircle2, FileQuestion, GitCompareArrows, Tags } from "lucide-react";
import type { ReactNode } from "react";
import { RichDocumentRenderer } from "@/components/admin/rich-content/RichDocumentRenderer";
import { buildAdminRichContentAssetUrl } from "@/lib/rich-content/asset-urls";
import type { CanonicalRichDocument, QuestionItemContent, QuestionVariantContent } from "@/server/questions/contracts";
import type { ChangeDetails } from "./types";

type ReviewItem = ChangeDetails["items"][number];

export function QuestionReviewItem({ item, taxonomyLabels = {} }: { item: ReviewItem; taxonomyLabels?: Record<string, string> }) {
  const before = asQuestionItem(item.beforeSnapshot);
  const after = asQuestionItem(item.proposedSnapshot);
  if (!after) return null;

  const changedVariants = collectChangedVariants(before, after);
  const beforeOccurrences = countOccurrences(before);
  const afterOccurrences = countOccurrences(after);
  const answerChanged = !sameJson(before?.sharedAnswer ?? null, after.sharedAnswer);
  const taxonomyChanged = !sameJson(before?.taxonomyAssignments ?? [], after.taxonomyAssignments);

  return (
    <article className="overflow-hidden rounded-2xl border bg-card" data-review-kind="question-item">
      <header className="flex flex-col gap-3 border-b bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><FileQuestion className="h-4 w-4" /></span>
          <div>
            <p className="text-sm font-black">{item.presentation.resourceLabel}</p>
            <p className="mt-1 text-[11px] text-muted-foreground" dir="auto">{item.presentation.resourceSubtitle}</p>
          </div>
        </div>
        <span className="w-fit rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold text-primary">{item.presentation.areaLabel}</span>
      </header>

      <div className="space-y-5 p-4">
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="ملخص تعديل السؤال">
          <SummaryMetric label="الترتيب" before={before?.displayOrder} after={after.displayOrder} />
          <SummaryMetric label="الصيغ" before={before?.variants.length ?? 0} after={after.variants.length} />
          <SummaryMetric label="الورودات" before={beforeOccurrences} after={afterOccurrences} />
          <SummaryMetric label="التصنيفات" before={before?.taxonomyAssignments.length ?? 0} after={after.taxonomyAssignments.length} />
        </section>

        {changedVariants.length > 0 && (
          <section className="space-y-3">
            <SectionTitle icon={GitCompareArrows} title="الصيغ المتغيّرة" subtitle={`${changedVariants.length} صيغة تحتاج مراجعة`} />
            {changedVariants.map(({ id, previous, proposed }) => (
              <div key={id} className="rounded-xl border bg-background/60 p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold">الصيغة #{proposed?.displayOrder ?? previous?.displayOrder}</p>
                  <div className="flex gap-1.5">
                    {before?.primaryVariantId === id && <Badge tone="old">أساسية سابقًا</Badge>}
                    {after.primaryVariantId === id && <Badge tone="new"><CheckCircle2 className="h-3 w-3" />أساسية الآن</Badge>}
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <DocumentSide label="قبل" tone="old" document={previous?.content} empty="صيغة جديدة" />
                  <DocumentSide label="بعد" tone="new" document={proposed?.content} empty="الصيغة غير موجودة" />
                </div>
                <OccurrenceSummary before={previous} after={proposed} />
              </div>
            ))}
          </section>
        )}

        {answerChanged && (
          <section className="space-y-3">
            <SectionTitle icon={ArrowLeft} title="الجواب المشترك" subtitle="مقارنة الجواب قبل النشر وبعده" />
            <div className="grid gap-3 lg:grid-cols-2">
              <DocumentSide label="قبل" tone="old" document={before?.sharedAnswer ?? undefined} empty="لا يوجد جواب سابق" />
              <DocumentSide label="بعد" tone="new" document={after.sharedAnswer ?? undefined} empty="لا يوجد جواب مقترح" />
            </div>
          </section>
        )}

        {taxonomyChanged && (
          <section className="rounded-xl border bg-muted/20 p-3">
            <SectionTitle icon={Tags} title="التصنيف" subtitle="مقارنة روابط السؤال داخل شجرة التصنيف" />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <AssignmentList label="قبل" assignments={before?.taxonomyAssignments ?? []} taxonomyLabels={taxonomyLabels} />
              <AssignmentList label="بعد" assignments={after.taxonomyAssignments} taxonomyLabels={taxonomyLabels} />
            </div>
          </section>
        )}
      </div>
    </article>
  );
}

function DocumentSide({ label, tone, document, empty }: { label: string; tone: "old" | "new"; document?: CanonicalRichDocument; empty: string }) {
  return (
    <div className={`min-w-0 rounded-xl border p-3 ${tone === "old" ? "border-destructive/20 bg-destructive/[.025]" : "border-emerald-500/25 bg-emerald-500/[.035]"}`}>
      <p className={`mb-3 text-[10px] font-bold ${tone === "old" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`}>{label}</p>
      {document ? <RichDocumentRenderer document={document} resolveAssetUrl={buildAdminRichContentAssetUrl} fallbackLabel="تعذر عرض هذا المحتوى." /> : <p className="py-5 text-center text-xs text-muted-foreground">{empty}</p>}
    </div>
  );
}

function OccurrenceSummary({ before, after }: { before?: QuestionVariantContent; after?: QuestionVariantContent }) {
  if (sameJson(before?.occurrences ?? [], after?.occurrences ?? [])) return null;
  return (
    <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2">
      <OccurrenceList label="المصادر قبل" values={(before?.occurrences ?? []).map((item) => item.rawLabel)} />
      <OccurrenceList label="المصادر بعد" values={(after?.occurrences ?? []).map((item) => item.rawLabel)} />
    </div>
  );
}

function OccurrenceList({ label, values }: { label: string; values: string[] }) {
  return <div><p className="text-[10px] font-semibold text-muted-foreground">{label} ({values.length})</p>{values.length ? <ul className="mt-1.5 space-y-1 text-[11px]">{values.map((value, index) => <li key={`${index}-${value}`} className="rounded-lg bg-muted/40 px-2 py-1.5" dir="auto">{value}</li>)}</ul> : <p className="mt-1.5 text-[11px] text-muted-foreground">لا توجد مصادر</p>}</div>;
}

function AssignmentList({ label, assignments, taxonomyLabels }: { label: string; assignments: QuestionItemContent["taxonomyAssignments"]; taxonomyLabels: Record<string, string> }) {
  return <div className="rounded-lg bg-background p-2.5"><p className="text-[10px] font-semibold text-muted-foreground">{label} ({assignments.length})</p>{assignments.length ? <ul className="mt-2 space-y-1 text-[11px]">{assignments.map((assignment) => <li key={assignment.taxonomyNodeId} className="flex items-center justify-between gap-2"><span className="truncate" dir="auto" title={taxonomyLabels[assignment.taxonomyNodeId] ?? assignment.taxonomyNodeId}>{taxonomyLabels[assignment.taxonomyNodeId] ?? shortId(assignment.taxonomyNodeId)}</span><Badge tone={assignment.role === "PRIMARY" ? "new" : "neutral"}>{assignment.role === "PRIMARY" ? "أساسي" : "مرتبط"}</Badge></li>)}</ul> : <p className="mt-2 text-[11px] text-muted-foreground">لا توجد روابط</p>}</div>;
}

function SummaryMetric({ label, before, after }: { label: string; before?: number; after: number }) {
  const changed = before !== after;
  return <div className="rounded-xl border bg-background p-3"><p className="text-[10px] text-muted-foreground">{label}</p><div className="mt-1 flex items-center gap-1.5 text-sm font-black"><span className={changed ? "text-muted-foreground line-through" : "text-foreground"}>{before ?? "—"}</span>{changed && <><ArrowLeft className="h-3 w-3 text-primary" /><span className="text-primary">{after}</span></>}</div></div>;
}

function SectionTitle({ icon: Icon, title, subtitle }: { icon: typeof GitCompareArrows; title: string; subtitle: string }) {
  return <div className="flex items-center gap-2"><Icon className="h-4 w-4 text-primary" /><div><h3 className="text-xs font-black">{title}</h3><p className="mt-0.5 text-[10px] text-muted-foreground">{subtitle}</p></div></div>;
}

function Badge({ children, tone }: { children: ReactNode; tone: "old" | "new" | "neutral" }) {
  const style = tone === "new" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : tone === "old" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground";
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-semibold ${style}`}>{children}</span>;
}

function collectChangedVariants(before: QuestionItemContent | null, after: QuestionItemContent) {
  const previous = new Map((before?.variants ?? []).map((variant) => [variant.id, variant]));
  const proposed = new Map(after.variants.map((variant) => [variant.id, variant]));
  return [...new Set([...previous.keys(), ...proposed.keys()])]
    .map((id) => ({ id, previous: previous.get(id), proposed: proposed.get(id) }))
    .filter((entry) => !sameJson(entry.previous, entry.proposed));
}

function asQuestionItem(value: Record<string, unknown>): QuestionItemContent | null {
  if (typeof value.packageId !== "string" || !Array.isArray(value.variants) || !Array.isArray(value.taxonomyAssignments)) return null;
  return value as unknown as QuestionItemContent;
}

function countOccurrences(value: QuestionItemContent | null): number {
  return value?.variants.reduce((total, variant) => total + variant.occurrences.length, 0) ?? 0;
}

function shortId(value: string): string { return `${value.slice(0, 8)}…${value.slice(-4)}`; }
function sameJson(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
