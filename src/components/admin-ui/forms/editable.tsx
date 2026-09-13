"use client";

import * as React from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useResetOn } from "@/lib/hooks";
import { Button, IconButton } from "../primitives/button";
import { Badge } from "../status/status-badge";
import { estimateTokens } from "@/lib/format";
import { TextArea, TextField, inputShell, rawInput } from "./input";
import { CharacterCount } from "./field";

/* ============================================================================
   InlineEditableField
   ---------------------------------------------------------------------------
   Direct manipulation: edit the value where you read it. Used for names,
   display labels and short descriptions in detail panels and table cells.

   Interaction contract:
   - click (or Enter on the focused value) enters edit mode with the text
     selected, so replacing is one keystroke
   - Enter commits, Escape reverts, blur commits
   - the value's box does not move between read and edit mode
   - a pencil appears on hover so the affordance is discoverable without
     cluttering the resting state
   ========================================================================== */

export interface InlineEditableFieldProps {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  /** Multi-line editing. */
  multiline?: boolean;
  /** Visual weight of the read-mode text. */
  variant?: "body" | "title" | "pageTitle" | "mono";
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
  disabledReason?: string;
  maxLength?: number;
  ltr?: boolean;
  /** Validate before committing; return a message to reject. */
  validate?: (value: string) => string | null;
  emptyLabel?: string;
  ariaLabel?: string;
}

export function InlineEditableField({
  value,
  onCommit,
  placeholder = "أضف قيمة",
  multiline = false,
  variant = "body",
  className,
  inputClassName,
  disabled = false,
  disabledReason,
  maxLength,
  ltr = false,
  validate,
  emptyLabel = "—",
  ariaLabel,
}: InlineEditableFieldProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // Adopt an externally-updated value, but never clobber an in-progress edit.
  useResetOn(editing ? null : value, () => {
    if (!editing) setDraft(value);
  });

  React.useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    const problem = validate?.(next) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setEditing(false);
    if (next !== value) onCommit(next);
  };

  const cancel = () => {
    setDraft(value);
    setError(null);
    setEditing(false);
  };

  const textClass = cn(
    variant === "body" && "text-sm text-fg",
    variant === "title" && "text-md font-semibold text-fg",
    variant === "pageTitle" && "text-xl font-semibold tracking-tighter text-fg",
    variant === "mono" && "ltr-island font-mono text-xs text-fg-secondary",
  );

  if (!editing) {
    return (
      <span
        className={cn("group/edit inline-flex min-w-0 items-center gap-1.5", className)}
      >
        <button
          type="button"
          aria-label={ariaLabel ?? "تعديل"}
          title={disabled ? disabledReason : undefined}
          disabled={disabled}
          onClick={() => setEditing(true)}
          dir={ltr ? "ltr" : undefined}
          className={cn(
            "min-w-0 truncate rounded-[4px] text-start",
            "transition-colors duration-[var(--dur-fast)]",
            !disabled && "hover:bg-hover",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
            "disabled:cursor-not-allowed",
            "-mx-1 px-1",
            textClass,
            !value && "text-fg-quaternary",
          )}
        >
          {value || emptyLabel}
        </button>
        {!disabled ? (
          <Pencil
            className="size-3 shrink-0 text-fg-quaternary opacity-0 transition-opacity group-hover/edit:opacity-100"
            aria-hidden
          />
        ) : null}
      </span>
    );
  }

  return (
    <span className={cn("inline-flex min-w-0 flex-col gap-1", className)}>
      <span className="inline-flex min-w-0 items-start gap-1.5">
        {multiline ? (
          <TextArea
            ref={inputRef as React.Ref<HTMLTextAreaElement>}
            value={draft}
            maxLength={maxLength}
            ltr={ltr}
            minRows={2}
            status={error ? "invalid" : undefined}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancel();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
            }}
            className={inputClassName}
          />
        ) : (
          <TextField
            ref={inputRef as React.Ref<HTMLInputElement>}
            value={draft}
            maxLength={maxLength}
            ltr={ltr}
            placeholder={placeholder}
            status={error ? "invalid" : undefined}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            onBlur={() => {
              // Blur commits, matching a spreadsheet rather than losing work.
              if (!error) commit();
            }}
            className={inputClassName}
          />
        )}
        <span className="flex shrink-0 items-center gap-0.5 pt-0.5">
          <IconButton label="تأكيد" size="sm" variant="quiet" onMouseDown={(e) => e.preventDefault()} onClick={commit}>
            <Check aria-hidden />
          </IconButton>
          <IconButton label="إلغاء" size="sm" variant="ghost" onMouseDown={(e) => e.preventDefault()} onClick={cancel}>
            <X aria-hidden />
          </IconButton>
        </span>
      </span>
      {error ? <span className="text-xs text-danger-text">{error}</span> : null}
      {multiline ? (
        <span className="text-2xs text-fg-quaternary">
          ⌘/Ctrl + Enter للحفظ · Esc للإلغاء
        </span>
      ) : null}
    </span>
  );
}

/* ============================================================================
   TagsEditor — free-form labels (taxonomy hints, eval tags, banner audiences).
   Enter or comma commits a tag; Backspace on an empty input removes the last.
   ========================================================================== */

export interface TagsEditorProps {
  value: string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  /** Restrict to a known set; free entry when omitted. */
  suggestions?: string[];
  maxTags?: number;
  disabled?: boolean;
  className?: string;
  /** Normalise each tag before it is stored. */
  normalise?: (raw: string) => string;
  ltr?: boolean;
}

export function TagsEditor({
  value,
  onValueChange,
  placeholder = "أضف وسمًا ثم Enter",
  suggestions,
  maxTags,
  disabled = false,
  className,
  normalise = (raw) => raw.trim(),
  ltr = false,
}: TagsEditorProps) {
  const [draft, setDraft] = React.useState("");
  const atLimit = maxTags != null && value.length >= maxTags;

  const add = (raw: string) => {
    const tag = normalise(raw);
    if (!tag || atLimit) return;
    if (value.includes(tag)) {
      setDraft("");
      return;
    }
    onValueChange([...value, tag]);
    setDraft("");
  };

  const remove = (tag: string) => onValueChange(value.filter((t) => t !== tag));

  const available = suggestions?.filter(
    (s) => !value.includes(s) && s.includes(draft.trim()),
  );

  return (
    <div className={cn("min-w-0", className)}>
      <div
        className={cn(
          inputShell({ auto: true }),
          "min-h-control-md flex-wrap items-center gap-1.5 px-2 py-1.5",
          disabled && "cursor-not-allowed bg-disabled-bg",
        )}
      >
        {value.map((tag) => (
          <span
            key={tag}
            dir={ltr ? "ltr" : undefined}
            className={cn(
              "inline-flex h-[22px] items-center gap-1 rounded-sm border border-border-subtle bg-inset px-1.5 text-xs text-fg-secondary",
              ltr && "ltr-island font-mono text-2xs",
            )}
          >
            <span className="max-w-[12rem] truncate">{tag}</span>
            {!disabled ? (
              <button
                type="button"
                aria-label={`إزالة ${tag}`}
                onClick={() => remove(tag)}
                className="text-fg-quaternary transition-colors hover:text-danger-text focus-visible:outline-1 focus-visible:outline-[var(--ring)]"
              >
                <X className="size-3" aria-hidden />
              </button>
            ) : null}
          </span>
        ))}
        {!atLimit && !disabled ? (
          <input
            value={draft}
            dir={ltr ? "ltr" : undefined}
            placeholder={value.length === 0 ? placeholder : undefined}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add(draft);
              } else if (e.key === "Backspace" && !draft && value.length) {
                onValueChange(value.slice(0, -1));
              }
            }}
            onBlur={() => draft && add(draft)}
            className={cn(rawInput, "h-[22px] min-w-24 text-sm", ltr && "font-mono text-xs")}
          />
        ) : null}
      </div>

      {available?.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-2xs text-fg-quaternary">مقترحات:</span>
          {available.slice(0, 8).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="inline-flex h-[20px] items-center gap-1 rounded-sm border border-dashed border-border-strong px-1.5 text-2xs text-fg-tertiary transition-colors hover:border-accent-border hover:bg-accent-subtle hover:text-accent-text"
            >
              <Plus className="size-2.5" aria-hidden />
              {s}
            </button>
          ))}
        </div>
      ) : null}

      {atLimit ? (
        <p className="mt-1.5 text-xs text-fg-quaternary">
          بلغت الحد الأقصى ({maxTags}).
        </p>
      ) : null}
    </div>
  );
}

/* ============================================================================
   KeyValueEditor — provider metadata, request headers, eval case variables.
   Keys are LTR/mono because they are technical; values may be either.
   ========================================================================== */

export interface KeyValuePair {
  id: string;
  key: string;
  value: string;
}

export function KeyValueEditor({
  pairs,
  onChange,
  keyPlaceholder = "المفتاح",
  valuePlaceholder = "القيمة",
  addLabel = "إضافة سطر",
  disabled = false,
  className,
  /** Mark some keys as reserved / non-removable. */
  lockedKeys,
  maxPairs,
}: {
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  disabled?: boolean;
  className?: string;
  lockedKeys?: string[];
  maxPairs?: number;
}) {
  const update = (id: string, patch: Partial<KeyValuePair>) =>
    onChange(pairs.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const remove = (id: string) => onChange(pairs.filter((p) => p.id !== id));

  const add = () =>
    onChange([
      ...pairs,
      { id: `kv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, key: "", value: "" },
    ]);

  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      {pairs.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-inset px-3 py-3 text-xs text-fg-tertiary">
          لا توجد بيانات إضافية. أضف سطرًا إذا احتاج الموفر رؤوسًا مخصّصة.
        </p>
      ) : null}

      {pairs.map((pair) => {
        const locked = lockedKeys?.includes(pair.key);
        return (
          <div key={pair.id} className="flex items-start gap-2">
            <TextField
              value={pair.key}
              ltr
              size="sm"
              placeholder={keyPlaceholder}
              disabled={disabled || locked}
              onChange={(e) => update(pair.id, { key: e.target.value })}
              wrapperClassName="w-[38%] min-w-0"
            />
            <TextField
              value={pair.value}
              size="sm"
              placeholder={valuePlaceholder}
              disabled={disabled}
              onChange={(e) => update(pair.id, { value: e.target.value })}
              wrapperClassName="min-w-0 flex-1"
            />
            <IconButton
              label={`حذف ${pair.key || "السطر"}`}
              size="sm"
              variant="ghost"
              disabled={disabled || locked}
              onClick={() => remove(pair.id)}
              className="mt-0 shrink-0 text-fg-quaternary hover:text-danger-text"
            >
              <Trash2 aria-hidden />
            </IconButton>
          </div>
        );
      })}

      {maxPairs == null || pairs.length < maxPairs ? (
        <Button
          size="sm"
          variant="outline"
          icon={<Plus aria-hidden />}
          onClick={add}
          disabled={disabled}
        >
          {addLabel}
        </Button>
      ) : null}
    </div>
  );
}

/* ============================================================================
   JsonEditorShell
   ---------------------------------------------------------------------------
   Deliberately a *shell*, not a real code editor. It gives the operator a
   monospaced LTR surface, live validation, a token estimate and a format
   action. The real admin can drop a proper editor into the same slot without
   changing the surrounding layout.
   ========================================================================== */

export function JsonEditorShell({
  value,
  onValueChange,
  className,
  minRows = 8,
  maxRows = 24,
  disabled = false,
  showTokenEstimate = false,
  label,
}: {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  minRows?: number;
  maxRows?: number;
  disabled?: boolean;
  showTokenEstimate?: boolean;
  label?: React.ReactNode;
}) {
  const parsed = React.useMemo(() => {
    if (!value.trim()) return { ok: true as const, error: null };
    try {
      JSON.parse(value);
      return { ok: true as const, error: null };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [value]);

  const format = () => {
    if (!parsed.ok) return;
    try {
      onValueChange(JSON.stringify(JSON.parse(value), null, 2));
    } catch {
      /* already validated */
    }
  };

  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-fg-secondary">
          {label ?? "الحمولة (JSON)"}
        </span>
        <span className="flex items-center gap-2">
          {showTokenEstimate ? (
            <CharacterCount value={estimateTokens(value)} unit="رمز تقديري" />
          ) : null}
          <Badge
            tone={parsed.ok ? "success" : "danger"}
            variant="subtle"
            size="sm"
          >
            {parsed.ok ? "صيغة صحيحة" : "صيغة غير صحيحة"}
          </Badge>
          <Button
            size="xs"
            variant="ghost"
            onClick={format}
            disabled={disabled || !parsed.ok || !value.trim()}
          >
            تنسيق
          </Button>
        </span>
      </div>
      <TextArea
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        mono
        ltr
        minRows={minRows}
        maxRows={maxRows}
        disabled={disabled}
        spellCheck={false}
        status={parsed.ok ? undefined : "invalid"}
        aria-label="محرر JSON"
      />
      {!parsed.ok ? (
        <p dir="ltr" className="ltr-island mt-1.5 font-mono text-2xs text-danger-text">
          {parsed.error}
        </p>
      ) : null}
    </div>
  );
}
