"use client";

/**
 * Admin — Navigation manager (/admin/navigation)
 * =================================================
 *
 * Edits the student app's bottom-nav items (5 entries). Persists to
 * localStorage under `pythagoras-admin-nav-items` (the student app will
 * read from there immediately).
 *
 * Layout (provided by `<AdminPageLayout>`):
 *   - Left: reorderable list of nav items (FLIP animation, move up/down).
 *   - Middle: editor (label input + icon picker grid + enabled toggle)
 *             with the pending-save pattern (Save / Discard bar).
 *   - Right: shared `ActivityHistory`.
 *   - Bottom: `<LiveBottomNavPreview>` showing the current draft state
 *             as a mock of the student bottom nav.
 *
 * Activity logging: every commit + every reorder routes through
 * `getAdminStore().appendHistoryEntry(...)` so the right-hand panel
 * shows nav actions alongside banner / carousel actions.
 */

import { useMemo, useRef, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { SimpleListItem } from "@/components/admin/SimpleListItem";
import { SimpleItemEditor, EditableItem } from "@/components/admin/SimpleItemEditor";
import { LiveBottomNavPreview } from "@/components/admin/LiveBottomNavPreview";
import { useToast } from "@/hooks/use-toast";
import { useFlipReorder } from "@/lib/admin/use-flip-reorder";
import { useNavStore } from "@/lib/admin/use-nav-store";
import { getNavStore, NavItem } from "@/lib/admin/nav-store";

export default function AdminNavigationPage() {
  const { toast } = useToast();
  const { navItems, lastStorageError } = useNavStore();
  const store = getNavStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableItem | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(
    () => [...navItems].sort((a, b) => a.order - b.order),
    [navItems]
  );

  // FLIP animation — pass the sorted ids array so the hook only re-runs
  // when an actual reorder happens (not on every keystroke in the editor).
  const flipItems = useMemo(() => sorted.map((i) => i.id), [sorted]);
  useFlipReorder(listRef, flipItems, 300);

  // Defensive: if the selected item disappears (e.g. a future delete
  // feature clears the list), reset the selection. Uses the "adjust
  // state during render" pattern (same approach BannerEditor uses to
  // avoid set-state-in-effect).
  const selectedStillExists = selectedId
    ? navItems.some((i) => i.id === selectedId)
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
    store.commitNavEdit(id, patch, changeSummary);
    toast({
      title: "تم حفظ العنصر",
      description:
        changeSummary.length > 0
          ? changeSummary[0]
          : "تم تحديث عنصر التنقل بنجاح.",
    });
  };

  const handleMoveUp = (item: NavItem) => {
    store.moveNavItem(item.id, "up");
    toast({
      title: "إعادة ترتيب",
      description: `تم تحريك «${item.label}» لأعلى.`,
    });
  };

  const handleMoveDown = (item: NavItem) => {
    store.moveNavItem(item.id, "down");
    toast({
      title: "إعادة ترتيب",
      description: `تم تحريك «${item.label}» لأسفل.`,
    });
  };

  return (
    <AdminPageLayout
      title="إدارة التنقل"
      subtitle="تعديل ترتيب وأيقونات الـ Bottom Navigation"
      loadStore={() => store.loadFromStorage()}
      storageError={lastStorageError}
      list={
        <div className="rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b p-4">
            <div className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                عناصر التنقل
              </h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                {sorted.length}
              </span>
            </div>
          </div>

          <div ref={listRef} className="space-y-2 p-3">
            {sorted.length === 0 ? (
              <div className="grid place-items-center gap-2 py-12 text-center text-sm text-muted-foreground">
                <LayoutGrid className="h-8 w-8 opacity-30" />
                لا توجد عناصر تنقل.
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
                    enabled={item.enabled}
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
            الترتيب هنا يطابق ترتيب ظهور العناصر في شريط التنقل السفلي للطلاب —
            من اليمين إلى اليسار.
          </div>
        </div>
      }
      editor={
        <div style={{ minHeight: 480 }}>
          <SimpleItemEditor
            item={selectedItem}
            enabledField="enabled"
            title="محرر عنصر التنقل"
            itemNoun="عنصر تنقل"
            onSave={handleSave}
            onClose={() => setSelectedId(null)}
            onDraftChange={setDraft}
          />
        </div>
      }
      preview={
        <LiveBottomNavPreview
          items={draft ? sorted.map((i) => (i.id === draft.id ? draft : i)) : sorted}
          activeId={selectedId}
        />
      }
    />
  );
}
