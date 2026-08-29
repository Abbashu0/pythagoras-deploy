"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Bold, ImagePlus, Italic, Plus, Trash2, Underline } from "lucide-react";
import { AssetPickerDialog } from "@/components/admin/library/AssetPickerDialog";
import { RichDocumentRenderer } from "@/components/admin/rich-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { RichInline } from "@/server/question-packages";
import type { CanonicalRichDocument } from "@/server/questions";

type Block = CanonicalRichDocument["blocks"][number];
type BlockType = Block["type"];
type SelectionRange = { start: number; end: number };

const BLOCK_LABELS: Record<BlockType, string> = {
  paragraph: "فقرة",
  heading: "عنوان",
  "ordered-list": "قائمة مرقمة",
  "bullet-list": "قائمة نقطية",
  quran: "نص قرآني",
  poetry: "شعر",
  table: "جدول",
  image: "صورة",
  divider: "فاصل",
};

export function RichDocumentEditor({ value, onChange, allocateIds, label }: {
  value: CanonicalRichDocument;
  onChange: (value: CanonicalRichDocument) => void;
  allocateIds: (kind: "blocks" | "verses", count: number) => Promise<string[]>;
  label: string;
}) {
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);

  const update = (index: number, block: Block) => onChange({ ...value, blocks: value.blocks.map((current, position) => position === index ? block : current) });
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= value.blocks.length) return;
    const blocks = [...value.blocks];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    onChange({ ...value, blocks });
  };
  const add = async (type: BlockType) => {
    const [id] = await allocateIds("blocks", 1);
    onChange({ ...value, blocks: [...value.blocks, createBlock(type, id)] });
  };
  const convertParagraphSelection = async (index: number, selection: SelectionRange) => {
    const block = value.blocks[index];
    if (block?.type !== "paragraph" || selection.end <= selection.start) return;
    const selected = sliceInlineByUtf16(block.spans, selection.start, selection.end);
    if (!selected.some((span) => span.text.trim())) return;

    const before = trimInline(sliceInlineByUtf16(block.spans, 0, selection.start));
    const after = trimInline(sliceInlineByUtf16(block.spans, selection.end, Number.MAX_SAFE_INTEGER));
    const parts: Array<{ kind: "paragraph" | "quran"; spans: RichInline; id?: string }> = [];
    if (before.length) parts.push({ kind: "paragraph", id: block.id, spans: before });
    parts.push({ kind: "quran", spans: trimInline(selected) });
    if (after.length) parts.push({ kind: "paragraph", spans: after });

    const blockIds = await allocateIds("blocks", Math.max(0, parts.length - 1));
    const [verseId] = await allocateIds("verses", 1);
    let generatedIdIndex = 0;
    const converted = parts.map((part) => {
      const id = part.id ?? blockIds[generatedIdIndex++];
      return part.kind === "quran"
        ? { id, type: "quran" as const, verses: [{ id: verseId, spans: part.spans }] }
        : { id, type: "paragraph" as const, spans: part.spans };
    });
    onChange({ ...value, blocks: [...value.blocks.slice(0, index), ...converted, ...value.blocks.slice(index + 1)] });
  };

  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><Label>{label}</Label><p className="mt-1 text-[10px] text-muted-foreground">محتوى Pythagoras منظم؛ لا يُخزن HTML أو JSON خاص بالمحرر.</p></div>
      <div className="flex flex-wrap gap-1">{(Object.keys(BLOCK_LABELS) as BlockType[]).map((type) => <Button key={type} type="button" size="sm" variant="outline" onClick={() => void add(type)}><Plus className="h-3.5 w-3.5" />{BLOCK_LABELS[type]}</Button>)}</div>
    </div>
    {value.blocks.length ? <div className="space-y-3">{value.blocks.map((block, index) => <article key={block.id} className="rounded-2xl border bg-card p-3">
      <div className="mb-3 flex items-center justify-between gap-2"><div><span className="text-xs font-bold">{BLOCK_LABELS[block.type]}</span><span className="mr-2 font-mono text-[9px] text-muted-foreground">{block.id.slice(0, 8)}</span></div><div className="flex gap-1"><Button type="button" size="icon" variant="ghost" aria-label="تحريك لأعلى" onClick={() => move(index, -1)} disabled={index === 0}><ArrowUp className="h-3.5 w-3.5" /></Button><Button type="button" size="icon" variant="ghost" aria-label="تحريك لأسفل" onClick={() => move(index, 1)} disabled={index === value.blocks.length - 1}><ArrowDown className="h-3.5 w-3.5" /></Button><Button type="button" size="icon" variant="ghost" aria-label="حذف الكتلة" onClick={() => onChange({ ...value, blocks: value.blocks.filter((_, position) => position !== index) })}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button></div></div>
      <BlockEditor block={block} onChange={(next) => update(index, next)} allocateIds={allocateIds} onPickImage={() => setPickerIndex(index)} onConvertSelection={(selection) => void convertParagraphSelection(index, selection)} />
    </article>)}</div> : <div className="rounded-2xl border border-dashed p-6 text-center text-xs text-muted-foreground">أضف كتلة واحدة على الأقل. الصورة وحدها مسموحة، أما الفاصل وحده فلا يكفي كسؤال.</div>}
    {value.blocks.length ? <details className="rounded-2xl border bg-muted/20 p-3"><summary className="cursor-pointer text-xs font-bold">معاينة آمنة</summary><div className="mt-3"><RichDocumentRenderer document={value} resolveAssetUrl={(id) => `/api/admin/assets/${id}/content`} fallbackLabel="تعذر عرض المعاينة." /></div></details> : null}
    <AssetPickerDialog open={pickerIndex !== null} onOpenChange={(open) => { if (!open) setPickerIndex(null); }} onSelect={(asset) => { if (pickerIndex === null) return; const block = value.blocks[pickerIndex]; if (block?.type === "image") update(pickerIndex, { ...block, assetId: asset.id, alt: block.alt || asset.displayName }); setPickerIndex(null); }} />
  </section>;
}

function BlockEditor({ block, onChange, allocateIds, onPickImage, onConvertSelection }: { block: Block; onChange: (block: Block) => void; allocateIds: (kind: "blocks" | "verses", count: number) => Promise<string[]>; onPickImage: () => void; onConvertSelection: (selection: SelectionRange) => void }) {
  if (block.type === "paragraph") return <InlineEditor value={block.spans} onChange={(spans) => onChange({ ...block, spans })} onConvertSelection={onConvertSelection} />;
  if (block.type === "heading") return <div className="space-y-2"><select className="h-9 rounded-md border bg-background px-3 text-xs" value={block.level} onChange={(event) => onChange({ ...block, level: Number(event.target.value) as 2 | 3 | 4 })}><option value={2}>H2</option><option value={3}>H3</option><option value={4}>H4</option></select><InlineEditor value={block.spans} onChange={(spans) => onChange({ ...block, spans })} /></div>;
  if (block.type === "ordered-list" || block.type === "bullet-list") return <div className="space-y-2">{block.items.map((item, index) => <div key={index} className="flex items-start gap-2"><span className="mt-2 text-xs text-muted-foreground">{block.type === "ordered-list" ? `${index + 1}.` : "•"}</span><div className="flex-1"><InlineEditor value={item.spans} onChange={(spans) => onChange({ ...block, items: block.items.map((current, position) => position === index ? { spans } : current) })} /></div><Button type="button" size="icon" variant="ghost" onClick={() => onChange({ ...block, items: block.items.filter((_, position) => position !== index) })}><Trash2 className="h-3.5 w-3.5" /></Button></div>)}<Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...block, items: [...block.items, { spans: [{ text: "" }] }] })}><Plus className="h-3.5 w-3.5" /> بند</Button></div>;
  if (block.type === "quran") return <div className="space-y-3">{block.verses.map((verse, index) => <div key={verse.id} className="rounded-xl bg-muted/30 p-3"><div className="grid gap-2 sm:grid-cols-2"><Input value={verse.surah ?? ""} onChange={(event) => onChange({ ...block, verses: block.verses.map((current, position) => position === index ? { ...current, surah: event.target.value || undefined } : current) })} placeholder="السورة (اختياري)" /><Input type="number" min={1} value={verse.ayah ?? ""} onChange={(event) => onChange({ ...block, verses: block.verses.map((current, position) => position === index ? { ...current, ayah: event.target.value ? Number(event.target.value) : undefined } : current) })} placeholder="الآية" /></div><div className="mt-2"><InlineEditor value={verse.spans} onChange={(spans) => onChange({ ...block, verses: block.verses.map((current, position) => position === index ? { ...current, spans } : current) })} /></div></div>)}<Button type="button" size="sm" variant="outline" onClick={async () => { const [id] = await allocateIds("verses", 1); onChange({ ...block, verses: [...block.verses, { id, spans: [{ text: "" }] }] }); }}><Plus className="h-3.5 w-3.5" /> آية</Button></div>;
  if (block.type === "poetry") return <div className="space-y-3">{block.verses.map((verse, index) => <div key={verse.id} className="grid gap-2 rounded-xl bg-muted/30 p-3 sm:grid-cols-2"><div><p className="mb-1 text-[10px] text-muted-foreground">الصدر</p><InlineEditor value={verse.sadr} onChange={(sadr) => onChange({ ...block, verses: block.verses.map((current, position) => position === index ? { ...current, sadr } : current) })} /></div><div><p className="mb-1 text-[10px] text-muted-foreground">العجز</p><InlineEditor value={verse.ajuz} onChange={(ajuz) => onChange({ ...block, verses: block.verses.map((current, position) => position === index ? { ...current, ajuz } : current) })} /></div></div>)}<Button type="button" size="sm" variant="outline" onClick={async () => { const [id] = await allocateIds("verses", 1); onChange({ ...block, verses: [...block.verses, { id, sadr: [{ text: "" }], ajuz: [{ text: "" }] }] }); }}><Plus className="h-3.5 w-3.5" /> بيت</Button></div>;
  if (block.type === "table") return <div className="space-y-3"><div className="grid gap-2 sm:grid-cols-3"><Input type="number" min={0} value={block.headerRowCount} onChange={(event) => onChange({ ...block, headerRowCount: Math.max(0, Number(event.target.value)) })} placeholder="صفوف العنوان" /><select className="h-10 rounded-md border bg-background px-3 text-xs" value={block.displayMode ?? "standard"} onChange={(event) => onChange({ ...block, displayMode: event.target.value as "standard" | "compact" })}><option value="standard">عرض قياسي</option><option value="compact">عرض مضغوط</option></select><InlineEditor compact value={block.caption ?? [{ text: "" }]} onChange={(caption) => onChange({ ...block, caption })} /></div><div className="max-w-full overflow-x-auto"><div className="min-w-[520px] space-y-2">{block.rows.map((row, rowIndex) => <div key={rowIndex} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, row.cells.length)}, minmax(130px, 1fr))` }}>{row.cells.map((cell, cellIndex) => <InlineEditor key={cellIndex} compact value={cell.spans} onChange={(spans) => onChange({ ...block, rows: block.rows.map((current, position) => position === rowIndex ? { cells: current.cells.map((currentCell, cellPosition) => cellPosition === cellIndex ? { spans } : currentCell) } : current) })} />)}</div>)}</div></div><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...block, rows: [...block.rows, { cells: Array.from({ length: Math.max(1, block.rows[0]?.cells.length ?? 2) }, () => ({ spans: [{ text: "" }] })) }] })}>صف جديد</Button><Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...block, rows: block.rows.map((row) => ({ cells: [...row.cells, { spans: [{ text: "" }] }] })), columnAlignments: [...(block.columnAlignments ?? []), "start"] })}>عمود جديد</Button></div></div>;
  if (block.type === "image") return <div className="grid gap-3 sm:grid-cols-[auto_1fr]"><Button type="button" variant="outline" onClick={onPickImage}><ImagePlus className="h-4 w-4" /> {block.assetId ? "تغيير الصورة" : "اختيار الصورة"}</Button><div className="space-y-2"><Input value={block.alt} onChange={(event) => onChange({ ...block, alt: event.target.value })} placeholder="النص البديل المطلوب" /><InlineEditor compact value={block.caption ?? [{ text: "" }]} onChange={(caption) => onChange({ ...block, caption })} /><p className="font-mono text-[9px] text-muted-foreground" dir="ltr">Asset ID: {block.assetId || "—"}</p></div></div>;
  return <p className="py-3 text-center text-xs text-muted-foreground">فاصل مرئي</p>;
}

function InlineEditor({ value, onChange, compact = false, onConvertSelection }: { value: RichInline; onChange: (value: RichInline) => void; compact?: boolean; onConvertSelection?: (selection: SelectionRange) => void }) {
  const spans = value.length ? value : [{ text: "" }];
  const [selection, setSelection] = useState<{ index: number; start: number; end: number } | null>(null);
  return <div className="space-y-2">{spans.map((span, index) => <div key={index} className="rounded-xl border bg-background p-2"><Textarea rows={compact ? 1 : 2} value={span.text} onChange={(event) => onChange(spans.map((current, position) => position === index ? { ...current, text: event.target.value } : current))} onSelect={(event) => setSelection({ index, start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })} placeholder="اكتب النص كما هو؛ HTML يُعامل كنص غير تنفيذي." dir="auto" /><div className="mt-2 flex flex-wrap items-center gap-1"><MarkButton label="عريض" icon={Bold} active={span.marks?.includes("bold") ?? false} onClick={() => onChange(toggleMark(spans, index, "bold"))} /><MarkButton label="مائل" icon={Italic} active={span.marks?.includes("italic") ?? false} onClick={() => onChange(toggleMark(spans, index, "italic"))} /><MarkButton label="تحته خط" icon={Underline} active={span.marks?.includes("underline") ?? false} onClick={() => onChange(toggleMark(spans, index, "underline"))} />{onConvertSelection && selection?.index === index && selection.end > selection.start ? <Button type="button" size="sm" variant="secondary" onClick={() => { onConvertSelection({ start: selection.start, end: selection.end }); setSelection(null); }}>تحويل التحديد إلى نص قرآني</Button> : null}{spans.length > 1 ? <Button type="button" size="sm" variant="ghost" onClick={() => onChange(spans.filter((_, position) => position !== index))}><Trash2 className="h-3.5 w-3.5" /></Button> : null}</div></div>)}<Button type="button" size="sm" variant="ghost" onClick={() => onChange([...spans, { text: "" }])}><Plus className="h-3.5 w-3.5" /> مقطع منسق</Button></div>;
}

function MarkButton({ label, icon: Icon, active, onClick }: { label: string; icon: typeof Bold; active: boolean; onClick: () => void }) { return <Button type="button" size="sm" variant={active ? "secondary" : "ghost"} aria-pressed={active} aria-label={label} onClick={onClick}><Icon className="h-3.5 w-3.5" /><span className="sr-only">{label}</span></Button>; }
function toggleMark(spans: RichInline, index: number, mark: "bold" | "italic" | "underline"): RichInline { return spans.map((span, position) => { if (position !== index) return span; const marks = new Set(span.marks ?? []); if (marks.has(mark)) marks.delete(mark); else marks.add(mark); return { ...span, ...(marks.size ? { marks: [...marks] } : { marks: undefined }) }; }); }
function sliceInlineByUtf16(spans: RichInline, start: number, end: number): RichInline { let cursor = 0; const result: RichInline = []; for (const span of spans) { const spanStart = cursor; const spanEnd = cursor + span.text.length; const from = Math.max(start, spanStart) - spanStart; const to = Math.min(end, spanEnd) - spanStart; if (to > from) result.push({ ...span, text: span.text.slice(from, to) }); cursor = spanEnd; } return result; }
function trimInline(spans: RichInline): RichInline { const result = spans.map((span) => ({ ...span })).filter((span) => span.text.length); if (!result.length) return []; result[0].text = result[0].text.replace(/^\s+/u, ""); result.at(-1)!.text = result.at(-1)!.text.replace(/\s+$/u, ""); return result.filter((span) => span.text.length); }
function createBlock(type: BlockType, id: string): Block {
  if (type === "paragraph") return { id, type, spans: [{ text: "" }] };
  if (type === "heading") return { id, type, level: 2, spans: [{ text: "" }] };
  if (type === "ordered-list" || type === "bullet-list") return { id, type, items: [{ spans: [{ text: "" }] }] };
  if (type === "quran") return { id, type, verses: [] };
  if (type === "poetry") return { id, type, verses: [] };
  if (type === "table") return { id, type, headerRowCount: 1, displayMode: "standard", columnAlignments: ["start", "start"], rows: [{ cells: [{ spans: [{ text: "" }] }, { spans: [{ text: "" }] }] }] };
  if (type === "image") return { id, type, assetId: "", alt: "" };
  return { id, type: "divider" };
}
