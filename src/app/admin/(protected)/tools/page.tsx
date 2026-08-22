"use client";

/**
 * Admin — Tools manager (/admin/tools)
 * =====================================
 *
 * Edits the student app's list of tools (5 entries). Persists to
 * localStorage under `pythagoras-admin-tools`.
 *
 * Same layout as the Materials manager, but the live preview uses the
 * "list" variant (tools are rendered as a vertical list in the student
 * app, not a grid).
 *
 * Activity logging routes through `getAdminStore().appendHistoryEntry(...)`
 * with the `logPrefix: "أدوات"`.
 */

import { useMemo, useRef, useState } from "react";
import { Wrench } from "lucide-react";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { SimpleListItem } from "@/components/admin/SimpleListItem";
import { SimpleItemEditor, EditableItem } from "@/components/admin/SimpleItemEditor";
import { LiveCardGridPreview } from "@/components/admin/LiveCardGridPreview";
import { useToast } from "@/hooks/use-toast";
import { useFlipReorder } from "@/lib/admin/use-flip-reorder";
import { useToolsStore } from "@/lib/admin/use-content-store";
import { getToolsStore, ContentItem } from "@/lib/admin/content-store";

export default function AdminToolsPage() {
  const { toast } = useToast();
  const { items, lastStorageError } = useToolsStore();
  const store = getToolsStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableItem | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(
    () => [...items].sort((a, b) => a.order - b.order),
    [items]
  );

  const flipItems = useMemo(() => sorted.map((i) => i.id), [sorted]);
  useFlipReorder(listRef, flipItems, 300);

  // Defensive: clear selection if the selected item disappears.
  // "Adjust state during render" pattern — avoids set-state-in-effect.
  const selectedStillExists = selectedId
    ? items.some((i) => i.id === selectedId)
    : true;
  const [trackedExists, setTrackedExists] = useState(true);
  if (selectedStillExists !== trackedExists) {
    setTrackedExists(selectedStillExists);
    if (!selectedStillExists) setSelectedId(null);
  }

  const selectedItem = sorted.find((i) => i.id === selectedId) ?? null;

  const handleSave = (
    id: string,
    patch: { label?: string; icon?: string; enabled?: boolean },
    changeSummary: string[]
  ) => {
    const contentPatch: {
      label?: string;
      icon?: string;
      available?: boolean;
    } = {};
    if (patch.label !== undefined) contentPatch.label = patch.label;
    if (patch.icon !== undefined) contentPatch.icon = patch.icon;
    if (patch.enabled !== undefined) contentPatch.available = patch.enabled;
    store.commitContentEdit(id, contentPatch, changeSummary);
    toast({
      title: "تم حفظ الأداة",
      description:
        changeSummary.length > 0
          ? changeSummary[0]
          : "تم تحديث الأداة بنجاح.",
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

  return (
    <AdminPageLayout
      title="إدارة الأدوات"
      subtitle="تعديل ترتيب وأيقونات أدوات الطالب"
      loadStore={() => store.loadFromStorage()}
      storageError={lastStorageError}
      list={
        <div className="rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b p-4">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                الأدوات
              </h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                {sorted.length}
              </span>
            </div>
          </div>

          <div ref={listRef} className="space-y-2 p-3">
            {sorted.length === 0 ? (
              <div className="grid place-items-center gap-2 py-12 text-center text-sm text-muted-foreground">
                <Wrench className="h-8 w-8 opacity-30" />
                لا توجد أدوات.
              </div>
            ) : (
              sorted.map((item) => (
                <div key={item.id} data-flip-key={item.id}>
                  <SimpleListItem
                    id={item.id}
                    label={item.label}
                    icon={item.icon}
                    order={item.order}
                    total={sorted.length}
                    enabled={item.available}
                    isSelected={item.id === selectedId}
                    onSelect={() => setSelectedId(item.id)}
                    onMoveUp={() => handleMoveUp(item)}
                    onMoveDown={() => handleMoveDown(item)}
                    trailingBadge={!item.available ? "قريبًا" : undefined}
                  />
                </div>
              ))
            )}
          </div>

          <div className="border-t px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
            الأدوات غير المتاحة تظهر للطلاب بشارة «قريبًا» ولا يمكن فتحها.
          </div>
        </div>
      }
      editor={
        <div style={{ minHeight: 480 }}>
          <SimpleItemEditor
            item={selectedItem}
            enabledField="available"
            title="محرر الأداة"
            itemNoun="أداة"
            onSave={handleSave}
            onClose={() => setSelectedId(null)}
            onDraftChange={setDraft}
          />
        </div>
      }
      preview={
        <LiveCardGridPreview
          items={
            draft
              ? sorted.map((i) => (i.id === draft.id ? draft : i))
              : sorted
          }
          activeId={selectedId}
          headerLabel="قائمة الأدوات للطلاب"
          variant="list"
        />
      }
    />
  );
}
