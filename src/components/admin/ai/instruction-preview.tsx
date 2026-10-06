"use client";
import * as React from "react";
import { Copy, Check } from "lucide-react";
import type { InstructionSection } from "@/lib/ai-instruction-sections";
import { Button } from "@/components/admin-ui/primitives/button";
export function InstructionPreview({ sections, text, legacy = false }: { sections: InstructionSection[]; text: string; legacy?: boolean }) {
  const [mode, setMode] = React.useState<"structured" | "compiled">("structured");
  const [copied, setCopied] = React.useState(false);
  const [copyError, setCopyError] = React.useState(false);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex gap-1" role="group" aria-label="نوع المعاينة">
      <Button size="sm" variant={mode === "structured" ? "quiet" : "ghost"} aria-pressed={mode === "structured"} onClick={() => setMode("structured")}>الفقرات</Button>
      <Button size="sm" variant={mode === "compiled" ? "quiet" : "ghost"} aria-pressed={mode === "compiled"} onClick={() => setMode("compiled")}>النص التنفيذي</Button></div>
      <Button size="sm" icon={copied ? <Check /> : <Copy />} onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setCopyError(false); } catch { setCopyError(true); } }}>نسخ النص التنفيذي</Button></div>
    {copyError ? <p role="status" className="text-xs text-danger-text">تعذّر النسخ. يمكنك تحديد النص ونسخه يدويًا.</p> : null}
    {legacy ? <p className="text-xs leading-relaxed text-warning-text">إصدار نصّي قديم: النص التنفيذي أدناه محفوظ حرفيًا. استعادته كمسودة ثم نشره يستخدم Compiler V1 ويضيف عنوان الفقرة.</p> : null}
    {mode === "compiled" ? <pre dir="auto" className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border-subtle bg-inset p-4 font-sans text-sm leading-[1.85] text-fg-secondary">{text || "لا يوجد نص تنفيذي في هذه المسودة."}</pre> : <div className="space-y-4">
      {sections.map((section, index) => <section key={section.id} className="border-s-2 border-border ps-4"><div className="flex items-center gap-2"><h3 className="font-semibold">{index + 1}. {section.title || "فقرة بلا عنوان"}</h3>{!section.enabled ? <span className="text-2xs text-fg-quaternary">غير مفعّلة</span> : null}</div>
        {section.description ? <p className="mt-1 text-xs text-fg-tertiary">{section.description} <span className="text-fg-quaternary">· وصف إداري فقط</span></p> : null}
        <p dir="auto" className="mt-3 whitespace-pre-wrap break-words text-sm leading-[1.85] text-fg-secondary">{section.body || "النص فارغ"}</p></section>)}
    </div>}
    <p className="text-2xs leading-relaxed text-fg-quaternary">لا تُضاف أوصاف الفقرات أو معرّفاتها إلى النص التنفيذي. هذه المعاينة نصّية ولا تنفّذ XML أو HTML أو الكود.</p>
  </div>;
}
