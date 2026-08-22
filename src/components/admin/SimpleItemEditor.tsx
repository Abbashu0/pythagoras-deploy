"use client";

/**
 * SimpleItemEditor — shared editor panel for the Navigation, Materials,
 * and Tools managers.
 *
 * All three managers edit items with the SAME shape conceptually:
 *
 *   { id, label, icon, available-or-enabled, order }
 *
 * The only field-name difference is `enabled` (nav) vs `available`
 * (materials/tools). The editor abstracts that behind an `enabledField`
 * prop ("enabled" | "available") so the same UI serves all three.
 *
 * Implements the same "pending save" pattern as `BannerEditor`:
 *   - Local `draft` state holds the working copy.
 *   - A `dirty` Set tracks which fields changed vs the original.
 *   - Save bar only appears when there are unsaved changes.
 *   - Save goes through: idle → saving (simulated latency) → saved (green) → idle
 *                                                      └→ error (red) → idle
 *   - `onDraftChange(draft)` lets the parent render a live preview that
 *     reflects the unsaved state.
 *
 * Props:
 *   - item:        the committed item being edited (null = empty state)
 *   - enabledField: which field name to use for the toggle
 *   - title:       header label, e.g. "محرر عنصر التنقل"
 *   - itemNoun:    short noun shown in the empty state + dirty badge,
 *                  e.g. "عنصر التنقل" / "مادة" / "أداة"
 *   - onSave(id, patch, changeSummary): commits the edit.
 *   - onClose():   called when the X button is clicked.
 *   - onDraftChange(draft): notifies parent of the local draft.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  X,
  Save,
  RotateCcw,
  AlertCircle,
  Check,
  Loader2,
  MousePointerClick,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { IconPicker } from "@/components/admin/IconPicker";

/** Minimal item shape this editor can handle. */
export interface EditableItem {
  id: string;
  label: string;
  icon: string;
  enabled?: boolean;
  available?: boolean;
  order: number;
}

type SaveState = "idle" | "saving" | "saved" | "error";
type DirtyField = "label" | "icon" | "enabled";

interface Props {
  item: EditableItem | null;
  /** Which field on the item drives the enable/disable toggle. */
  enabledField: "enabled" | "available";
  /** Header label, e.g. "محرر عنصر التنقل". */
  title: string;
  /** Short noun for empty-state + dirty badge, e.g. "مادة". */
  itemNoun: string;
  onSave: (
    id: string,
    patch: { label?: string; icon?: string; enabled?: boolean },
    changeSummary: string[]
  ) => void;
  onClose: () => void;
  onDraftChange?: (draft: EditableItem | null) => void;
  /** Use draft-oriented copy when a parent workspace still requires a final Change Set save. */
  buffered?: boolean;
}

const SAVE_LATENCY_MS = 900;
const SAVED_DISPLAY_MS = 2000;
const ERROR_DISPLAY_MS = 3000;

const ENABLED_LABELS = {
  enabled: { on: "تفعيل العنصر", off: "العناصر المعطّلة لا تظهر في شريط التنقل" },
  available: { on: "إتاحة العنصر", off: "العناصر غير المتاحة لا تظهر للطلاب" },
} as const;

function getEnabled(draft: EditableItem, field: "enabled" | "available"): boolean {
  return field === "enabled"
    ? draft.enabled ?? false
    : draft.available ?? false;
}

function buildChangeSummary(
  dirty: Set<DirtyField>,
  original: EditableItem,
  next: EditableItem,
  enabledField: "enabled" | "available"
): string[] {
  const summary: string[] = [];
  if (dirty.has("label")) {
    summary.push(
      `التسمية: من «${original.label || "—"}» إلى «${next.label || "—"}»`
    );
  }
  if (dirty.has("icon")) {
    summary.push(`الأيقونة: من «${original.icon}» إلى «${next.icon}»`);
  }
  if (dirty.has("enabled")) {
    const nextOn = getEnabled(next, enabledField);
    summary.push(nextOn ? "تم التفعيل" : "تم التعطيل");
  }
  return summary;
}

export function SimpleItemEditor({
  item,
  enabledField,
  title,
  itemNoun,
  onSave,
  onClose,
  onDraftChange,
  buffered = false,
}: Props) {
  const [draft, setDraft] = useState<EditableItem | null>(item);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Sync draft when the item ID changes (using the "adjust state during
  // render" pattern — same approach BannerEditor uses to avoid
  // set-state-in-effect).
  const [prevItemId, setPrevItemId] = useState<string | null>(item?.id ?? null);
  const currentItemId = item?.id ?? null;
  if (currentItemId !== prevItemId) {
    setPrevItemId(currentItemId);
    setDraft(item);
    setSaveState("idle");
  }

  // Notify parent of draft changes (for live preview).
  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  // Derived: dirty fields by diffing draft against the original item.
  const dirty = useMemo<Set<DirtyField>>(() => {
    const empty = new Set<DirtyField>();
    if (!item || !draft) return empty;
    if (item.id !== draft.id) return empty;
    const next = new Set<DirtyField>();
    if (draft.label !== item.label) next.add("label");
    if (draft.icon !== item.icon) next.add("icon");
    if (getEnabled(draft, enabledField) !== getEnabled(item, enabledField)) {
      next.add("enabled");
    }
    return next;
  }, [draft, item, enabledField]);

  const updateField = useCallback(
    <K extends keyof EditableItem>(key: K, value: EditableItem[K]) => {
      setDraft((prev) =>
        prev ? { ...prev, [key]: value } : prev
      );
    },
    []
  );

  // Save handler with simulated latency + state transitions.
  const handleSave = useCallback(async () => {
    if (!draft || !item) return;
    setSaveState("saving");
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY_MS));
    try {
      const summary = buildChangeSummary(dirty, item, draft, enabledField);
      const patch: {
        label?: string;
        icon?: string;
        enabled?: boolean;
      } = {};
      if (dirty.has("label")) patch.label = draft.label;
      if (dirty.has("icon")) patch.icon = draft.icon;
      if (dirty.has("enabled")) patch.enabled = getEnabled(draft, enabledField);
      onSave(item.id, patch, summary);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), SAVED_DISPLAY_MS);
    } catch {
      setSaveState("error");
      window.setTimeout(() => setSaveState("idle"), ERROR_DISPLAY_MS);
    }
  }, [draft, item, dirty, enabledField, onSave]);

  const handleDiscard = useCallback(() => {
    if (!item) return;
    setDraft(item);
    setSaveState("idle");
  }, [item]);

  const hasUnsavedChanges = dirty.size > 0;

  // Empty state: no item selected.
  if (!item || !draft) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border bg-card p-8 text-center">
        <div className="grid place-items-center rounded-full bg-muted p-4">
          <MousePointerClick className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">
          اختر {itemNoun} للتعديل
        </p>
        <p className="max-w-xs text-xs text-muted-foreground">
          اضغط على أي عنصر في القائمة لفتحه هنا، أو أعد ترتيب العناصر بالأسهم.
        </p>
      </div>
    );
  }

  const isSaving = saveState === "saving";
  const isSaved = saveState === "saved";
  const isError = saveState === "error";
  const enabledValue = getEnabled(draft, enabledField);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b p-4">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">
            الموضع #{draft.order + 1}
            {hasUnsavedChanges && (
              <span className="mr-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                تغييرات غير محفوظة
              </span>
            )}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Body — scrollable */}
      <div className="admin-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="space-y-5 p-4">
          {/* Label */}
          <section className="space-y-2">
            <Label
              htmlFor="item-label"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              التسمية
            </Label>
            <Input
              id="item-label"
              value={draft.label}
              onChange={(e) => updateField("label", e.target.value)}
              placeholder="مثال: الرئيسية"
              dir="rtl"
              maxLength={40}
              disabled={isSaving}
            />
          </section>

          {/* Icon picker */}
          <section className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              الأيقونة
            </Label>
            <IconPicker
              value={draft.icon}
              onChange={(name) => updateField("icon", name)}
              disabled={isSaving}
            />
          </section>

          {/* Enabled / Available toggle */}
          <section className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5">
            <div className="space-y-0.5">
              <Label
                htmlFor="item-enabled"
                className="text-sm font-medium text-foreground"
              >
                {ENABLED_LABELS[enabledField].on}
              </Label>
              <p className="text-xs text-muted-foreground">
                {ENABLED_LABELS[enabledField].off}
              </p>
            </div>
            <Switch
              id="item-enabled"
              checked={enabledValue}
              onCheckedChange={(checked) => updateField(enabledField, checked)}
              disabled={isSaving}
            />
          </section>
        </div>
      </div>

      {/* Save / Discard bar (only when there are unsaved changes) */}
      {hasUnsavedChanges && (
        <div className="admin-save-bar flex flex-shrink-0 items-center justify-between gap-3 border-t bg-card p-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDiscard}
            disabled={isSaving}
            className="gap-1.5 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            تجاهل التغييرات
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
            className={
              isSaved
                ? "gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-600"
                : isError
                ? "gap-1.5 bg-red-600 text-xs text-white hover:bg-red-600"
                : "gap-1.5 text-xs"
            }
          >
            {isSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                جارٍ الحفظ…
              </>
            ) : isSaved ? (
              <>
                <Check className="h-3.5 w-3.5" />
                {buffered ? "تم الاعتماد في المسودة" : "تم الحفظ"}
              </>
            ) : isError ? (
              <>
                <AlertCircle className="h-3.5 w-3.5" />
                فشل الحفظ
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                {buffered ? "اعتماد في المسودة" : "حفظ التغييرات"}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
