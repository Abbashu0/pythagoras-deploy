"use client";

import * as React from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCopyToClipboard } from "@/lib/hooks";
import { truncateMiddle } from "@/lib/format";
import { Tooltip } from "./tooltip";

/* ============================================================================
   Technical identifiers inside an RTL interface
   ---------------------------------------------------------------------------
   `deepseek/deepseek-v4-flash:free` must never be reordered by the bidi
   algorithm. Every one of these components sets an explicit LTR island with
   `unicode-bidi: isolate`, so the identifier reads correctly no matter what
   Arabic text surrounds it.

   Rule of thumb:
   - Mono          : inline identifier inside a sentence or a table cell.
   - TechnicalId   : identifier as a labelled value, with copy affordance.
   - CodeBlock     : multi-line machine output.
   - JsonPreview   : structured payload with light key/value colouring.
   ========================================================================== */

export function Mono({
  children,
  className,
  size = "sm",
  tone = "default",
  ...props
}: React.ComponentPropsWithoutRef<"span"> & {
  size?: "xs" | "sm" | "base";
  tone?: "default" | "muted" | "accent";
}) {
  return (
    <span
      dir="ltr"
      className={cn(
        "ltr-island inline-block max-w-full truncate font-mono",
        size === "xs" && "text-[10px]",
        size === "sm" && "text-2xs",
        size === "base" && "text-xs",
        tone === "default" && "text-fg-secondary",
        tone === "muted" && "text-fg-quaternary",
        tone === "accent" && "text-accent-text",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/** Inline code chip — for identifiers that need visual containment. */
export function CodeChip({
  children,
  className,
  ...props
}: React.ComponentPropsWithoutRef<"code">) {
  return (
    <code
      dir="ltr"
      className={cn(
        "ltr-island inline-flex max-w-full items-center rounded-[4px] border border-code-border bg-code-bg",
        "px-1.5 py-px font-mono text-2xs text-code-fg",
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
    </code>
  );
}

/* ---------------------------------------------------------------------------
   CopyButton — shared copy affordance with "تم النسخ" feedback.
   ------------------------------------------------------------------------ */

export function CopyButton({
  value,
  label = "نسخ",
  copiedLabel = "تم النسخ",
  size = "sm",
  className,
  onCopied,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  size?: "xs" | "sm";
  className?: string;
  onCopied?: () => void;
}) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <Tooltip content={copied ? copiedLabel : label} delay={copied ? 0 : 400}>
      <button
        type="button"
        aria-label={copied ? copiedLabel : label}
        onClick={(e) => {
          e.stopPropagation();
          void copy(value).then(() => onCopied?.());
        }}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-[4px] transition-colors duration-[var(--dur-fast)]",
          "text-fg-quaternary hover:bg-hover hover:text-fg-secondary",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]",
          copied && "text-success-text",
          size === "xs" ? "size-4" : "size-5",
          className,
        )}
      >
        {copied ? (
          <Check className={size === "xs" ? "size-2.5" : "size-3"} aria-hidden />
        ) : (
          <Copy className={size === "xs" ? "size-2.5" : "size-3"} aria-hidden />
        )}
      </button>
    </Tooltip>
  );
}

/* ---------------------------------------------------------------------------
   TechnicalId — the canonical way to show a provider key, model id, run id.
   Copy appears on hover of the row (group/id) and is always keyboard-reachable.
   ------------------------------------------------------------------------ */

export function TechnicalId({
  value,
  label,
  truncate,
  copyable = true,
  size = "sm",
  className,
  prefix,
  href,
}: {
  value: string;
  /** Optional Arabic caption rendered before the identifier. */
  label?: React.ReactNode;
  /** Middle-truncate to this many characters. */
  truncate?: number;
  copyable?: boolean;
  size?: "xs" | "sm" | "base";
  className?: string;
  /** e.g. a provider mark before the id. */
  prefix?: React.ReactNode;
  href?: string;
}) {
  const display = truncate ? truncateMiddle(value, truncate) : value;
  const shortened = display !== value;

  const body = (
    <Tooltip content={shortened ? value : null} delay={200}>
      <Mono size={size} className="max-w-full">
        {display}
      </Mono>
    </Tooltip>
  );

  return (
    <span
      className={cn("group/id inline-flex min-w-0 items-center gap-1.5", className)}
    >
      {label ? (
        <span className="shrink-0 text-2xs text-fg-quaternary">{label}</span>
      ) : null}
      {prefix}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-w-0 items-center gap-1 rounded-[3px] hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
        >
          {body}
          <ExternalLink className="size-2.5 shrink-0 text-fg-quaternary" aria-hidden />
        </a>
      ) : (
        body
      )}
      {copyable ? (
        <span className="opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover/id:opacity-100 focus-within:opacity-100">
          <CopyButton value={value} size="xs" />
        </span>
      ) : null}
    </span>
  );
}

/* ---------------------------------------------------------------------------
   CodeBlock — multi-line machine output. Never used for error stack traces in
   operator-facing surfaces; those get a human summary with the raw payload
   tucked behind a disclosure.
   ------------------------------------------------------------------------ */

export function CodeBlock({
  code,
  language,
  className,
  copyable = true,
  maxHeight = 320,
  lineNumbers = false,
  caption,
}: {
  code: string;
  language?: string;
  className?: string;
  copyable?: boolean;
  maxHeight?: number | string;
  lineNumbers?: boolean;
  caption?: React.ReactNode;
}) {
  const lines = React.useMemo(() => code.replace(/\n$/, "").split("\n"), [code]);

  return (
    <figure
      className={cn(
        "group/code overflow-hidden rounded-md border border-code-border bg-code-bg",
        className,
      )}
    >
      {caption || language || copyable ? (
        <figcaption className="flex items-center justify-between gap-2 border-b border-code-border px-2.5 py-1.5">
          <span className="min-w-0 truncate text-2xs text-fg-quaternary">
            {caption ?? (language ? <Mono size="xs">{language}</Mono> : null)}
          </span>
          {copyable ? <CopyButton value={code} /> : null}
        </figcaption>
      ) : null}
      <div className="overflow-auto" style={{ maxHeight }}>
        <pre className="pyth-code p-3 text-code-fg">
          {lineNumbers ? (
            <code>
              {lines.map((line, i) => (
                <span key={i} className="grid grid-cols-[2.25rem_1fr]">
                  <span className="select-none pe-3 text-end text-code-punct">
                    {i + 1}
                  </span>
                  <span>{line || "\u00A0"}</span>
                </span>
              ))}
            </code>
          ) : (
            <code>{code}</code>
          )}
        </pre>
      </div>
    </figure>
  );
}

/* ---------------------------------------------------------------------------
   JsonPreview — read-only structured payload with minimal, semantic colouring.
   Deliberately not a full editor; it exists so operators can verify a payload
   without leaving the panel.
   ------------------------------------------------------------------------ */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function JsonNode({
  value,
  depth,
  isLast,
}: {
  value: Json;
  depth: number;
  isLast: boolean;
}) {
  const pad = { paddingInlineStart: depth * 14 };
  const comma = isLast ? "" : ",";

  if (value === null)
    return (
      <div style={pad}>
        <span className="text-code-punct">null</span>
        {comma}
      </div>
    );
  if (typeof value === "boolean" || typeof value === "number")
    return (
      <div style={pad}>
        <span className="text-[var(--code-number)]">{String(value)}</span>
        {comma}
      </div>
    );
  if (typeof value === "string")
    return (
      <div style={pad}>
        <span className="text-[var(--code-string)]">&quot;{value}&quot;</span>
        {comma}
      </div>
    );

  if (Array.isArray(value)) {
    if (value.length === 0)
      return (
        <div style={pad}>
          <span className="text-code-punct">[]</span>
          {comma}
        </div>
      );
    return (
      <>
        <div style={pad} className="text-code-punct">
          [
        </div>
        {value.map((v, i) => (
          <JsonNode
            key={i}
            value={v}
            depth={depth + 1}
            isLast={i === value.length - 1}
          />
        ))}
        <div style={pad} className="text-code-punct">
          ]{comma}
        </div>
      </>
    );
  }

  const entries = Object.entries(value);
  if (entries.length === 0)
    return (
      <div style={pad}>
        <span className="text-code-punct">{"{}"}</span>
        {comma}
      </div>
    );

  return (
    <>
      <div style={pad} className="text-code-punct">
        {"{"}
      </div>
      {entries.map(([k, v], i) => {
        const last = i === entries.length - 1;
        const primitive =
          v === null || typeof v !== "object" || Array.isArray(v) === false
            ? v === null || typeof v !== "object"
            : false;
        if (primitive) {
          return (
            <div key={k} style={{ paddingInlineStart: (depth + 1) * 14 }}>
              <span className="text-[var(--code-key)]">&quot;{k}&quot;</span>
              <span className="text-code-punct">: </span>
              {v === null ? (
                <span className="text-code-punct">null</span>
              ) : typeof v === "string" ? (
                <span className="text-[var(--code-string)]">&quot;{v}&quot;</span>
              ) : (
                <span className="text-[var(--code-number)]">{String(v)}</span>
              )}
              {last ? "" : ","}
            </div>
          );
        }
        return (
          <React.Fragment key={k}>
            <div style={{ paddingInlineStart: (depth + 1) * 14 }}>
              <span className="text-[var(--code-key)]">&quot;{k}&quot;</span>
              <span className="text-code-punct">:</span>
            </div>
            <JsonNode value={v} depth={depth + 2} isLast={last} />
          </React.Fragment>
        );
      })}
      <div style={pad} className="text-code-punct">
        {"}"}
        {comma}
      </div>
    </>
  );
}

export function JsonPreview({
  data,
  className,
  maxHeight = 280,
  copyable = true,
  caption,
}: {
  data: Json;
  className?: string;
  maxHeight?: number | string;
  copyable?: boolean;
  caption?: React.ReactNode;
}) {
  const raw = React.useMemo(() => JSON.stringify(data, null, 2), [data]);
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-md border border-code-border bg-code-bg",
        className,
      )}
    >
      {caption || copyable ? (
        <figcaption className="flex items-center justify-between gap-2 border-b border-code-border px-2.5 py-1.5">
          <span className="truncate text-2xs text-fg-quaternary">
            {caption ?? "JSON"}
          </span>
          {copyable ? <CopyButton value={raw} /> : null}
        </figcaption>
      ) : null}
      <div className="overflow-auto" style={{ maxHeight }}>
        <div className="pyth-code p-3 text-code-fg">
          <JsonNode value={data} depth={0} isLast />
        </div>
      </div>
    </figure>
  );
}
