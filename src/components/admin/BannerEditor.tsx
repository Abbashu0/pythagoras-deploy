"use client";

/**
 * BannerEditor
 * -------------
 * Side panel for editing a single SponsoredBanner.
 *
 * Implements a "pending save" pattern:
 *   - Local `draft` state holds the working copy (typed in inputs are NOT
 *     pushed to the store until the user clicks Save).
 *   - A `dirty` Set tracks which fields have changed relative to the
 *     original banner.
 *   - The Save bar only appears when there are unsaved changes.
 *   - Save goes through a state machine:
 *         idle → saving (1.2s simulated latency) → saved (2s green) → idle
 *                                       └→ error (3s red) → idle
 *
 * The editor adapts to `draft.bannerType`:
 *
 *   - "full":  Image Upload + Image Positioner + Enabled toggle.
 *              Title/subtitle are hidden (text lives inside the image).
 *
 *   - "split": Image Upload + Positioner + Title + Subtitle + Enabled toggle.
 *
 * Switching banner type marks `bannerType` dirty — the user must Save to
 * commit the change.
 *
 * Props:
 *   - banner:               the banner being edited (null = empty state)
 *   - onSave(id, patch, changeSummary):
 *       called when the user clicks Save. Receives only the dirty fields as
 *       a patch, plus a human-readable Arabic change summary for the
 *       activity log.
 *   - onClose:              called when the user clicks the X button
 *   - onDraftChange(draft): called whenever the local draft changes — lets
 *       the parent show a live preview of the unsaved state.
 *   - onImageEditingChange(editing): forwarded to ImagePositioner — true
 *       while the user is dragging the image, false otherwise. Lets the
 *       parent suppress "unsaved changes" warnings during live drags.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  X,
  Save,
  ImageIcon,
  LayoutGrid,
  LayoutPanelTop,
  RotateCcw,
  AlertCircle,
  Check,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  SponsoredBanner,
  BannerImageTransform,
  BannerType,
  BannerInput,
  BANNER_TRANSFORM_DEFAULT,
} from "@/lib/admin/banner-model";
import { UploadArea } from "./UploadArea";
import { ImagePositioner } from "./ImagePositioner";
import { setImage as setImageInDB, deleteImage as deleteImageFromDB } from "@/lib/admin/image-db";
import { getBannerDimensions, BANNER_POSITIONER_WIDTH } from "@/lib/admin/dimensions";

type SaveState = "idle" | "saving" | "saved" | "error";

interface Props {
  banner: SponsoredBanner | null;
  onSave: (
    id: string,
    patch: Partial<BannerInput>,
    changeSummary: string[]
  ) => void;
  onClose: () => void;
  /** Notifies parent of the local draft (for live preview). */
  onDraftChange?: (draft: SponsoredBanner | null) => void;
  /** Forwarded to ImagePositioner — true while user is dragging the image. */
  onImageEditingChange?: (editing: boolean) => void;
}

/** Which fields can be dirty (tracked in the `dirty` Set). */
type DirtyField =
  | "bannerType"
  | "image"
  | "title"
  | "subtitle"
  | "enabled"
  | "transform";

/** Simulated save latency (ms) — gives the user a visible "saving" state. */
const SAVE_LATENCY_MS = 1200;
/** How long the green "saved" state shows (ms). */
const SAVED_DISPLAY_MS = 2000;
/** How long the red "error" state shows (ms). */
const ERROR_DISPLAY_MS = 3000;

const TYPE_OPTIONS: {
  value: BannerType;
  label: string;
  description: string;
  icon: typeof LayoutGrid;
}[] = [
  {
    value: "full",
    label: "بانر كامل",
    description: "صورة واحدة تملأ الإطار بالكامل — كل النص داخل الصورة",
    icon: LayoutPanelTop,
  },
  {
    value: "split",
    label: "بانر مقسّم",
    description: "صورة على جانب + عنوان ووصف قابلين للتعديل",
    icon: LayoutGrid,
  },
];

/**
 * Convert a set of dirty fields into a human-readable Arabic change summary.
 * Used by the activity log so the user can see what changed in each edit.
 */
function buildChangeSummary(
  dirty: Set<DirtyField>,
  original: SponsoredBanner,
  next: SponsoredBanner
): string[] {
  const summary: string[] = [];
  if (dirty.has("bannerType")) {
    const from = original.bannerType === "full" ? "كامل" : "مقسّم";
    const to = next.bannerType === "full" ? "كامل" : "مقسّم";
    summary.push(`نوع البانر: من «${from}» إلى «${to}»`);
  }
  if (dirty.has("image")) {
    if (!original.image && next.image) summary.push("تم رفع صورة جديدة");
    else if (original.image && !next.image) summary.push("تم حذف الصورة");
    else summary.push("تم استبدال الصورة");
  }
  if (dirty.has("title")) {
    summary.push(
      `العنوان: من «${original.title || "—"}» إلى «${next.title || "—"}»`
    );
  }
  if (dirty.has("subtitle")) {
    summary.push(
      `الوصف: من «${original.subtitle || "—"}» إلى «${next.subtitle || "—"}»`
    );
  }
  if (dirty.has("enabled")) {
    summary.push(next.enabled ? "تم تفعيل البانر" : "تم تعطيل البانر");
  }
  if (dirty.has("transform")) {
    summary.push("تم ضبط موضع الصورة وتكبيرها");
  }
  return summary;
}

export function BannerEditor({
  banner,
  onSave,
  onClose,
  onDraftChange,
  onImageEditingChange,
}: Props) {
  const [draft, setDraft] = useState<SponsoredBanner | null>(banner);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // ---- Sync draft when banner ID changes ----
  // We use the "adjust state during render" pattern (calling setState while
  // a prop change is detected) instead of useEffect+setState — the latter
  // triggers cascading renders and is flagged by react-hooks/set-state-in-effect.
  // See https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [prevBannerId, setPrevBannerId] = useState<string | null>(
    banner?.id ?? null
  );
  const currentBannerId = banner?.id ?? null;
  if (currentBannerId !== prevBannerId) {
    setPrevBannerId(currentBannerId);
    setDraft(banner);
    setSaveState("idle");
  }

  // ---- Notify parent of draft changes (for live preview) ----
  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  // ---- Derived: dirty fields by diffing draft against the original banner ----
  // This is more robust than marking dirty on every change — if the user
  // reverts a field back to its original value, that field drops out of the
  // dirty set automatically.
  const dirty = useMemo<Set<DirtyField>>(() => {
    const empty = new Set<DirtyField>();
    if (!banner || !draft) return empty;
    // Only diff the SAME banner — across-banner comparisons are meaningless.
    if (banner.id !== draft.id) return empty;
    const next = new Set<DirtyField>();
    if (draft.bannerType !== banner.bannerType) next.add("bannerType");
    if (draft.image !== banner.image) next.add("image");
    if (draft.title !== banner.title) next.add("title");
    if (draft.subtitle !== banner.subtitle) next.add("subtitle");
    if (draft.enabled !== banner.enabled) next.add("enabled");
    if (
      draft.transform.offsetX !== banner.transform.offsetX ||
      draft.transform.offsetY !== banner.transform.offsetY ||
      draft.transform.scale !== banner.transform.scale
    ) {
      next.add("transform");
    }
    return next;
  }, [draft, banner]);

  // ---- Field update helper ----
  const updateField = useCallback(
    <K extends DirtyField>(key: K, value: SponsoredBanner[K]) => {
      setDraft((prev) =>
        prev ? { ...prev, [key]: value, updatedAt: new Date().toISOString() } : prev
      );
    },
    []
  );

  const onTransformChange = useCallback((next: BannerImageTransform) => {
    setDraft((prev) =>
      prev
        ? { ...prev, transform: next, updatedAt: new Date().toISOString() }
        : prev
    );
  }, []);

  // ---- Save handler with simulated latency + state transitions ----
  const handleSave = useCallback(async () => {
    if (!draft || !banner) return;
    setSaveState("saving");
    // Simulate network latency so the user sees the loading state.
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY_MS));
    try {
      const summary = buildChangeSummary(dirty, banner, draft);
      const patch: Partial<BannerInput> = {};
      if (dirty.has("bannerType")) patch.bannerType = draft.bannerType;
      if (dirty.has("image")) {
        patch.image = draft.image || "";
        patch.imageKey = draft.imageKey || "";
      }
      if (dirty.has("title")) patch.title = draft.title;
      if (dirty.has("subtitle")) patch.subtitle = draft.subtitle;
      if (dirty.has("enabled")) patch.enabled = draft.enabled;
      if (dirty.has("destination")) patch.destination = draft.destination;
      if (dirty.has("destinationType")) patch.destinationType = draft.destinationType;
      if (dirty.has("startDate")) patch.startDate = draft.startDate;
      if (dirty.has("endDate")) patch.endDate = draft.endDate;
      if (dirty.has("transform")) patch.transform = draft.transform;
      onSave(banner.id, patch, summary);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), SAVED_DISPLAY_MS);
    } catch {
      setSaveState("error");
      window.setTimeout(() => setSaveState("idle"), ERROR_DISPLAY_MS);
    }
  }, [draft, banner, dirty, onSave]);

  const handleDiscard = useCallback(() => {
    if (!banner) return;
    setDraft(banner);
    setSaveState("idle");
  }, [banner]);

  const hasUnsavedChanges = dirty.size > 0;

  // ---- Empty state: no banner selected ----
  if (!banner || !draft) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="grid place-items-center rounded-full bg-muted p-4">
          <Save className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">اختر بانرًا للتعديل</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          اضغط على أي بطاقة في القائمة لفتحها هنا، أو ارفع صورة جديدة من قسم الرفع.
        </p>
      </div>
    );
  }

  const isFull = draft.bannerType === "full";
  const isSaving = saveState === "saving";
  const isSaved = saveState === "saved";
  const isError = saveState === "error";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b p-4">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-foreground">محرر البانر</h3>
          <p className="text-xs text-muted-foreground">
            الموضع #{draft.displayOrder} · {isFull ? "بانر كامل" : "بانر مقسّم"}
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
          {/* ---------- Banner Type selector ---------- */}
          <section className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              نوع البانر
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {TYPE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isSelected = draft.bannerType === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={isSaving}
                    onClick={() => updateField("bannerType", opt.value)}
                    className={`flex flex-col items-start gap-1.5 rounded-lg border p-3 text-right transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                        : "border-border hover:border-primary/40 hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon
                        className={`h-4 w-4 ${
                          isSelected ? "text-primary" : "text-muted-foreground"
                        }`}
                      />
                      <span className="text-sm font-medium text-foreground">
                        {opt.label}
                      </span>
                    </div>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {opt.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ---------- Upload section (always shown) ---------- */}
          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              صورة البانر
            </h4>
            <UploadArea
              currentImage={draft.image}
              recommendedDimensions={getBannerDimensions(draft.bannerType)}
              recommendedLabel={
                draft.bannerType === "full" ? "بانر كامل" : "بانر مقسّم"
              }
              onUploaded={(dataUrl) => {
                const key = `banner-${draft?.id || "temp"}`;
                setDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        image: dataUrl,
                        imageKey: key,
                        transform: { ...BANNER_TRANSFORM_DEFAULT },
                        updatedAt: new Date().toISOString(),
                      }
                    : prev
                );
                setImageInDB(key, dataUrl).catch((e) =>
                  console.error("[BannerEditor] setImageInDB failed:", e)
                );
              }}
              onClear={() => {
                if (draft?.imageKey) deleteImageFromDB(draft.imageKey);
                setDraft((prev) =>
                  prev
                    ? {
                        ...prev,
                        image: "",
                        imageKey: "",
                        transform: { ...BANNER_TRANSFORM_DEFAULT },
                        updatedAt: new Date().toISOString(),
                      }
                    : prev
                );
              }}
            />
          </section>

          {/* ---------- Image positioning (always shown when image exists) ---------- */}
          {draft.image && (
            <section className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                ضبط الموضع
              </h4>
              <ImagePositioner
                imageSrc={draft.image}
                gradient={draft.gradient}
                value={draft.transform}
                onChange={onTransformChange}
                previewWidth={BANNER_POSITIONER_WIDTH}
                fullFrame={isFull}
                onEditingChange={onImageEditingChange}
              />
            </section>
          )}

          {/* ---------- Split-only fields: Title + Subtitle ---------- */}
          {!isFull && (
            <>
              <section className="space-y-2">
                <Label
                  htmlFor="banner-title"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  العنوان
                </Label>
                <Input
                  id="banner-title"
                  value={draft.title}
                  onChange={(e) => updateField("title", e.target.value)}
                  placeholder="مثال: مراجعة الأحياء"
                  dir="rtl"
                  maxLength={60}
                  disabled={isSaving}
                />
              </section>

              <section className="space-y-2">
                <Label
                  htmlFor="banner-subtitle"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  الوصف
                </Label>
                <Textarea
                  id="banner-subtitle"
                  value={draft.subtitle}
                  onChange={(e) => updateField("subtitle", e.target.value)}
                  placeholder="مثال: ملخص شامل للفصول الأربعة"
                  dir="rtl"
                  rows={3}
                  maxLength={120}
                  disabled={isSaving}
                />
              </section>
            </>
          )}

          {/* ---------- Full-banner hint ---------- */}
          {isFull && (
            <div className="flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 text-xs text-blue-600 dark:text-blue-400">
              <ImageIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>
                في البانر الكامل، كل النص والعلامة التجارية وزر الإجراء تكون
                مصمّمة داخل الصورة نفسها. ارفع صورة جاهزة بالأبعاد الموصى بها.
              </span>
            </div>
          )}

          {/* ---------- Enabled toggle (always shown) ---------- */}
          <section className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5">
            <div className="space-y-0.5">
              <Label
                htmlFor="banner-enabled"
                className="text-sm font-medium text-foreground"
              >
                تفعيل البانر
              </Label>
              <p className="text-xs text-muted-foreground">
                البانرات المعطّلة لا تظهر في الكاروسيل
              </p>
            </div>
            <Switch
              id="banner-enabled"
              checked={draft.enabled}
              onCheckedChange={(checked) => updateField("enabled", checked)}
              disabled={isSaving}
            />
          </section>

          {/* ---------- Destination type ---------- */}
          <section className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              إجراء النقر
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: "internal", label: "مسار داخلي" },
                { value: "external", label: "رابط خارجي" },
                { value: "pdf", label: "ملف PDF" },
                { value: "none", label: "بدون إجراء" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={isSaving}
                  onClick={() => updateField("destinationType", opt.value)}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    (draft.destinationType || "internal") === opt.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/40 hover:text-foreground"
                  } ${isSaving ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {(draft.destinationType || "internal") !== "none" && (
              <Input
                value={draft.destination || ""}
                onChange={(e) => updateField("destination", e.target.value)}
                placeholder={
                  (draft.destinationType || "internal") === "external"
                    ? "https://example.com"
                    : (draft.destinationType || "internal") === "pdf"
                    ? "pdf-id أو رابط الملف"
                    : "tests-biology"
                }
                dir="ltr"
                disabled={isSaving}
                className="font-mono text-xs"
              />
            )}
          </section>

          {/* ---------- Scheduling ---------- */}
          <section className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              الجدولة (اختياري)
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">تاريخ البدء</label>
                <Input
                  type="date"
                  value={draft.startDate ? draft.startDate.slice(0, 10) : ""}
                  onChange={(e) =>
                    updateField(
                      "startDate",
                      e.target.value ? new Date(e.target.value).toISOString() : null
                    )
                  }
                  disabled={isSaving}
                  className="text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">تاريخ الانتهاء</label>
                <Input
                  type="date"
                  value={draft.endDate ? draft.endDate.slice(0, 10) : ""}
                  onChange={(e) =>
                    updateField(
                      "endDate",
                      e.target.value ? new Date(e.target.value).toISOString() : null
                    )
                  }
                  disabled={isSaving}
                  className="text-xs"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              اتركها فارغة لعرض البانر فوراً وبلا تاريخ انتهاء.
            </p>
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
