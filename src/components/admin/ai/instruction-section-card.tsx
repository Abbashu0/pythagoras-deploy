"use client";
import * as React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowUp, ChevronDown, Copy, GripVertical, MoreHorizontal, Trash2 } from "lucide-react";
import { INSTRUCTION_LIMITS, type InstructionSection } from "@/lib/ai-instruction-sections";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/admin-ui/primitives/button";
import { Panel } from "@/components/admin-ui/primitives/surface";
import { TextArea, TextField } from "@/components/admin-ui/forms/input";
import { Switch } from "@/components/admin-ui/forms/toggle";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "@/components/admin-ui/overlays/menu";
export function InstructionSectionCard({ section, position, count, dirty, collapsed, busy, last, update, toggleCollapsed, duplicate, remove, move }: {
  section: InstructionSection; position: number; count?: { tokens: number; precision: "exact" | "estimated" }; dirty: boolean; collapsed: boolean; busy: boolean; last: boolean;
  update: (value: Partial<InstructionSection>) => void; toggleCollapsed: () => void; duplicate: () => void; remove: () => void; move: (direction: -1 | 1) => void;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: section.id, disabled: busy });
  const reduced = useReducedMotion();
  const [menuOpen, setMenuOpen] = React.useState(false);
  return <Panel ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition: reduced ? undefined : transition }}
    className={cn("min-w-0", isDragging && "z-10 shadow-lg", !section.enabled && "border-border-subtle bg-surface-secondary")}>
    <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-3 sm:px-4">
      <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} disabled={busy} aria-label={`ترتيب الفقرة ${position}`}
        className="focus-ring flex size-8 touch-none items-center justify-center rounded-md text-fg-quaternary hover:bg-hover hover:text-fg-secondary"><GripVertical className="size-4" aria-hidden /></button>
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-inset text-xs text-fg-tertiary tnum" aria-label={`الفقرة ${position}`}>{position}</span>
      <div className="min-w-32 flex-1"><TextField id={`instruction-title-${section.id}`} value={section.title} onChange={(event) => update({ title: event.target.value })} disabled={busy}
        tone="quiet" placeholder="عنوان الفقرة" maxLength={INSTRUCTION_LIMITS.title * 2} aria-label={`عنوان الفقرة ${position}`} className="font-semibold" /></div>
      {dirty ? <span className="size-1.5 rounded-full bg-warning" title="تعديل غير منشور" aria-label="تعديل غير منشور" /> : null}
      <span className="rounded-md border border-border-subtle bg-inset px-2 py-1 text-2xs text-fg-tertiary tnum" title="العنوان والنص والفاصل؛ الوصف لا يُحتسب.">
        {count ? `${count.precision === "estimated" ? "≈ " : ""}${count.tokens.toLocaleString("en-US")}` : "…"} <span dir="ltr">tokens</span>
      </span>
      <Switch size="sm" checked={section.enabled} onCheckedChange={(enabled) => update({ enabled })} disabled={busy} aria-label={`تفعيل الفقرة ${position} في المسودة`} />
      <IconButton label={collapsed ? `توسيع الفقرة ${position}` : `طي الفقرة ${position}`} variant="ghost" size="sm" onClick={toggleCollapsed} aria-expanded={!collapsed} aria-controls={`instruction-body-${section.id}`}>
        <ChevronDown className={cn("transition-transform motion-reduce:transition-none", !collapsed && "rotate-180")} aria-hidden />
      </IconButton>
      <Menu dir="rtl" open={menuOpen} onOpenChange={setMenuOpen}><MenuTrigger asChild><IconButton label={`خيارات الفقرة ${position}`} variant="ghost" size="sm" disabled={busy}><MoreHorizontal aria-hidden /></IconButton></MenuTrigger>
        <MenuContent><MenuItem icon={<Copy />} onSelect={() => { setMenuOpen(false); duplicate(); }}>تكرار الفقرة</MenuItem><MenuItem icon={<ArrowUp />} disabled={position === 1} onSelect={() => move(-1)}>نقل لأعلى</MenuItem>
          <MenuItem icon={<ArrowDown />} disabled={last} onSelect={() => move(1)}>نقل لأسفل</MenuItem><MenuSeparator /><MenuItem danger icon={<Trash2 />} onSelect={remove}>حذف الفقرة</MenuItem></MenuContent>
      </Menu>
    </div>
    <div id={`instruction-body-${section.id}`} hidden={collapsed} className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`instruction-description-${section.id}`} className="shrink-0 text-xs text-fg-tertiary">وصف إداري</label>
        <div className="min-w-48 flex-1"><TextField id={`instruction-description-${section.id}`} size="sm" tone="quiet" value={section.description} onChange={(event) => update({ description: event.target.value })} disabled={busy}
          placeholder="ملاحظة لتوضيح الغرض من الفقرة — لا تُرسل للنموذج" maxLength={INSTRUCTION_LIMITS.description * 2} aria-describedby={`instruction-note-${section.id}`} /></div>
      </div>
      <label className="sr-only" htmlFor={`instruction-text-${section.id}`}>نص تعليمات الفقرة {position}</label>
      <TextArea id={`instruction-text-${section.id}`} dir={section.body ? "auto" : "rtl"} value={section.body} onChange={(event) => update({ body: event.target.value })} disabled={busy}
        minRows={collapsed ? 1 : 7} maxRows={18} autoResize mono={false} className="px-4 py-3 text-sm leading-[1.85]"
        placeholder={position === 1 ? "انت مودل تطبيق فيثاغورس مدرب على آلاف الأسئلة الوزارية وصفحات المنهج..." : "اكتب التعليمات التي سيقرأها النموذج في هذه الفقرة…"} />
      <div id={`instruction-note-${section.id}`} className="flex flex-wrap justify-between gap-2 text-2xs text-fg-quaternary"><span>{section.enabled ? "العنوان والنص يُطبّقان على المساعد بعد النشر فقط." : "هذه الفقرة لا تُرسل ولا تُحتسب؛ يمكنك الاستمرار بتحريرها."}</span><span>الوصف للإدارة فقط</span></div>
    </div>
  </Panel>;
}
