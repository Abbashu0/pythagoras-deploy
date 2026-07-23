"use client";

/**
 * Package Workspace — /admin/content/[id]
 *
 * The full-screen editor for a single package and its questions.
 *
 * Layout (3 columns):
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Header: package name + status + actions                    │
 *   ├──────────┬─────────────────────────────────────┬────────────┤
 *   │ Question │       Question Editor               │  Inspector │
 *   │   List   │   (text / type / options / answer)  │  (status,  │
 *   │ (sidebar)│                                     │  tags, …)  │
 *   └──────────┴─────────────────────────────────────┴────────────┘
 *
 * Behavior:
 *   - Load package + questions on mount
 *   - Select a question to edit
 *   - Add / reorder / delete questions
 *   - Autosave changes (debounced) + manual save
 *   - Update package status (draft → ready → published)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowRight,
  Loader2,
  Plus,
  Rocket,
  CheckCircle2,
  Archive,
  Trash2,
  Settings2,
  FileQuestion,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { QuestionList } from "@/components/admin/QuestionList";
import { QuestionEditor } from "@/components/admin/QuestionEditor";
import { QuestionInspector } from "@/components/admin/QuestionInspector";
import type { Package as PackageType, Question, Tag, Subject, Section, Topic } from "@/lib/entities";

interface PackageDetails {
  package: PackageType;
  subject: Subject | null;
  sections: Section[];
  topics: Topic[];
  questionsCount: number;
}

export default function PackageWorkspacePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [details, setDetails] = useState<PackageDetails | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dirtySnapshot, setDirtySnapshot] = useState<string>("");

  // ---- Data fetching ----

  const fetchDetails = useCallback(async () => {
    try {
      const res = await fetch(`/api/packages/${params.id}`, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) {
          toast({ title: "الحزمة غير موجودة", variant: "destructive" });
          router.push("/admin/content");
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setDetails(data);
    } catch (e) {
      console.error("[workspace] fetch details failed:", e);
      toast({ title: "فشل تحميل الحزمة", variant: "destructive" });
    }
  }, [params.id, router, toast]);

  const fetchQuestions = useCallback(async () => {
    try {
      const res = await fetch(`/api/questions?packageId=${params.id}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setQuestions(data.questions || []);
        // Auto-select first question if nothing selected.
        if (!selectedId && data.questions?.length > 0) {
          setSelectedId(data.questions[0].id);
        }
      }
    } catch (e) {
      console.error("[workspace] fetch questions failed:", e);
    } finally {
      setLoading(false);
    }
  }, [params.id, selectedId]);

  const fetchTags = useCallback(async () => {
    try {
      // Use the registries?name=subjects pattern but for tags we need a dedicated endpoint.
      // For v1 we'll just GET /api/subjects and ignore — tags will be added later.
      // TODO: add /api/tags endpoint
      setTags([]);
    } catch (e) {
      console.error("[workspace] fetch tags failed:", e);
    }
  }, []);

  useEffect(() => {
    void fetchDetails();
    void fetchQuestions();
    void fetchTags();
  }, [fetchDetails, fetchQuestions, fetchTags]);

  // ---- Selected question ----

  const selectedQuestion = questions.find((q) => q.id === selectedId) || null;

  // ---- Dirty tracking ----
  // When the user edits the selected question, we keep a snapshot of the
  // original to compare against, so we know when there are unsaved changes.

  const originalRef = useRef<string>("");
  useEffect(() => {
    if (selectedQuestion) {
      const snap = JSON.stringify(selectedQuestion);
      originalRef.current = snap;
      setDirtySnapshot(snap);
      setDirty(false);
    } else {
      originalRef.current = "";
      setDirty(false);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Handlers ----

  const handleQuestionChange = (updates: Partial<Question>) => {
    if (!selectedQuestion) return;
    const next = questions.map((q) =>
      q.id === selectedQuestion.id ? { ...q, ...updates } : q
    );
    setQuestions(next);
    // Compute dirty by comparing to the original snapshot.
    const updated = next.find((q) => q.id === selectedQuestion.id);
    if (updated) {
      const isDirty = JSON.stringify(updated) !== originalRef.current;
      setDirty(isDirty);
    }
  };

  const handleSave = async () => {
    if (!selectedQuestion || !dirty) return;
    setSaving(true);
    try {
      const res = await fetch("/api/questions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selectedQuestion, id: selectedQuestion.id }),
      });
      if (res.ok) {
        const data = await res.json();
        // Update the snapshot so the question is no longer dirty.
        originalRef.current = JSON.stringify(data.question);
        setDirtySnapshot(originalRef.current);
        setDirty(false);
        // Replace in list with the saved version (server might have updated timestamps).
        setQuestions((prev) =>
          prev.map((q) => (q.id === data.question.id ? data.question : q))
        );
      } else {
        toast({ title: "فشل الحفظ", variant: "destructive" });
      }
    } catch (e) {
      console.error("[workspace] save failed:", e);
      toast({ title: "فشل الحفظ", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleAddQuestion = async () => {
    if (!details) return;
    setSaving(true);
    try {
      const res = await fetch("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId: details.package.id,
          questionText: "سؤال جديد",
          type: "short-answer",
          answerText: "",
          difficulty: "medium",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setQuestions((prev) => [...prev, data.question]);
        setSelectedId(data.question.id);
        toast({ title: "تم إنشاء السؤال" });
      } else {
        toast({ title: "فشل إنشاء السؤال", variant: "destructive" });
      }
    } catch (e) {
      console.error("[workspace] add failed:", e);
      toast({ title: "فشل إنشاء السؤال", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleReorder = async (id: string, direction: "up" | "down") => {
    const idx = questions.findIndex((q) => q.id === id);
    if (idx === -1) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= questions.length) return;

    // Optimistic swap.
    const next = [...questions];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    // Update local order fields.
    next.forEach((q, i) => (q.order = i));
    setQuestions(next);

    // Persist the new order to the server.
    try {
      await fetch("/api/questions?reorder=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId: details?.package.id,
          orderedIds: next.map((q) => q.id),
        }),
      });
    } catch (e) {
      console.error("[workspace] reorder failed:", e);
      // Revert on failure.
      void fetchQuestions();
    }
  };

  const handleDeleteQuestion = async (id: string) => {
    try {
      const res = await fetch(`/api/questions?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        const remaining = questions.filter((q) => q.id !== id);
        setQuestions(remaining);
        if (selectedId === id) {
          setSelectedId(remaining[0]?.id || null);
        }
        toast({ title: "تم حذف السؤال" });
      } else {
        toast({ title: "فشل الحذف", variant: "destructive" });
      }
    } catch (e) {
      console.error("[workspace] delete failed:", e);
      toast({ title: "فشل الحذف", variant: "destructive" });
    }
  };

  const handlePublishPackage = async () => {
    if (!details) return;
    try {
      const res = await fetch("/api/packages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: details.package.id,
          status: "published",
          visible: true,
          publishedAt: new Date().toISOString(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDetails((prev) =>
          prev ? { ...prev, package: data.package } : prev
        );
        toast({
          title: "تم النشر",
          description: `نُشرت «${data.package.name}» وأصبحت ظاهرة للطلاب.`,
        });
      }
    } catch (e) {
      console.error("[workspace] publish failed:", e);
      toast({ title: "فشل النشر", variant: "destructive" });
    }
  };

  const handleArchivePackage = async () => {
    if (!details) return;
    if (!confirm(`أرشفة «${details.package.name}»؟`)) return;
    try {
      const res = await fetch("/api/packages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: details.package.id, status: "archived" }),
      });
      if (res.ok) {
        toast({ title: "تمت الأرشفة" });
        router.push("/admin/content");
      }
    } catch (e) {
      console.error("[workspace] archive failed:", e);
      toast({ title: "فشلت الأرشفة", variant: "destructive" });
    }
  };

  const handleDeletePackage = async () => {
    if (!details) return;
    if (!confirm(`حذف «${details.package.name}» نهائياً؟ سيتم حذف جميع الأسئلة المرتبطة.`)) return;
    try {
      const res = await fetch(`/api/packages/${details.package.id}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "تم الحذف" });
        router.push("/admin/content");
      }
    } catch (e) {
      console.error("[workspace] delete package failed:", e);
      toast({ title: "فشل الحذف", variant: "destructive" });
    }
  };

  // ---- Render ----

  if (loading || !details) {
    return (
      <div className="grid h-screen place-items-center gap-3 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">جارٍ تحميل الحزمة…</p>
      </div>
    );
  }

  const pkg = details.package;
  const isPublished = pkg.status === "published";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 border-b border-border bg-card/60 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/admin/content")}
            className="gap-1 text-xs"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            رجوع
          </Button>
          <div
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white"
            style={{ backgroundColor: pkg.color || "#6366f1" }}
          >
            <FileQuestion className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold text-foreground">{pkg.name}</h1>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{details.subject?.name || "بدون مادة"}</span>
              <span className="text-muted-foreground/40">•</span>
              <span>{questions.length} سؤال</span>
              <span className="text-muted-foreground/40">•</span>
              <span className="font-mono">
                v{pkg.version} • {pkg.schemaVersion}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleArchivePackage}
            className="gap-1 text-xs"
          >
            <Archive className="h-3.5 w-3.5" />
            أرشفة
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDeletePackage}
            className="gap-1 text-xs text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            حذف
          </Button>
          <Button
            size="sm"
            onClick={handlePublishPackage}
            disabled={isPublished || questions.length === 0}
            className="gap-1.5 text-xs"
          >
            {isPublished ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                منشور
              </>
            ) : (
              <>
                <Rocket className="h-3.5 w-3.5" />
                نشر الحزمة
              </>
            )}
          </Button>
        </div>
      </header>

      {/* 3-column workspace */}
      <div className="flex flex-1 overflow-hidden" dir="rtl">
        {/* Right: Inspector (in RTL, it appears on the right) */}
        <QuestionInspector
          question={selectedQuestion}
          availableTags={tags}
          onChange={handleQuestionChange}
        />

        {/* Center: Editor */}
        <QuestionEditor
          question={selectedQuestion}
          onChange={handleQuestionChange}
          onSave={handleSave}
          saving={saving}
          dirty={dirty}
        />

        {/* Left: Questions list (in RTL, it appears on the left) */}
        <QuestionList
          questions={questions}
          selectedId={selectedId}
          loading={saving}
          onSelect={setSelectedId}
          onAdd={handleAddQuestion}
          onReorder={handleReorder}
          onDelete={handleDeleteQuestion}
        />
      </div>
    </div>
  );
}
