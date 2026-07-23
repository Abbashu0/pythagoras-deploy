"use client";

/**
 * QuestionList — left sidebar showing all questions in a package.
 *
 * Features:
 *   - Numbered list of questions (truncated preview)
 *   - Type icon + difficulty dot
 *   - Status badge (draft/published/...)
 *   - Click to select → opens in editor
 *   - "Add Question" button at bottom
 *   - Reorder via up/down arrows (simpler than drag-drop for v1)
 *   - Delete via trash icon (with confirmation)
 *
 * Props:
 *   - questions: Question[]
 *   - selectedId: string | null
 *   - onSelect: (id) => void
 *   - onAdd: () => void
 *   - onReorder: (id, direction) => void
 *   - onDelete: (id) => void
 */

import { useMemo } from "react";
import {
  Plus,
  ChevronUp,
  ChevronDown,
  Trash2,
  FileQuestion,
  CheckCircle2,
  Circle,
  AlertCircle,
  Archive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Question } from "@/lib/entities";
import { cn } from "@/lib/utils";

interface Props {
  questions: Question[];
  selectedId: string | null;
  loading?: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onReorder: (id: string, direction: "up" | "down") => void;
  onDelete: (id: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  mcq: "اختيار",
  "fill-blank": "فراغ",
  "true-false": "صح/خطأ",
  "short-answer": "إجابة قصيرة",
  "long-answer": "إجابة طويلة",
  essay: "مقالي",
  matching: "تطابق",
  ordering: "ترتيب",
  diagram: "رسم",
  custom: "مخصص",
};

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "bg-emerald-500",
  medium: "bg-amber-500",
  hard: "bg-orange-500",
  expert: "bg-red-500",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  draft: <Circle className="h-3 w-3 text-muted-foreground" />,
  review: <AlertCircle className="h-3 w-3 text-amber-500" />,
  ready: <CheckCircle2 className="h-3 w-3 text-blue-500" />,
  published: <CheckCircle2 className="h-3 w-3 text-emerald-500" />,
  archived: <Archive className="h-3 w-3 text-muted-foreground" />,
  hidden: <Circle className="h-3 w-3 text-muted-foreground/50" />,
};

export function QuestionList({
  questions,
  selectedId,
  loading,
  onSelect,
  onAdd,
  onReorder,
  onDelete,
}: Props) {
  // Memoize previews — truncate question text for sidebar display.
  const previews = useMemo(
    () =>
      questions.map((q, idx) => ({
        ...q,
        preview: (q.questionText || "سؤال فارغ").slice(0, 60).trim(),
        displayOrder: idx + 1,
      })),
    [questions]
  );

  return (
    <aside className="flex h-full w-72 flex-col border-l border-border bg-card/40">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <FileQuestion className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">
            الأسئلة
            <span className="mr-1.5 text-xs text-muted-foreground">
              ({questions.length})
            </span>
          </h3>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onAdd}
          disabled={loading}
          className="h-7 w-7 p-0"
          title="إضافة سؤال"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {previews.length === 0 ? (
          <div className="grid place-items-center gap-2 py-12 text-center">
            <FileQuestion className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">
              لا توجد أسئلة بعد.
              <br />
              اضغط + لإضافة سؤال جديد.
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {previews.map((q, idx) => (
              <li key={q.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(q.id!)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(q.id!);
                    }
                  }}
                  className={cn(
                    "group relative flex w-full cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2 text-right outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
                    selectedId === q.id
                      ? "border-primary bg-primary/10"
                      : "border-transparent hover:border-border hover:bg-muted/50"
                  )}
                >
                  {/* Row 1: order number + status + type badge + difficulty dot */}
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="font-mono tabular-nums">{q.displayOrder}.</span>
                    {STATUS_ICONS[q.status || "draft"]}
                    <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                      {TYPE_LABELS[q.type] || q.type}
                    </span>
                    <span
                      className={cn(
                        "ml-auto h-1.5 w-1.5 rounded-full",
                        DIFFICULTY_COLORS[q.difficulty || "medium"]
                      )}
                      title={q.difficulty}
                    />
                  </div>

                  {/* Row 2: question preview */}
                  <p className="line-clamp-2 text-xs text-foreground">
                    {q.preview}
                  </p>

                  {/* Row 3: hover actions */}
                  <div className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (idx > 0) onReorder(q.id!, "up");
                        }}
                        disabled={idx === 0}
                        className="grid h-5 w-5 place-items-center rounded bg-background/80 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30"
                        title="تحريك للأعلى"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (idx < previews.length - 1) onReorder(q.id!, "down");
                        }}
                        disabled={idx === previews.length - 1}
                        className="grid h-5 w-5 place-items-center rounded bg-background/80 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30"
                        title="تحريك للأسفل"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`حذف السؤال #${q.displayOrder}؟`)) {
                            onDelete(q.id!);
                          }
                        }}
                        className="grid h-5 w-5 place-items-center rounded bg-background/80 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="حذف"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border p-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onAdd}
          disabled={loading}
          className="w-full gap-1.5 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          سؤال جديد
        </Button>
      </div>
    </aside>
  );
}
