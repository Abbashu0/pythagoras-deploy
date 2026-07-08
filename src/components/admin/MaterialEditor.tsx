"use client";

/**
 * MaterialEditor
 * ---------------
 * Side panel for editing a single Material (subject card).
 *
 * Implements the same "pending save" pattern as `BannerEditor`:
 *   - Local `draft` state holds the working copy (typed-in inputs are NOT
 *     pushed to the store until the user clicks Save).
 *   - A `dirty` Set tracks which fields have changed relative to the
 *     original item.
 *   - The Save bar only appears when there are unsaved changes.
 *   - Save goes through a state machine:
 *         idle → saving (simulated latency) → saved (green) → idle
 *                                       └→ error (red) → idle
 *
 * Fields the editor manages:
 *   - image:        Data URL of the uploaded card image (UploadArea +
 *                   ImagePositioner — same pattern as banners).
 *   - transform:    Image positioning { offsetX, offsetY, scale }.
 *   - label:        Arabic title (e.g. "الأحياء").
 *   - englishTitle: English caption in caps (e.g. "BIOLOGY").
 *   - available:    Whether the material is shown to students.
 *
 * The icon field is preserved on save but not exposed in the UI (the
 * student app no longer renders the icon — it renders the uploaded
 * image or gradient fallback instead).
 *
 * Props:
 *   - item:                  the committed item being edited (null = empty state)
 *   - onSave(id, patch, changeSummary):
 *       called when the user clicks Save. Receives only the dirty fields
 *       as a patch, plus a human-readable Arabic change summary for the
 *       activity log.
 *   - onClose:               called when the X button is clicked
 *   - onDraftChange(draft):  called whenever the local draft changes —
 *                            lets the parent show a live preview of the
 *                            unsaved state.
 *   - onImageEditingChange(editing): forwarded to ImagePositioner — true
 *                            while the user is dragging the image, false
 *                            otherwise. Lets the parent suppress FLIP
 *                            animation during live drags.
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
import {
  BANNER_TRANSFORM_DEFAULT,
  type BannerImageTransform,
} from "@/lib/admin/banner-model";
import { UploadArea } from "./UploadArea";
import { ImagePositioner } from "./ImagePositioner";
import type { ContentItem } from "@/lib/admin/content-store";

type SaveState = "idle" | "saving" | "saved" | "error";

/** Fields tracked in the `dirty` Set. */
type DirtyField =
  | "image"
  | "transform"
  | "label"
  | "englishTitle"
  | "available";

/** Patch shape accepted by the parent's `commitContentEdit`. */
export type MaterialPatch = Partial<
  Omit<ContentItem, "id" | "order" | "icon">
>;

interface Props {
  item: ContentItem | null;
  onSave: (
    id: string,
    patch: MaterialPatch,
    changeSummary: string[]
  ) => void;
  onClose: () => void;
  /** Notifies parent of the local draft (for live preview). */
  onDraftChange?: (draft: ContentItem | null) => void;
  /** Forwarded to ImagePositioner — true while the user is dragging. */
  onImageEditingChange?: (editing: boolean) => void;
}

/** Simulated save latency (ms) — gives the user a visible "saving" state. */
const SAVE_LATENCY_MS = 900;
const SAVED_DISPLAY_MS = 2000;
const ERROR_DISPLAY_MS = 3000;

/**
 * Build a human-readable Arabic change summary from the dirty fields.
 * Used by the activity log so the user can see what changed in each edit.
 */
function buildChangeSummary(
  dirty: Set<DirtyField>,
  original: ContentItem,
  next: ContentItem
): string[] {
  const summary: string[] = [];
  if (dirty.has("label")) {
    summary.push(
      `التسمية: من «${original.label || "—"}» إلى «${next.label || "—"}»`
    );
  }
  if (dirty.has("englishTitle")) {
    summary.push(
      `التسمية الإنجليزية: من «${original.englishTitle || "—"}» إلى «${next.englishTitle || "—"}»`
    );
  }
  if (dirty.has("image")) {
    if (!original.image && next.image) summary.push("تم رفع صورة جديدة");
    else if (original.image && !next.image) summary.push("تم حذف الصورة");
    else summary.push("تم استبدال الصورة");
  }
  if (dirty.has("transform")) {
    summary.push("تم ضبط موضع الصورة وتكبيرها");
  }
  if (dirty.has("available")) {
    summary.push(next.available ? "تم تفعيل المادة" : "تم تعطيل المادة");
  }
  return summary;
}

export function MaterialEditor({
  item,
  onSave,
  onClose,
  onDraftChange,
  onImageEditingChange,
}: Props) {
  const [draft, setDraft] = useState<ContentItem | null>(item);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // ---- Sync draft when the item ID changes ----
  // "Adjust state during render" pattern (same approach BannerEditor uses
  // to avoid set-state-in-effect).
  const [prevItemId, setPrevItemId] = useState<string | null>(item?.id ?? null);
  const currentItemId = item?.id ?? null;
  if (currentItemId !== prevItemId) {
    setPrevItemId(currentItemId);
    setDraft(item);
    setSaveState("idle");
  }

  // ---- Notify parent of draft changes (for live preview) ----
  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  // ---- Derived: dirty fields by diffing draft against the original item ----
  const dirty = useMemo<Set<DirtyField>>(() => {
    const empty = new Set<DirtyField>();
    if (!item || !draft) return empty;
    if (item.id !== draft.id) return empty;
    const next = new Set<DirtyField>();
    if (draft.label !== item.label) next.add("label");
    if ((draft.englishTitle || "") !== (item.englishTitle || "")) {
      next.add("englishTitle");
    }
    if ((draft.image || "") !== (item.image || "")) next.add("image");
    const dt = draft.transform || BANNER_TRANSFORM_DEFAULT;
    const it = item.transform || BANNER_TRANSFORM_DEFAULT;
    if (
      dt.offsetX !== it.offsetX ||
      dt.offsetY !== it.offsetY ||
      dt.scale !== it.scale
    ) {
      next.add("transform");
    }
    if (draft.available !== item.available) next.add("available");
    return next;
  }, [draft, item]);

  // ---- Field update helpers ----
  const updateField = useCallback(
    <K extends keyof ContentItem>(key: K, value: ContentItem[K]) => {
      setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    []
  );

  const onTransformChange = useCallback((next: BannerImageTransform) => {
    setDraft((prev) => (prev ? { ...prev, transform: next } : prev));
  }, []);

  // ---- Save handler with simulated latency + state transitions ----
  const handleSave = useCallback(async () => {
    if (!draft || !item) return;
    setSaveState("saving");
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY_MS));
    try {
      const summary = buildChangeSummary(dirty, item, draft);
      const patch: MaterialPatch = {};
      if (dirty.has("label")) patch.label = draft.label;
      if (dirty.has("englishTitle")) patch.englishTitle = draft.englishTitle || "";
      if (dirty.has("image")) patch.image = draft.image || "";
      if (dirty.has("transform")) patch.transform = draft.transform;
      if (dirty.has("available")) patch.available = draft.available;
      onSave(item.id, patch, summary);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), SAVED_DISPLAY_MS);
    } catch {
      setSaveState("error");
      window.setTimeout(() => setSaveState("idle"), ERROR_DISPLAY_MS);
    }
  }, [draft, item, dirty, onSave]);

  const handleDiscard = useCallback(() => {
    if (!item) return;
    setDraft(item);
    setSaveState("idle");
  }, [item]);

  const hasUnsavedChanges = dirty.size > 0;

  // ---- Empty state: no item selected ----
  if (!item || !draft) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border bg-card p-8 text-center">
        <div className="grid place-items-center rounded-full bg-muted p-4">
          <MousePointerClick className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">اختر مادة للتعديل</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          اضغط على أي مادة في القائمة لفتحها هنا، أو أعد ترتيب المواد بالأسهم.
        </p>
      </div>
    );
  }

  const isSaving = saveState === "saving";
  const isSaved = saveState === "saved";
  const isError = saveState === "error";

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b p-4">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-foreground">محرر المادة</h3>
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
          {/* ---------- Upload section ---------- */}
          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              صورة المادة
            </h4>
            <UploadArea
              currentImage={draft.image || undefined}
              compressionTarget={{
                maxWidth: 800,
                maxHeight: 450,
                quality: 0.85,
                mime: "image/jpeg",
              }}
              recommendedHint="الحجم الموصى به: 800×450px (نسبة 16:9) — تصدير 2× retina. يتم ضغط الصور تلقائياً عند الرفع لتوفير المساحة."
              onUploaded={(dataUrl) => {
                setDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        image: dataUrl,
                        transform: { ...BANNER_TRANSFORM_DEFAULT },
                      }
                    : prev
                );
              }}
              onClear={() => {
                setDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        image: "",
                        transform: { ...BANNER_TRANSFORM_DEFAULT },
                      }
                    : prev
                );
              }}
            />
          </section>

          {/* ---------- Image positioning (only when image exists) ---------- */}
          {draft.image && (
            <section className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                ضبط الموضع
              </h4>
              <ImagePositioner
                imageSrc={draft.image}
                gradient={draft.gradient}
                value={draft.transform || BANNER_TRANSFORM_DEFAULT}
                onChange={onTransformChange}
                // 16:9 preview width — narrower than the banner's 320
                // because the card aspect ratio is taller-per-width.
                previewWidth={288}
                fullFrame
                onEditingChange={onImageEditingChange}
              />
            </section>
          )}

          {/* ---------- Arabic title ---------- */}
          <section className="space-y-2">
            <Label
              htmlFor="item-label"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              العنوان (عربي)
            </Label>
            <Input
              id="item-label"
              value={draft.label}
              onChange={(e) => updateField("label", e.target.value)}
              placeholder="مثال: الأحياء"
              dir="rtl"
              maxLength={40}
              disabled={isSaving}
            />
          </section>

          {/* ---------- English title ---------- */}
          <section className="space-y-2">
            <Label
              htmlFor="item-english-title"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              العنوان (إنجليزي)
            </Label>
            <Input
              id="item-english-title"
              value={draft.englishTitle || ""}
              onChange={(e) => updateField("englishTitle", e.target.value.toUpperCase())}
              placeholder="مثال: BIOLOGY"
              dir="ltr"
              maxLength={24}
              disabled={isSaving}
              className="font-mono tracking-wider"
            />
            <p className="text-[11px] text-muted-foreground">
              يظهر تحت العنوان العربي بحروف كبيرة.
            </p>
          </section>

          {/* ---------- Available toggle ---------- */}
          <section className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5">
            <div className="space-y-0.5">
              <Label
                htmlFor="item-available"
                className="text-sm font-medium text-foreground"
              >
                إتاحة المادة
              </Label>
              <p className="text-xs text-muted-foreground">
                المواد غير المتاحة لا تظهر للطلاب
              </p>
            </div>
            <Switch
              id="item-available"
              checked={draft.available}
              onCheckedChange={(checked) => updateField("available", checked)}
              disabled={isSaving}
            />
          </section>
        </div>
      </div>

      {/* ---------- Save / Discard bar (only when there are unsaved changes) ---------- */}
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
                تم الحفظ
              </>
            ) : isError ? (
              <>
                <AlertCircle className="h-3.5 w-3.5" />
                فشل الحفظ
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                حفظ التغييرات
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
