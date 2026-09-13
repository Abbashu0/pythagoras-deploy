"use client";

import * as React from "react";
import {
  AlertTriangle,
  CalendarX,
  Database,
  FileQuestion,
  Inbox,
  Lock,
  Plug,
  RefreshCw,
  SearchX,
  ServerCrash,
  Sparkles,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "../primitives/button";
import { Shortcut } from "../primitives/kbd";
import { toneClasses, type StatusTone } from "../status/status-registry";

/* ============================================================================
   Empty / error states
   ---------------------------------------------------------------------------
   Every state here answers three questions, in this order:
     1. What is this surface for?
     2. Why is it empty / broken?
     3. What is the single next thing I should do?

   No decorative illustrations. A 40px glyph in a tonal circle is enough to
   signal "this is a state, not missing content", and it costs no layout.

   The distinction that matters most: "empty because nothing exists yet" needs a
   create action; "empty because your filters exclude everything" needs a clear
   action. Conflating them is the classic empty-state mistake.
   ========================================================================== */

export type EmptyStateKind =
  | "empty"
  | "noResults"
  | "noData"
  | "noDataInRange"
  | "firstRun"
  | "error"
  | "offline"
  | "forbidden"
  | "future"
  | "notConfigured";

const PRESET: Record<
  EmptyStateKind,
  { icon: typeof Inbox; tone: StatusTone }
> = {
  empty: { icon: Inbox, tone: "neutral" },
  noResults: { icon: SearchX, tone: "neutral" },
  noData: { icon: Database, tone: "neutral" },
  noDataInRange: { icon: CalendarX, tone: "neutral" },
  firstRun: { icon: Sparkles, tone: "accent" },
  error: { icon: ServerCrash, tone: "danger" },
  offline: { icon: Plug, tone: "danger" },
  forbidden: { icon: Lock, tone: "warning" },
  future: { icon: Sparkles, tone: "future" },
  notConfigured: { icon: Wrench, tone: "warning" },
};

export interface EmptyStateProps {
  kind?: EmptyStateKind;
  /** What this surface is / what happened. */
  title: React.ReactNode;
  /** Why it is empty and what it will contain. */
  description?: React.ReactNode;
  /** The single next step. */
  action?: React.ReactNode;
  /** A lesser alternative — "امسح المرشّحات", "تحديث". */
  secondaryAction?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
  /** Bordered container vs. bare (inside an existing Panel). */
  bordered?: boolean;
  /** Extra content under the actions — a hint list, a shortcut. */
  children?: React.ReactNode;
  align?: "center" | "start";
}

export function EmptyState({
  kind = "empty",
  title,
  description,
  action,
  secondaryAction,
  icon,
  className,
  size = "md",
  bordered = false,
  children,
  align = "center",
}: EmptyStateProps) {
  const preset = PRESET[kind];
  const tone = toneClasses[preset.tone];
  const Icon = preset.icon;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col",
        align === "center" ? "items-center text-center" : "items-start text-start",
        size === "sm" && "gap-2.5 px-4 py-8",
        size === "md" && "gap-3 px-6 py-12",
        size === "lg" && "gap-3.5 px-6 py-16",
        bordered && "rounded-lg border border-dashed border-border bg-surface",
        className,
      )}
    >
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-full",
          tone.subtle,
          tone.text,
          size === "sm" && "size-9 [&_svg]:size-4",
          size === "md" && "size-11 [&_svg]:size-5",
          size === "lg" && "size-14 [&_svg]:size-6",
        )}
      >
        {icon ?? <Icon aria-hidden />}
      </span>

      <div className={cn("min-w-0", align === "center" && "max-w-md")}>
        <h3
          className={cn(
            "font-semibold text-fg",
            size === "sm" ? "text-sm" : "text-md",
          )}
        >
          {title}
        </h3>
        {description ? (
          <p
            className={cn(
              "mt-1.5 leading-[1.75] text-fg-secondary",
              size === "sm" ? "text-xs" : "text-sm",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>

      {action || secondaryAction ? (
        <div
          className={cn(
            "mt-1 flex flex-wrap items-center gap-2",
            align === "center" && "justify-center",
          )}
        >
          {action}
          {secondaryAction}
        </div>
      ) : null}

      {children ? <div className="mt-2 min-w-0">{children}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Purpose-built states. These exist so pages do not re-invent the copy, and so
   the wording stays consistent across the product.
   ------------------------------------------------------------------------ */

export function NoResultsState({
  query,
  onClearFilters,
  activeFilterCount,
  className,
  entityLabel = "نتائج",
}: {
  query?: string;
  onClearFilters?: () => void;
  activeFilterCount?: number;
  className?: string;
  entityLabel?: string;
}) {
  return (
    <EmptyState
      kind="noResults"
      size="sm"
      className={className}
      title={`لا توجد ${entityLabel} مطابقة`}
      description={
        query ? (
          <>
            لم نجد شيئًا يطابق{" "}
            <span dir="ltr" className="ltr-island font-mono text-xs">
              «{query}»
            </span>
            {activeFilterCount
              ? ` مع ${activeFilterCount} مرشّح مطبّق.`
              : "."}
          </>
        ) : activeFilterCount ? (
          `المرشّحات المطبّقة (${activeFilterCount}) تستبعد كل العناصر.`
        ) : (
          "جرّب تعديل البحث."
        )
      }
      action={
        onClearFilters ? (
          <Button size="sm" variant="secondary" onClick={onClearFilters}>
            مسح المرشّحات
          </Button>
        ) : undefined
      }
    />
  );
}

export function ErrorState({
  title = "تعذّر تحميل البيانات",
  description = "حدث خطأ أثناء الاتصال بالخدمة. لم يُفقد أي تغيير محفوظ.",
  onRetry,
  /** Raw technical detail — kept behind a disclosure, never the headline. */
  detail,
  className,
  size = "md",
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  onRetry?: () => void;
  detail?: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const [showDetail, setShowDetail] = React.useState(false);

  return (
    <EmptyState
      kind="error"
      size={size}
      className={className}
      title={title}
      description={description}
      action={
        onRetry ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<RefreshCw aria-hidden />}
            onClick={onRetry}
          >
            إعادة المحاولة
          </Button>
        ) : undefined
      }
      secondaryAction={
        detail ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowDetail((v) => !v)}
          >
            {showDetail ? "إخفاء التفاصيل" : "التفاصيل التقنية"}
          </Button>
        ) : undefined
      }
    >
      {showDetail && detail ? (
        <div className="w-full max-w-lg text-start">{detail}</div>
      ) : null}
    </EmptyState>
  );
}

export function ForbiddenState({
  className,
  requiredRole,
  onRequestAccess,
}: {
  className?: string;
  requiredRole?: string;
  onRequestAccess?: () => void;
}) {
  return (
    <EmptyState
      kind="forbidden"
      className={className}
      title="لا تملك صلاحية الوصول"
      description={
        requiredRole
          ? `هذه الصفحة متاحة لدور ${requiredRole} فقط. تواصل مع مالك المنصة لطلب الصلاحية.`
          : "هذه الصفحة تتطلب صلاحية أعلى. تواصل مع مالك المنصة."
      }
      action={
        onRequestAccess ? (
          <Button size="sm" variant="secondary" onClick={onRequestAccess}>
            طلب صلاحية
          </Button>
        ) : undefined
      }
    />
  );
}

export function ComingSoonState({
  title,
  description,
  milestone,
  dependencies,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** e.g. "M12" — the roadmap milestone that delivers this. */
  milestone?: string;
  /** What must ship first. */
  dependencies?: string[];
  className?: string;
}) {
  return (
    <EmptyState
      kind="future"
      className={className}
      title={title}
      description={description}
    >
      <div className="w-full max-w-md space-y-3 text-start">
        {milestone ? (
          <p className="text-xs text-fg-tertiary">
            مخطّط ضمن المرحلة{" "}
            <span dir="ltr" className="ltr-island font-mono text-2xs">
              {milestone}
            </span>
          </p>
        ) : null}
        {dependencies?.length ? (
          <div className="rounded-md border border-border-subtle bg-inset px-3 py-2.5">
            <p className="eyebrow mb-1.5">يعتمد على</p>
            <ul className="space-y-1">
              {dependencies.map((d) => (
                <li
                  key={d}
                  className="flex items-start gap-1.5 text-xs text-fg-secondary"
                >
                  <span
                    aria-hidden
                    className="mt-1.5 size-1 shrink-0 rounded-full bg-fg-quaternary"
                  />
                  {d}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </EmptyState>
  );
}

export function NoDataInRangeState({
  onResetRange,
  className,
  rangeLabel,
}: {
  onResetRange?: () => void;
  className?: string;
  rangeLabel?: string;
}) {
  return (
    <EmptyState
      kind="noDataInRange"
      size="sm"
      className={className}
      title="لا توجد بيانات في هذه الفترة"
      description={
        rangeLabel
          ? `لم تُسجَّل أي أحداث بين ${rangeLabel}. جرّب فترة أوسع.`
          : "لم تُسجَّل أي أحداث في الفترة المحدّدة. جرّب فترة أوسع."
      }
      action={
        onResetRange ? (
          <Button size="sm" variant="secondary" onClick={onResetRange}>
            آخر ٣٠ يومًا
          </Button>
        ) : undefined
      }
    />
  );
}

/**
 * FirstRunState — the "you have not set this up yet" state. Distinguished from
 * an ordinary empty list because it should teach, and because the create action
 * is the whole point of the screen.
 */
export function FirstRunState({
  title,
  description,
  steps,
  action,
  shortcut,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Ordered setup steps, shown as a numbered list. */
  steps?: { label: React.ReactNode; hint?: React.ReactNode }[];
  action?: React.ReactNode;
  shortcut?: string;
  className?: string;
}) {
  return (
    <EmptyState
      kind="firstRun"
      size="lg"
      bordered
      className={className}
      title={title}
      description={description}
      action={action}
    >
      <div className="w-full max-w-lg space-y-3 text-start">
        {steps?.length ? (
          <ol className="space-y-2.5">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-accent-subtle text-2xs font-semibold text-accent-text tnum">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-fg">{s.label}</span>
                  {s.hint ? (
                    <span className="mt-0.5 block text-xs text-fg-tertiary">
                      {s.hint}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
        {shortcut ? (
          <p className="flex items-center gap-2 text-2xs text-fg-quaternary">
            أو استخدم لوحة الأوامر
            <Shortcut keys={shortcut} size="sm" />
          </p>
        ) : null}
      </div>
    </EmptyState>
  );
}

/** Compact inline empty message for small panels and chart bodies. */
export function InlineEmpty({
  message,
  icon,
  className,
  action,
}: {
  message: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-24 flex-col items-center justify-center gap-2 px-4 py-6 text-center",
        className,
      )}
    >
      <span className="text-fg-quaternary [&_svg]:size-4">
        {icon ?? <FileQuestion aria-hidden />}
      </span>
      <p className="text-xs text-fg-tertiary">{message}</p>
      {action}
    </div>
  );
}

/** Dependency-blocked state: something upstream must be configured first. */
export function BlockedByDependencyState({
  title,
  blockers,
  className,
}: {
  title: React.ReactNode;
  blockers: { label: string; actionLabel?: string; onAction?: () => void }[];
  className?: string;
}) {
  return (
    <EmptyState
      kind="notConfigured"
      className={className}
      title={title}
      description="أكمل الخطوات التالية أولًا، ثم ستصبح هذه الصفحة قابلة للاستخدام."
      align="start"
    >
      <ul className="w-full max-w-lg divide-y divide-border-subtle overflow-hidden rounded-md border border-border bg-surface">
        {blockers.map((b) => (
          <li
            key={b.label}
            className="flex items-center justify-between gap-3 px-3 py-2.5"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm text-fg-secondary">
              <AlertTriangle
                className="size-3.5 shrink-0 text-warning-text"
                aria-hidden
              />
              <span className="truncate">{b.label}</span>
            </span>
            {b.actionLabel ? (
              <Button size="sm" variant="ghost" onClick={b.onAction}>
                {b.actionLabel}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </EmptyState>
  );
}
