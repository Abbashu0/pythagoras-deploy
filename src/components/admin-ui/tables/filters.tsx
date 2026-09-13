"use client";

import * as React from "react";
import {
  Bookmark,
  BookmarkPlus,
  Check,
  Filter,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { rowEnter } from "@/lib/motion";
import { formatNumber } from "@/lib/format";
import { Button, IconButton } from "../primitives/button";
import { Popover, PopoverContent, PopoverTrigger } from "../overlays/popover";
import { SearchInput } from "../forms/input";
import { Checkbox } from "../forms/toggle";
import { CountBadge, StatusDot } from "../status/status-badge";
import { ScrollArea } from "../primitives/scroll-area";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "../overlays/menu";
import type { StatusKey } from "../status/status-registry";
import { Tooltip } from "../primitives/tooltip";

/* ============================================================================
   Filter system
   ---------------------------------------------------------------------------
   The problem this solves: a row of twenty pills. The old admin exposed every
   filter as a permanent control, so the toolbar was wider than the data.

   The model here:
     1. One search field, always visible.
     2. A single "مرشّحات" popover holding every available facet.
     3. Only *active* filters appear as chips, each removable.
     4. Saved views capture a filter set an operator returns to.

   A facet's options carry counts from the data, so an operator can see that
   filtering by "معطّل" would yield 2 rows before they click.
   ========================================================================== */

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
  /** Renders a state dot instead of a colour swatch. */
  status?: StatusKey;
  icon?: React.ReactNode;
  technicalId?: string;
}

export interface FilterFacet {
  id: string;
  label: string;
  options: FilterOption[];
  /** Single-choice facets render radio-style. */
  multiple?: boolean;
  /** Show a search box inside the facet when it has many options. */
  searchable?: boolean;
  icon?: React.ReactNode;
}

export type FilterValues = Record<string, string[]>;

/* ---------------------------------------------------------------------------
   FilterBar — the composed toolbar.
   ------------------------------------------------------------------------ */

export interface FilterBarProps {
  /** Search */
  query?: string;
  onQueryChange?: (value: string) => void;
  searchPlaceholder?: string;

  /** Facets */
  facets?: FilterFacet[];
  values?: FilterValues;
  onValuesChange?: (values: FilterValues) => void;

  /** Result count, shown after the filters. */
  resultCount?: number;
  totalCount?: number;
  countLabel?: (shown: number, total: number) => React.ReactNode;

  /** Saved views */
  savedViews?: SavedView[];
  activeViewId?: string | null;
  onSelectView?: (id: string | null) => void;
  onSaveView?: (name: string) => void;
  onDeleteView?: (id: string) => void;

  /** Trailing controls — density, columns, primary action. */
  children?: React.ReactNode;
  /** Extra always-visible controls before the filter button (e.g. date range). */
  leading?: React.ReactNode;
  className?: string;
  searchWidth?: string;
}

export function FilterBar({
  query = "",
  onQueryChange,
  searchPlaceholder = "بحث…",
  facets = [],
  values = {},
  onValuesChange,
  resultCount,
  totalCount,
  countLabel,
  savedViews,
  activeViewId,
  onSelectView,
  onSaveView,
  onDeleteView,
  children,
  leading,
  className,
  searchWidth = "w-full sm:w-64",
}: FilterBarProps) {
  const activeCount = Object.values(values).reduce(
    (sum, list) => sum + list.length,
    0,
  );

  const clearAll = () => {
    onValuesChange?.({});
    onQueryChange?.("");
    onSelectView?.(null);
  };

  return (
    <div className={cn("min-w-0 space-y-2.5", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {onQueryChange ? (
          <SearchInput
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onClear={() => onQueryChange("")}
            placeholder={searchPlaceholder}
            size="sm"
            wrapperClassName={searchWidth}
          />
        ) : null}

        {leading}

        {facets.length > 0 ? (
          <AdvancedFilterPopover
            facets={facets}
            values={values}
            onValuesChange={onValuesChange}
            activeCount={activeCount}
          />
        ) : null}

        {savedViews ? (
          <SavedViewMenu
            views={savedViews}
            activeId={activeViewId ?? null}
            onSelect={onSelectView}
            onSave={onSaveView}
            onDelete={onDeleteView}
            canSave={activeCount > 0 || query.length > 0}
          />
        ) : null}

        <span className="ms-auto flex shrink-0 items-center gap-2">
          {resultCount != null ? (
            <span className="text-xs text-fg-tertiary">
              {countLabel ? (
                countLabel(resultCount, totalCount ?? resultCount)
              ) : (
                <>
                  <span className="font-medium text-fg tnum">
                    {formatNumber(resultCount)}
                  </span>
                  {totalCount != null && totalCount !== resultCount ? (
                    <span className="tnum"> من {formatNumber(totalCount)}</span>
                  ) : null}
                </>
              )}
            </span>
          ) : null}
          {children}
        </span>
      </div>

      <ActiveFilters
        facets={facets}
        values={values}
        onValuesChange={onValuesChange}
        query={query}
        onClearQuery={onQueryChange ? () => onQueryChange("") : undefined}
        onClearAll={clearAll}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
   AdvancedFilterPopover — every facet in one place.
   ------------------------------------------------------------------------ */

export function AdvancedFilterPopover({
  facets,
  values,
  onValuesChange,
  activeCount = 0,
  label = "مرشّحات",
}: {
  facets: FilterFacet[];
  values: FilterValues;
  onValuesChange?: (values: FilterValues) => void;
  activeCount?: number;
  label?: string;
}) {
  const [openFacet, setOpenFacet] = React.useState<string | null>(
    facets[0]?.id ?? null,
  );

  const toggle = (facet: FilterFacet, value: string) => {
    const current = values[facet.id] ?? [];
    let next: string[];
    if (facet.multiple === false) {
      next = current[0] === value ? [] : [value];
    } else {
      next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
    }
    const merged = { ...values, [facet.id]: next };
    if (next.length === 0) delete merged[facet.id];
    onValuesChange?.(merged);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={activeCount > 0 ? "accentSubtle" : "secondary"}
          icon={<Filter aria-hidden />}
          trailingIcon={
            activeCount > 0 ? (
              <CountBadge value={activeCount} tone="accent" />
            ) : undefined
          }
        >
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent padding="none" align="start" className="flex w-[30rem]">
        {/* Facet list */}
        <div className="w-40 shrink-0 border-e border-border-subtle p-1.5">
          {facets.map((f) => {
            const count = values[f.id]?.length ?? 0;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setOpenFacet(f.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-start text-xs transition-colors",
                  openFacet === f.id
                    ? "bg-selected font-medium text-accent-text"
                    : "text-fg-secondary hover:bg-hover",
                )}
              >
                <span className="shrink-0 text-fg-quaternary [&_svg]:size-3.5">
                  {f.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{f.label}</span>
                {count > 0 ? <CountBadge value={count} tone="accent" /> : null}
              </button>
            );
          })}
        </div>

        {/* Options */}
        <div className="min-w-0 flex-1">
          {facets
            .filter((f) => f.id === openFacet)
            .map((facet) => (
              <FacetOptions
                key={facet.id}
                facet={facet}
                selected={values[facet.id] ?? []}
                onToggle={(v) => toggle(facet, v)}
                onClear={() => {
                  const merged = { ...values };
                  delete merged[facet.id];
                  onValuesChange?.(merged);
                }}
              />
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FacetOptions({
  facet,
  selected,
  onToggle,
  onClear,
}: {
  facet: FilterFacet;
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [q, setQ] = React.useState("");
  const searchable = facet.searchable ?? facet.options.length > 8;
  const filtered = q
    ? facet.options.filter(
        (o) =>
          o.label.toLowerCase().includes(q.toLowerCase()) ||
          o.technicalId?.toLowerCase().includes(q.toLowerCase()),
      )
    : facet.options;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-2.5 py-2">
        <span className="text-xs font-medium text-fg">{facet.label}</span>
        {selected.length > 0 ? (
          <Button size="xs" variant="ghost" onClick={onClear}>
            مسح
          </Button>
        ) : null}
      </div>

      {searchable ? (
        /* The ring sits on the wrapper, not the bare input: the input is
           borderless and full-width, so an outline on it would trace the whole
           row. Same pattern as `inputShell`. */
        <div
          className={cn(
            "flex items-center gap-2 border-b border-border-subtle px-2.5",
            "focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-[var(--ring)]",
          )}
        >
          <Search className="size-3.5 shrink-0 text-fg-quaternary" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`ابحث في ${facet.label}`}
            className="h-8 min-w-0 flex-1 border-0 bg-transparent text-xs text-fg outline-none placeholder:text-fg-quaternary"
          />
        </div>
      ) : null}

      <ScrollArea className="max-h-64">
        <div className="p-1.5">
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-fg-tertiary">
              لا توجد خيارات مطابقة
            </p>
          ) : (
            filtered.map((opt) => {
              const active = selected.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onToggle(opt.value)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-[5px] px-2 py-1.5 text-start text-xs transition-colors",
                    "hover:bg-hover",
                    opt.count === 0 && !active && "opacity-50",
                  )}
                >
                  {facet.multiple === false ? (
                    <span className="flex size-3.5 shrink-0 items-center justify-center">
                      {active ? (
                        <Check className="size-3.5 text-accent" aria-hidden />
                      ) : null}
                    </span>
                  ) : (
                    <Checkbox
                      size="sm"
                      checked={active}
                      tabIndex={-1}
                      className="pointer-events-none shrink-0"
                    />
                  )}
                  {opt.status ? <StatusDot status={opt.status} size="sm" /> : null}
                  {opt.icon ? (
                    <span className="shrink-0 text-fg-tertiary [&_svg]:size-3.5">
                      {opt.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-fg-secondary">
                    {opt.label}
                  </span>
                  {opt.technicalId ? (
                    <span
                      dir="ltr"
                      className="ltr-island shrink-0 font-mono text-[10px] text-fg-quaternary"
                    >
                      {opt.technicalId}
                    </span>
                  ) : null}
                  {opt.count != null ? (
                    <span className="shrink-0 text-2xs text-fg-quaternary tnum">
                      {formatNumber(opt.count)}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   ActiveFilters — chips for what is actually applied.
   ------------------------------------------------------------------------ */

export function ActiveFilters({
  facets,
  values,
  onValuesChange,
  query,
  onClearQuery,
  onClearAll,
  className,
}: {
  facets: FilterFacet[];
  values: FilterValues;
  onValuesChange?: (values: FilterValues) => void;
  query?: string;
  onClearQuery?: () => void;
  onClearAll?: () => void;
  className?: string;
}) {
  const entries = Object.entries(values).filter(([, v]) => v.length > 0);
  const hasQuery = Boolean(query?.trim());
  if (entries.length === 0 && !hasQuery) return null;

  const removeValue = (facetId: string, value: string) => {
    const next = { ...values };
    next[facetId] = next[facetId].filter((v) => v !== value);
    if (next[facetId].length === 0) delete next[facetId];
    onValuesChange?.(next);
  };

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      <AnimatePresence initial={false}>
        {hasQuery ? (
          <motion.span key="__q" variants={rowEnter} initial="hidden" animate="visible" exit="exit">
            <FilterChip
              label="البحث"
              value={query!}
              mono
              onRemove={onClearQuery}
            />
          </motion.span>
        ) : null}

        {entries.map(([facetId, list]) => {
          const facet = facets.find((f) => f.id === facetId);
          if (!facet) return null;
          // Collapse a facet with 3+ selections into a single chip.
          if (list.length >= 3) {
            return (
              <motion.span
                key={facetId}
                variants={rowEnter}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <FilterChip
                  label={facet.label}
                  value={`${list.length} محدّد`}
                  detail={list
                    .map(
                      (v) =>
                        facet.options.find((o) => o.value === v)?.label ?? v,
                    )
                    .join(" · ")}
                  onRemove={() => {
                    const next = { ...values };
                    delete next[facetId];
                    onValuesChange?.(next);
                  }}
                />
              </motion.span>
            );
          }
          return list.map((v) => {
            const opt = facet.options.find((o) => o.value === v);
            return (
              <motion.span
                key={`${facetId}:${v}`}
                variants={rowEnter}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <FilterChip
                  label={facet.label}
                  value={opt?.label ?? v}
                  status={opt?.status}
                  onRemove={() => removeValue(facetId, v)}
                />
              </motion.span>
            );
          });
        })}
      </AnimatePresence>

      {onClearAll ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={onClearAll}
          className="text-fg-tertiary"
        >
          مسح الكل
        </Button>
      ) : null}
    </div>
  );
}

export function FilterChip({
  label,
  value,
  onRemove,
  status,
  mono = false,
  detail,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  onRemove?: () => void;
  status?: StatusKey;
  mono?: boolean;
  /** Tooltip content when the chip collapses several values. */
  detail?: string;
  className?: string;
}) {
  const chip = (
    <span
      className={cn(
        "inline-flex h-6 max-w-[16rem] items-center gap-1.5 rounded-full border border-border bg-surface ps-2 pe-1 text-2xs",
        className,
      )}
    >
      <span className="shrink-0 text-fg-quaternary">{label}</span>
      {status ? <StatusDot status={status} size="sm" /> : null}
      <span
        dir={mono ? "ltr" : undefined}
        className={cn(
          "min-w-0 truncate font-medium text-fg",
          mono && "ltr-island font-mono",
        )}
      >
        {value}
      </span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`إزالة مرشّح ${typeof label === "string" ? label : ""}`}
          onClick={onRemove}
          className="shrink-0 rounded-full p-0.5 text-fg-quaternary transition-colors hover:bg-hover-strong hover:text-danger-text focus-visible:outline-1 focus-visible:outline-[var(--ring)]"
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );

  return detail ? <Tooltip content={detail}>{chip}</Tooltip> : chip;
}

/* ---------------------------------------------------------------------------
   SavedViews
   ------------------------------------------------------------------------ */

export interface SavedView {
  id: string;
  name: string;
  /** Description of what it captures — shown as a hint. */
  description?: string;
  values: FilterValues;
  query?: string;
  /** Views the operator cannot delete (system defaults). */
  builtIn?: boolean;
}

export function SavedViewMenu({
  views,
  activeId,
  onSelect,
  onSave,
  onDelete,
  canSave = false,
}: {
  views: SavedView[];
  activeId: string | null;
  onSelect?: (id: string | null) => void;
  onSave?: (name: string) => void;
  onDelete?: (id: string) => void;
  canSave?: boolean;
}) {
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState("");
  const active = views.find((v) => v.id === activeId);

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          size="sm"
          variant={active ? "accentSubtle" : "secondary"}
          icon={<Bookmark aria-hidden />}
        >
          {active ? active.name : "العروض المحفوظة"}
        </Button>
      </MenuTrigger>
      <MenuContent align="start" className="min-w-56">
        <MenuLabel>العروض المحفوظة</MenuLabel>
        {views.length === 0 ? (
          <p className="px-2 py-3 text-xs text-fg-tertiary">
            لا توجد عروض محفوظة بعد. طبّق مرشّحات ثم احفظها.
          </p>
        ) : (
          views.map((v) => (
            <MenuItem
              key={v.id}
              icon={
                v.id === activeId ? (
                  <Check className="text-accent" aria-hidden />
                ) : (
                  <span className="size-4" />
                )
              }
              hint={v.description}
              onSelect={() => onSelect?.(v.id)}
              trailing={
                !v.builtIn && onDelete ? (
                  <IconButton
                    label={`حذف ${v.name}`}
                    size="xs"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(v.id);
                    }}
                  >
                    <X aria-hidden />
                  </IconButton>
                ) : undefined
              }
            >
              {v.name}
            </MenuItem>
          ))
        )}

        {activeId ? (
          <>
            <MenuSeparator />
            <MenuItem onSelect={() => onSelect?.(null)}>
              إلغاء العرض الحالي
            </MenuItem>
          </>
        ) : null}

        {onSave ? (
          <>
            <MenuSeparator />
            {saving ? (
              <div className="p-1.5">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && name.trim()) {
                      onSave(name.trim());
                      setName("");
                      setSaving(false);
                    }
                    if (e.key === "Escape") setSaving(false);
                  }}
                  placeholder="اسم العرض"
                  className="h-control-sm w-full rounded-sm border border-border bg-surface px-2 text-xs text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                />
                <p className="mt-1 text-2xs text-fg-quaternary">
                  Enter للحفظ · Esc للإلغاء
                </p>
              </div>
            ) : (
              <MenuItem
                icon={<BookmarkPlus aria-hidden />}
                disabled={!canSave}
                hint={!canSave ? "طبّق مرشّحًا أولًا" : undefined}
                onSelect={(e) => {
                  e.preventDefault();
                  setSaving(true);
                }}
              >
                حفظ العرض الحالي
              </MenuItem>
            )}
          </>
        ) : null}
      </MenuContent>
    </Menu>
  );
}

/* ---------------------------------------------------------------------------
   Small standalone filter controls, for toolbars that need one specific facet
   visible at all times.
   ------------------------------------------------------------------------ */

export function QuickFilterGroup({
  options,
  value,
  onValueChange,
  className,
  allLabel = "الكل",
}: {
  options: FilterOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  className?: string;
  allLabel?: string;
}) {
  return (
    <div className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      <QuickChip
        active={value == null}
        onClick={() => onValueChange(null)}
        label={allLabel}
      />
      {options.map((o) => (
        <QuickChip
          key={o.value}
          active={value === o.value}
          onClick={() => onValueChange(o.value)}
          label={o.label}
          count={o.count}
          status={o.status}
        />
      ))}
    </div>
  );
}

function QuickChip({
  active,
  onClick,
  label,
  count,
  status,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  status?: StatusKey;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
        active
          ? "border-accent-border bg-accent-subtle font-medium text-accent-text"
          : "border-border bg-surface text-fg-secondary hover:border-border-strong hover:bg-hover",
      )}
    >
      {status ? <StatusDot status={status} size="sm" /> : null}
      {label}
      {count != null ? (
        <span className="text-2xs text-fg-quaternary tnum">{count}</span>
      ) : null}
    </button>
  );
}

/** "Add filter" affordance for empty toolbars. */
export function AddFilterButton({
  facets,
  onPick,
}: {
  facets: FilterFacet[];
  onPick: (facetId: string) => void;
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="sm" variant="outline" icon={<Plus aria-hidden />}>
          إضافة مرشّح
        </Button>
      </MenuTrigger>
      <MenuContent align="start" className="min-w-44">
        <MenuLabel>المرشّحات المتاحة</MenuLabel>
        {facets.map((f) => (
          <MenuItem key={f.id} icon={f.icon} onSelect={() => onPick(f.id)}>
            {f.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

export { SlidersHorizontal as FilterIcon };
