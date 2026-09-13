"use client";

import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Info,
  Sparkles,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { rowEnter } from "@/lib/motion";
import { Button, IconButton } from "../primitives/button";
import { toneClasses, type StatusTone } from "../status/status-registry";

/* ============================================================================
   Banners & attention management
   ---------------------------------------------------------------------------
   The old admin's failure mode was uniform urgency: everything red, so nothing
   read as urgent. This system defines four levels and holds the line:

     info      something changed; no action needed
     attention something should be looked at soon (budget at 78%, stale index)
     important something is blocking a workflow (Pi has no runtime adapter)
     critical  something is actively broken or losing data (dead letter queue)

   Only `critical` gets a solid fill. `attention` and `important` are tonal.
   `info` is barely tinted. A page should never show more than one critical
   banner; if two things are critical, the page needs an IssueList.
   ========================================================================== */

export type AttentionLevel = "info" | "attention" | "important" | "critical";

const LEVEL: Record<
  AttentionLevel,
  { tone: StatusTone; icon: typeof Info; label: string }
> = {
  info: { tone: "info", icon: Info, label: "معلومة" },
  attention: { tone: "warning", icon: AlertTriangle, label: "يستدعي الانتباه" },
  important: { tone: "warning", icon: AlertCircle, label: "مهم" },
  critical: { tone: "danger", icon: AlertTriangle, label: "حرج" },
};

export interface BannerProps {
  level?: AttentionLevel;
  title?: React.ReactNode;
  children?: React.ReactNode;
  /** Primary and secondary actions, inline-end on wide layouts. */
  actions?: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
  icon?: React.ReactNode;
  /** No border/background — for use inside an already-tinted container. */
  appearance?: "panel" | "inline" | "solid";
  size?: "sm" | "md";
}

export function Banner({
  level = "info",
  title,
  children,
  actions,
  onDismiss,
  className,
  icon,
  appearance = "panel",
  size = "md",
}: BannerProps) {
  const cfg = LEVEL[level];
  const tone = toneClasses[cfg.tone];
  const Icon = cfg.icon;
  const solid = appearance === "solid" || level === "critical";

  return (
    <div
      role={level === "critical" || level === "important" ? "alert" : "status"}
      className={cn(
        "flex min-w-0 items-start gap-3",
        appearance !== "inline" && "rounded-lg border",
        appearance === "panel" && [tone.subtle, tone.border],
        solid && appearance === "solid" && [tone.solid, "border-transparent text-on-accent"],
        appearance === "panel" && size === "md" && "px-4 py-3",
        appearance === "panel" && size === "sm" && "px-3 py-2.5",
        appearance === "solid" && "px-4 py-3",
        className,
      )}
    >
      <span
        className={cn(
          "mt-px flex shrink-0 items-center",
          appearance === "solid" ? "text-on-accent" : tone.text,
          "[&_svg]:size-4",
        )}
      >
        {icon ?? <Icon aria-hidden />}
      </span>

      <div className="min-w-0 flex-1">
        {title ? (
          <p
            className={cn(
              "text-sm font-medium leading-snug",
              appearance === "solid" ? "text-on-accent" : "text-fg",
            )}
          >
            {title}
          </p>
        ) : null}
        {children ? (
          <div
            className={cn(
              "text-xs leading-[1.7]",
              title && "mt-1",
              appearance === "solid"
                ? "text-on-accent/85"
                : "text-fg-secondary",
            )}
          >
            {children}
          </div>
        ) : null}
        {actions ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 sm:hidden">
            {actions}
          </div>
        ) : null}
      </div>

      {actions ? (
        <div className="hidden shrink-0 items-center gap-2 sm:flex">{actions}</div>
      ) : null}

      {onDismiss ? (
        <IconButton
          label="إخفاء"
          size="xs"
          variant="ghost"
          onClick={onDismiss}
          className={cn(
            "-me-1 shrink-0",
            appearance === "solid" && "text-on-accent hover:bg-white/15",
          )}
        >
          <X aria-hidden />
        </IconButton>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   AttentionBanner — a banner that names the entity it is about and offers the
   one action that resolves it. This is the shape used on the dashboard.
   ------------------------------------------------------------------------ */

export function AttentionBanner({
  level = "attention",
  entity,
  headline,
  detail,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  onDismiss,
  className,
}: {
  level?: AttentionLevel;
  /** What this is about — "OpenRouter", "Pi", "قائمة المهام". */
  entity?: React.ReactNode;
  headline: React.ReactNode;
  detail?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <Banner
      level={level}
      title={
        <span className="flex flex-wrap items-baseline gap-x-2">
          {entity ? (
            <span className="text-fg-tertiary">{entity} ·</span>
          ) : null}
          <span>{headline}</span>
        </span>
      }
      onDismiss={onDismiss}
      className={className}
      actions={
        actionLabel || secondaryLabel ? (
          <>
            {secondaryLabel ? (
              <Button size="sm" variant="ghost" onClick={onSecondary}>
                {secondaryLabel}
              </Button>
            ) : null}
            {actionLabel ? (
              <Button
                size="sm"
                variant={level === "critical" ? "destructive" : "secondary"}
                onClick={onAction}
              >
                {actionLabel}
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {detail}
    </Banner>
  );
}

/* ---------------------------------------------------------------------------
   InlineWarning / InlineNote — the smallest attention affordance. Sits directly
   under the control it refers to.
   ------------------------------------------------------------------------ */

export function InlineNote({
  tone = "info",
  icon,
  children,
  className,
  size = "sm",
}: {
  tone?: StatusTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  size?: "xs" | "sm";
}) {
  const t = toneClasses[tone];
  const Fallback =
    tone === "danger"
      ? AlertCircle
      : tone === "warning"
        ? AlertTriangle
        : tone === "success"
          ? CheckCircle2
          : tone === "future"
            ? Sparkles
            : Info;

  return (
    <p
      className={cn(
        "flex items-start gap-1.5 leading-[1.6]",
        size === "xs" ? "text-2xs" : "text-xs",
        t.text,
        className,
      )}
    >
      <span className="mt-px shrink-0 [&_svg]:size-3">
        {icon ?? <Fallback aria-hidden />}
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function InlineWarning(props: Omit<Parameters<typeof InlineNote>[0], "tone">) {
  return <InlineNote tone="warning" {...props} />;
}

export function InlineError(props: Omit<Parameters<typeof InlineNote>[0], "tone">) {
  return <InlineNote tone="danger" {...props} />;
}

export function InlineSuccess(props: Omit<Parameters<typeof InlineNote>[0], "tone">) {
  return <InlineNote tone="success" {...props} />;
}

/* ---------------------------------------------------------------------------
   IssueList — the honest way to present several problems at once. Ordered by
   severity, each with the entity, the consequence, and the fix.
   ------------------------------------------------------------------------ */

export interface Issue {
  id: string;
  level: AttentionLevel;
  /** What is affected. */
  entity: string;
  /** What is wrong, in plain language. */
  headline: string;
  /** What it prevents, if anything. */
  consequence?: string;
  /** The action that resolves it. */
  actionLabel?: string;
  onAction?: () => void;
  href?: string;
  meta?: React.ReactNode;
}

const LEVEL_WEIGHT: Record<AttentionLevel, number> = {
  critical: 0,
  important: 1,
  attention: 2,
  info: 3,
};

export function IssueList({
  issues,
  className,
  emptyMessage = "لا توجد مسائل تستدعي الانتباه.",
  max,
  onShowAll,
}: {
  issues: Issue[];
  className?: string;
  emptyMessage?: React.ReactNode;
  max?: number;
  onShowAll?: () => void;
}) {
  const sorted = React.useMemo(
    () => [...issues].sort((a, b) => LEVEL_WEIGHT[a.level] - LEVEL_WEIGHT[b.level]),
    [issues],
  );
  const shown = max ? sorted.slice(0, max) : sorted;
  const rest = sorted.length - shown.length;

  if (issues.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-lg border border-border-subtle bg-surface px-4 py-3.5",
          className,
        )}
      >
        <CheckCircle2 className="size-4 shrink-0 text-success-text" aria-hidden />
        <p className="text-sm text-fg-secondary">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn("min-w-0", className)}>
      <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface">
        <AnimatePresence initial={false}>
          {shown.map((issue) => {
            const cfg = LEVEL[issue.level];
            const tone = toneClasses[cfg.tone];
            const Icon = cfg.icon;
            return (
              <motion.li
                key={issue.id}
                variants={rowEnter}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="group/issue flex items-start gap-3 px-4 py-3 transition-colors hover:bg-hover"
              >
                <span className={cn("mt-px shrink-0", tone.text)}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium text-fg">{issue.headline}</span>
                    <span className="text-xs text-fg-tertiary">{issue.entity}</span>
                  </p>
                  {issue.consequence ? (
                    <p className="mt-1 text-xs leading-[1.7] text-fg-tertiary">
                      {issue.consequence}
                    </p>
                  ) : null}
                  {issue.meta ? (
                    <div className="mt-1.5 text-2xs text-fg-quaternary">
                      {issue.meta}
                    </div>
                  ) : null}
                </div>
                {issue.actionLabel ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={issue.onAction}
                    trailingIcon={
                      <ChevronLeft className="ltr:rotate-180" aria-hidden />
                    }
                    className="shrink-0 opacity-70 transition-opacity group-hover/issue:opacity-100"
                  >
                    {issue.actionLabel}
                  </Button>
                ) : null}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      {rest > 0 ? (
        <button
          type="button"
          onClick={onShowAll}
          className="mt-2 text-xs font-medium text-accent-text transition-colors hover:text-accent"
        >
          عرض {rest} مسألة أخرى
        </button>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   SystemAlert — a full-width bar docked under the top bar for platform-level
   conditions (read-only mode, maintenance, provider outage).
   ------------------------------------------------------------------------ */

export function SystemAlert({
  level = "critical",
  children,
  actions,
  onDismiss,
  className,
}: {
  level?: AttentionLevel;
  children: React.ReactNode;
  actions?: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const cfg = LEVEL[level];
  const tone = toneClasses[cfg.tone];
  const Icon = cfg.icon;

  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-3 border-b px-4 py-2",
        tone.subtle,
        tone.border,
        className,
      )}
    >
      <Icon className={cn("size-4 shrink-0", tone.text)} aria-hidden />
      <p className="min-w-0 flex-1 text-xs leading-[1.6] text-fg-secondary">
        {children}
      </p>
      {actions}
      {onDismiss ? (
        <IconButton label="إخفاء" size="xs" variant="ghost" onClick={onDismiss}>
          <X aria-hidden />
        </IconButton>
      ) : null}
    </div>
  );
}
