"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";
import { InspectorPanel } from "@/components/admin-ui/layout/master-detail";
import { Tabs } from "@/components/admin-ui/navigation/tabs";
import { Button } from "@/components/admin-ui/primitives/button";
import { Panel, PanelBody, PanelHeader, Well } from "@/components/admin-ui/primitives/surface";
import { Badge } from "@/components/admin-ui/status/status-badge";
import { DateCell } from "@/components/admin-ui/tables/cells";
import { RichDocumentRenderer } from "@/components/admin/rich-content";
import type { DirectQuestionDetail, DirectQuestionPackageTaxonomyNode } from "@/server/question-editor";
import { questionSourceKindLabel } from "@/lib/question-source-labels";

const buildLocalAdminRichContentAssetUrl = (assetId: string) =>
  `/api/admin/local/assets/${encodeURIComponent(assetId)}/content`;

export function CanonicalQuestionInspector({
  question,
  taxonomy,
  onClose,
  onEdit,
  className,
}: {
  question: DirectQuestionDetail | null;
  taxonomy: DirectQuestionPackageTaxonomyNode[];
  onClose: () => void;
  onEdit: () => void;
  className?: string;
}) {
  const [tab, setTab] = React.useState<"preview" | "variants" | "sources" | "taxonomy">("preview");
  if (!question) return null;
  const primary = question.content.variants.find((variant) => variant.id === question.content.primaryVariantId) ?? question.content.variants[0];
  const taxonomyById = new Map(taxonomy.map((node) => [node.id, node]));

  return (
    <InspectorPanel
      open
      onClose={onClose}
      title={`سؤال #${question.content.displayOrder}`}
      subtitle="تفاصيل السؤال"
      width="lg"
      className={className}
      actions={<Button size="sm" variant="secondary" icon={<ExternalLink aria-hidden />} onClick={onEdit}>تعديل</Button>}
    >
      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} items={[{ value: "preview", label: "المعاينة" }, { value: "variants", label: "الصيغ", count: question.content.variants.length }, { value: "sources", label: "المصدر والورود" }, { value: "taxonomy", label: "التصنيف" }]} />
      <div className="mt-4">
        {tab === "preview" ? <PreviewTab question={question} primary={primary} /> : null}
        {tab === "variants" ? <VariantsTab question={question} /> : null}
        {tab === "sources" ? <SourcesTab question={question} /> : null}
        {tab === "taxonomy" ? <TaxonomyTab question={question} taxonomyById={taxonomyById} /> : null}
      </div>
    </InspectorPanel>
  );
}

function PreviewTab({ question, primary }: { question: DirectQuestionDetail; primary: DirectQuestionDetail["content"]["variants"][number] | undefined }) {
  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader title="الصيغة الأساسية" description="هذه هي الصيغة الأساسية التي تظهر افتراضيًا للطالب." density="compact" />
        <PanelBody>{primary ? <RichDocumentRenderer document={primary.content} resolveAssetUrl={buildLocalAdminRichContentAssetUrl} /> : <Well padding="sm"><p className="text-xs text-fg-tertiary">لا توجد صيغة أساسية.</p></Well>}</PanelBody>
      </Panel>
      <Panel>
        <PanelHeader title="الإجابة المشتركة" density="compact" actions={<Badge size="sm" variant="subtle" tone={question.content.sharedAnswer ? "success" : "neutral"}>{question.content.sharedAnswer ? "موجودة" : "غير موجودة"}</Badge>} />
        <PanelBody>{question.content.sharedAnswer ? <RichDocumentRenderer document={question.content.sharedAnswer} resolveAssetUrl={buildLocalAdminRichContentAssetUrl} /> : <p className="text-sm text-fg-tertiary">لا توجد إجابة مشتركة لهذا السؤال.</p>}</PanelBody>
      </Panel>
      <TechnicalDetails question={question} />
    </div>
  );
}

function VariantsTab({ question }: { question: DirectQuestionDetail }) {
  return <div className="space-y-3">{question.content.variants.map((variant, index) => <Panel key={variant.id}><PanelHeader title={`صيغة ${index + 1}`} actions={variant.id === question.content.primaryVariantId ? <Badge size="sm" variant="subtle" tone="accent">الصيغة الأساسية</Badge> : undefined} density="compact" /><PanelBody><RichDocumentRenderer document={variant.content} resolveAssetUrl={buildLocalAdminRichContentAssetUrl} /><p className="mt-3 text-xs text-fg-tertiary">{variant.occurrences.length} ورود</p></PanelBody></Panel>)}</div>;
}

function SourcesTab({ question }: { question: DirectQuestionDetail }) {
  const occurrences = question.content.variants.flatMap((variant, variantIndex) => variant.occurrences.map((occurrence) => ({ ...occurrence, variantIndex })));
  if (!occurrences.length) return <Well padding="md"><p className="text-center text-sm text-fg-tertiary">لا توجد ورود مصدرية لهذا السؤال.</p></Well>;
  return <div className="space-y-2">{occurrences.map((occurrence) => <Panel key={occurrence.id} variant="inset"><PanelBody><div className="flex flex-wrap items-center gap-2"><Badge size="sm" variant="subtle" tone="neutral">{questionSourceKindLabel(occurrence.sourceKind)}</Badge>{occurrence.year ? <span className="text-xs text-fg-secondary tnum">{occurrence.year}</span> : null}<span className="text-xs text-fg-quaternary">صيغة {occurrence.variantIndex + 1}</span></div><p className="mt-2 text-sm text-fg">{occurrence.rawLabel}</p><div className="mt-2 flex flex-wrap gap-1.5 text-2xs text-fg-tertiary">{[occurrence.roundCode, occurrence.session, occurrence.sourceName, occurrence.notes].filter(Boolean).map((value) => <span key={value} className="rounded-sm border border-border-subtle bg-surface px-1.5 py-1">{value}</span>)}{occurrence.branches.map((value) => <span key={`branch:${value}`} className="rounded-sm border border-border-subtle bg-surface px-1.5 py-1">{value}</span>)}{occurrence.qualifiers.map((value) => <span key={`qualifier:${value}`} className="rounded-sm border border-border-subtle bg-surface px-1.5 py-1">{value}</span>)}</div></PanelBody></Panel>)}</div>;
}

function TaxonomyTab({ question, taxonomyById }: { question: DirectQuestionDetail; taxonomyById: Map<string, DirectQuestionPackageTaxonomyNode> }) {
  if (!question.content.taxonomyAssignments.length) return <Well padding="md"><p className="text-center text-sm text-fg-tertiary">غير مصنّف.</p></Well>;
  return <div className="space-y-2">{question.content.taxonomyAssignments.map((assignment) => { const node = taxonomyById.get(assignment.taxonomyNodeId); return <Panel key={assignment.taxonomyNodeId} variant="inset"><PanelBody><div className="flex items-center gap-2"><Badge size="sm" variant="subtle" tone={assignment.role === "PRIMARY" ? "accent" : "neutral"}>{assignment.role === "PRIMARY" ? "أساسي" : "مرتبط"}</Badge><span className="text-sm text-fg">{node?.breadcrumb ?? "تصنيف غير موجود"}</span></div></PanelBody></Panel>; })}</div>;
}

function TechnicalDetails({ question }: { question: DirectQuestionDetail }) {
  return <details className="rounded-md border border-border-subtle bg-inset px-3 py-2"><summary className="cursor-pointer text-xs text-fg-tertiary">تفاصيل تقنية</summary><dl className="mt-3 grid gap-2 text-xs"><div className="flex justify-between gap-3"><dt className="text-fg-tertiary">معرّف السؤال</dt><dd dir="ltr" className="font-mono text-fg-secondary">{question.id}</dd></div><div className="flex justify-between gap-3"><dt className="text-fg-tertiary">معرّف الحزمة</dt><dd dir="ltr" className="font-mono text-fg-secondary">{question.packageId}</dd></div><div className="flex justify-between gap-3"><dt className="text-fg-tertiary">Revision</dt><dd dir="ltr" className="font-mono text-fg-secondary">{question.revision}</dd></div><div className="flex items-center justify-between gap-3"><dt className="text-fg-tertiary">آخر تحديث</dt><dd><DateCell value={question.updatedAt} relative={false} /></dd></div></dl></details>;
}
