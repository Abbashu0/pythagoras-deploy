"use client";

import { useRef, useState } from "react";
import { CheckCircle2, CopyCheck, FileUp, Loader2, RefreshCw, UploadCloud, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatBytes } from "./format";
import {
  handleExpiredSession,
  LibraryApiError,
  parseApiResponse,
  type LibraryAsset,
} from "./library-types";

type UploadStatus = "queued" | "uploading" | "complete" | "reused" | "failed";

interface UploadEntry {
  id: string;
  file: File;
  status: UploadStatus;
  error?: string;
  asset?: LibraryAsset;
}

interface UploadResponse {
  ok: true;
  asset: LibraryAsset;
  reused: boolean;
}

const STATUS_LABELS: Record<UploadStatus, string> = {
  queued: "بانتظار الرفع",
  uploading: "جارٍ الرفع",
  complete: "تم الرفع",
  reused: "موجود مسبقًا — أُعيد استخدامه",
  failed: "فشل الرفع",
};

export function AssetUploadDialog({
  open,
  onOpenChange,
  onCompleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<UploadEntry[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);

  const addFiles = (files: FileList | File[]) => {
    const added = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: "queued" as const,
    }));
    if (added.length === 0) return;
    setQueue((current) => [
      ...current.filter((item) => item.status === "queued" || item.status === "uploading" || item.status === "failed"),
      ...added,
    ]);
    setDisplayName("");
  };

  const updateEntry = (id: string, update: Partial<UploadEntry>) => {
    setQueue((current) => current.map((item) => item.id === id ? { ...item, ...update } : item));
  };

  const uploadOne = async (entry: UploadEntry, singleDisplayName?: string): Promise<boolean> => {
    updateEntry(entry.id, { status: "uploading", error: undefined });
    try {
      const form = new FormData();
      form.set("file", entry.file);
      if (singleDisplayName?.trim()) form.set("displayName", singleDisplayName.trim());
      const response = await fetch("/api/admin/assets", { method: "POST", body: form });
      const body = await parseApiResponse<UploadResponse>(response);
      updateEntry(entry.id, {
        status: body.reused ? "reused" : "complete",
        asset: body.asset,
      });
      return true;
    } catch (error) {
      if (handleExpiredSession(error)) return false;
      const message = error instanceof Error ? error.message : "تعذّر رفع الملف بسبب خطأ غير متوقع.";
      updateEntry(entry.id, { status: "failed", error: message });
      return false;
    }
  };

  const runEntries = async (entries: UploadEntry[]) => {
    if (entries.length === 0 || running) return;
    setRunning(true);
    let cursor = 0;
    let successCount = 0;
    const singleName = entries.length === 1 ? displayName : undefined;
    const workers = Array.from({ length: Math.min(3, entries.length) }, async () => {
      while (cursor < entries.length) {
        const entry = entries[cursor++];
        if (await uploadOne(entry, singleName)) successCount += 1;
      }
    });
    await Promise.all(workers);
    setRunning(false);
    if (successCount > 0) onCompleted();
  };

  const retry = async (entry: UploadEntry) => {
    if (running) return;
    setRunning(true);
    const succeeded = await uploadOne(entry, queue.length === 1 ? displayName : undefined);
    setRunning(false);
    if (succeeded) onCompleted();
  };

  const pending = queue.filter((item) => item.status === "queued" || item.status === "failed");

  return (
    <Dialog open={open} onOpenChange={(next) => !running && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-2xl" dir="rtl">
        <DialogHeader className="border-b px-6 py-5 text-right">
          <DialogTitle className="flex items-center gap-2"><UploadCloud className="h-5 w-5 text-primary" /> رفع ملفات جديدة</DialogTitle>
          <DialogDescription>تُحفظ الملفات في مكتبة المحتوى المحلية الدائمة، مع منع تكرار البايتات المتطابقة.</DialogDescription>
        </DialogHeader>

        <div className="admin-scroll max-h-[calc(90vh-170px)] space-y-4 overflow-y-auto px-6 py-5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              addFiles(event.dataTransfer.files);
            }}
            className={cn(
              "grid min-h-40 w-full place-items-center rounded-2xl border-2 border-dashed p-6 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              dragging ? "border-primary bg-primary/10" : "border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/35",
            )}
          >
            <span>
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"><FileUp className="h-6 w-6" /></span>
              <span className="mt-3 block text-sm font-bold text-foreground">اسحب الملفات هنا أو اضغط للاختيار</span>
              <span className="mt-1 block text-[11px] text-muted-foreground">يمكن تحديد عدة ملفات، وستُرفع ثلاثة ملفات كحد أقصى في الوقت نفسه.</span>
            </span>
          </button>
          <input ref={inputRef} type="file" multiple className="sr-only" onChange={(event) => event.target.files && addFiles(event.target.files)} />

          {queue.length === 1 && queue[0].status !== "uploading" && (
            <label className="block space-y-2">
              <span className="text-xs font-semibold text-foreground">اسم العرض (اختياري)</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={255}
                placeholder={queue[0].file.name}
                className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                dir="auto"
              />
            </label>
          )}

          {queue.length > 0 && (
            <div className="space-y-2" aria-live="polite">
              {queue.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                  <StatusIcon status={entry.status} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-foreground" dir="auto" title={entry.file.name}>{entry.file.name}</div>
                    <div className={cn("mt-1 text-[10px]", entry.status === "failed" ? "text-destructive" : "text-muted-foreground")}>{entry.error ?? `${STATUS_LABELS[entry.status]} · ${formatBytes(entry.file.size)}`}</div>
                  </div>
                  {entry.status === "failed" && (
                    <Button size="sm" variant="outline" onClick={() => retry(entry)} disabled={running} aria-label={`إعادة رفع ${entry.file.name}`}><RefreshCw className="h-3.5 w-3.5" /> إعادة</Button>
                  )}
                  {entry.status === "queued" && !running && (
                    <button type="button" onClick={() => setQueue((current) => current.filter((item) => item.id !== entry.id))} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`إزالة ${entry.file.name}`}><X className="h-4 w-4" /></button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="border-t px-6 py-4 sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={running}>إغلاق</Button>
          <Button onClick={() => runEntries(pending)} disabled={pending.length === 0 || running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {running ? "جارٍ الرفع…" : `رفع ${pending.length ? pending.length.toLocaleString("ar-IQ") : ""} ${pending.length === 1 ? "ملف" : "ملفات"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusIcon({ status }: { status: UploadStatus }) {
  if (status === "uploading") return <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-primary" />;
  if (status === "complete") return <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-500" />;
  if (status === "reused") return <CopyCheck className="h-5 w-5 flex-shrink-0 text-sky-500" />;
  if (status === "failed") return <XCircle className="h-5 w-5 flex-shrink-0 text-destructive" />;
  return <FileUp className="h-5 w-5 flex-shrink-0 text-muted-foreground" />;
}
