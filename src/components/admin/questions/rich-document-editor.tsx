"use client";

import * as React from "react";
import { v7 as uuidv7 } from "uuid";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Copy,
  GripVertical,
  Image as ImageIcon,
  Italic,
  Minus,
  Plus,
  Quote,
  RotateCcw,
  Trash2,
  Underline,
} from "lucide-react";
import { AssetPicker, AssetThumb, type Asset } from "@/components/admin-ui/domain/content/assets";
import { ReorderableList } from "@/components/admin-ui/domain/content/reorderable";
import { FormField } from "@/components/admin-ui/forms/field";
import { Select } from "@/components/admin-ui/forms/select";
import { TextField } from "@/components/admin-ui/forms/input";
import { Button, IconButton } from "@/components/admin-ui/primitives/button";
import { Panel, PanelBody, PanelHeader, Well } from "@/components/admin-ui/primitives/surface";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/admin-ui/overlays/menu";
import { cn } from "@/lib/cn";
import type { RichInline } from "@/server/question-packages/contracts";
import type { CanonicalRichDocument } from "@/server/questions";

type RichBlock = CanonicalRichDocument["blocks"][number];
type RichBlockType = RichBlock["type"];
type IdKind = "block" | "verse" | "occurrence" | "variant";

export type RichDocumentIdAllocator = (kind: IdKind) => string;

const BLOCK_LABELS: Record<RichBlockType, string> = {
  paragraph: "فقرة",
  heading: "عنوان",
  "ordered-list": "قائمة مرقمة",
  "bullet-list": "قائمة نقطية",
  quran: "آية / نص قرآني",
  poetry: "شعر",
  table: "جدول",
  image: "صورة",
  divider: "فاصل",
};

const BLOCK_ICONS: Record<RichBlockType, typeof Quote> = {
  paragraph: Quote,
  heading: Quote,
  "ordered-list": Quote,
  "bullet-list": Quote,
  quran: Quote,
  poetry: Quote,
  table: Quote,
  image: ImageIcon,
  divider: Minus,
};

const MARK_ORDER = ["bold", "italic", "underline"] as const;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inlineMarkup(value: RichInline): string {
  const spans = value.length ? value : [{ text: "" }];
  return spans.map((span) => {
    const marks = MARK_ORDER.filter((mark) => span.marks?.includes(mark));
    return `<span data-rich-marks="${marks.join(" ")}">${escapeHtml(span.text)}</span>`;
  }).join("");
}

function marksForElement(element: Element): Array<(typeof MARK_ORDER)[number]> {
  const found = new Set<(typeof MARK_ORDER)[number]>();
  let current: Element | null = element;
  while (current) {
    const tag = current.tagName.toLowerCase();
    if (tag === "b" || tag === "strong") found.add("bold");
    if (tag === "i" || tag === "em") found.add("italic");
    if (tag === "u") found.add("underline");
    for (const mark of current.getAttribute("data-rich-marks")?.split(" ") ?? []) {
      if (MARK_ORDER.includes(mark as (typeof MARK_ORDER)[number])) found.add(mark as (typeof MARK_ORDER)[number]);
    }
    current = current.parentElement;
  }
  return MARK_ORDER.filter((mark) => found.has(mark));
}

function serializeInline(root: HTMLElement): RichInline {
  const result: RichInline = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? "";
      if (text) {
        const marks = marksForElement(node.parentElement ?? root);
        result.push(marks.length ? { text, marks: [...marks] } : { text });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.tagName.toLowerCase() === "br") {
      result.push({ text: "\n" });
      return;
    }
    for (const child of element.childNodes) visit(child);
  };
  for (const child of root.childNodes) visit(child);
  return result.length ? result : [{ text: "" }];
}

function useInlineEditor(value: RichInline, onChange: (value: RichInline) => void) {
  const ref = React.useRef<HTMLDivElement>(null);
  const signature = JSON.stringify(value);
  const markup = inlineMarkup(value);
  const lastSignature = React.useRef(signature);

  React.useEffect(() => {
    if (lastSignature.current === signature || !ref.current) return;
    ref.current.innerHTML = markup;
    lastSignature.current = signature;
  }, [markup, signature]);

  const emit = React.useCallback(() => {
    if (!ref.current) return;
    const next = serializeInline(ref.current);
    lastSignature.current = JSON.stringify(next);
    onChange(next);
  }, [onChange]);

  const command = React.useCallback((name: "bold" | "italic" | "underline") => {
    ref.current?.focus();
    document.execCommand(name);
    emit();
  }, [emit]);

  return { ref, markup, emit, command };
}

function RichInlineEditor({
  value,
  onChange,
  ariaLabel,
  className,
}: {
  value: RichInline;
  onChange: (value: RichInline) => void;
  ariaLabel: string;
  className?: string;
}) {
  const { ref, markup, emit, command } = useInlineEditor(value, onChange);
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1.5 flex items-center gap-0.5" role="toolbar" aria-label="تنسيق النص">
        <IconButton label="غامق" size="xs" variant="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => command("bold")}><Bold aria-hidden /></IconButton>
        <IconButton label="مائل" size="xs" variant="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => command("italic")}><Italic aria-hidden /></IconButton>
        <IconButton label="تحته خط" size="xs" variant="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => command("underline")}><Underline aria-hidden /></IconButton>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        dir="rtl"
        className="min-h-10 rounded-md border border-border bg-surface px-3 py-2 text-sm leading-[1.85] text-fg outline-none transition-[border-color,box-shadow] focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-subtle)] [&_[data-rich-marks~='bold']]:font-bold [&_[data-rich-marks~='italic']]:italic [&_[data-rich-marks~='underline']]:underline"
        dangerouslySetInnerHTML={{ __html: markup }}
        onInput={emit}
        onBlur={emit}
        onKeyDown={(event) => {
          if (!(event.ctrlKey || event.metaKey)) return;
          const commandName = event.key.toLowerCase();
          if (commandName === "b" || commandName === "i" || commandName === "u") {
            event.preventDefault();
            command(commandName === "b" ? "bold" : commandName === "i" ? "italic" : "underline");
          }
        }}
      />
    </div>
  );
}

function newId(allocateId: RichDocumentIdAllocator | undefined, kind: IdKind): string {
  return allocateId?.(kind) ?? uuidv7();
}

function cloneBlockWithNewIds(block: RichBlock, allocateId?: RichDocumentIdAllocator): RichBlock {
  const clone = structuredClone(block) as RichBlock;
  clone.id = newId(allocateId, "block");
  if (clone.type === "quran") clone.verses = clone.verses.map((verse) => ({ ...verse, id: newId(allocateId, "verse") }));
  if (clone.type === "poetry") clone.verses = clone.verses.map((verse) => ({ ...verse, id: newId(allocateId, "verse") }));
  return clone;
}

export function RichDocumentEditor({
  value,
  onChange,
  assets = [],
  allocateId,
  className,
}: {
  value: CanonicalRichDocument;
  onChange: (value: CanonicalRichDocument) => void;
  assets?: Asset[];
  allocateId?: RichDocumentIdAllocator;
  className?: string;
}) {
  const [imageBlockId, setImageBlockId] = React.useState<string | null>(null);

  const updateBlock = (blockId: string, next: RichBlock) => {
    onChange({ ...value, blocks: value.blocks.map((block) => block.id === blockId ? next : block) });
  };
  const addBlock = (type: RichBlockType) => {
    const id = newId(allocateId, "block");
    let block: RichBlock;
    switch (type) {
      case "heading": block = { id, type, level: 2, spans: [{ text: "" }] }; break;
      case "ordered-list":
      case "bullet-list": block = { id, type, items: [{ spans: [{ text: "" }] }] }; break;
      case "quran": block = { id, type, verses: [{ id: newId(allocateId, "verse"), spans: [{ text: "" }] }] }; break;
      case "poetry": block = { id, type, verses: [{ id: newId(allocateId, "verse"), sadr: [{ text: "" }], ajuz: [{ text: "" }] }] }; break;
      case "table": block = { id, type, headerRowCount: 1, columnAlignments: ["start", "start"], displayMode: "standard", rows: [{ cells: [{ spans: [{ text: "" }] }, { spans: [{ text: "" }] }] }, { cells: [{ spans: [{ text: "" }] }, { spans: [{ text: "" }] }] }] }; break;
      case "image":
        block = { id, type, assetId: assets[0]?.id ?? "", alt: "" };
        break;
      case "divider": block = { id, type }; break;
      case "paragraph": block = { id, type, spans: [{ text: "" }] }; break;
    }
    onChange({ ...value, blocks: [...value.blocks, block] });
    if (type === "image") setImageBlockId(id);
  };

  return (
    <div className={cn("min-w-0 space-y-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-fg-tertiary">كل عنصر محفوظ كبنية RichDocument حقيقية.</span>
        <Menu>
          <MenuTrigger asChild><Button size="sm" variant="secondary" icon={<Plus aria-hidden />}>إضافة عنصر</Button></MenuTrigger>
          <MenuContent align="end" className="min-w-52">
            <MenuLabel>نوع العنصر</MenuLabel>
            <MenuItem onSelect={() => addBlock("paragraph")}>فقرة</MenuItem>
            <MenuItem onSelect={() => addBlock("heading")}>عنوان</MenuItem>
            <MenuItem onSelect={() => addBlock("ordered-list")}>قائمة مرقمة</MenuItem>
            <MenuItem onSelect={() => addBlock("bullet-list")}>قائمة نقطية</MenuItem>
            <MenuItem onSelect={() => addBlock("quran")}>آية / نص قرآني</MenuItem>
            <MenuItem onSelect={() => addBlock("poetry")}>شعر</MenuItem>
            <MenuItem onSelect={() => addBlock("table")}>جدول</MenuItem>
            <MenuItem disabled={!assets.length} hint={!assets.length ? "اختر صورة من مخزن الملفات أولًا." : undefined} onSelect={() => addBlock("image")}>صورة</MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => addBlock("divider")}>فاصل</MenuItem>
          </MenuContent>
        </Menu>
      </div>

      <ReorderableList
        items={value.blocks}
        onReorder={(blocks) => onChange({ ...value, blocks })}
        itemLabel="عنصر"
        bordered={false}
        renderItem={(block) => (
          <RichBlockEditor
            block={block}
            assets={assets}
            allocateId={allocateId}
            onChange={(next) => updateBlock(block.id, next)}
            onDuplicate={() => onChange({ ...value, blocks: [...value.blocks.slice(0, value.blocks.findIndex((item) => item.id === block.id) + 1), cloneBlockWithNewIds(block, allocateId), ...value.blocks.slice(value.blocks.findIndex((item) => item.id === block.id) + 1)] })}
            onDelete={() => onChange({ ...value, blocks: value.blocks.filter((item) => item.id !== block.id) })}
            onOpenImagePicker={() => setImageBlockId(block.id)}
          />
        )}
        emptyState={<Well padding="md"><p className="text-center text-xs text-fg-tertiary">لا توجد عناصر بعد. أضف فقرة لبدء التحرير.</p></Well>}
      />

      <AssetPicker
        open={imageBlockId !== null}
        onOpenChange={(open) => { if (!open) setImageBlockId(null); }}
        assets={assets}
        kind="image"
        value={imageBlockId ? (() => { const block = value.blocks.find((item) => item.id === imageBlockId); return block?.type === "image" ? block.assetId : null; })() : null}
        onSelect={(asset) => {
          if (!imageBlockId) return;
          const block = value.blocks.find((item) => item.id === imageBlockId);
          if (block?.type === "image") updateBlock(imageBlockId, { ...block, assetId: asset.id });
        }}
      />
    </div>
  );
}

function BlockChrome({
  block,
  onDuplicate,
  onDelete,
  children,
}: {
  block: RichBlock;
  onDuplicate: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const Icon = BLOCK_ICONS[block.type];
  return (
    <Panel className="min-w-0">
      <PanelHeader
        title={BLOCK_LABELS[block.type]}
        density="compact"
        icon={<Icon className="size-4 text-fg-tertiary" aria-hidden />}
        actions={
          <div className="flex items-center gap-0.5">
            <span className="me-1 text-fg-quaternary" title="اسحب لإعادة الترتيب"><GripVertical className="size-4" aria-hidden /></span>
            <IconButton label="تكرار العنصر" size="xs" variant="ghost" onClick={onDuplicate}><Copy aria-hidden /></IconButton>
            <IconButton label="حذف العنصر" size="xs" variant="ghost" className="hover:text-danger-text" onClick={onDelete}><Trash2 aria-hidden /></IconButton>
          </div>
        }
      />
      <PanelBody>{children}</PanelBody>
    </Panel>
  );
}

function RichBlockEditor({
  block,
  assets,
  allocateId,
  onChange,
  onDuplicate,
  onDelete,
  onOpenImagePicker,
}: {
  block: RichBlock;
  assets: Asset[];
  allocateId?: RichDocumentIdAllocator;
  onChange: (block: RichBlock) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpenImagePicker: () => void;
}) {
  return (
    <BlockChrome block={block} onDuplicate={onDuplicate} onDelete={onDelete}>
      {block.type === "paragraph" ? <RichInlineEditor value={block.spans} onChange={(spans) => onChange({ ...block, spans })} ariaLabel="محتوى الفقرة" /> : null}
      {block.type === "heading" ? (
        <div className="space-y-3">
          <FormField label="مستوى العنوان">
            <Select value={String(block.level) as "2" | "3" | "4"} options={[{ value: "2", label: "H2" }, { value: "3", label: "H3" }, { value: "4", label: "H4" }]} onValueChange={(level) => onChange({ ...block, level: Number(level) as 2 | 3 | 4 })} aria-label="مستوى العنوان" />
          </FormField>
          <RichInlineEditor value={block.spans} onChange={(spans) => onChange({ ...block, spans })} ariaLabel="محتوى العنوان" />
        </div>
      ) : null}
      {block.type === "ordered-list" || block.type === "bullet-list" ? (
        <InlineCollectionEditor
          items={block.items}
          onChange={(items) => onChange({ ...block, items })}
          ordered={block.type === "ordered-list"}
          allocateId={allocateId}
          ariaLabel="عنصر قائمة"
        />
      ) : null}
      {block.type === "quran" ? <QuranEditor block={block} onChange={onChange} allocateId={allocateId} /> : null}
      {block.type === "poetry" ? <PoetryEditor block={block} onChange={onChange} allocateId={allocateId} /> : null}
      {block.type === "table" ? <TableEditor block={block} onChange={onChange} /> : null}
      {block.type === "image" ? <ImageBlockEditor block={block} assets={assets} onChange={onChange} onOpenPicker={onOpenImagePicker} /> : null}
      {block.type === "divider" ? <p className="text-xs text-fg-tertiary">فاصل بصري بين مقاطع المحتوى.</p> : null}
    </BlockChrome>
  );
}

function InlineCollectionEditor({
  items,
  onChange,
  ordered,
  ariaLabel,
}: {
  items: Array<{ spans: RichInline }>;
  onChange: (items: Array<{ spans: RichInline }>) => void;
  ordered: boolean;
  allocateId?: RichDocumentIdAllocator;
  ariaLabel: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="flex min-w-0 items-start gap-2">
          <span className="mt-2.5 w-6 shrink-0 text-center text-xs font-semibold text-fg-tertiary">{ordered ? `${index + 1}.` : "•"}</span>
          <RichInlineEditor value={item.spans} onChange={(spans) => onChange(items.map((current, i) => i === index ? { spans } : current))} ariaLabel={`${ariaLabel} ${index + 1}`} className="flex-1" />
          <div className="mt-6 flex shrink-0 gap-0.5">
            <IconButton label="نقل لأعلى" size="xs" variant="ghost" disabled={index === 0} onClick={() => onChange(arrayMove(items, index, index - 1))}><AlignRight aria-hidden /></IconButton>
            <IconButton label="نقل لأسفل" size="xs" variant="ghost" disabled={index === items.length - 1} onClick={() => onChange(arrayMove(items, index, index + 1))}><AlignLeft aria-hidden /></IconButton>
            <IconButton label="حذف عنصر القائمة" size="xs" variant="ghost" className="hover:text-danger-text" disabled={items.length === 1} onClick={() => onChange(items.filter((_, i) => i !== index))}><Trash2 aria-hidden /></IconButton>
          </div>
        </div>
      ))}
      <Button size="xs" variant="outline" icon={<Plus aria-hidden />} onClick={() => onChange([...items, { spans: [{ text: "" }] }])}>إضافة عنصر</Button>
    </div>
  );
}

function QuranEditor({ block, onChange, allocateId }: { block: Extract<RichBlock, { type: "quran" }>; onChange: (block: RichBlock) => void; allocateId?: RichDocumentIdAllocator }) {
  return (
    <div className="space-y-3">
      {block.verses.map((verse, index) => (
        <Panel key={verse.id} variant="inset">
          <PanelBody>
            <div className="mb-3 flex items-center justify-between gap-2"><span className="text-xs font-medium text-fg">الآية {index + 1}</span><div className="flex gap-1"><IconButton label="نقل لأعلى" size="xs" variant="ghost" disabled={index === 0} onClick={() => onChange({ ...block, verses: arrayMove(block.verses, index, index - 1) })}><AlignRight aria-hidden /></IconButton><IconButton label="نقل لأسفل" size="xs" variant="ghost" disabled={index === block.verses.length - 1} onClick={() => onChange({ ...block, verses: arrayMove(block.verses, index, index + 1) })}><AlignLeft aria-hidden /></IconButton><IconButton label="حذف الآية" size="xs" variant="ghost" className="hover:text-danger-text" disabled={block.verses.length === 1} onClick={() => onChange({ ...block, verses: block.verses.filter((_, i) => i !== index) })}><Trash2 aria-hidden /></IconButton></div></div>
            <RichInlineEditor value={verse.spans} onChange={(spans) => onChange({ ...block, verses: block.verses.map((current, i) => i === index ? { ...current, spans } : current) })} ariaLabel={`نص الآية ${index + 1}`} />
            <div className="mt-3 grid gap-3 sm:grid-cols-2"><FormField label="السورة"><TextField value={verse.surah ?? ""} onChange={(event) => { const next = { ...verse }; if (event.target.value) next.surah = event.target.value; else delete next.surah; onChange({ ...block, verses: block.verses.map((current, i) => i === index ? next : current) }); }} /></FormField><FormField label="رقم الآية"><TextField type="number" value={verse.ayah?.toString() ?? ""} onChange={(event) => { const next = { ...verse }; const value = Number(event.target.value); if (Number.isInteger(value) && value > 0) next.ayah = value; else delete next.ayah; onChange({ ...block, verses: block.verses.map((current, i) => i === index ? next : current) }); }} /></FormField></div>
          </PanelBody>
        </Panel>
      ))}
      <Button size="xs" variant="outline" icon={<Plus aria-hidden />} onClick={() => onChange({ ...block, verses: [...block.verses, { id: newId(allocateId, "verse"), spans: [{ text: "" }] }] })}>إضافة آية</Button>
    </div>
  );
}

function PoetryEditor({ block, onChange, allocateId }: { block: Extract<RichBlock, { type: "poetry" }>; onChange: (block: RichBlock) => void; allocateId?: RichDocumentIdAllocator }) {
  return (
    <div className="space-y-3">
      {block.verses.map((verse, index) => (
        <Panel key={verse.id} variant="inset"><PanelBody><div className="mb-3 flex items-center justify-between"><span className="text-xs font-medium text-fg">البيت {index + 1}</span><div className="flex gap-1"><IconButton label="نقل البيت لأعلى" size="xs" variant="ghost" disabled={index === 0} onClick={() => onChange({ ...block, verses: arrayMove(block.verses, index, index - 1) })}><AlignRight aria-hidden /></IconButton><IconButton label="نقل البيت لأسفل" size="xs" variant="ghost" disabled={index === block.verses.length - 1} onClick={() => onChange({ ...block, verses: arrayMove(block.verses, index, index + 1) })}><AlignLeft aria-hidden /></IconButton><IconButton label="حذف البيت" size="xs" variant="ghost" className="hover:text-danger-text" disabled={block.verses.length === 1} onClick={() => onChange({ ...block, verses: block.verses.filter((_, i) => i !== index) })}><Trash2 aria-hidden /></IconButton></div></div><div className="grid gap-3 lg:grid-cols-2"><FormField label="الصدر"><RichInlineEditor value={verse.sadr} onChange={(sadr) => onChange({ ...block, verses: block.verses.map((current, i) => i === index ? { ...current, sadr } : current) })} ariaLabel={`صدر البيت ${index + 1}`} /></FormField><FormField label="العجز"><RichInlineEditor value={verse.ajuz} onChange={(ajuz) => onChange({ ...block, verses: block.verses.map((current, i) => i === index ? { ...current, ajuz } : current) })} ariaLabel={`عجز البيت ${index + 1}`} /></FormField></div></PanelBody></Panel>
      ))}
      <Button size="xs" variant="outline" icon={<Plus aria-hidden />} onClick={() => onChange({ ...block, verses: [...block.verses, { id: newId(allocateId, "verse"), sadr: [{ text: "" }], ajuz: [{ text: "" }] }] })}>إضافة بيت</Button>
    </div>
  );
}

function TableEditor({ block, onChange }: { block: Extract<RichBlock, { type: "table" }>; onChange: (block: RichBlock) => void }) {
  const columnCount = block.rows[0]?.cells.length ?? 0;
  const updateCell = (rowIndex: number, columnIndex: number, spans: RichInline) => onChange({ ...block, rows: block.rows.map((row, ri) => ri === rowIndex ? { ...row, cells: row.cells.map((cell, ci) => ci === columnIndex ? { spans } : cell) } : row) });
  const removeRow = (rowIndex: number) => {
    if (block.rows.length <= 1) return;
    const rows = block.rows.filter((_, index) => index !== rowIndex);
    const headerRowCount = Math.max(0, Math.min(rows.length, block.headerRowCount - (rowIndex < block.headerRowCount ? 1 : 0)));
    onChange({ ...block, rows, headerRowCount });
  };
  const removeColumn = (columnIndex: number) => {
    if (columnCount <= 1) return;
    onChange({
      ...block,
      rows: block.rows.map((row) => ({ ...row, cells: row.cells.filter((_, index) => index !== columnIndex) })),
      columnAlignments: block.columnAlignments?.filter((_, index) => index !== columnIndex),
    });
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3"><FormField label="صفوف العنوان"><TextField type="number" min={0} max={block.rows.length} value={block.headerRowCount} onChange={(event) => { const value = Math.max(0, Math.min(block.rows.length, Number(event.target.value) || 0)); onChange({ ...block, headerRowCount: value }); }} /></FormField><FormField label="نمط العرض"><Select value={block.displayMode ?? "standard"} options={[{ value: "standard", label: "قياسي" }, { value: "compact", label: "مضغوط" }]} onValueChange={(displayMode) => onChange({ ...block, displayMode: displayMode as "standard" | "compact" })} /></FormField><FormField label="الوصف"><div className="flex items-center gap-2"><Button size="xs" variant="outline" onClick={() => onChange(block.caption ? { ...block, caption: undefined } : { ...block, caption: [{ text: "" }] })}>{block.caption ? "إزالة الوصف" : "إضافة وصف"}</Button></div></FormField></div>
      {block.caption ? <RichInlineEditor value={block.caption} onChange={(caption) => onChange({ ...block, caption })} ariaLabel="وصف الجدول" /> : null}
      <div className="overflow-x-auto rounded-md border border-border"><table className="min-w-full border-collapse"><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.cells.map((cell, columnIndex) => <td key={columnIndex} className="min-w-40 border-b border-e border-border-subtle p-2 align-top last:border-e-0"><div className="mb-1 flex items-center justify-between gap-2"><span className="text-2xs text-fg-quaternary">{rowIndex < block.headerRowCount ? "عنوان" : "خلية"}</span>{rowIndex === 0 ? <IconButton label="حذف العمود" size="xs" variant="ghost" className="hover:text-danger-text" disabled={columnCount <= 1} onClick={() => removeColumn(columnIndex)}><Trash2 aria-hidden /></IconButton> : null}</div><RichInlineEditor value={cell.spans} onChange={(spans) => updateCell(rowIndex, columnIndex, spans)} ariaLabel={`خلية ${rowIndex + 1}-${columnIndex + 1}`} /></td>)}<td className="w-12 border-b border-border-subtle p-2 align-top"><IconButton label="حذف الصف" size="xs" variant="ghost" className="hover:text-danger-text" disabled={block.rows.length <= 1} onClick={() => removeRow(rowIndex)}><Trash2 aria-hidden /></IconButton></td></tr>)}</tbody></table></div>
      <div className="flex flex-wrap gap-2"><Button size="xs" variant="outline" icon={<Plus aria-hidden />} onClick={() => onChange({ ...block, rows: [...block.rows, { cells: Array.from({ length: columnCount || 1 }, () => ({ spans: [{ text: "" }] })) }] })}>إضافة صف</Button><Button size="xs" variant="outline" icon={<Plus aria-hidden />} onClick={() => onChange({ ...block, rows: block.rows.map((row) => ({ ...row, cells: [...row.cells, { spans: [{ text: "" }] }] })), columnAlignments: [...(block.columnAlignments ?? []), "start"] })}>إضافة عمود</Button><Button size="xs" variant="quiet" icon={<RotateCcw aria-hidden />} onClick={() => onChange({ ...block, columnAlignments: Array.from({ length: columnCount }, () => "start" as const) })}>محاذاة البداية</Button></div>
      <div className="grid gap-3 sm:grid-cols-3">{Array.from({ length: columnCount }, (_, index) => <FormField key={index} label={`محاذاة العمود ${index + 1}`}><Select value={block.columnAlignments?.[index] ?? "start"} options={[{ value: "start", label: "بداية" }, { value: "center", label: "وسط" }, { value: "end", label: "نهاية" }]} onValueChange={(alignment) => onChange({ ...block, columnAlignments: Array.from({ length: columnCount }, (_, i) => i === index ? alignment as "start" | "center" | "end" : block.columnAlignments?.[i] ?? "start") })} /></FormField>)}</div>
    </div>
  );
}

function ImageBlockEditor({ block, assets, onChange, onOpenPicker }: { block: Extract<RichBlock, { type: "image" }>; assets: Asset[]; onChange: (block: RichBlock) => void; onOpenPicker: () => void }) {
  const selected = assets.find((asset) => asset.id === block.assetId);
  return <div className="space-y-3"><div className="flex flex-wrap items-center gap-3">{selected ? <AssetThumb asset={selected} size="md" /> : <Well padding="sm"><span className="text-xs text-fg-tertiary">لم يتم اختيار صورة.</span></Well>}<Button size="sm" variant="secondary" icon={<ImageIcon aria-hidden />} onClick={onOpenPicker}>اختيار من المخزن</Button></div><FormField label="النص البديل" required description="مطلوب لإتاحة الصورة داخل المحتوى."><TextField value={block.alt} onChange={(event) => onChange({ ...block, alt: event.target.value })} /></FormField><FormField label="وصف اختياري"><Button size="xs" variant="outline" onClick={() => onChange(block.caption ? { ...block, caption: undefined } : { ...block, caption: [{ text: "" }] })}>{block.caption ? "إزالة الوصف" : "إضافة وصف"}</Button>{block.caption ? <RichInlineEditor value={block.caption} onChange={(caption) => onChange({ ...block, caption })} ariaLabel="وصف الصورة" className="mt-2" /> : null}</FormField></div>;
}

function arrayMove<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
