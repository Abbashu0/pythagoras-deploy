"use client";

/**
 * Admin — Materials manager (/admin/materials)
 * =================================================
 *
 * Edits the student app's list of subjects (8 entries). Persists to
 * localStorage under `pythagoras-admin-materials`.
 *
 * Layout (provided by `<AdminPageLayout>` — 12-col grid, RTL):
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  [→ لوحة التحكم]   "إدارة المواد"      [☀ / ☾ toggle]            │
 *   │                    "تعديل صور وعناوين المواد"                    │
 *   ├──────────────────────┬─────────────────────┬──────────────────────┤
 *   │  col-span-5          │  col-span-4         │  col-span-3 (sticky) │
 *   │  Materials list      │  MaterialEditor     │  ActivityHistory     │
 *   │  (FLIP reorder,      │  (image upload +    │  (shared — auto by   │
 *   │   image thumbnails)  │   positioner +      │   AdminPageLayout)   │
 *   │                      │   AR/EN titles +    │                      │
 *   │                      │   available toggle) │                      │
 *   ├──────────────────────┴─────────────────────┴──────────────────────┤
 *   │  Bottom strip:                                                    │
 *   │   - Live card preview (single material, matches student UI)      │
 *   │   - Appearance Settings (card height, fade, text scale, position)│
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * State:
 *   - selectedId / draftItem / isImageEditing: pure UI state.
 *   - draftSettings: working copy of the four global appearance
 *     settings while the user drags the sliders. null = no unsaved
 *     changes (preview falls back to the committed snapshot values).
 *   - The store subscription (`useMaterialsStore`) re-renders on every
 *     item change AND on every settings change (both live in the same
 *     snapshot).
 *
 * FLIP animation:
 *   - `useFlipReorder(listRef, flipItems, 300)` where
 *     `flipItems = isImageEditing ? [] : sorted.map(i => i.id)`.
 *   - We pass `[]` while the user is dragging the image positioner so the
 *     list items' positions are captured AFTER the drag ends — otherwise
 *     the live transform updates would constantly invalidate the snapshot.
 */

import { useMemo, useRef, useState } from "react";
import { BookOpen, Eye } from "lucide-react";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { MaterialListItem } from "@/components/admin/MaterialListItem";
import { MaterialEditor } from "@/components/admin/MaterialEditor";
import { MaterialCardPreview } from "@/components/admin/MaterialCardPreview";
import { AppearanceSettings } from "@/components/admin/AppearanceSettings";
import { useToast } from "@/hooks/use-toast";
import { useFlipReorder } from "@/lib/admin/use-flip-reorder";
import { useMaterialsStore } from "@/lib/admin/use-content-store";
import {
  getMaterialsStore,
  type ContentItem,
  type MaterialsSettings,
} from "@/lib/admin/content-store";
import type { MaterialPatch } from "@/components/admin/MaterialEditor";

export default function AdminMaterialsPage() {
  const { toast } = useToast();
  const {
    items,
    fadeIntensity,
    textVerticalPosition,
    textScale,
    cardHeight,
    lastStorageError,
  } = useMaterialsStore();
  const store = getMaterialsStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftItem, setDraftItem] = useState<ContentItem | null>(null);
  const [isImageEditing, setIsImageEditing] = useState(false);

  // Working draft of the four global appearance settings. null = no
  // unsaved changes — the live preview falls back to the committed
  // snapshot values. Setting a non-null value makes the preview update
  // in real-time as the user drags the sliders.
  const [draftSettings, setDraftSettings] = useState<MaterialsSettings | null>(
    null
  );

  const listRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(
    () => [...items].sort((a, b) => a.order - b.order),
    [items]
  );

  // FLIP — pass [] while image is being dragged so the snapshot isn't
  // invalidated by live transform updates inside the editor.
  const flipItems = useMemo(
    () => (isImageEditing ? [] : sorted.map((i) => i.id)),
    [sorted, isImageEditing]
  );
  useFlipReorder(listRef, flipItems, 300);

  // Defensive: clear selection if the selected item disappears.
  // "Adjust state during render" pattern — avoids set-state-in-effect.
  const selectedStillExists = selectedId
    ? items.some((i) => i.id === selectedId)
    : true;
  const [trackedExists, setTrackedExists] = useState(true);
  if (selectedStillExists !== trackedExists) {
    setTrackedExists(selectedStillExists);
    if (!selectedStillExists) {
      setSelectedId(null);
      setDraftItem(null);
    }
  }

  const selectedItem = sorted.find((i) => i.id === selectedId) ?? null;

  // The preview shows the draft if there are unsaved changes, otherwise
  // the committed selected item. When nothing is selected, fall back to
  // the first item so the preview is never blank on first load.
  const previewItem =
    draftItem ??
    selectedItem ??
    (sorted.length > 0 ? sorted[0] : null);

  // Committed (saved) appearance settings from the snapshot.
  const committedSettings: MaterialsSettings = {
    fadeIntensity,
    textVerticalPosition,
    textScale,
    cardHeight,
  };

  // Effective = draft (if unsaved changes) otherwise committed.
  const effectiveSettings: MaterialsSettings =
    draftSettings ?? committedSettings;

  // ---------- Mutations ----------
  const handleSave = (
    id: string,
    patch: MaterialPatch,
    changeSummary: string[]
  ) => {
    store.commitContentEdit(id, patch, changeSummary);
    toast({
      title: "تم حفظ المادة",
      description:
        changeSummary.length > 0
          ? changeSummary[0]
          : "تم تحديث المادة بنجاح.",
    });
  };

  const handleMoveUp = (item: ContentItem) => {
    store.moveContentItem(item.id, "up");
    toast({
      title: "إعادة ترتيب",
      description: `تم تحريك «${item.label}» لأعلى.`,
    });
  };

  const handleMoveDown = (item: ContentItem) => {
    store.moveContentItem(item.id, "down");
    toast({
      title: "إعادة ترتيب",
      description: `تم تحريك «${item.label}» لأسفل.`,
    });
  };

  // ---------- Appearance settings handlers ----------
  // Plain functions (no useCallback) — matches the pattern used by the
  // item-save/move handlers above. The store singleton is stable and
  // `toast` is stable per `useToast`, so memoization isn't necessary.
  const handleSettingsDraftChange = (next: MaterialsSettings) => {
    setDraftSettings(next);
  };

  const handleSettingsSave = () => {
    if (!draftSettings) return;
    store.setMaterialsSettings(draftSettings);
    setDraftSettings(null);
    toast({
      title: "تم حفظ إعدادات المظهر",
      description: "ستظهر التغييرات على جميع بطاقات المواد للطلاب.",
    });
  };

  const handleSettingsReset = () => {
    setDraftSettings(null);
  };

  return (
    <AdminPageLayout
      title="إدارة المواد"
      subtitle="تعديل صور وعناوين المواد الدراسية"
      loadStore={() => store.loadFromStorage()}
      storageError={lastStorageError}
      list={
        <div className="rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b p-4">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                المواد الدراسية
              </h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                {sorted.length}
              </span>
            </div>
          </div>

          <div ref={listRef} className="space-y-2 p-3">
            {sorted.length === 0 ? (
              <div className="grid place-items-center gap-2 py-12 text-center text-sm text-muted-foreground">
                <BookOpen className="h-8 w-8 opacity-30" />
                لا توجد مواد.
              </div>
            ) : (
              sorted.map((item, idx) => (
                <div key={item.id} data-flip-key={item.id}>
                  <MaterialListItem
                    item={item}
                    order={idx}
                    total={sorted.length}
                    isSelected={item.id === selectedId}
                    onSelect={() => setSelectedId(item.id)}
                    onMoveUp={() => handleMoveUp(item)}
                    onMoveDown={() => handleMoveDown(item)}
                  />
                </div>
              ))
            )}
          </div>

          <div className="border-t px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
            الترتيب يطابق ترتيب ظهور المواد في صفحة المواد للطلاب. كل بطاقة
            تظهر كصورة كاملة بارتفاع قابل للتعديل من إعدادات المظهر.
          </div>
        </div>
      }
      editor={
        <div style={{ minHeight: 480 }}>
          <MaterialEditor
            item={selectedItem}
            onSave={handleSave}
            onClose={() => {
              setSelectedId(null);
              setDraftItem(null);
            }}
            onDraftChange={setDraftItem}
            onImageEditingChange={setIsImageEditing}
          />
        </div>
      }
      preview={
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Live single-card preview — matches the student app's
              full-image material card exactly. Updates in real-time
              as the user drags the appearance sliders. */}
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">
                  معاينة البطاقة
                </h2>
              </div>
              <span className="text-[10px] text-muted-foreground">
                مطابقة لما يراه الطلاب
              </span>
            </div>
            <div className="flex justify-center rounded-lg bg-muted/20 p-4">
              <div style={{ width: "378px", maxWidth: "100%" }}>
                <MaterialCardPreview
                  image={previewItem?.image}
                  gradient={previewItem?.gradient}
                  transform={previewItem?.transform}
                  title={previewItem?.label}
                  englishTitle={previewItem?.englishTitle}
                  available={previewItem?.available ?? true}
                  fadeIntensity={effectiveSettings.fadeIntensity}
                  textVerticalPosition={effectiveSettings.textVerticalPosition}
                  textScale={effectiveSettings.textScale}
                  cardHeight={effectiveSettings.cardHeight}
                />
              </div>
            </div>
            <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
              التغييرات غير المحفوظة تظهر هنا فوراً. إعدادات المظهر تنطبق على
              جميع البطاقات.
            </p>
          </div>

          {/* Appearance Settings — 4 sliders + Save/Reset */}
          <AppearanceSettings
            committed={committedSettings}
            draft={draftSettings}
            onDraftChange={handleSettingsDraftChange}
            onSave={handleSettingsSave}
            onReset={handleSettingsReset}
          />
        </div>
      }
    />
  );
}
