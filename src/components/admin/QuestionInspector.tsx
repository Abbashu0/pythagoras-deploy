"use client";

/**
 * QuestionInspector — right panel for question metadata.
 *
 * Features:
 *   - Status selector (draft/review/ready/published/archived/hidden)
 *   - Difficulty selector (easy/medium/hard/expert)
 *   - Tags editor (add/remove, with autocomplete from existing tags)
 *   - Visibility toggle
 *   - Version + analytics stats (read-only)
 *   - Sources (appearances) — placeholder for v1
 *   - Resources — placeholder for v1
 *
 * Props:
 *   - question: Question | null
 *   - availableTags: Tag[]
 *   - onChange: (updates: Partial<Question>) => void
 */

import { useState } from "react";
import {
  Tag as TagIcon,
  X,
  Plus,
  Eye,
  EyeOff,
  BarChart3,
  History,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Question, DifficultyLevel, QuestionStatus } from "@/lib/entities";
import type { Tag } from "@/lib/entities";

interface Props {
  question: Question | null;
  availableTags: Tag[];
  onChange: (updates: Partial<Question>) => void;
}

const STATUSES: { value: QuestionStatus; label: string; color: string }[] = [
  { value: "draft", label: "مسودة", color: "border-amber-500/30 bg-amber-500/10 text-amber-600" },
  { value: "review", label: "مراجعة", color: "border-blue-500/30 bg-blue-500/10 text-blue-600" },
  { value: "ready", label: "جاهز", color: "border-cyan-500/30 bg-cyan-500/10 text-cyan-600" },
  { value: "published", label: "منشور", color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" },
  { value: "archived", label: "مؤرشف", color: "border-gray-500/30 bg-gray-500/10 text-gray-600" },
  { value: "hidden", label: "مخفي", color: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600" },
];

const DIFFICULTIES: { value: DifficultyLevel; label: string; color: string }[] = [
  { value: "easy", label: "سهل", color: "text-emerald-600" },
  { value: "medium", label: "متوسط", color: "text-amber-600" },
  { value: "hard", label: "صعب", color: "text-orange-600" },
  { value: "expert", label: "خبير", color: "text-red-600" },
];

export function QuestionInspector({ question, availableTags, onChange }: Props) {
  const [tagInput, setTagInput] = useState("");

  if (!question) {
    return (
      <aside className="hidden w-80 border-r border-border bg-card/40 lg:block">
        <div className="grid place-items-center gap-2 py-20 text-center text-xs text-muted-foreground">
          <Layers className="h-8 w-8 text-muted-foreground/30" />
          <p>اختر سؤالاً لعرض خصائصه</p>
        </div>
      </aside>
    );
  }

  const currentTags = availableTags.filter((t) => question.tags?.includes(t.id!));

  const handleAddTag = (tag: Tag) => {
    if (question.tags?.includes(tag.id!)) return;
    onChange({ tags: [...(question.tags || []), tag.id!] });
    setTagInput("");
  };

  const handleRemoveTag = (tagId: string) => {
    onChange({ tags: (question.tags || []).filter((t) => t !== tagId) });
  };

  // Tag suggestions: filter by input, exclude already-added.
  const tagSuggestions = tagInput
    ? availableTags
        .filter(
          (t) =>
            t.name.includes(tagInput) && !question.tags?.includes(t.id!)
        )
        .slice(0, 5)
    : [];

  return (
    <aside className="hidden w-80 flex-col border-r border-border bg-card/40 lg:flex">
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Layers className="h-4 w-4 text-primary" />
          الخصائص
        </h3>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        {/* Status */}
        <section>
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            الحالة
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                onClick={() => onChange({ status: s.value })}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors",
                  question.status === s.value
                    ? s.color
                    : "border-border text-muted-foreground hover:bg-muted/50"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>

        {/* Difficulty */}
        <section>
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            مستوى الصعوبة
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.value}
                onClick={() => onChange({ difficulty: d.value })}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors",
                  question.difficulty === d.value
                    ? `border-current ${d.color} bg-current/10`
                    : "border-border text-muted-foreground hover:bg-muted/50"
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </section>

        {/* Visibility */}
        <section>
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            الظهور
          </label>
          <button
            onClick={() => onChange({ visible: !question.visible })}
            className={cn(
              "flex w-full items-center justify-between rounded-md border px-3 py-2 text-xs font-medium transition-colors",
              question.visible
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
                : "border-border bg-muted/30 text-muted-foreground"
            )}
          >
            <span className="flex items-center gap-2">
              {question.visible ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" />
              )}
              {question.visible ? "ظاهر للطلاب" : "مخفي عن الطلاب"}
            </span>
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                question.visible ? "bg-emerald-500" : "bg-muted-foreground/30"
              )}
            />
          </button>
        </section>

        {/* Tags */}
        <section>
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            الوسوم
          </label>

          {/* Current tags */}
          {currentTags.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {currentTags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    borderColor: `${tag.color}40`,
                    backgroundColor: `${tag.color}10`,
                    color: tag.color,
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                  <button
                    onClick={() => handleRemoveTag(tag.id!)}
                    className="hover:opacity-70"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Tag input */}
          <div className="relative">
            <TagIcon className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="بحث أو إضافة وسم…"
              className="h-8 pr-7 text-xs"
              dir="rtl"
            />
            {tagSuggestions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover p-1 shadow-md">
                {tagSuggestions.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => handleAddTag(tag)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"
                  >
                    <Plus className="h-3 w-3 text-muted-foreground" />
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span>{tag.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Stats */}
        <section>
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            الإحصائيات
          </label>
          <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <BarChart3 className="h-3 w-3" />
                مرات الإجابة
              </span>
              <span className="font-mono tabular-nums font-medium">
                {question.timesAnswered ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <BarChart3 className="h-3 w-3" />
                إجابات صحيحة
              </span>
              <span className="font-mono tabular-nums font-medium text-emerald-600">
                {question.timesCorrect ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <History className="h-3 w-3" />
                الإصدار
              </span>
              <span className="font-mono tabular-nums font-medium">
                v{question.version ?? 1}
              </span>
            </div>
          </div>
        </section>

        {/* Resources — placeholder for v1 */}
        <section>
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            الموارد (صور، جداول)
          </label>
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-center text-[11px] text-muted-foreground">
            لا توجد موارد مرتبطة.
            <br />
            <span className="text-muted-foreground/70">(إدارة الموارد ستضاف في M5)</span>
          </div>
        </section>

        {/* Sources — placeholder for v1 */}
        <section>
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            المصادر (ظهور في امتحانات)
          </label>
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-center text-[11px] text-muted-foreground">
            لا توجد مصادر مسجلة.
            <br />
            <span className="text-muted-foreground/70">(إدارة المصادر ستضاف في M5)</span>
          </div>
        </section>
      </div>
    </aside>
  );
}
