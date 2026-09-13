"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Ban,
  ChevronLeft,
  Link2Off,
  Power,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "../primitives/button";
import { Badge, StatusBadge } from "../status/status-badge";
import { Well, Panel } from "../primitives/surface";
import { TextField } from "../forms/input";
import { FormField } from "../forms/field";
import { Checkbox } from "../forms/toggle";
import { Banner } from "../feedback/banner";
import { EntityGlyph } from "../primitives/avatar";
import { Mono } from "../primitives/mono";
import { Separator } from "../primitives/separator";
import { useResetOn } from "@/lib/hooks";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "../overlays/dialog";

/* ============================================================================
   Destructive actions
   ---------------------------------------------------------------------------
   The rule this system enforces: an operator must never see
   "Delete failed." — ever.

   Deletion is modelled as a question with three possible answers, and the UI
   renders a different surface for each:

   1. ALLOWED       nothing depends on it. Confirm and go.
   2. CONSEQUENTIAL things depend on it, but the dependency can be reassigned
                    or cascaded. Show exactly what will change, then confirm.
   3. BLOCKED       things depend on it that must be changed first. Show the
                    dependents, link to each one, and disable the delete button
                    with the reason stated in words — not as a grey mystery.

   The dependency list is supplied by the caller (the server knows the graph);
   this component's job is to make the answer legible and actionable.

   Reversibility ladder, from least to most destructive:
     Disable → Archive → Revoke → Remove relation → Reset → Delete → Purge
   Prefer the leftmost option that solves the operator's problem, and say so in
   the dialog when a gentler option exists.
   ========================================================================== */

export interface Dependent {
  id: string;
  /** Entity type label — "نموذج", "بانر", "وكيل". */
  type: string;
  /** Display name. */
  name: string;
  technicalId?: string;
  href?: string;
  /** What must happen to it before the delete can proceed. */
  requiredAction?: string;
  /** Cascade: this dependent will also be deleted/updated. */
  cascade?: "delete" | "detach" | "reassign";
}

export type DeletePermission = "allowed" | "consequential" | "blocked";

export function resolveDeletePermission(
  dependents: Dependent[],
): DeletePermission {
  if (dependents.length === 0) return "allowed";
  return dependents.some((d) => d.cascade == null) ? "blocked" : "consequential";
}

/* ---------------------------------------------------------------------------
   DependencyList — the honest answer to "why can't I delete this?"
   ------------------------------------------------------------------------ */

export function DependencyList({
  dependents,
  className,
  title,
  emptyMessage,
}: {
  dependents: Dependent[];
  className?: string;
  title?: React.ReactNode;
  emptyMessage?: React.ReactNode;
}) {
  // Group by entity type so "نموذجان ووكيل" reads as three kinds, not five rows
  // of undifferentiated names. Computed before any early return so the hook
  // order stays stable.
  const grouped = React.useMemo(() => {
    const map = new Map<string, Dependent[]>();
    for (const d of dependents) {
      const list = map.get(d.type);
      if (list) list.push(d);
      else map.set(d.type, [d]);
    }
    return [...map.entries()];
  }, [dependents]);

  if (dependents.length === 0) {
    return emptyMessage ? (
      <p className={cn("text-xs text-fg-tertiary", className)}>{emptyMessage}</p>
    ) : null;
  }

  return (
    <div className={cn("min-w-0", className)}>
      {title ? <p className="eyebrow mb-1.5">{title}</p> : null}
      <ul className="divide-y divide-border-subtle overflow-hidden rounded-md border border-border bg-surface">
        {grouped.map(([type, items]) =>
          items.map((dep) => (
            <li
              key={dep.id}
              className="flex items-start justify-between gap-3 px-3 py-2.5"
            >
              <span className="flex min-w-0 items-start gap-2.5">
                <EntityGlyph size="xs" name={dep.name} tone="neutral" />
                <span className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="truncate text-sm text-fg">{dep.name}</span>
                    <span className="text-2xs text-fg-quaternary">{type}</span>
                    {dep.technicalId ? (
                      <Mono size="xs">{dep.technicalId}</Mono>
                    ) : null}
                  </span>
                  {dep.requiredAction ? (
                    <span className="mt-0.5 block text-xs text-warning-text">
                      {dep.requiredAction}
                    </span>
                  ) : null}
                  {dep.cascade ? (
                    <span className="mt-0.5 block text-xs text-fg-tertiary">
                      {dep.cascade === "delete"
                        ? "سيُحذف أيضًا"
                        : dep.cascade === "detach"
                          ? "ستُلغى الصلة به"
                          : "سيُعاد إسناده"}
                    </span>
                  ) : null}
                </span>
              </span>

              {dep.href ? (
                <Button
                  size="xs"
                  variant="ghost"
                  asChild
                  className="shrink-0"
                  trailingIcon={<ChevronLeft className="ltr:rotate-180" aria-hidden />}
                >
                  <Link href={dep.href}>فتح</Link>
                </Button>
              ) : null}
            </li>
          )),
        )}
      </ul>
    </div>
  );
}

/* ============================================================================
   DeleteDialog
   ========================================================================== */

export interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Entity type label — "موفر", "نموذج", "ملف". */
  entityType: string;
  /** Display name. */
  entityName: string;
  technicalId?: string;
  /** Everything that references this entity. */
  dependents?: Dependent[];
  onConfirm: () => void | Promise<void>;
  deleting?: boolean;
  /** Require typing the entity name. Auto-enabled when dependents cascade. */
  requireTypedConfirmation?: boolean;
  /** Extra consequences worth stating. */
  consequences?: React.ReactNode[];
  /** A gentler alternative to offer — usually disable or archive. */
  alternative?: {
    label: string;
    description: string;
    onSelect: () => void;
  };
  /** Overrides the derived permission (server had the final say). */
  permission?: DeletePermission;
  /** Copy override for the irreversible statement. */
  irreversibleNote?: React.ReactNode;
}

export function DeleteDialog({
  open,
  onOpenChange,
  entityType,
  entityName,
  technicalId,
  dependents = [],
  onConfirm,
  deleting = false,
  requireTypedConfirmation,
  consequences,
  alternative,
  permission: permissionProp,
  irreversibleNote,
}: DeleteDialogProps) {
  const permission = permissionProp ?? resolveDeletePermission(dependents);
  const blocked = permission === "blocked";
  const needsTyped =
    requireTypedConfirmation ?? permission === "consequential";

  const [typed, setTyped] = React.useState("");
  const [ackCascade, setAckCascade] = React.useState(false);

  useResetOn(open, () => {
    if (!open) {
      setTyped("");
      setAckCascade(false);
    }
  });

  const cascading = dependents.filter((d) => d.cascade != null);
  const blockers = dependents.filter((d) => d.cascade == null);

  const typedOk = !needsTyped || typed.trim() === entityName;
  const ackOk = cascading.length === 0 || ackCascade;
  const canDelete = !blocked && typedOk && ackOk && !deleting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={blocked || dependents.length > 0 ? "lg" : "md"}>
        <DialogHeader
          title={
            blocked
              ? `لا يمكن حذف ${entityType} ${entityName}`
              : `حذف ${entityType} ${entityName}؟`
          }
          icon={
            <span
              className={cn(
                "grid size-9 place-items-center rounded-full",
                blocked
                  ? "bg-warning-subtle text-warning-text"
                  : "bg-danger-subtle text-danger-text",
              )}
            >
              {blocked ? (
                <TriangleAlert className="size-4" aria-hidden />
              ) : (
                <Trash2 className="size-4" aria-hidden />
              )}
            </span>
          }
          description={
            blocked ? (
              <>
                هذا العنصر مستخدم بواسطة{" "}
                <span className="font-medium text-fg">
                  {blockers.length}{" "}
                  {blockers.length === 2 ? "عنصرين" : "عنصرًا"}
                </span>
                . عدّل العناصر التالية أولًا، ثم أعد المحاولة.
              </>
            ) : (
              (irreversibleNote ??
                "هذا الإجراء غير قابل للتراجع. سيُسجَّل في سجل النشاط.")
            )
          }
        />

        <DialogBody className="space-y-4 pb-2">
          {technicalId ? (
            <Well padding="xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-2xs text-fg-quaternary">
                  المعرّف التقني
                </span>
                <Mono size="base">{technicalId}</Mono>
              </div>
            </Well>
          ) : null}

          {blocked ? (
            <DependencyList
              dependents={blockers}
              title="يجب تعديل ما يلي أولًا"
            />
          ) : null}

          {cascading.length > 0 ? (
            <>
              <DependencyList
                dependents={cascading}
                title="سيتأثر ما يلي"
              />
              <div className="rounded-lg border border-danger-border bg-danger-subtle p-3.5">
                <Checkbox
                  checked={ackCascade}
                  onCheckedChange={(v) => setAckCascade(Boolean(v))}
                  label={`أُدرك أن ${cascading.length} عنصرًا مرتبطًا سيتأثر`}
                  description="هذا التأثير جزء من الحذف ولا يمكن التراجع عنه."
                />
              </div>
            </>
          ) : null}

          {consequences?.length ? (
            <Banner level="attention" size="sm" title="ما سيحدث">
              <ul className="space-y-1">
                {consequences.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span
                      aria-hidden
                      className="mt-1.5 size-1 shrink-0 rounded-full bg-current opacity-60"
                    />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </Banner>
          ) : null}

          {alternative && !blocked ? (
            <>
              <Separator />
              <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-secondary p-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">
                    هل تريد {alternative.label} بدلًا من الحذف؟
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-fg-tertiary">
                    {alternative.description}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={alternative.onSelect}
                  className="shrink-0"
                >
                  {alternative.label}
                </Button>
              </div>
            </>
          ) : null}

          {needsTyped && !blocked ? (
            <FormField
              label={
                <>
                  للتأكيد، اكتب{" "}
                  <span className="font-semibold text-fg">{entityName}</span>
                </>
              }
            >
              <TextField
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={entityName}
                autoComplete="off"
                autoFocus
                status={typed && !typedOk ? "invalid" : undefined}
              />
            </FormField>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {blocked ? "إغلاق" : "إلغاء"}
          </Button>
          {!blocked ? (
            <Button
              variant="destructive"
              icon={<Trash2 aria-hidden />}
              onClick={() => void onConfirm()}
              loading={deleting}
              disabled={!canDelete}
            >
              حذف نهائيًا
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================================
   ConfirmDialog — the general-purpose confirmation for reversible or
   moderately consequential actions.
   ========================================================================== */

export type ConfirmTone = "danger" | "warning" | "accent";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "تأكيد",
  cancelLabel = "إلغاء",
  onConfirm,
  tone = "accent",
  busy = false,
  icon,
  children,
  /** Statements the operator should read before confirming. */
  points,
  /** Undo is available after the fact — say so, it lowers the stakes. */
  undoable = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  tone?: ConfirmTone;
  busy?: boolean;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  points?: React.ReactNode[];
  undoable?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader
          title={title}
          description={description}
          icon={
            icon ?? (
              <span
                className={cn(
                  "grid size-9 place-items-center rounded-full",
                  tone === "danger" && "bg-danger-subtle text-danger-text",
                  tone === "warning" && "bg-warning-subtle text-warning-text",
                  tone === "accent" && "bg-accent-subtle text-accent-text",
                )}
              >
                <AlertTriangle className="size-4" aria-hidden />
              </span>
            )
          }
        />
        {children || points?.length || undoable ? (
          <DialogBody className="space-y-3 pb-2">
            {points?.length ? (
              <ul className="space-y-1.5">
                {points.map((p, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-xs leading-relaxed text-fg-secondary"
                  >
                    <span
                      aria-hidden
                      className="mt-1.5 size-1 shrink-0 rounded-full bg-fg-quaternary"
                    />
                    {p}
                  </li>
                ))}
              </ul>
            ) : null}
            {children}
            {undoable ? (
              <p className="text-xs text-fg-tertiary">
                يمكنك التراجع عن هذا الإجراء بعد تنفيذه.
              </p>
            ) : null}
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "destructive" : "primary"}
            onClick={() => void onConfirm()}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================================
   Purpose-built lesser actions
   ========================================================================== */

export function ArchiveDialog({
  open,
  onOpenChange,
  entityType,
  entityName,
  onConfirm,
  busy,
  restorable = true,
  effects,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: string;
  entityName: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  restorable?: boolean;
  effects?: React.ReactNode[];
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="warning"
      icon={
        <span className="grid size-9 place-items-center rounded-full bg-warning-subtle text-warning-text">
          <Archive className="size-4" aria-hidden />
        </span>
      }
      title={`أرشفة ${entityType} ${entityName}؟`}
      description={
        restorable
          ? "سيُخرَج من الاستخدام مع الاحتفاظ ببياناته، ويمكن استعادته في أي وقت."
          : "سيُخرَج من الاستخدام مع الاحتفاظ ببياناته."
      }
      confirmLabel="أرشفة"
      onConfirm={onConfirm}
      busy={busy}
      points={effects}
    />
  );
}

export function RestoreDialog({
  open,
  onOpenChange,
  entityType,
  entityName,
  onConfirm,
  busy,
  note,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: string;
  entityName: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  note?: React.ReactNode;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="accent"
      icon={
        <span className="grid size-9 place-items-center rounded-full bg-success-subtle text-success-text">
          <ArchiveRestore className="size-4" aria-hidden />
        </span>
      }
      title={`استعادة ${entityType} ${entityName}؟`}
      description="سيعود إلى حالته السابقة كما كان قبل الأرشفة."
      confirmLabel="استعادة"
      onConfirm={onConfirm}
      busy={busy}
      points={note ? [note] : undefined}
    />
  );
}

export function DisableDialog({
  open,
  onOpenChange,
  entityType,
  entityName,
  onConfirm,
  busy,
  /** What stops working while it is disabled. */
  effects,
  dependents = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: string;
  entityName: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  effects?: React.ReactNode[];
  dependents?: Dependent[];
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="warning"
      icon={
        <span className="grid size-9 place-items-center rounded-full bg-warning-subtle text-warning-text">
          <Power className="size-4" aria-hidden />
        </span>
      }
      title={`تعطيل ${entityType} ${entityName}؟`}
      description="تبقى الإعدادات محفوظة، ويمكن إعادة التفعيل في أي وقت."
      confirmLabel="تعطيل"
      onConfirm={onConfirm}
      busy={busy}
      points={effects}
      undoable
    >
      {dependents.length > 0 ? (
        <DependencyList dependents={dependents} title="سيتأثر ما يلي" />
      ) : null}
    </ConfirmDialog>
  );
}

export function RevokeDialog({
  open,
  onOpenChange,
  what,
  onConfirm,
  busy,
  consequences,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is being revoked — "مفتاح OpenRouter". */
  what: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  consequences?: React.ReactNode[];
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="danger"
      icon={
        <span className="grid size-9 place-items-center rounded-full bg-danger-subtle text-danger-text">
          <Ban className="size-4" aria-hidden />
        </span>
      }
      title={`إبطال ${what}؟`}
      description="سيتوقف العمل فورًا حتى إضافة بديل. لا يمكن استرجاع القيمة المُبطلة."
      confirmLabel="إبطال"
      onConfirm={onConfirm}
      busy={busy}
      points={consequences}
    />
  );
}

export function RemoveRelationDialog({
  open,
  onOpenChange,
  /** "إزالة إسناد النموذج من Pi" */
  title,
  description,
  onConfirm,
  busy,
  replacement,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  /** Control for choosing a replacement instead of leaving it empty. */
  replacement?: React.ReactNode;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="warning"
      icon={
        <span className="grid size-9 place-items-center rounded-full bg-warning-subtle text-warning-text">
          <Link2Off className="size-4" aria-hidden />
        </span>
      }
      title={title}
      description={description}
      confirmLabel="إزالة الصلة"
      onConfirm={onConfirm}
      busy={busy}
    >
      {replacement}
    </ConfirmDialog>
  );
}

export function ResetDialog({
  open,
  onOpenChange,
  what,
  onConfirm,
  busy,
  /** What the defaults are. */
  defaultsSummary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  what: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  defaultsSummary?: React.ReactNode;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="warning"
      icon={
        <span className="grid size-9 place-items-center rounded-full bg-warning-subtle text-warning-text">
          <RotateCcw className="size-4" aria-hidden />
        </span>
      }
      title={`إعادة ${what} إلى الإعدادات الافتراضية؟`}
      description="ستُستبدل القيم الحالية بالافتراضية، وسيُسجَّل ذلك كمراجعة جديدة."
      confirmLabel="إعادة التعيين"
      onConfirm={onConfirm}
      busy={busy}
    >
      {defaultsSummary ? (
        <Well padding="xs">
          <p className="eyebrow mb-1.5">القيم الافتراضية</p>
          {defaultsSummary}
        </Well>
      ) : null}
    </ConfirmDialog>
  );
}

/** Purge: permanent removal of data, not just an entity. Highest friction. */
export function PurgeDialog({
  open,
  onOpenChange,
  what,
  scopeDescription,
  recordCount,
  onConfirm,
  busy,
  confirmationPhrase = "purge",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  what: string;
  scopeDescription: React.ReactNode;
  recordCount?: number;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  confirmationPhrase?: string;
}) {
  const [typed, setTyped] = React.useState("");
  const [ack, setAck] = React.useState(false);

  useResetOn(open, () => {
    if (!open) {
      setTyped("");
      setAck(false);
    }
  });

  const ok = typed.trim().toLowerCase() === confirmationPhrase.toLowerCase() && ack;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" hideClose>
        <DialogHeader
          title={`إزالة نهائية لـ ${what}`}
          icon={
            <span className="grid size-9 place-items-center rounded-full bg-danger text-on-accent">
              <TriangleAlert className="size-4" aria-hidden />
            </span>
          }
          description="هذه العملية تحذف البيانات نفسها، لا العنصر فقط. لا توجد استعادة."
        />
        <DialogBody className="space-y-4 pb-2">
          <Banner level="critical" title="النطاق">
            {scopeDescription}
            {recordCount != null ? (
              <span className="mt-1 block font-medium tnum">
                عدد السجلات المتأثرة: {recordCount.toLocaleString("en-US")}
              </span>
            ) : null}
          </Banner>

          <Checkbox
            checked={ack}
            onCheckedChange={(v) => setAck(Boolean(v))}
            label="أُدرك أن هذه البيانات لا يمكن استرجاعها"
            description="لا توجد نسخة احتياطية داخل لوحة التحكم."
          />

          <FormField
            label={
              <>
                اكتب{" "}
                <span
                  dir="ltr"
                  className="ltr-island font-mono font-semibold text-fg"
                >
                  {confirmationPhrase}
                </span>{" "}
                للتأكيد
              </>
            }
          >
            <TextField
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              ltr
              autoComplete="off"
              autoFocus
              placeholder={confirmationPhrase}
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            إلغاء
          </Button>
          <Button
            variant="destructive"
            onClick={() => void onConfirm()}
            loading={busy}
            disabled={!ok}
          >
            إزالة نهائية
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================================
   DangerZone
   ---------------------------------------------------------------------------
   A bounded region at the end of a settings page. Everything in it is
   irreversible or disruptive, each row states its own consequence, and the
   region is visually quarantined so nothing else on the page inherits its
   urgency.
   ========================================================================== */

export interface DangerAction {
  key: string;
  label: string;
  description: React.ReactNode;
  actionLabel: string;
  onAction: () => void;
  /** Blocked with a stated reason rather than a grey button. */
  disabled?: boolean;
  disabledReason?: React.ReactNode;
  tone?: "warning" | "danger";
  icon?: React.ReactNode;
  /** Dependent count preview, e.g. "مستخدم بواسطة نموذجين". */
  status?: React.ReactNode;
}

export function DangerZone({
  actions,
  title = "منطقة الإجراءات الحسّاسة",
  description = "هذه الإجراءات تؤثر على البيئة الحيّة، وبعضها غير قابل للتراجع.",
  className,
}: {
  actions: DangerAction[];
  title?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <Panel
      variant="outlined"
      className={cn("border-danger-border/60 min-w-0", className)}
    >
      <div className="border-b border-danger-border/50 bg-danger-subtle/40 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <AlertTriangle
            className="mt-px size-4 shrink-0 text-danger-text"
            aria-hidden
          />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-fg">{title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-fg-tertiary">
              {description}
            </p>
          </div>
        </div>
      </div>

      <ul className="divide-y divide-border-subtle">
        {actions.map((action) => (
          <li
            key={action.key}
            className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 py-3.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-fg">
                  {action.label}
                </span>
                {action.status}
              </div>
              <p className="mt-1 max-w-prose text-xs leading-relaxed text-fg-tertiary">
                {action.description}
              </p>
              {action.disabled && action.disabledReason ? (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning-text">
                  <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
                  {action.disabledReason}
                </p>
              ) : null}
            </div>
            <Button
              size="sm"
              variant={
                action.disabled
                  ? "secondary"
                  : action.tone === "warning"
                    ? "dangerOutline"
                    : "dangerOutline"
              }
              icon={action.icon}
              onClick={action.onAction}
              disabled={action.disabled}
              className="shrink-0"
            >
              {action.actionLabel}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ---------------------------------------------------------------------------
   BlockedActionNote — the inline version of a blocked delete, for use in
   detail panels where opening a dialog just to be refused is a waste.
   ------------------------------------------------------------------------ */

export function BlockedActionNote({
  action,
  dependents,
  className,
}: {
  /** "حذف هذا الموفر" */
  action: string;
  dependents: Dependent[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-warning-border bg-warning-subtle px-3 py-2.5",
        className,
      )}
    >
      <p className="flex items-start gap-2 text-xs text-fg-secondary">
        <AlertTriangle
          className="mt-px size-3.5 shrink-0 text-warning-text"
          aria-hidden
        />
        <span>
          <span className="font-medium text-fg">لا يمكن {action}</span> لأنه
          مستخدم بواسطة{" "}
          <span className="tnum">{dependents.length}</span>{" "}
          {dependents.length === 2 ? "عنصرين" : "عنصرًا"}:{" "}
          {dependents.slice(0, 3).map((d, i) => (
            <React.Fragment key={d.id}>
              {i > 0 ? "، " : ""}
              {d.href ? (
                <Link
                  href={d.href}
                  className="font-medium text-accent-text hover:underline"
                >
                  {d.name}
                </Link>
              ) : (
                <span className="font-medium">{d.name}</span>
              )}
            </React.Fragment>
          ))}
          {dependents.length > 3 ? ` و${dependents.length - 3} غيرها` : ""}.
        </span>
      </p>
    </div>
  );
}

/** Status chip summarising why an entity cannot be removed. */
export function DependencyBadge({
  count,
  label = "مرتبط",
  className,
}: {
  count: number;
  label?: string;
  className?: string;
}) {
  if (count === 0) return null;
  return (
    <Badge size="sm" variant="subtle" tone="warning" className={className}>
      <span className="tnum">{count}</span> {label}
    </Badge>
  );
}

export { StatusBadge };
