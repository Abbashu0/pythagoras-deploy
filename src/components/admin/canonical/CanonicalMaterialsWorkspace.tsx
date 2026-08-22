"use client";

import { useMemo, useState } from "react";
import { BookOpen, ImageIcon, LockKeyhole, X } from "lucide-react";
import { AppearanceSettings, type MaterialsSettings } from "@/components/admin/AppearanceSettings";
import { IconPicker } from "@/components/admin/IconPicker";
import { ImagePositioner } from "@/components/admin/ImagePositioner";
import { MaterialCardPreview } from "@/components/admin/MaterialCardPreview";
import { MaterialListItem, type MaterialListItemValue } from "@/components/admin/MaterialListItem";
import { AssetPickerDialog } from "@/components/admin/library/AssetPickerDialog";
import type { LibraryAsset } from "@/components/admin/library/library-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getMaterialCardDimensions } from "@/lib/admin/dimensions";
import type { CanonicalMaterial } from "@/server/canonical-content/contracts";
import { CanonicalWorkspaceFrame, PendingBadge } from "./CanonicalWorkspaceFrame";
import { moveOrdered, useCanonicalContentDraft } from "./useCanonicalContentDraft";

function listMaterial(item: CanonicalMaterial): MaterialListItemValue {
  return {
    id: item.id,
    label: item.label,
    englishTitle: item.englishTitle,
    icon: item.iconKey,
    image: item.asset ? `/api/admin/assets/${encodeURIComponent(item.asset.id)}/content` : "",
    gradient: item.gradient,
    transform: { offsetX: item.offsetX, offsetY: item.offsetY, scale: item.scale },
    available: item.available,
    order: item.displayOrder,
  };
}

export function CanonicalMaterialsWorkspace() {
  const workspace = useCanonicalContentDraft("materials");
  const { draft, setDraft, source } = workspace;
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const materials = useMemo(() => [...(draft?.materials ?? [])].sort((a, b) => a.displayOrder - b.displayOrder), [draft?.materials]);
  const effectiveSelectedId = selectedId === undefined || (selectedId !== null && !materials.some((material) => material.id === selectedId)) ? materials[0]?.id ?? null : selectedId;
  const selected = materials.find((material) => material.id === effectiveSelectedId) ?? null;

  const updateMaterial = (id: string, patch: Partial<CanonicalMaterial>) => setDraft((current) => current ? ({ ...current, materials: current.materials.map((material) => material.id === id ? { ...material, ...patch } : material) }) : current);
  const move = (id: string, direction: -1 | 1) => setDraft((current) => current ? ({ ...current, materials: moveOrdered(current.materials, id, direction) }) : current);
  const committedSettings: MaterialsSettings | null = source ? {
    fadeIntensity: source.materialSettings.fadeIntensity,
    textVerticalPosition: source.materialSettings.textVerticalPosition,
    textScale: source.materialSettings.textScale,
    cardHeight: source.materialSettings.cardHeight,
  } : null;
  const effectiveSettings: MaterialsSettings | null = draft ? {
    fadeIntensity: draft.materialSettings.fadeIntensity,
    textVerticalPosition: draft.materialSettings.textVerticalPosition,
    textScale: draft.materialSettings.textScale,
    cardHeight: draft.materialSettings.cardHeight,
  } : null;

  return <CanonicalWorkspaceFrame
    title="إدارة المواد"
    subtitle="قائمة المواد الدلالية، محرر بصري، ومعاينة مطابقة لبطاقات الطالب."
    source={source}
    loading={workspace.loading}
    saving={workspace.saving}
    dirty={workspace.dirty}
    error={workspace.error}
    onReset={workspace.reset}
    onSave={() => void workspace.save("تحديث المواد ومظهر البطاقات")}
  >
    {draft && effectiveSettings && committedSettings ? <>
      <div className="grid grid-cols-12 gap-6">
        <section className="col-span-12 xl:col-span-5">
          <div className="overflow-hidden rounded-2xl border bg-card"><div className="flex items-center justify-between border-b p-4"><div className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary"/><div><h2 className="text-sm font-bold">المواد الدراسية</h2><p className="mt-1 text-[10px] text-muted-foreground">ثماني هويات دلالية ثابتة</p></div></div><span className="rounded-full bg-muted px-2 py-1 text-[10px]">{materials.length}</span></div><div className="space-y-2 p-3">{materials.map((material, index) => <div key={material.id} data-flip-key={material.id} className="space-y-1"><MaterialListItem item={listMaterial(material)} order={index} total={materials.length} isSelected={material.id === effectiveSelectedId} onSelect={() => setSelectedId(material.id)} onMoveUp={() => move(material.id, -1)} onMoveDown={() => move(material.id, 1)}/><PendingBadge visible={Boolean(source?.pendingResourceKeys.includes(`material:${material.id}`))}/></div>)}</div><p className="border-t p-3 text-[11px] leading-5 text-muted-foreground">الترتيب يبقى في المسودة حتى الحفظ. subjectKey هوية تقنية ثابتة لا تُعاد تسميتها.</p></div>
        </section>
        <section className="col-span-12 space-y-5 xl:col-span-7">
          <CanonicalMaterialEditor material={selected} cardHeight={effectiveSettings.cardHeight} onClose={() => setSelectedId(null)} onChange={(patch) => selected && updateMaterial(selected.id, patch)}/>
          <div className="rounded-2xl border bg-card p-4"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">معاينة بطاقة المادة</h2><span className="text-[10px] text-muted-foreground">نفس دلالات عرض الطالب</span></div><div className="flex justify-center rounded-xl bg-[#070a10] p-5"><div className="w-full max-w-[394px]"><MaterialCardPreview image={selected?.asset ? `/api/admin/assets/${selected.asset.id}/content` : undefined} gradient={selected?.gradient} transform={selected ? { offsetX: selected.offsetX, offsetY: selected.offsetY, scale: selected.scale } : undefined} title={selected?.label} englishTitle={selected?.englishTitle} {...effectiveSettings}/></div></div></div>
        </section>
      </div>
      <AppearanceSettings buffered committed={committedSettings} draft={JSON.stringify(committedSettings) === JSON.stringify(effectiveSettings) ? null : effectiveSettings} onDraftChange={(settings) => setDraft((current) => current ? ({ ...current, materialSettings: { ...current.materialSettings, ...settings } }) : current)} onSave={() => undefined} onReset={() => setDraft((current) => current && source ? ({ ...current, materialSettings: structuredClone(source.materialSettings) }) : current)}/>
    </> : null}
  </CanonicalWorkspaceFrame>;
}

function CanonicalMaterialEditor({ material, cardHeight, onChange, onClose }: { material: CanonicalMaterial | null; cardHeight: number; onChange: (patch: Partial<CanonicalMaterial>) => void; onClose: () => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  if (!material) return <div className="grid min-h-[540px] place-items-center rounded-2xl border bg-card p-8 text-sm text-muted-foreground">اختر مادة لفتح المحرر المتخصص.</div>;
  const imageUrl = material.asset ? `/api/admin/assets/${encodeURIComponent(material.asset.id)}/content` : "";
  const dimensions = getMaterialCardDimensions({ cardHeight });
  const choose = (asset: LibraryAsset) => onChange({ assetId: asset.id, asset: { id: asset.id, displayName: asset.displayName, originalFilename: asset.originalFilename, mimeType: asset.mimeType, url: `/api/content/assets/${asset.id}` } });
  return <div className="overflow-hidden rounded-2xl border bg-card">
    <div className="flex items-center justify-between border-b p-4"><div><h2 className="text-sm font-bold">محرر المادة</h2><p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><LockKeyhole className="h-3 w-3"/>{material.subjectKey} · revision {material.revision}</p></div><Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4"/></Button></div>
    <div className="admin-scroll max-h-[720px] space-y-5 overflow-y-auto p-4">
      <section className="space-y-3"><div className="flex items-center justify-between"><Label>صورة المادة</Label>{material.asset ? <span className="max-w-[220px] truncate text-[10px] text-muted-foreground">{material.asset.displayName}</span> : null}</div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setPickerOpen(true)}><ImageIcon className="ml-2 h-4 w-4"/>اختيار من مكتبة الأصول</Button>{material.asset ? <Button variant="ghost" onClick={() => onChange({ assetId: null, asset: null })}><X className="ml-2 h-4 w-4"/>إزالة المرجع</Button> : null}</div>{imageUrl ? <ImagePositioner imageSrc={imageUrl} gradient={material.gradient} value={{ offsetX: material.offsetX, offsetY: material.offsetY, scale: material.scale }} onChange={(value) => onChange(value)} previewWidth={dimensions.cssWidth} aspectRatio={`${dimensions.cssWidth} / ${dimensions.cssHeight}`} fullFrame minScale={0.5} maxScale={3} maxOffset={50}/> : <div className="grid h-36 place-items-center rounded-xl border border-dashed text-xs text-muted-foreground" style={{ background: material.gradient }}>تدرّج احتياطي — اختر Asset لإضافة صورة.</div>}</section>
      <label className="space-y-2"><Label>العنوان العربي</Label><Input value={material.label} onChange={(event) => onChange({ label: event.target.value })} maxLength={40}/></label>
      <label className="space-y-2"><Label>العنوان الإنجليزي</Label><Input dir="ltr" className="font-mono tracking-wider" value={material.englishTitle} onChange={(event) => onChange({ englishTitle: event.target.value.toUpperCase() })} maxLength={24}/></label>
      <label className="space-y-2"><Label>التدرّج الاحتياطي</Label><Input dir="ltr" value={material.gradient} onChange={(event) => onChange({ gradient: event.target.value })}/></label>
      <section className="space-y-2"><Label>الأيقونة</Label><IconPicker value={material.iconKey} onChange={(iconKey) => onChange({ iconKey })}/></section>
      <section className="flex items-center justify-between rounded-xl border p-3"><div><Label>إتاحة المادة</Label><p className="mt-1 text-[11px] text-muted-foreground">المادة غير المتاحة لا تظهر في Student ولا يُكشف Asset الخاص بها.</p></div><Switch checked={material.available} onCheckedChange={(available) => onChange({ available })}/></section>
    </div>
    <AssetPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onSelect={choose}/>
  </div>;
}
