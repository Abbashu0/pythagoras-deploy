"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type ExpandedState,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Table as TanTable,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronsUpDown,
  Columns3,
  Rows3,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { dockBottom } from "@/lib/motion";
import { formatNumber } from "@/lib/format";
import { Button, IconButton } from "../primitives/button";
import { Checkbox } from "../forms/toggle";
import { Tooltip } from "../primitives/tooltip";
import { SegmentedControl } from "../forms/segmented";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "../overlays/menu";
import { SkeletonRow } from "../primitives/skeleton";
import { ErrorState, NoResultsState } from "../feedback/empty-state";
import { Separator } from "../primitives/separator";
export type { TanTable };

/* ============================================================================
   DataTable
   ---------------------------------------------------------------------------
   One table implementation for the whole admin. Built on TanStack Table v8 for
   the state machinery; all presentation is ours.

   RTL notes that matter:
   - The table element inherits `dir` from the document, so columns already flow
     right-to-left. Every cell uses `text-align: start`, never `left`.
   - Numeric columns are the exception: they align to the *end* and use tabular
     figures so magnitudes line up, exactly as in a spreadsheet.
   - Sort chevrons are vertical, so no mirroring is required.
   - The sticky header uses a background token plus a hairline rather than a
     shadow, because a shadow under a sticky header reads as a seam in RTL when
     the horizontal scrollbar appears.

   State can be fully controlled (URL-synced in the real admin) or left internal
   for the lab.
   ========================================================================== */

export type TableDensity = "compact" | "default" | "comfortable";

const ROW_HEIGHT: Record<TableDensity, string> = {
  compact: "h-8",
  default: "h-11",
  comfortable: "h-14",
};

const CELL_PAD: Record<TableDensity, string> = {
  compact: "px-2.5 py-1",
  default: "px-3 py-2",
  comfortable: "px-3.5 py-3",
};

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  /** Stable row id — required for selection to survive re-sorting. */
  getRowId?: (row: TData, index: number) => string;

  /* --- states ---------------------------------------------------------- */
  loading?: boolean;
  error?: { title?: string; description?: string; detail?: React.ReactNode } | null;
  onRetry?: () => void;
  /** Shown when there is genuinely no data at all. */
  emptyState?: React.ReactNode;
  /** Shown when filters/search exclude everything. */
  noResultsState?: React.ReactNode;

  /* --- interaction ----------------------------------------------------- */
  onRowClick?: (row: TData) => void;
  /** Id of the row currently open in a detail pane. */
  activeRowId?: string | null;
  /** Row-level context menu. */
  renderRowContextMenu?: (row: TData) => React.ReactNode;
  /** Sub-row content for expandable rows. */
  renderSubRow?: (row: Row<TData>) => React.ReactNode;
  getRowCanExpand?: (row: Row<TData>) => boolean;

  /* --- selection ------------------------------------------------------- */
  enableRowSelection?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (state: RowSelectionState) => void;
  /** Rendered in the floating bar when rows are selected. */
  bulkActions?: (selected: TData[], clear: () => void) => React.ReactNode;

  /* --- sorting / filtering --------------------------------------------- */
  sorting?: SortingState;
  onSortingChange?: (state: SortingState) => void;
  defaultSorting?: SortingState;
  columnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (state: ColumnFiltersState) => void;
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;

  /* --- visibility / density -------------------------------------------- */
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (state: VisibilityState) => void;
  /** Row density. Hold this in the page and pair it with `DensityControl`. */
  density?: TableDensity;

  /* --- pagination ------------------------------------------------------ */
  pagination?: boolean;
  pageSize?: number;
  pageSizeOptions?: number[];

  /* --- chrome ---------------------------------------------------------- */
  /** Toolbar above the table — search, filters, actions. */
  toolbar?: React.ReactNode;
  /** Sticky header. Requires a bounded-height scroll parent. */
  stickyHeader?: boolean;
  /** Bordered container. Off when the table already sits inside a Panel. */
  bordered?: boolean;
  className?: string;
  tableClassName?: string;
  /** Number of skeleton rows while loading. */
  skeletonRows?: number;
  /** Skeleton column widths, as percentages. */
  skeletonColumns?: number[];
  /** Total row count label, e.g. "١٢ موفرًا". */
  countLabel?: (count: number, total: number) => React.ReactNode;
  /** Footer row — totals and aggregates. */
  footer?: React.ReactNode;
  ariaLabel?: string;
}

export function DataTable<TData>({
  columns,
  data,
  getRowId,
  loading = false,
  error = null,
  onRetry,
  emptyState,
  noResultsState,
  onRowClick,
  activeRowId,
  renderRowContextMenu,
  renderSubRow,
  getRowCanExpand,
  enableRowSelection = false,
  rowSelection: rowSelectionProp,
  onRowSelectionChange,
  bulkActions,
  sorting: sortingProp,
  onSortingChange,
  defaultSorting = [],
  columnFilters: columnFiltersProp,
  onColumnFiltersChange,
  globalFilter = "",
  onGlobalFilterChange,
  columnVisibility: visibilityProp,
  onColumnVisibilityChange,
  density = "default",
  pagination = false,
  pageSize = 25,
  pageSizeOptions = [10, 25, 50, 100],
  toolbar,
  stickyHeader = true,
  bordered = true,
  className,
  tableClassName,
  skeletonRows = 8,
  skeletonColumns,
  countLabel,
  footer,
  ariaLabel,
}: DataTableProps<TData>) {
  /* --- state (controlled or internal) --------------------------------- */
  const [sortingInternal, setSortingInternal] =
    React.useState<SortingState>(defaultSorting);
  const [filtersInternal, setFiltersInternal] =
    React.useState<ColumnFiltersState>([]);
  const [selectionInternal, setSelectionInternal] =
    React.useState<RowSelectionState>({});
  const [visibilityInternal, setVisibilityInternal] =
    React.useState<VisibilityState>({});
  const [expanded, setExpanded] = React.useState<ExpandedState>({});

  const sorting = sortingProp ?? sortingInternal;
  const columnFilters = columnFiltersProp ?? filtersInternal;
  const rowSelection = rowSelectionProp ?? selectionInternal;
  const columnVisibility = visibilityProp ?? visibilityInternal;

  const setSorting = onSortingChange ?? setSortingInternal;
  const setFilters = onColumnFiltersChange ?? setFiltersInternal;
  const setSelection = onRowSelectionChange ?? setSelectionInternal;
  const setVisibility = onColumnVisibilityChange ?? setVisibilityInternal;

  const resolvedColumns = React.useMemo(() => {
    const base = [...columns];
    if (renderSubRow) base.unshift(expandColumn<TData>());
    if (enableRowSelection) base.unshift(selectColumn<TData>());
    return base;
  }, [columns, enableRowSelection, renderSubRow]);

  const table = useReactTable({
    data,
    columns: resolvedColumns,
    getRowId,
    state: {
      sorting,
      columnFilters,
      rowSelection,
      columnVisibility,
      globalFilter,
      expanded,
      ...(pagination ? {} : {}),
    },
    initialState: pagination ? { pagination: { pageIndex: 0, pageSize } } : undefined,
    enableRowSelection,
    onSortingChange: (updater) =>
      setSorting(typeof updater === "function" ? updater(sorting) : updater),
    onColumnFiltersChange: (updater) =>
      setFilters(typeof updater === "function" ? updater(columnFilters) : updater),
    onRowSelectionChange: (updater) =>
      setSelection(typeof updater === "function" ? updater(rowSelection) : updater),
    onColumnVisibilityChange: (updater) =>
      setVisibility(
        typeof updater === "function" ? updater(columnVisibility) : updater,
      ),
    onGlobalFilterChange: (value) => onGlobalFilterChange?.(value as string),
    onExpandedChange: setExpanded,
    getRowCanExpand: getRowCanExpand ?? (renderSubRow ? () => true : undefined),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getExpandedRowModel: getExpandedRowModel(),
    ...(pagination ? { getPaginationRowModel: getPaginationRowModel() } : {}),
    globalFilterFn: "includesString",
  });

  const rows = table.getRowModel().rows;
  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const hasFilters =
    columnFilters.length > 0 || (globalFilter?.trim().length ?? 0) > 0;
  const colCount = table.getVisibleLeafColumns().length;

  const clearSelection = React.useCallback(
    () => table.resetRowSelection(),
    [table],
  );

  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      {toolbar}

      <div
        className={cn(
          "relative min-w-0 overflow-hidden",
          bordered && "rounded-lg border border-border bg-surface",
        )}
      >
        <div className="overflow-x-auto">
          <table
            aria-label={ariaLabel}
            className={cn(
              "w-full border-collapse text-start",
              tableClassName,
            )}
          >
            <thead
              className={cn(
                "bg-inset",
                stickyHeader && "sticky top-0 z-[var(--z-raised)]",
              )}
            >
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id} className="hairline-b">
                  {group.headers.map((header) => {
                    const col = header.column;
                    const align = (col.columnDef.meta as CellMeta | undefined)?.align;
                    const width = (col.columnDef.meta as CellMeta | undefined)?.width;
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        style={{ width }}
                        className={cn(
                          "whitespace-nowrap text-2xs font-semibold text-fg-tertiary",
                          density === "compact" ? "h-7 px-2.5" : "h-9 px-3",
                          align === "end" && "text-end",
                          align === "center" && "text-center",
                          !align && "text-start",
                        )}
                      >
                        {header.isPlaceholder ? null : col.getCanSort() ? (
                          <SortButton column={col} align={align}>
                            {flexRender(col.columnDef.header, header.getContext())}
                          </SortButton>
                        ) : (
                          flexRender(col.columnDef.header, header.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={colCount} className="p-0">
                    {Array.from({ length: skeletonRows }).map((_, i) => (
                      <SkeletonRow
                        key={i}
                        columns={
                          skeletonColumns ??
                          Array.from({ length: Math.min(colCount, 6) }, () =>
                            Math.floor(80 / Math.min(colCount, 6)),
                          )
                        }
                        height={density === "compact" ? 32 : 44}
                      />
                    ))}
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={colCount} className="p-0">
                    <ErrorState
                      title={error.title}
                      description={error.description}
                      detail={error.detail}
                      onRetry={onRetry}
                    />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="p-0">
                    {hasFilters
                      ? (noResultsState ?? (
                          <NoResultsState
                            query={globalFilter}
                            activeFilterCount={columnFilters.length}
                            onClearFilters={() => {
                              table.resetColumnFilters();
                              onGlobalFilterChange?.("");
                            }}
                          />
                        ))
                      : emptyState}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const isActive = activeRowId != null && row.id === activeRowId;
                  const rowNode = (
                    <tr
                      key={row.id}
                      data-selected={row.getIsSelected() || undefined}
                      data-active={isActive || undefined}
                      onClick={
                        onRowClick ? () => onRowClick(row.original) : undefined
                      }
                      onKeyDown={
                        onRowClick
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onRowClick(row.original);
                              }
                            }
                          : undefined
                      }
                      tabIndex={onRowClick ? 0 : undefined}
                      className={cn(
                        "group/tr border-b border-border-subtle last:border-b-0",
                        "transition-colors duration-[var(--dur-fast)]",
                        onRowClick &&
                          "cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]",
                        row.getIsSelected()
                          ? "bg-selected"
                          : isActive
                            ? "bg-accent-subtle"
                            : "hover:bg-hover",
                      )}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const meta = cell.column.columnDef.meta as
                          | CellMeta
                          | undefined;
                        return (
                          <td
                            key={cell.id}
                            className={cn(
                              ROW_HEIGHT[density],
                              CELL_PAD[density],
                              "align-middle text-sm text-fg-secondary",
                              meta?.align === "end" && "text-end tnum",
                              meta?.align === "center" && "text-center",
                              !meta?.align && "text-start",
                              meta?.truncate && "max-w-0",
                              meta?.className,
                            )}
                          >
                            <div
                              className={cn(
                                meta?.truncate && "truncate",
                                meta?.align === "end" && "tnum",
                              )}
                            >
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext(),
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );

                  return (
                    <React.Fragment key={row.id}>
                      {renderRowContextMenu
                        ? renderRowContextMenu(row.original)
                        : null}
                      {rowNode}
                      {row.getIsExpanded() && renderSubRow ? (
                        <tr className="border-b border-border-subtle bg-inset">
                          <td colSpan={colCount} className="p-0">
                            {renderSubRow(row)}
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>

            {footer ? (
              <tfoot className="hairline-t bg-surface-secondary">
                <tr>
                  <td colSpan={colCount} className="px-3 py-2 text-xs">
                    {footer}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      {pagination && !loading && rows.length > 0 ? (
        <DataTablePagination
          table={table}
          pageSizeOptions={pageSizeOptions}
          countLabel={countLabel}
        />
      ) : !loading && rows.length > 0 && countLabel ? (
        <p className="mt-2.5 text-xs text-fg-tertiary">
          {countLabel(rows.length, data.length)}
        </p>
      ) : null}

      {/* Bulk action bar: floats above the content so selection is never lost
          behind a scroll. */}
      <AnimatePresence>
        {enableRowSelection && bulkActions && selectedRows.length > 0 ? (
          <motion.div
            variants={dockBottom}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="pointer-events-none fixed inset-x-0 bottom-5 z-[var(--z-sticky)] flex justify-center px-4"
          >
            <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-xl border border-border bg-elevated px-3 py-2 shadow-xl">
              <span className="flex items-center gap-2 text-sm">
                <span className="grid size-6 place-items-center rounded-md bg-accent text-2xs font-semibold text-on-accent tnum">
                  {selectedRows.length}
                </span>
                <span className="text-fg-secondary">عنصر محدّد</span>
              </span>
              <Separator orientation="vertical" className="h-5" />
              <div className="flex items-center gap-1.5">
                {bulkActions(selectedRows, clearSelection)}
              </div>
              <Separator orientation="vertical" className="h-5" />
              <IconButton
                label="إلغاء التحديد"
                size="sm"
                variant="ghost"
                onClick={clearSelection}
              >
                <X aria-hidden />
              </IconButton>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Column meta
   ------------------------------------------------------------------------ */

export interface CellMeta {
  align?: "start" | "end" | "center";
  width?: number | string;
  truncate?: boolean;
  className?: string;
  /** Human label used by the column-visibility menu. */
  label?: string;
}

/* ---------------------------------------------------------------------------
   Sort header
   ------------------------------------------------------------------------ */

function SortButton<TData>({
  column,
  children,
  align,
}: {
  column: Column<TData, unknown>;
  children: React.ReactNode;
  align?: CellMeta["align"];
}) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      aria-label={`ترتيب حسب ${typeof children === "string" ? children : "العمود"}`}
      className={cn(
        "group/sort -mx-1 inline-flex items-center gap-1 rounded-[4px] px-1 py-0.5",
        "transition-colors hover:text-fg",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
        sorted && "text-fg",
        align === "end" && "flex-row-reverse",
      )}
    >
      <span>{children}</span>
      {sorted === "asc" ? (
        <ArrowUp className="size-3 text-accent" aria-hidden />
      ) : sorted === "desc" ? (
        <ArrowDown className="size-3 text-accent" aria-hidden />
      ) : (
        <ChevronsUpDown
          className="size-3 text-fg-quaternary opacity-0 transition-opacity group-hover/sort:opacity-100"
          aria-hidden
        />
      )}
    </button>
  );
}

/* ---------------------------------------------------------------------------
   Built-in columns
   ------------------------------------------------------------------------ */

export function selectColumn<TData>(): ColumnDef<TData, unknown> {
  return {
    id: "__select",
    enableSorting: false,
    enableHiding: false,
    size: 36,
    meta: { width: 36, align: "center", label: "التحديد" } satisfies CellMeta,
    header: ({ table }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          size="sm"
          aria-label="تحديد كل الصفوف"
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? "indeterminate"
                : false
          }
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(Boolean(v))}
        />
      </div>
    ),
    cell: ({ row }) => (
      <div
        className="flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          size="sm"
          aria-label="تحديد الصف"
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onCheckedChange={(v) => row.toggleSelected(Boolean(v))}
        />
      </div>
    ),
  };
}

export function expandColumn<TData>(): ColumnDef<TData, unknown> {
  return {
    id: "__expand",
    enableSorting: false,
    enableHiding: false,
    size: 32,
    meta: { width: 32, align: "center", label: "التوسيع" } satisfies CellMeta,
    header: () => <span className="sr-only">توسيع</span>,
    cell: ({ row }) =>
      row.getCanExpand() ? (
        <button
          type="button"
          aria-label={row.getIsExpanded() ? "إخفاء التفاصيل" : "عرض التفاصيل"}
          aria-expanded={row.getIsExpanded()}
          onClick={(e) => {
            e.stopPropagation();
            row.toggleExpanded();
          }}
          className="inline-flex size-5 items-center justify-center rounded-[4px] text-fg-quaternary transition-colors hover:bg-hover hover:text-fg-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
        >
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform duration-[var(--dur-base)]",
              row.getIsExpanded() ? "rotate-180" : "-rotate-90 rtl:rotate-90",
            )}
            aria-hidden
          />
        </button>
      ) : null,
  };
}

/** Row actions column. Keep to ≤3 visible actions plus an overflow menu. */
export function actionsColumn<TData>(
  render: (row: TData) => React.ReactNode,
  options: { width?: number; label?: string } = {},
): ColumnDef<TData, unknown> {
  return {
    id: "__actions",
    enableSorting: false,
    enableHiding: false,
    meta: {
      width: options.width ?? 1,
      align: "end",
      label: options.label ?? "إجراءات",
    } satisfies CellMeta,
    header: () => <span className="sr-only">إجراءات</span>,
    cell: ({ row }) => (
      <div
        className="flex items-center justify-end gap-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        {render(row.original)}
      </div>
    ),
  };
}

/* ---------------------------------------------------------------------------
   Toolbar pieces
   ------------------------------------------------------------------------ */

export function ColumnVisibilityMenu<TData>({
  table,
  label = "الأعمدة",
}: {
  table: TanTable<TData>;
  label?: string;
}) {
  const hideable = table
    .getAllLeafColumns()
    .filter((c) => c.getCanHide() && c.id !== "__select" && c.id !== "__expand");

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="sm" variant="secondary" icon={<Columns3 aria-hidden />}>
          {label}
        </Button>
      </MenuTrigger>
      <MenuContent className="min-w-48">
        <MenuLabel>الأعمدة المعروضة</MenuLabel>
        {hideable.map((column) => {
          const meta = column.columnDef.meta as CellMeta | undefined;
          return (
            <MenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(v) => column.toggleVisibility(Boolean(v))}
              onSelect={(e) => e.preventDefault()}
            >
              {meta?.label ??
                (typeof column.columnDef.header === "string"
                  ? column.columnDef.header
                  : column.id)}
            </MenuCheckboxItem>
          );
        })}
        <MenuSeparator />
        <MenuCheckboxItem
          checked={hideable.every((c) => c.getIsVisible())}
          onCheckedChange={() => table.resetColumnVisibility()}
          onSelect={(e) => e.preventDefault()}
        >
          إظهار الكل
        </MenuCheckboxItem>
      </MenuContent>
    </Menu>
  );
}

export function DensityControl({
  value,
  onChange,
}: {
  value: TableDensity;
  onChange: (value: TableDensity) => void;
}) {
  return (
    <Tooltip content="كثافة الصفوف">
      <SegmentedControl
        size="sm"
        aria-label="كثافة الصفوف"
        value={value}
        onValueChange={onChange}
        options={[
          {
            value: "compact",
            icon: <Rows3 aria-hidden />,
            ariaLabel: "مكثّفة",
            tooltip: "مكثّفة",
          },
          {
            value: "default",
            icon: <Rows3 aria-hidden />,
            ariaLabel: "افتراضية",
            tooltip: "افتراضية",
          },
          {
            value: "comfortable",
            icon: <Rows3 aria-hidden />,
            ariaLabel: "مريحة",
            tooltip: "مريحة",
          },
        ]}
      />
    </Tooltip>
  );
}

/* ---------------------------------------------------------------------------
   Pagination
   ------------------------------------------------------------------------ */

export function DataTablePagination<TData>({
  table,
  pageSizeOptions = [10, 25, 50, 100],
  countLabel,
}: {
  table: TanTable<TData>;
  pageSizeOptions?: number[];
  countLabel?: (count: number, total: number) => React.ReactNode;
}) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const total = table.getFilteredRowModel().rows.length;
  const from = total === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(total, (pageIndex + 1) * pageSize);
  const pageCount = table.getPageCount();

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p className="text-xs text-fg-tertiary">
        {countLabel ? (
          countLabel(to - from + 1, total)
        ) : (
          <>
            <span className="tnum">
              {formatNumber(from)}–{formatNumber(to)}
            </span>{" "}
            من <span className="tnum">{formatNumber(total)}</span>
          </>
        )}
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-fg-tertiary">
          لكل صفحة
          <select
            value={pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            className="h-control-sm rounded-sm border border-border bg-surface px-1.5 text-xs text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] tnum"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            السابق
          </Button>
          <span className="px-1.5 text-xs text-fg-tertiary tnum">
            {pageIndex + 1} / {Math.max(1, pageCount)}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            التالي
          </Button>
        </div>
      </div>
    </div>
  );
}

export type { ColumnDef, Row, SortingState, ColumnFiltersState, VisibilityState, RowSelectionState };
