"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { statusSwap } from "@/lib/motion";
import { InfoTip } from "../primitives/tooltip";

/* ============================================================================
   Field infrastructure
   ---------------------------------------------------------------------------
   Every control in the system is wrapped by FormField, which owns:
   - the label / control / description wiring (`htmlFor`, `aria-describedby`,
     `aria-invalid`, `aria-errormessage`)
   - the required / optional affordance
   - helper text that is always visible when it is genuinely useful, and
     validation messages that replace it only while a problem exists

   Deliberate choices:
   - "مطلوب" is marked with a word, not a red asterisk. An asterisk is a
     convention, not an explanation, and it reads badly next to Arabic.
   - Optional is marked only when a form is mostly required, and vice versa —
     callers decide via `optionalHint`.
   - Validation messages never shift layout: the message row reserves its own
     line as soon as a field declares it can produce one.
   ========================================================================== */

export type FieldStatus = "default" | "invalid" | "valid" | "warning";

interface FieldContextValue {
  id: string;
  descriptionId: string;
  messageId: string;
  status: FieldStatus;
  disabled: boolean;
  required: boolean;
  hasMessage: boolean;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

export function useFieldContext() {
  return React.useContext(FieldContext);
}

/** Props a control receives from its FormField wrapper. */
export function useFieldControlProps() {
  const ctx = useFieldContext();
  if (!ctx) return {};
  return {
    id: ctx.id,
    disabled: ctx.disabled || undefined,
    required: ctx.required || undefined,
    "aria-invalid": ctx.status === "invalid" || undefined,
    "aria-describedby":
      [ctx.descriptionId, ctx.hasMessage ? ctx.messageId : null]
        .filter(Boolean)
        .join(" ") || undefined,
  } as const;
}

export interface FormFieldProps {
  label?: React.ReactNode;
  /** Secondary English/technical label, e.g. "Provider Key". */
  labelEn?: string;
  /** Persistent explanation. Prefer this over a tooltip. */
  description?: React.ReactNode;
  /** Nuance that genuinely is supplemental — goes behind an InfoTip. */
  hint?: React.ReactNode;
  /** Validation message. Replaces `description` while present. */
  message?: React.ReactNode;
  status?: FieldStatus;
  required?: boolean;
  /** Renders "اختياري" next to the label. */
  optionalHint?: boolean;
  disabled?: boolean;
  /** Right-hand slot in the label row — e.g. a character counter or a link. */
  labelAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Label beside the control instead of above it (settings rows). */
  orientation?: "vertical" | "horizontal";
  /** Explicit id, otherwise generated. */
  id?: string;
  /** Reserve the message line even when there is no message. */
  reserveMessageSpace?: boolean;
}

export function FormField({
  label,
  labelEn,
  description,
  hint,
  message,
  status = "default",
  required = false,
  optionalHint = false,
  disabled = false,
  labelAction,
  children,
  className,
  orientation = "vertical",
  id: idProp,
  reserveMessageSpace = false,
}: FormFieldProps) {
  const auto = React.useId();
  const id = idProp ?? `f${auto.replace(/:/g, "")}`;
  const descriptionId = `${id}-desc`;
  const messageId = `${id}-msg`;
  const hasMessage = message != null && message !== false && message !== "";

  const ctx = React.useMemo<FieldContextValue>(
    () => ({
      id,
      descriptionId,
      messageId,
      status,
      disabled,
      required,
      hasMessage,
    }),
    [id, descriptionId, messageId, status, disabled, required, hasMessage],
  );

  const labelBlock = label ? (
    <div className="flex items-baseline justify-between gap-3">
      <label
        htmlFor={id}
        className={cn(
          "inline-flex items-baseline gap-1.5 text-xs font-medium",
          disabled ? "text-disabled-fg" : "text-fg-secondary",
        )}
      >
        <span>{label}</span>
        {labelEn ? (
          <span
            dir="ltr"
            className="ltr-island font-mono text-[10px] font-normal text-fg-quaternary"
          >
            {labelEn}
          </span>
        ) : null}
        {required ? (
          <span className="text-2xs font-normal text-danger-text">مطلوب</span>
        ) : optionalHint ? (
          <span className="text-2xs font-normal text-fg-quaternary">اختياري</span>
        ) : null}
        {hint ? <InfoTip content={hint} /> : null}
      </label>
      {labelAction ? (
        <span className="shrink-0 text-2xs text-fg-quaternary">{labelAction}</span>
      ) : null}
    </div>
  ) : null;

  const messageBlock = (
    <div
      className={cn(
        "relative",
        reserveMessageSpace || hasMessage ? "min-h-[1.125rem]" : null,
      )}
    >
      <AnimatePresence initial={false} mode="wait">
        {hasMessage ? (
          <motion.p
            key="msg"
            id={messageId}
            role={status === "invalid" ? "alert" : undefined}
            variants={statusSwap}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              "flex items-start gap-1.5 text-xs leading-[1.5]",
              status === "invalid" && "text-danger-text",
              status === "warning" && "text-warning-text",
              status === "valid" && "text-success-text",
              status === "default" && "text-fg-tertiary",
            )}
          >
            {status === "invalid" ? (
              <AlertCircle className="mt-[2px] size-3 shrink-0" aria-hidden />
            ) : status === "valid" ? (
              <CheckCircle2 className="mt-[2px] size-3 shrink-0" aria-hidden />
            ) : status === "warning" ? (
              <AlertCircle className="mt-[2px] size-3 shrink-0" aria-hidden />
            ) : (
              <Info className="mt-[2px] size-3 shrink-0" aria-hidden />
            )}
            <span>{message}</span>
          </motion.p>
        ) : description ? (
          <motion.p
            key="desc"
            id={descriptionId}
            variants={statusSwap}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="text-xs leading-[1.6] text-fg-tertiary"
          >
            {description}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );

  return (
    <FieldContext.Provider value={ctx}>
      <div
        data-field-status={status}
        className={cn(
          orientation === "horizontal"
            ? "grid grid-cols-1 items-start gap-x-6 gap-y-1.5 sm:grid-cols-[minmax(9rem,14rem)_1fr]"
            : "space-y-1.5",
          className,
        )}
      >
        {orientation === "horizontal" ? (
          <>
            <div className="space-y-1 sm:pt-1.5">
              {labelBlock}
              {description && !hasMessage ? (
                <p
                  id={descriptionId}
                  className="text-xs leading-[1.6] text-fg-tertiary"
                >
                  {description}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              {children}
              {hasMessage ? messageBlock : null}
            </div>
          </>
        ) : (
          <>
            {labelBlock}
            {children}
            {description || hasMessage || reserveMessageSpace
              ? messageBlock
              : null}
          </>
        )}
      </div>
    </FieldContext.Provider>
  );
}

/* ---------------------------------------------------------------------------
   FieldGroup / FieldRow — layout for related fields.
   ------------------------------------------------------------------------ */

export function FieldGroup({
  title,
  description,
  children,
  className,
  columns = 1,
  actions,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  columns?: 1 | 2 | 3;
  actions?: React.ReactNode;
}) {
  return (
    <fieldset className={cn("min-w-0", className)}>
      {title ? (
        <div className="mb-3.5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <legend className="text-sm font-semibold text-fg">{title}</legend>
            {description ? (
              <p className="mt-1 max-w-prose text-xs leading-[1.7] text-fg-tertiary">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      <div
        className={cn(
          "grid gap-x-5 gap-y-4",
          columns === 1 && "grid-cols-1",
          columns === 2 && "grid-cols-1 sm:grid-cols-2",
          columns === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {children}
      </div>
    </fieldset>
  );
}

/** Two or more controls that behave as one logical input (min/max, w×h). */
export function FieldRow({
  children,
  className,
  gap = "sm",
}: {
  children: React.ReactNode;
  className?: string;
  gap?: "xs" | "sm" | "md";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-start",
        gap === "xs" && "gap-1.5",
        gap === "sm" && "gap-2",
        gap === "md" && "gap-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Settings-style row: label + description on one side, control on the other. */
export function SettingRow({
  label,
  labelEn,
  description,
  children,
  className,
  status,
  disabled,
  bordered = true,
  align = "center",
}: {
  label: React.ReactNode;
  labelEn?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  status?: React.ReactNode;
  disabled?: boolean;
  bordered?: boolean;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "flex gap-6 py-3.5 first:pt-0 last:pb-0",
        bordered && "border-b border-border-subtle last:border-b-0",
        align === "center" ? "items-center" : "items-start",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            className={cn(
              "text-sm font-medium",
              disabled ? "text-disabled-fg" : "text-fg",
            )}
          >
            {label}
          </span>
          {labelEn ? (
            <span
              dir="ltr"
              className="ltr-island font-mono text-[10px] text-fg-quaternary"
            >
              {labelEn}
            </span>
          ) : null}
          {status}
        </div>
        {description ? (
          <p className="mt-1 max-w-prose text-xs leading-[1.7] text-fg-tertiary">
            {description}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Character / token counter for the label row. */
export function CharacterCount({
  value,
  max,
  unit,
}: {
  value: number;
  max?: number;
  unit?: string;
}) {
  const over = max != null && value > max;
  const near = max != null && !over && value > max * 0.9;
  return (
    <span
      className={cn(
        "tnum",
        over && "font-medium text-danger-text",
        near && "text-warning-text",
      )}
    >
      {value.toLocaleString("en-US")}
      {max != null ? ` / ${max.toLocaleString("en-US")}` : null}
      {unit ? ` ${unit}` : null}
    </span>
  );
}
