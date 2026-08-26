import { ArrowLeftRight, BookOpen, FolderTree, LayoutGrid } from "lucide-react";
import type { MaterialQuestionBankLayoutContent, MaterialQuestionBankNodeContent } from "@/server/material-question-bank";
import type { ChangeDetails } from "./types";

type ReviewItem = ChangeDetails["items"][number];

export function MaterialQuestionBankReviewItem({ item }: { item: ReviewItem }) {
  const before = asLayout(item.beforeSnapshot);
  const after = asLayout(item.proposedSnapshot);
  if (!after) return null;
  const beforeNodes = new Map((before?.nodes ?? []).map((node) => [node.id, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const changed = [...new Set([...beforeNodes.keys(), ...afterNodes.keys()])]
    .map((id) => ({ id, before: beforeNodes.get(id), after: afterNodes.get(id) }))
    .filter((entry) => JSON.stringify(entry.before) !== JSON.stringify(entry.after));
  return <article className="overflow-hidden rounded-2xl border bg-card" data-review-kind="material-question-bank">
    <header className="flex flex-col gap-3 border-b bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><LayoutGrid className="h-4 w-4" /></span><div><p className="text-sm font-black">{item.presentation.resourceLabel}</p><p className="mt-1 text-[11px] text-muted-foreground">مراجعة البنية والتوزيع قبل وصولها إلى الطالب</p></div></div><span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold text-primary">{item.presentation.areaLabel}</span></header>
    <div className="space-y-5 p-4"><section className="grid gap-2 sm:grid-cols-3"><Metric label="نمط الجذر" before={before?.rootPresentation ?? "غير منشور"} after={after.rootPresentation} /><Metric label="العقد" before={String(before?.nodes.length ?? 0)} after={String(after.nodes.length)} /><Metric label="العقد المتغيّرة" before="—" after={String(changed.length)} /></section>
      <section className="space-y-2"><h3 className="text-xs font-black">التغييرات البنيوية</h3>{changed.length ? changed.map((entry) => <div key={entry.id} className="grid gap-2 rounded-xl border bg-muted/20 p-3 sm:grid-cols-[1fr_auto_1fr]"><NodeSide node={entry.before} empty="عقدة جديدة" /><ArrowLeftRight className="h-4 w-4 self-center justify-self-center text-muted-foreground" /><NodeSide node={entry.after} empty="أُزيلت من المقترح" /></div>) : <p className="rounded-xl bg-muted/30 p-4 text-xs text-muted-foreground">لا توجد تغييرات عقدية.</p>}</section>
    </div>
  </article>;
}

function NodeSide({ node, empty }: { node?: MaterialQuestionBankNodeContent; empty: string }) { if (!node) return <p className="text-xs text-muted-foreground">{empty}</p>; return <div className="min-w-0"><div className="flex items-center gap-2">{node.nodeType === "GROUP" ? <FolderTree className="h-4 w-4 text-primary" /> : <BookOpen className="h-4 w-4 text-primary" />}<strong className="truncate text-xs">{node.label}</strong></div><p className="mt-2 font-mono text-[9px] text-muted-foreground">{node.nodeKey} · order {node.displayOrder}</p><p className="mt-1 text-[10px] text-muted-foreground">{node.nodeType === "GROUP" ? node.groupPresentation : node.packageId ? `${node.targetMode} · ${node.packageId.slice(0, 8)}…` : "فتحة بنك فارغة"} · {node.enabled ? "مفعّل" : "معطّل"}</p></div>; }
function Metric({ label, before, after }: { label: string; before: string; after: string }) { const changed = before !== after; return <div className="rounded-xl border p-3"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-2 text-xs"><span className={changed ? "text-muted-foreground line-through" : "font-bold"}>{before}</span>{changed ? <><span className="mx-2 text-primary">←</span><strong className="text-primary">{after}</strong></> : null}</p></div>; }
function asLayout(value: Record<string, unknown>): MaterialQuestionBankLayoutContent | null { return typeof value.materialId === "string" && Array.isArray(value.nodes) ? value as unknown as MaterialQuestionBankLayoutContent : null; }
