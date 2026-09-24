"use client";

import * as React from "react";
import { ArrowRight, Check, ChevronDown, Server } from "lucide-react";

import type { AIAgent1RuntimeModel } from "@/server/ai/agent-1-runtime/contracts";
import { cn } from "@/lib/cn";
import { formatContextWindow } from "@/lib/format";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge, StatusBadge } from "../../status/status-badge";
import { Button } from "../../primitives/button";
import { Mono } from "../../primitives/mono";
import { Panel } from "../../primitives/surface";
import { Popover, PopoverContent, PopoverTrigger } from "../../overlays/popover";
import { InlineNote } from "../../feedback/banner";

export interface AgentModelSelectorProps {
  models: AIAgent1RuntimeModel[];
  value: string | null;
  onValueChange: (modelConfigId: string | null) => void;
  excludedIds?: ReadonlySet<string>;
  clearable?: boolean;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}

/** Agent routing selector adapted from APCL's provider-grouped model selector. */
export function AgentModelSelector({
  models,
  value,
  onValueChange,
  excludedIds = new Set(),
  clearable = false,
  disabled = false,
  placeholder = "اختر نموذجًا",
  ariaLabel,
  className,
}: AgentModelSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const selected = models.find((model) => model.id === value) ?? null;
  const groups = React.useMemo(() => {
    const grouped = new Map<string, AIAgent1RuntimeModel[]>();
    for (const model of models) {
      const current = grouped.get(model.providerName) ?? [];
      current.push(model);
      grouped.set(model.providerName, current);
    }
    return [...grouped.entries()];
  }, [models]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-expanded={open}
          className={cn("w-full justify-between text-start", className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected ? (
              <>
                <span className="min-w-0 truncate font-medium text-fg">
                  {selected.displayName}
                </span>
                <span className="shrink-0 text-xs text-fg-tertiary">
                  {selected.providerName}
                </span>
              </>
            ) : (
              <span className="truncate text-fg-quaternary">{placeholder}</span>
            )}
          </span>
          <ChevronDown className="size-4 shrink-0 text-fg-quaternary" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        padding="none"
        width="min(28rem, calc(100vw - 2rem))"
        className="p-0"
      >
        <Command
          dir="rtl"
          shouldFilter
          className="bg-transparent text-fg"
        >
          <CommandInput
            autoFocus
            placeholder="ابحث باسم النموذج أو معرّفه..."
            className="text-fg placeholder:text-fg-quaternary"
          />
          <CommandList className="max-h-80">
            <CommandEmpty className="px-3 py-6 text-xs text-fg-tertiary">
              لا توجد نماذج مطابقة.
            </CommandEmpty>
            {clearable ? (
              <CommandGroup heading="التعيين">
                <CommandItem
                  value="__clear_primary_assignment__"
                  onSelect={() => {
                    onValueChange(null);
                    setOpen(false);
                  }}
                  className="data-[selected=true]:bg-hover data-[selected=true]:text-fg"
                >
                  <span className="flex-1 text-fg-secondary">بدون نموذج رئيسي</span>
                  {!value ? <Check className="size-4 text-accent" aria-hidden /> : null}
                </CommandItem>
              </CommandGroup>
            ) : null}
            {groups.map(([providerName, providerModels]) => (
              <CommandGroup key={providerName} heading={providerName}>
                {providerModels.map((model) => {
                  const excluded = excludedIds.has(model.id) && model.id !== value;
                  const blockedReason = model.readinessReason ??
                    (excluded ? "هذا النموذج مستخدم في موضع آخر من السلسلة." : null);
                  const optionDisabled = !model.ready || excluded;
                  return (
                    <CommandItem
                      key={model.id}
                      value={`${model.displayName} ${model.providerModelId} ${model.providerName}`}
                      disabled={optionDisabled}
                      onSelect={() => {
                        if (optionDisabled) return;
                        onValueChange(model.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "items-start gap-2.5 px-3 py-2.5 data-[selected=true]:bg-hover data-[selected=true]:text-fg",
                        optionDisabled && "cursor-not-allowed opacity-70",
                      )}
                    >
                      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-inset text-fg-tertiary">
                        <Server className="size-3.5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-fg">
                            {model.displayName}
                          </span>
                          {model.id === value ? (
                            <Check className="size-4 shrink-0 text-accent" aria-hidden />
                          ) : null}
                        </span>
                        <span dir="ltr" className="ltr-island mt-0.5 block truncate text-start">
                          <Mono size="xs">{model.providerModelId}</Mono>
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge size="sm" variant="inset">
                            <span className="tnum">
                              {model.contextWindowTokens == null
                                ? "نافذة غير محددة"
                                : `${formatContextWindow(model.contextWindowTokens)} رمز`}
                            </span>
                          </Badge>
                          <StatusBadge
                            status={model.ready ? "ready" : "notReady"}
                            label={model.readinessLabel}
                            size="sm"
                          />
                          {model.capability !== "GENERATION" ? (
                            <Badge size="sm" variant="inset">
                              <span dir="ltr" className="ltr-island">{model.capability}</span>
                            </Badge>
                          ) : null}
                        </span>
                        {blockedReason ? (
                          <span className="mt-1 block text-2xs leading-relaxed text-warning-text">
                            {blockedReason}
                          </span>
                        ) : null}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function AgentModelChain({
  model,
}: {
  model: AIAgent1RuntimeModel | null;
}) {
  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
      <ChainNode eyebrow="الوكيل" title="Agent 1" />
      <ChainArrow />
      <ChainNode
        eyebrow="النموذج"
        title={model?.displayName ?? "لا يوجد نموذج مسند"}
        technicalId={model?.providerModelId}
      />
      <ChainArrow />
      <ChainNode
        eyebrow="المزوّد"
        title={model?.providerName ?? "—"}
        status={model?.readinessLabel}
        ready={model?.ready}
      />
    </div>
  );
}

export function ModelAssignmentPanel({
  models,
  value,
  onValueChange,
  changed = false,
  disabled = false,
}: {
  models: AIAgent1RuntimeModel[];
  value: string | null;
  onValueChange: (modelConfigId: string | null) => void;
  changed?: boolean;
  disabled?: boolean;
}) {
  const selected = models.find((model) => model.id === value) ?? null;
  return (
    <div className="min-w-0 space-y-3.5">
      <label className="flex items-baseline gap-2 text-xs font-medium text-fg-secondary">
        النموذج الرئيسي
        {changed ? (
          <span className="font-normal text-warning-text">مسودة غير محفوظة</span>
        ) : null}
      </label>
      <AgentModelSelector
        ariaLabel="اختيار النموذج الرئيسي لـ Agent 1"
        models={models}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        clearable
        placeholder="اختر نموذج توليد رئيسيًا"
      />

      {selected ? (
        <>
          <Panel variant="inset" padding="sm">
            <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              <Fact label="المزوّد">
                <span className="font-medium text-fg">{selected.providerName}</span>
              </Fact>
              <Fact label="معرّف المزوّد">
                <span dir="ltr" className="ltr-island block text-start">
                  <Mono size="base">{selected.providerModelId}</Mono>
                </span>
              </Fact>
              <Fact label="نافذة السياق">
                <span className="font-medium text-fg tnum">
                  {selected.contextWindowTokens == null
                    ? "غير محددة"
                    : `${formatContextWindow(selected.contextWindowTokens)} رمز`}
                </span>
              </Fact>
              <Fact label="الجاهزية">
                <StatusBadge
                  status={selected.ready ? "ready" : "notReady"}
                  label={selected.readinessLabel}
                  size="sm"
                />
              </Fact>
            </dl>
          </Panel>
          <AgentModelChain model={selected} />
          {selected.readinessReason ? (
            <InlineNote tone="warning">{selected.readinessReason}</InlineNote>
          ) : null}
        </>
      ) : (
        <InlineNote tone="warning">
          لا يمكن تشغيل Agent 1 قبل إسناد نموذج Generation صالح.
        </InlineNote>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs text-fg-tertiary">{label}</dt>
      <dd className="min-w-0 text-xs">{children}</dd>
    </div>
  );
}

function ChainNode({
  eyebrow,
  title,
  technicalId,
  status,
  ready,
}: {
  eyebrow: string;
  title: string;
  technicalId?: string;
  status?: string;
  ready?: boolean;
}) {
  return (
    <Panel
      variant="outlined"
      padding="sm"
      className={cn("min-w-0", ready === false && "border-warning-border bg-warning-subtle/30")}
    >
      <p className="eyebrow">{eyebrow}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-fg">{title}</p>
      {technicalId ? (
        <span dir="ltr" className="ltr-island mt-0.5 block truncate text-start">
          <Mono size="xs">{technicalId}</Mono>
        </span>
      ) : null}
      {status ? (
        <span className="mt-1.5 block text-2xs text-fg-tertiary">{status}</span>
      ) : null}
    </Panel>
  );
}

function ChainArrow() {
  return (
    <span aria-hidden className="hidden px-1 text-fg-quaternary sm:inline">
      <ArrowRight className="size-4 rtl:rotate-180" />
    </span>
  );
}
