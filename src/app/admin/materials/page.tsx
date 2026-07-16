"use client";

/**
 * Admin — Materials manager (/admin/materials)
 *
 * NEW LAYOUT: Editor on the right (list + editor + appearance settings),
 * Live preview panel on the left (sticky, with Card/Page toggle).
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
  const [draftSettings, setDraftSettings] = useState<MaterialsSettings | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => [...items].sort((a, b) => a.order - b.order), [items]);

  const flipItems = useMemo(
    () => (isImageEditing ? [] : sorted.map((i) => i.id)),
    [sorted, isImageEditing]
  );
  useFlipReorder(listRef, flipItems, 300);

  const selectedStillExists = selectedId ? items.some((i) => i.id === selectedId) : true;
  const [trackedExists, setTrackedExists] = useState(true);
  if (selectedStillExists !== trackedExists) {
    setTrackedExists(selectedStillExists);
    if (!selectedStillExists) { setSelectedId(null); setDraftItem(null); }
  }

  const selectedItem = sorted.find((i) => i.id === selectedId) ?? null;
  const previewItem = draftItem ?? selectedItem ?? (sorted.length > 0 ? sorted[0] : null);

  const committedSettings: MaterialsSettings = { fadeIntensity, textVerticalPosition, textScale, cardHeight };
  const effectiveSettings: MaterialsSettings = draftSettings ?? committedSettings;

  const handleSave = (id: string, patch: MaterialPatch, changeSummary: string[]) => {
    store.commitContentEdit(id, patch, changeSummary);
    toast({ title: "تم حفظ المادة", description: changeSummary.length > 0 ? changeSummary[0] : "تم تحديث المادة بنجاح." });
  };

  const handleMoveUp = (item: ContentItem) => { store.moveContentItem(item.id, "up"); toast({ title: "إعادة ترتيب", description: `تم تحريك «${item.label}» لأعلى.` }); };
  const handleMoveDown = (item: ContentItem) => { store.moveContentItem(item.id, "down"); toast({ title: "إعادة ترتيب", description: `تم تحريك «${item.label}» لأسفل.` }); };

  const handleSettingsDraftChange = (next: MaterialsSettings) => setDraftSettings(next);
  const handleSettingsSave = () => { if (!draftSettings) return; store.setMaterialsSettings(draftSettings); setDraftSettings(null); toast({ title: "تم حفظ إعدادات المظهر", description: "ستظهر التغييرات على جميع بطاقات المواد للطلاب." }); };
  const handleSettingsReset = () => setDraftSettings(null);

  // Card preview content
  const cardPreview = (
    <div style={{ width: "100%", maxWidth: "394px" }}>
      <MaterialCardPreview
        image={previewItem?.image}
        gradient={previewItem?.gradient}
        transform={previewItem?.transform}
        title={previewItem?.label}
        englishTitle={previewItem?.englishTitle}
        fadeIntensity={effectiveSettings.fadeIntensity}
        textVerticalPosition={effectiveSettings.textVerticalPosition}
        textScale={effectiveSettings.textScale}
        cardHeight={effectiveSettings.cardHeight}
      />
    </div>
  );

  // Editor content (list + editor + settings combined)
  const editorContent = (
    <div className="space-y-5">
      {/* Materials list */}
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b p-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">المواد الدراسية</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">{sorted.length}</span>
          </div>
        </div>
        <div ref={listRef} className="space-y-2 p-3">
          {sorted.length === 0 ? (
            <div className="grid place-items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <BookOpen className="h-8 w-8 opacity-30" /> لا توجد مواد.
            </div>
          ) : (
            sorted.map((item, idx) => (
              <div key={item.id} data-flip-key={item.id}>
                <MaterialListItem item={item} order={idx} total={sorted.length} isSelected={item.id === selectedId} onSelect={() => setSelectedId(item.id)} onMoveUp={() => handleMoveUp(item)} onMoveDown={() => handleMoveDown(item)} />
              </div>
            ))
          )}
        </div>
      </div>

      {/* Material editor */}
      <div style={{ minHeight: 480 }}>
        <MaterialEditor
          item={selectedItem}
          onSave={handleSave}
          onClose={() => { setSelectedId(null); setDraftItem(null); }}
          onDraftChange={setDraftItem}
          onImageEditingChange={setIsImageEditing}
          cardHeight={effectiveSettings.cardHeight}
        />
      </div>

      {/* Appearance settings */}
      <AppearanceSettings
        committed={committedSettings}
        draft={draftSettings}
        onDraftChange={handleSettingsDraftChange}
        onSave={handleSettingsSave}
        onReset={handleSettingsReset}
      />
    </div>
  );

  return (
    <AdminPageLayout
      loadStore={() => store.loadFromStorage()}
      storageError={lastStorageError}
      editor={editorContent}
      cardPreview={cardPreview}
      fullPageUrl="/pythagoras/index.html#materials"
      fullPageLabel="صفحة المواد"
    />
  );
}
