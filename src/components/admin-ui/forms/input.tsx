"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Minus,
  Plus,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useResetOn } from "@/lib/hooks";
import { IconButton } from "../primitives/button";
import { CopyButton } from "../primitives/mono";
import { useFieldContext } from "./field";

/* ============================================================================
   Input shell
   ---------------------------------------------------------------------------
   All text-like controls share one shell so the focus ring, border tone and
   height are identical everywhere. The ring lives on the *wrapper*, which is
   what makes prefix/suffix adornments sit inside the focus outline instead of
   next to it.
   ========================================================================== */

export const inputShell = cva(
  [
    "group/input relative flex w-full items-center gap-1.5 overflow-hidden",
    "border bg-surface text-fg",
    "transition-[border-color,box-shadow,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
    "has-[input:disabled]:cursor-not-allowed has-[input:disabled]:bg-disabled-bg has-[input:disabled]:text-disabled-fg",
    "has-[textarea:disabled]:cursor-not-allowed has-[textarea:disabled]:bg-disabled-bg",
  ],
  {
    variants: {
      size: {
        sm: "h-control-sm rounded-sm px-2 text-xs",
        md: "h-control-md rounded-md px-2.5 text-sm",
        lg: "h-control-lg rounded-md px-3 text-sm",
      },
      status: {
        default: [
          "border-border",
          "hover:border-border-strong",
          "focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-subtle)] focus-within:hover:border-accent",
        ],
        invalid: [
          "border-danger",
          "focus-within:shadow-[0_0_0_3px_var(--danger-subtle)]",
        ],
        valid: [
          "border-success-border",
          "focus-within:border-success focus-within:shadow-[0_0_0_3px_var(--success-subtle)]",
        ],
        warning: [
          "border-warning-border",
          "focus-within:border-warning focus-within:shadow-[0_0_0_3px_var(--warning-subtle)]",
        ],
      },
      tone: {
        default: "",
        /** Read-only / derived values. */
        inset: "border-border-subtle bg-inset",
        /** Borderless — for inline editing inside tables. */
        quiet:
          "border-transparent bg-transparent hover:bg-hover focus-within:border-accent focus-within:bg-surface",
      },
      /** Multi-line: height is driven by the textarea, not the shell. */
      auto: { true: "h-auto items-stretch", false: "" },
    },
    defaultVariants: {
      size: "md",
      status: "default",
      tone: "default",
      auto: false,
    },
  },
);

export type InputSize = NonNullable<VariantProps<typeof inputShell>["size"]>;
export type InputStatus = NonNullable<VariantProps<typeof inputShell>["status"]>;
export type InputTone = NonNullable<VariantProps<typeof inputShell>["tone"]>;

/** The bare <input> styles, shared by every shell-wrapped control. */
export const rawInput = cn(
  "peer min-w-0 flex-1 border-0 bg-transparent p-0 text-inherit outline-none",
  "placeholder:text-fg-quaternary disabled:cursor-not-allowed disabled:text-disabled-fg",
  "[&::-webkit-calendar-picker-indicator]:opacity-60 dark:[&::-webkit-calendar-picker-indicator]:invert",
);

/** Non-interactive adornment inside the shell. */
export function Adornment({
  children,
  className,
  side = "start",
  divided = false,
}: {
  children: React.ReactNode;
  className?: string;
  side?: "start" | "end";
  /** Draw a hairline between the adornment and the input (prefix/suffix). */
  divided?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 select-none items-center gap-1 self-stretch text-fg-tertiary",
        "[&_svg]:size-3.5 [&_svg]:shrink-0",
        divided && [
          "-my-px bg-inset px-2 text-xs text-fg-tertiary",
          side === "start"
            ? "-ms-2.5 border-e border-border"
            : "-me-2.5 border-s border-border",
        ],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ============================================================================
   TextField
   ========================================================================== */

export interface TextFieldProps
  extends Omit<React.ComponentPropsWithoutRef<"input">, "size" | "prefix"> {
  size?: InputSize;
  status?: InputStatus;
  tone?: InputTone;
  /** Icon or short text at the inline start. */
  prefix?: React.ReactNode;
  /** Icon, unit or action at the inline end. */
  suffix?: React.ReactNode;
  /** Renders prefix/suffix as a divided segment (e.g. "https://"). */
  divided?: boolean;
  /** Show a clear button once there is a value. */
  clearable?: boolean;
  onClear?: () => void;
  /** Show a copy affordance for generated / technical values. */
  copyable?: boolean;
  /** Force LTR for technical values inside an RTL form. */
  ltr?: boolean;
  wrapperClassName?: string;
}

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    {
      size,
      status,
      tone,
      prefix,
      suffix,
      divided = false,
      clearable = false,
      onClear,
      copyable = false,
      ltr = false,
      className,
      wrapperClassName,
      value,
      defaultValue,
      onChange,
      dir,
      ...props
    },
    ref,
  ) {
    const field = useFieldContext();
    const resolvedStatus =
      status ?? (field?.status === "default" ? undefined : field?.status);
    const [internal, setInternal] = React.useState(defaultValue ?? "");
    const isControlled = value !== undefined;
    const current = isControlled ? value : internal;
    const hasValue = current != null && String(current).length > 0;
    const valueProps = isControlled ? { value } : { defaultValue };

    return (
      <div
        className={cn(
          inputShell({ size, status: resolvedStatus, tone }),
          wrapperClassName,
        )}
      >
        {prefix ? (
          <Adornment side="start" divided={divided}>
            {prefix}
          </Adornment>
        ) : null}
        <input
          ref={ref}
          {...valueProps}
          dir={dir ?? (ltr ? "ltr" : undefined)}
          onChange={(e) => {
            if (!isControlled) setInternal(e.target.value);
            onChange?.(e);
          }}
          className={cn(rawInput, ltr && "ltr-island font-mono", className)}
          id={field?.id}
          required={field?.required}
          aria-invalid={resolvedStatus === "invalid" || undefined}
          aria-describedby={
            field
              ? [field.descriptionId, field.hasMessage ? field.messageId : null]
                  .filter(Boolean)
                  .join(" ")
              : undefined
          }
          {...props}
        />
        {clearable && hasValue && !props.disabled ? (
          <IconButton
            label="مسح"
            size="xs"
            variant="ghost"
            tabIndex={-1}
            onClick={() => {
              if (!isControlled) setInternal("");
              onClear?.();
            }}
            className="shrink-0"
          >
            <X aria-hidden />
          </IconButton>
        ) : null}
        {copyable && hasValue ? (
          <CopyButton value={String(current)} size="xs" />
        ) : null}
        {suffix ? (
          <Adornment side="end" divided={divided}>
            {suffix}
          </Adornment>
        ) : null}
      </div>
    );
  },
);

/* ============================================================================
   TextArea — auto-growing, with an optional counter row.
   ========================================================================== */

export interface TextAreaProps
  extends Omit<React.ComponentPropsWithoutRef<"textarea">, "size"> {
  size?: InputSize;
  status?: InputStatus;
  tone?: InputTone;
  /** Grow with content up to `maxRows`. */
  autoResize?: boolean;
  minRows?: number;
  maxRows?: number;
  ltr?: boolean;
  wrapperClassName?: string;
  /** Monospaced — for instructions, templates and payloads. */
  mono?: boolean;
}

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea(
    {
      size,
      status,
      tone,
      autoResize = true,
      minRows = 3,
      maxRows = 16,
      ltr = false,
      mono = false,
      className,
      wrapperClassName,
      onChange,
      ...props
    },
    ref,
  ) {
    const field = useFieldContext();
    const resolvedStatus =
      status ?? (field?.status === "default" ? undefined : field?.status);
    const inner = React.useRef<HTMLTextAreaElement | null>(null);

    React.useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);

    const resize = React.useCallback(() => {
      const el = inner.current;
      if (!el || !autoResize) return;
      const style = window.getComputedStyle(el);
      const lineHeight = parseFloat(style.lineHeight || "20") || 20;
      const padding =
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      el.style.height = "auto";
      const next = Math.min(
        el.scrollHeight,
        lineHeight * maxRows + padding,
      );
      el.style.height = `${Math.max(next, lineHeight * minRows + padding)}px`;
      el.style.overflowY = el.scrollHeight > next ? "auto" : "hidden";
    }, [autoResize, maxRows, minRows]);

    React.useEffect(() => {
      resize();
    }, [resize, props.value]);

    return (
      <div
        className={cn(
          inputShell({ size, status: resolvedStatus, tone, auto: true }),
          "px-0 py-0",
          wrapperClassName,
        )}
      >
        <textarea
          ref={inner}
          dir={ltr ? "ltr" : undefined}
          rows={minRows}
          onChange={(e) => {
            resize();
            onChange?.(e);
          }}
          className={cn(
            rawInput,
            "block w-full resize-none px-2.5 py-2 leading-[1.7]",
            mono && "pyth-code",
            ltr && !mono && "ltr-island",
            className,
          )}
          id={field?.id}
          required={field?.required}
          aria-invalid={resolvedStatus === "invalid" || undefined}
          aria-describedby={
            field
              ? [field.descriptionId, field.hasMessage ? field.messageId : null]
                  .filter(Boolean)
                  .join(" ")
              : undefined
          }
          {...props}
        />
      </div>
    );
  },
);

/* ============================================================================
   NumberInput — explicit stepper, tabular figures, RTL-safe.
   The native spinners are removed in base.css because they are unusable at
   32px and mis-position in RTL.
   ========================================================================== */

export interface NumberInputProps
  extends Omit<
    React.ComponentPropsWithoutRef<"input">,
    "size" | "value" | "onChange" | "type"
  > {
  value?: number | null;
  onValueChange?: (value: number | null) => void;
  size?: InputSize;
  status?: InputStatus;
  tone?: InputTone;
  min?: number;
  max?: number;
  step?: number;
  /** Unit shown at the inline end ("token", "ms", "req/min"). */
  unit?: React.ReactNode;
  /** Plus/minus buttons instead of a stacked chevron stepper. */
  stepper?: "chevrons" | "plusminus" | "none";
  wrapperClassName?: string;
}

export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput(
    {
      value,
      onValueChange,
      size = "md",
      status,
      tone,
      min,
      max,
      step = 1,
      unit,
      stepper = "chevrons",
      className,
      wrapperClassName,
      disabled,
      ...props
    },
    ref,
  ) {
    const field = useFieldContext();
    const resolvedStatus =
      status ?? (field?.status === "default" ? undefined : field?.status);
    // The text buffer is separate from the numeric value so intermediate states
    // like "-" and "1." are typeable, and it resyncs whenever the controlled
    // value changes identity.
    const [text, setText] = React.useState(value != null ? String(value) : "");
    useResetOn(value, () => setText(value != null ? String(value) : ""));

    const clamp = (n: number) => {
      let v = n;
      if (min != null) v = Math.max(min, v);
      if (max != null) v = Math.min(max, v);
      return v;
    };

    const bump = (delta: number) => {
      const base = value ?? (Number(text) || 0);
      const next = clamp(base + delta * step);
      setText(String(next));
      onValueChange?.(next);
    };

    return (
      <div
        className={cn(
          inputShell({ size, status: resolvedStatus, tone }),
          stepper !== "none" && "pe-0",
          wrapperClassName,
        )}
      >
        {stepper === "plusminus" ? (
          <IconButton
            label="إنقاص"
            size="xs"
            variant="ghost"
            tabIndex={-1}
            disabled={disabled || (min != null && (value ?? 0) <= min)}
            onClick={() => bump(-1)}
          >
            <Minus aria-hidden />
          </IconButton>
        ) : null}

        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={text}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value;
            if (!/^-?\d*\.?\d*$/.test(raw)) return;
            setText(raw);
            if (raw === "" || raw === "-") {
              onValueChange?.(null);
              return;
            }
            const n = Number(raw);
            if (!Number.isNaN(n)) onValueChange?.(n);
          }}
          onBlur={(e) => {
            if (text === "") return;
            const n = Number(text);
            if (Number.isNaN(n)) return;
            const c = clamp(n);
            if (c !== n) {
              setText(String(c));
              onValueChange?.(c);
            }
            props.onBlur?.(e);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              bump(1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              bump(-1);
            }
            props.onKeyDown?.(e);
          }}
          className={cn(rawInput, "ltr-island text-start tnum", className)}
          id={field?.id}
          required={field?.required}
          aria-invalid={resolvedStatus === "invalid" || undefined}
          aria-describedby={
            field
              ? [field.descriptionId, field.hasMessage ? field.messageId : null]
                  .filter(Boolean)
                  .join(" ")
              : undefined
          }
          {...props}
        />

        {unit ? (
          <span className="shrink-0 select-none text-xs text-fg-quaternary">
            {unit}
          </span>
        ) : null}

        {stepper === "plusminus" ? (
          <IconButton
            label="زيادة"
            size="xs"
            variant="ghost"
            tabIndex={-1}
            disabled={disabled || (max != null && (value ?? 0) >= max)}
            onClick={() => bump(1)}
            className="me-1"
          >
            <Plus aria-hidden />
          </IconButton>
        ) : null}

        {stepper === "chevrons" ? (
          <span className="flex h-full shrink-0 flex-col border-s border-border">
            <button
              type="button"
              tabIndex={-1}
              aria-label="زيادة"
              disabled={disabled || (max != null && (value ?? 0) >= max)}
              onClick={() => bump(1)}
              className="flex flex-1 items-center justify-center px-1.5 text-fg-quaternary transition-colors hover:bg-hover hover:text-fg-secondary disabled:opacity-40"
            >
              <ChevronUp className="size-3" aria-hidden />
            </button>
            <span className="h-px bg-border" />
            <button
              type="button"
              tabIndex={-1}
              aria-label="إنقاص"
              disabled={disabled || (min != null && (value ?? 0) <= min)}
              onClick={() => bump(-1)}
              className="flex flex-1 items-center justify-center px-1.5 text-fg-quaternary transition-colors hover:bg-hover hover:text-fg-secondary disabled:opacity-40"
            >
              <ChevronDown className="size-3" aria-hidden />
            </button>
          </span>
        ) : null}
      </div>
    );
  },
);

/* ============================================================================
   SearchInput
   ========================================================================== */

export interface SearchInputProps extends Omit<TextFieldProps, "prefix"> {
  /** Result count shown at the inline end while a query is active. */
  resultCount?: number | null;
  onSearch?: (value: string) => void;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    {
      placeholder = "بحث…",
      resultCount,
      onSearch,
      value,
      onChange,
      onClear,
      className,
      ...props
    },
    ref,
  ) {
    return (
      <TextField
        ref={ref}
        type="search"
        role="searchbox"
        placeholder={placeholder}
        prefix={<Search aria-hidden />}
        clearable
        value={value}
        onChange={(e) => {
          onChange?.(e);
          onSearch?.(e.target.value);
        }}
        onClear={() => {
          onClear?.();
          onSearch?.("");
        }}
        suffix={
          resultCount != null ? (
            <span className="shrink-0 text-2xs text-fg-quaternary tnum">
              {resultCount} نتيجة
            </span>
          ) : undefined
        }
        className={className}
        {...props}
      />
    );
  },
);

/* ============================================================================
   PasswordInput — reveal toggle. Distinct from SecretField: this is for
   passwords the user is typing and may want to verify, not for stored
   credentials (those are write-only; see secret-field.tsx).
   ========================================================================== */

export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<TextFieldProps, "type" | "suffix">
>(function PasswordInput({ ltr = true, ...props }, ref) {
  const [revealed, setRevealed] = React.useState(false);
  return (
    <TextField
      ref={ref}
      type={revealed ? "text" : "password"}
      ltr={ltr}
      autoComplete="off"
      spellCheck={false}
      suffix={
        <IconButton
          label={revealed ? "إخفاء" : "إظهار"}
          size="xs"
          variant="ghost"
          tabIndex={-1}
          onClick={() => setRevealed((v) => !v)}
        >
          {revealed ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </IconButton>
      }
      {...props}
    />
  );
});

/* ============================================================================
   URLInput / SlugField / CodeField
   ========================================================================== */

export type URLInputProps = Omit<TextFieldProps, "prefix" | "type"> & {
  /** Hide the decorative scheme prefix when the value already includes one. */
  schemePrefix?: string | null;
};

export const URLInput = React.forwardRef<HTMLInputElement, URLInputProps>(
  function URLInput(
    { placeholder = "api.example.com/v1", schemePrefix = "https://", value, ...props },
    ref,
  ) {
  const hasExplicitScheme = typeof value === "string" && /^https?:\/\//iu.test(value.trim());
  return (
    <TextField
      ref={ref}
      type="url"
      inputMode="url"
      ltr
      divided
      spellCheck={false}
      autoComplete="off"
      value={value}
      prefix={!hasExplicitScheme && schemePrefix ? <span className="ltr-island font-mono text-2xs">{schemePrefix}</span> : undefined}
      placeholder={placeholder}
      {...props}
    />
  );
  },
);

/**
 * SlugField — technical keys (`openrouter`, `pi-tutor-global`). Normalises to
 * lowercase kebab-case as the operator types, so an invalid key is impossible
 * rather than merely reported.
 */
export interface SlugFieldProps
  extends Omit<TextFieldProps, "onChange" | "value" | "ltr"> {
  value?: string;
  onValueChange?: (value: string) => void;
  /** Derive from another field until the operator edits it directly. */
  derivedFrom?: string;
  allowDots?: boolean;
}

export const SlugField = React.forwardRef<HTMLInputElement, SlugFieldProps>(
  function SlugField(
    { value, onValueChange, derivedFrom, allowDots = false, ...props },
    ref,
  ) {
    const [touched, setTouched] = React.useState(false);

    const normalise = React.useCallback(
      (raw: string) =>
        raw
          .toLowerCase()
          .replace(allowDots ? /[^a-z0-9._-]+/g : /[^a-z0-9_-]+/g, "-")
          .replace(/-{2,}/g, "-")
          .replace(/^-/, ""),
      [allowDots],
    );

    React.useEffect(() => {
      if (touched || derivedFrom == null) return;
      const next = normalise(derivedFrom);
      if (next !== value) onValueChange?.(next);
    }, [derivedFrom, touched, normalise, onValueChange, value]);

    return (
      <TextField
        ref={ref}
        ltr
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        value={value ?? ""}
        onChange={(e) => {
          setTouched(true);
          onValueChange?.(normalise(e.target.value));
        }}
        {...props}
      />
    );
  },
);

/** Technical identifier field — mono, LTR, copyable, never auto-corrected. */
export const CodeField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  function CodeField(props, ref) {
    return (
      <TextField
        ref={ref}
        ltr
        copyable
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        {...props}
      />
    );
  },
);

/* ============================================================================
   ReadOnlyField / CopyableField
   ========================================================================== */

export function ReadOnlyField({
  value,
  size = "md",
  mono = false,
  copyable = false,
  className,
  suffix,
  emptyLabel = "—",
}: {
  value: React.ReactNode;
  size?: InputSize;
  mono?: boolean;
  copyable?: boolean;
  className?: string;
  suffix?: React.ReactNode;
  emptyLabel?: string;
}) {
  const isEmpty = value == null || value === "";
  return (
    <div
      className={cn(
        inputShell({ size, tone: "inset" }),
        "cursor-default select-text",
        className,
      )}
    >
      <span
        dir={mono ? "ltr" : undefined}
        className={cn(
          "min-w-0 flex-1 truncate",
          mono && "ltr-island font-mono text-xs",
          isEmpty && "text-fg-quaternary",
        )}
      >
        {isEmpty ? emptyLabel : value}
      </span>
      {copyable && !isEmpty ? (
        <CopyButton value={String(value)} size="xs" />
      ) : null}
      {suffix}
    </div>
  );
}

export function CopyableField({
  value,
  size = "md",
  mono = true,
  className,
  label,
}: {
  value: string;
  size?: InputSize;
  mono?: boolean;
  className?: string;
  label?: string;
}) {
  return (
    <ReadOnlyField
      value={value}
      size={size}
      mono={mono}
      copyable
      className={className}
      suffix={
        label ? (
          <span className="shrink-0 text-2xs text-fg-quaternary">{label}</span>
        ) : undefined
      }
    />
  );
}

/* ============================================================================
   InputGroup — attach controls into one visual unit (value + unit select,
   search + scope select). Keeps a single focus ring across the group.
   ========================================================================== */

export function InputGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-stretch",
        "[&>*]:rounded-none",
        "[&>*:first-child]:rounded-s-md [&>*:last-child]:rounded-e-md",
        "[&>*:not(:first-child)]:-ms-px",
        "[&>*:focus-within]:z-10",
        className,
      )}
    >
      {children}
    </div>
  );
}
