"use client";

import { useMemo, useState } from "react";
import { LayoutGrid, LockKeyhole, Wrench } from "lucide-react";
import { LiveBottomNavPreview } from "@/components/admin/LiveBottomNavPreview";
import { LiveCardGridPreview } from "@/components/admin/LiveCardGridPreview";
import { SimpleItemEditor, type EditableItem } from "@/components/admin/SimpleItemEditor";
import { SimpleListItem } from "@/components/admin/SimpleListItem";
import type { CanonicalNavigationItem, CanonicalTool } from "@/server/canonical-content/contracts";
import { CanonicalWorkspaceFrame, PendingBadge } from "./CanonicalWorkspaceFrame";
import { moveOrdered, type CanonicalArea, useCanonicalContentDraft } from "./useCanonicalContentDraft";

type SimpleArea = Extract<CanonicalArea, "tools" | "navigation">;
type SimpleCanonical = CanonicalTool | CanonicalNavigationItem;

function editable(item: SimpleCanonical, index: number, area: SimpleArea): EditableItem {
  return {
    id: item.id,
    label: item.label,
    icon: item.iconKey,
    order: index,
    ...(area === "tools" ? { available: (item as CanonicalTool).available } : { enabled: (item as CanonicalNavigationItem).enabled }),
  };
}

export function CanonicalSimpleWorkspace({ area }: { area: SimpleArea }) {
  const workspace = useCanonicalContentDraft(area);
  const { draft, setDraft, source } = workspace;
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [editorDraft, setEditorDraft] = useState<EditableItem | null>(null);
  const entries = useMemo(() => [...(draft?.[area] ?? [])].sort((a, b) => a.displayOrder - b.displayOrder), [area, draft]);
  const effectiveSelectedId = selectedId === undefined || (selectedId !== null && !entries.some((item) => item.id === selectedId)) ? entries[0]?.id ?? null : selectedId;
  const selectedIndex = entries.findIndex((item) => item.id === effectiveSelectedId);
  const selected = selectedIndex >= 0 ? entries[selectedIndex] : null;

  const update = (id: string, patch: { label?: string; icon?: string; enabled?: boolean }) => setDraft((current) => {
    if (!current) return current;
    const updated = current[area].map((item) => item.id === id ? ({ ...item, label: patch.label ?? item.label, iconKey: patch.icon ?? item.iconKey, ...(area === "tools" ? { available: patch.enabled ?? (item as CanonicalTool).available } : { enabled: patch.enabled ?? (item as CanonicalNavigationItem).enabled }) }) : item);
    return { ...current, [area]: updated };
  });
  const move = (id: string, direction: -1 | 1) => setDraft((current) => {
    if (!current) return current;
    return area === "tools"
      ? { ...current, tools: moveOrdered(current.tools, id, direction) }
      : { ...current, navigation: moveOrdered(current.navigation, id, direction) };
  });
  const list = entries.map((item, index) => editable(item, index, area));
  const preview = editorDraft ? list.map((item) => item.id === editorDraft.id ? editorDraft : item) : list;
  const title = area === "tools" ? "إدارة الأدوات" : "إدارة التنقل";
  const subtitle = area === "tools" ? "قائمة أدوات مدمجة مع الإتاحة والترتيب والمعاينة الحية." : "تحرير شريط التنقل السفلي دون السماح بمسارات تنفيذية عشوائية.";
  const resourceType = area === "tools" ? "tool" : "navigation";

  return <CanonicalWorkspaceFrame title={title} subtitle={subtitle} source={source} loading={workspace.loading} saving={workspace.saving} dirty={workspace.dirty} error={workspace.error} onReset={workspace.reset} onSave={() => void workspace.save(`تحديث ${title}`)}>
    {draft ? <>
      <div className="grid grid-cols-12 gap-6">
        <section className="col-span-12 xl:col-span-5"><div className="overflow-hidden rounded-2xl border bg-card"><div className="flex items-center gap-2 border-b p-4">{area === "tools" ? <Wrench className="h-4 w-4 text-primary"/> : <LayoutGrid className="h-4 w-4 text-primary"/>}<div><h2 className="text-sm font-bold">{area === "tools" ? "الأدوات" : "عناصر التنقل"}</h2><p className="mt-1 text-[10px] text-muted-foreground">ترتيب متحرك وتحرير مركّز</p></div></div><div className="space-y-2 p-3">{list.map((item) => <div key={item.id} data-flip-key={item.id} className="space-y-1"><SimpleListItem id={item.id} label={item.label} icon={item.icon} order={item.order} total={list.length} enabled={area === "tools" ? Boolean(item.available) : Boolean(item.enabled)} isSelected={item.id === effectiveSelectedId} onSelect={() => setSelectedId(item.id)} onMoveUp={() => move(item.id, -1)} onMoveDown={() => move(item.id, 1)} trailingBadge={area === "tools" && !item.available ? "قريبًا" : undefined}/><PendingBadge visible={Boolean(source?.pendingResourceKeys.includes(`${resourceType}:${item.id}`))}/></div>)}</div></div></section>
        <section className="col-span-12 xl:col-span-7">{selected ? <div className="space-y-3"><div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-[11px] text-muted-foreground"><LockKeyhole className="h-3.5 w-3.5"/><span>الهوية الدلالية ثابتة:</span><code dir="ltr" className="rounded bg-muted px-1.5 py-0.5">{"toolKey" in selected ? selected.toolKey : selected.navKey}</code></div><SimpleItemEditor buffered item={editable(selected, selectedIndex, area)} enabledField={area === "tools" ? "available" : "enabled"} title={area === "tools" ? "محرر الأداة" : "محرر عنصر التنقل"} itemNoun={area === "tools" ? "أداة" : "عنصر تنقل"} onSave={(id, patch) => update(id, patch)} onClose={() => setSelectedId(null)} onDraftChange={setEditorDraft}/></div> : <div className="grid min-h-[480px] place-items-center rounded-2xl border bg-card text-sm text-muted-foreground">اختر عنصرًا للتعديل.</div>}</section>
      </div>
      {area === "tools" ? <LiveCardGridPreview items={preview.map((item) => ({ id: item.id, label: item.label, icon: item.icon, available: item.available, order: item.order }))} activeId={effectiveSelectedId} headerLabel="قائمة الأدوات للطلاب" variant="list"/> : <LiveBottomNavPreview items={preview.map((item) => ({ id: item.id, label: item.label, icon: item.icon, enabled: item.enabled, order: item.order }))} activeId={effectiveSelectedId}/>} 
    </> : null}
  </CanonicalWorkspaceFrame>;
}
