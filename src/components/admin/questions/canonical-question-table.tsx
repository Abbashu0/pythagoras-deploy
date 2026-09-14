"use client";

import * as React from "react";
import { Check, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { DataTable, actionsColumn, type CellMeta, type ColumnDef, type TableDensity } from "@/components/admin-ui/tables/data-table";
import { NumberCell, PrimaryCell } from "@/components/admin-ui/tables/cells";
import { Badge } from "@/components/admin-ui/status/status-badge";
import { IconButton } from "@/components/admin-ui/primitives/button";
import { Tooltip } from "@/components/admin-ui/primitives/tooltip";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/admin-ui/overlays/menu";
import type { DirectQuestionSummary } from "@/server/question-editor";
import { questionSourceKindLabel } from "@/lib/question-source-labels";

export function CanonicalQuestionTable({
  items,
  density = "compact",
  loading = false,
  activeRowId,
  onRowClick,
  onEdit,
  onDelete,
  noResultsState,
}: {
  items: DirectQuestionSummary[];
  density?: TableDensity;
  loading?: boolean;
  activeRowId?: string | null;
  onRowClick?: (item: DirectQuestionSummary) => void;
  onEdit?: (item: DirectQuestionSummary) => void;
  onDelete?: (item: DirectQuestionSummary) => void;
  noResultsState?: React.ReactNode;
}) {
  const columns = React.useMemo<ColumnDef<DirectQuestionSummary, unknown>[]>(() => [
    {
      id: "displayOrder",
      accessorKey: "displayOrder",
      header: "الترتيب",
      meta: { label: "الترتيب", width: 76, align: "end" } satisfies CellMeta,
      cell: ({ row }) => <NumberCell value={row.original.displayOrder} />,
    },
    {
      id: "question",
      accessorKey: "primaryPreview",
      header: "السؤال",
      meta: { label: "السؤال", width: "40%", truncate: true } satisfies CellMeta,
      cell: ({ row }) => <PrimaryCell label={<Tooltip content={row.original.primaryPreview.length > 80 ? row.original.primaryPreview : null}><span>{row.original.primaryPreview}</span></Tooltip>} secondary={row.original.matchContext ? matchLabel(row.original.matchContext) : undefined} />,
    },
    {
      id: "taxonomy",
      accessorKey: "taxonomyBreadcrumb",
      header: "التصنيف",
      meta: { label: "التصنيف", width: "22%", truncate: true } satisfies CellMeta,
      cell: ({ row }) => <Tooltip content={row.original.taxonomyBreadcrumb}><span className="truncate text-sm text-fg-secondary">{row.original.taxonomyBreadcrumb}</span></Tooltip>,
    },
    {
      id: "variants",
      accessorKey: "variantCount",
      header: "الصيغ",
      meta: { label: "الصيغ", width: 72, align: "end" } satisfies CellMeta,
      cell: ({ row }) => <NumberCell value={row.original.variantCount} />,
    },
    {
      id: "occurrences",
      accessorKey: "occurrenceCount",
      header: "الورود",
      meta: { label: "الورود", width: 72, align: "end" } satisfies CellMeta,
      cell: ({ row }) => <NumberCell value={row.original.occurrenceCount} />,
    },
    {
      id: "answer",
      accessorKey: "hasAnswer",
      header: "الإجابة",
      meta: { label: "الإجابة", width: 84, align: "center" } satisfies CellMeta,
      cell: ({ row }) => row.original.hasAnswer ? <Tooltip content="توجد إجابة"><span className="inline-flex size-6 items-center justify-center rounded-full text-success-text" aria-label="توجد إجابة"><Check className="size-4" aria-hidden /></span></Tooltip> : <Badge size="sm" variant="subtle" tone="warning">مفقودة</Badge>,
    },
    {
      id: "source",
      accessorFn: (row) => row.sourceSummary.map((source) => source.sourceKind).join(" "),
      header: "المصدر",
      enableSorting: false,
      meta: { label: "المصدر", width: 176 } satisfies CellMeta,
      cell: ({ row }) => <SourceSummaryCell summaries={row.original.sourceSummary} density={density} />,
    },
    actionsColumn<DirectQuestionSummary>((item) => (
      <>
        {onEdit ? <IconButton label="تعديل السؤال" size="sm" variant="ghost" onClick={() => onEdit(item)}><Pencil aria-hidden /></IconButton> : null}
        {onDelete ? <Menu><MenuTrigger asChild><IconButton label="إجراءات السؤال" size="sm" variant="ghost"><MoreHorizontal aria-hidden /></IconButton></MenuTrigger><MenuContent align="end"><MenuItem danger icon={<Trash2 aria-hidden />} onSelect={() => onDelete(item)}>حذف السؤال</MenuItem></MenuContent></Menu> : null}
      </>
    ), { width: 88 }),
  ], [density, onDelete, onEdit]);

  return <DataTable columns={columns} data={items} getRowId={(row) => row.id} density={density} loading={loading} activeRowId={activeRowId} onRowClick={onRowClick} noResultsState={noResultsState} ariaLabel="جدول الأسئلة" />;
}

function SourceSummaryCell({ summaries, density }: { summaries: DirectQuestionSummary["sourceSummary"]; density: TableDensity }) {
  if (!summaries.length) return <span className="text-xs text-fg-quaternary">بلا مصدر</span>;
  const visible = density === "compact" ? summaries.slice(0, 1) : summaries.slice(0, 2);
  const remaining = summaries.slice(visible.length);
  const summary = (source: DirectQuestionSummary["sourceSummary"][number]) => `${questionSourceKindLabel(source.sourceKind)} · ${source.count}`;
  const remainingDetails = remaining.length ? <div className="space-y-1">{remaining.map((source) => <div key={source.sourceKind}>{summary(source)}</div>)}</div> : null;

  return density === "compact" ? (
    <div className="flex min-w-0 items-center gap-1 whitespace-nowrap">
      <span className="text-xs text-fg-secondary">{summary(visible[0]!)}</span>
      {remaining.length ? <Tooltip content={remainingDetails}><span className="shrink-0 text-xs font-medium text-fg-tertiary">+{remaining.length}</span></Tooltip> : null}
    </div>
  ) : (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      {visible.map((source) => <span key={source.sourceKind} className="whitespace-nowrap text-xs text-fg-secondary">{summary(source)}</span>)}
      {remaining.length ? <Tooltip content={remainingDetails}><span className="text-xs font-medium text-fg-tertiary">+{remaining.length}</span></Tooltip> : null}
    </div>
  );
}

function matchLabel(context: NonNullable<DirectQuestionSummary["matchContext"]>): string {
  const labels: Record<typeof context, string> = {
    PRIMARY_VARIANT: "مطابقة في السؤال",
    ALTERNATE_VARIANT: "مطابقة في صيغة بديلة",
    ANSWER: "مطابقة في الإجابة",
    TAXONOMY: "مطابقة في التصنيف",
    PROVENANCE: "مطابقة في المصدر",
  };
  return labels[context];
}
