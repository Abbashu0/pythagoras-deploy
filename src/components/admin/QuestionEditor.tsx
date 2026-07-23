"use client";

/**
 * QuestionEditor — center panel for editing a single question.
 *
 * Features:
 *   - Question type selector (mcq, fill-blank, true-false, short/long-answer, essay, ...)
 *   - Question text (textarea, supports markdown)
 *   - MCQ options editor (add/remove/reorder, mark correct)
 *   - Answer text (depends on type)
 *   - Explanation (markdown)
 *   - Autosave on field change (debounced 800ms)
 *   - Dirty indicator
 *   - Status badge (draft/ready/published)
 *
 * Props:
 *   - question: Question | null
 *   - onChange: (updates: Partial<Question>) => void
 *   - onSave: () => Promise<void>
 *   - saving: boolean
 *   - dirty: boolean
 */

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  Check,
  Circle,
  Plus,
  Trash2,
  Save,
  FileQuestion,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Question, QuestionTypeValue } from "@/lib/entities";

interface Props {
  question: Question | null;
  onChange: (updates: Partial<Question>) => void;
  onSave: () => Promise<void>;
  saving: boolean;
  dirty: boolean;
}

const QUESTION_TYPES: { value: QuestionTypeValue; label: string; needsOptions: boolean; answerLabel: string }[] = [
  { value: "mcq", label: "اختيار من متعدد", needsOptions: true, answerLabel: "الإجابة الصحيحة" },
  { value: "fill-blank", label: "تعبئة الفراغ", needsOptions: false, answerLabel: "الإجابة الصحيحة" },
  { value: "true-false", label: "صح أو خطأ", needsOptions: false, answerLabel: "الإجابة الصحيحة" },
  { value: "short-answer", label: "إجابة قصيرة", needsOptions: false, answerLabel: "الإجابة النموذجية" },
  { value: "long-answer", label: "إجابة طويلة", needsOptions: false, answerLabel: "الإجابة النموذجية" },
  { value: "essay", label: "سؤال مقالي", needsOptions: false, answerLabel: "خطط الإجابة" },
  { value: "matching", label: "تطابق", needsOptions: true, answerLabel: "أزواج التطابق" },
  { value: "ordering", label: "ترتيب", needsOptions: true, answerLabel: "الترتيب الصحيح" },
  { value: "diagram", label: "رسم بياني", needsOptions: false, answerLabel: "وصف الرسم المطلوب" },
  { value: "custom", label: "مخصص", needsOptions: false, answerLabel: "الإجابة" },
];

export function QuestionEditor({ question, onChange, onSave, saving, dirty }: Props) {
  // Debounced autosave
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localOptions, setLocalOptions] = useState<string[]>([]);

  useEffect(() => {
    if (question?.options) {
      setLocalOptions(question.options);
    } else {
      setLocalOptions([]);
    }
  }, [question?.id, question?.options]);

  useEffect(() => {
    if (!dirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void onSave();
    }, 1500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  if (!question) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <FileQuestion className="h-12 w-12 text-muted-foreground/30" />
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">لم يتم اختيار سؤال</h3>
          <p className="max-w-sm text-xs text-muted-foreground">
            اختر سؤالاً من الشريط الجانبي أو اضغط «سؤال جديد» لإنشاء سؤال في هذه الحزمة.
          </p>
        </div>
      </div>
    );
  }

  const typeConfig = QUESTION_TYPES.find((t) => t.value === question.type) || QUESTION_TYPES[3];

  const handleOptionChange = (idx: number, value: string) => {
    const next = [...localOptions];
    next[idx] = value;
    setLocalOptions(next);
    onChange({ options: next });
  };

  const handleAddOption = () => {
    const next = [...localOptions, ""];
    setLocalOptions(next);
    onChange({ options: next });
  };

  const handleRemoveOption = (idx: number) => {
    const next = localOptions.filter((_, i) => i !== idx);
    setLocalOptions(next);
    let nextCorrect: number | undefined = question.correctOptionIndex ?? undefined;
    if (nextCorrect === idx) nextCorrect = undefined;
    else if (nextCorrect !== undefined && nextCorrect > idx) {
      nextCorrect = nextCorrect - 1;
    }
    onChange({ options: next, correctOptionIndex: nextCorrect });
  };

  const handleMarkCorrect = (idx: number) => {
    onChange({ correctOptionIndex: idx });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-card/40 px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">السؤال</span>
          <span className="font-mono text-sm font-bold tabular-nums text-foreground">
            #{(question.order ?? 0) + 1}
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium",
              question.status === "published"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                : question.status === "draft"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-600"
                  : "border-border text-muted-foreground"
            )}
          >
            {question.status === "published" ? "منشور" : question.status === "draft" ? "مسودة" : question.status}
          </span>
        </div>

        {/* Save indicator */}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {saving ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>جارٍ الحفظ…</span>
            </>
          ) : dirty ? (
            <>
              <Circle className="h-2 w-2 fill-amber-500 text-amber-500" />
              <span>غير محفوظ</span>
            </>
          ) : (
            <>
              <Check className="h-3 w-3 text-emerald-500" />
              <span>محفوظ</span>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void onSave()}
            disabled={saving || !dirty}
            className="h-7 gap-1 text-[11px]"
          >
            <Save className="h-3 w-3" />
            حفظ
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Type selector */}
          <div>
            <label className="mb-2 block text-xs font-semibold text-foreground">
              نوع السؤال
            </label>
            <div className="flex flex-wrap gap-1.5">
              {QUESTION_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() =>
                    onChange({
                      type: t.value,
                      // Reset MCQ-specific fields when switching away from MCQ.
                      options: t.needsOptions ? localOptions : [],
                      correctOptionIndex: t.needsOptions ? (question.correctOptionIndex ?? undefined) : undefined,
                    })
                  }
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    question.type === t.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/50"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Question text */}
          <div>
            <label className="mb-2 block text-xs font-semibold text-foreground">
              نص السؤال
            </label>
            <Textarea
              value={question.questionText || ""}
              onChange={(e) => onChange({ questionText: e.target.value })}
              placeholder="اكتب نص السؤال هنا… (يدعم Markdown)"
              dir="rtl"
              rows={4}
              className="resize-y text-sm leading-relaxed"
            />
          </div>

          {/* MCQ Options */}
          {typeConfig.needsOptions && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground">
                  الخيارات
                  <span className="mr-1 text-muted-foreground">
                    ({localOptions.length})
                  </span>
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleAddOption}
                  className="h-7 gap-1 text-[11px]"
                >
                  <Plus className="h-3 w-3" />
                  إضافة خيار
                </Button>
              </div>
              <div className="space-y-2">
                {localOptions.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
                  لا توجد خيارات. اضغط «إضافة خيار» لبدء إضافة الخيارات.
                </p>
              ) : (
                localOptions.map((opt, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors",
                      question.correctOptionIndex === idx
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : "border-border bg-background"
                    )}
                  >
                    <button
                      onClick={() => handleMarkCorrect(idx)}
                      className={cn(
                        "grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[10px] font-bold transition-colors",
                        question.correctOptionIndex === idx
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-border text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-600"
                      )}
                      title="تعيين كإجابة صحيحة"
                    >
                      {question.correctOptionIndex === idx ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        String.fromCharCode(1571 + idx) // أ ب ج د ...
                      )}
                    </button>
                    <Input
                      value={opt}
                      onChange={(e) => handleOptionChange(idx, e.target.value)}
                      placeholder={`الخيار ${idx + 1}`}
                      className="h-8 flex-1 border-0 bg-transparent text-sm shadow-none focus-visible:ring-1"
                      dir="rtl"
                    />
                    <button
                      onClick={() => handleRemoveOption(idx)}
                      className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="حذف الخيار"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))
              )}
              </div>
              {question.type === "mcq" && question.correctOptionIndex === null && localOptions.length > 0 && (
                <p className="mt-2 text-[11px] text-amber-600">
                  ⚠ لم يتم تحديد إجابة صحيحة. اضغط على الدائرة بجانب الخيار الصحيح.
                </p>
              )}
            </div>
          )}

          {/* Answer / Explanation */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-xs font-semibold text-foreground">
                {typeConfig.answerLabel}
              </label>
              <Textarea
                value={question.answerText || ""}
                onChange={(e) => onChange({ answerText: e.target.value })}
                placeholder="الإجابة النموذجية…"
                dir="rtl"
                rows={3}
                className="resize-y text-sm leading-relaxed"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-semibold text-foreground">
                الشرح
              </label>
              <Textarea
                value={question.explanation || ""}
                onChange={(e) => onChange({ explanation: e.target.value })}
                placeholder="شرح الإجابة (يُعرض بعد الإجابة)…"
                dir="rtl"
                rows={3}
                className="resize-y text-sm leading-relaxed"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
