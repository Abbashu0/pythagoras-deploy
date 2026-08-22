"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FilePenLine, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AssetPreview } from "./AssetPreview";
import { formatBytes, formatDate, formatDimensions } from "./format";
import {
  handleExpiredSession,
  MEDIA_KIND_LABELS,
  parseApiResponse,
  type AssetIntegrityResponse,
  type LibraryAsset,
} from "./library-types";
import { AssetProposalDialog } from "./AssetProposalDialog";

interface CanonicalUsage {
  assetId: string;
  banners: Array<{ id: string; title: string }>;
  materials: Array<{ id: string; subjectKey: string; label: string }>;
}

export function AssetDetailsDialog({
  asset,
  onOpenChange,
}: {
  asset: LibraryAsset | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [fetchedDetails, setFetchedDetails] = useState<LibraryAsset | null>(null);
  const [integrityResult, setIntegrityResult] = useState<AssetIntegrityResponse["integrity"] | null>(null);
  const [requestError, setRequestError] = useState<{ assetId: string; message: string } | null>(null);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [usage, setUsage] = useState<CanonicalUsage | null>(null);
  const details = fetchedDetails?.id === asset?.id ? fetchedDetails : asset;
  const integrity = integrityResult?.assetId === asset?.id ? integrityResult : null;
  const error = requestError && requestError.assetId === asset?.id ? requestError.message : null;
  const loading = Boolean(asset) && (!integrity || fetchedDetails?.id !== asset?.id) && !error;

  useEffect(() => {
    if (!asset) return;
    const controller = new AbortController();
    Promise.all([
      fetch(`/api/admin/assets/${asset.id}`, { signal: controller.signal }).then((response) => parseApiResponse<{ ok: true; asset: LibraryAsset; usage: CanonicalUsage }>(response)),
      fetch(`/api/admin/assets/${asset.id}/integrity`, { signal: controller.signal }).then((response) => parseApiResponse<AssetIntegrityResponse>(response)),
    ])
      .then(([detailBody, integrityBody]) => {
        setFetchedDetails(detailBody.asset);
        setUsage(detailBody.usage);
        setIntegrityResult(integrityBody.integrity);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        if (handleExpiredSession(requestError)) return;
        setRequestError({
          assetId: asset.id,
          message: requestError instanceof Error ? requestError.message : "تعذّر تحميل تفاصيل الملف.",
        });
      });
    return () => controller.abort();
  }, [asset]);

  return (
    <Dialog open={Boolean(asset)} onOpenChange={onOpenChange}>
      <DialogContent
        className="!left-auto !right-0 !top-0 h-full !max-w-[min(100%,30rem)] !translate-x-0 !translate-y-0 overflow-hidden rounded-none border-y-0 border-r-0 p-0 sm:!max-w-[30rem]"
        dir="rtl"
      >
        {details && (
          <>
            <DialogHeader className="border-b px-6 py-5 text-right">
              <DialogTitle className="truncate pl-8" dir="auto" title={details.displayName}>{details.displayName}</DialogTitle>
              <DialogDescription>تفاصيل الملف وحالة تخزينه المحلي.</DialogDescription>
            </DialogHeader>
            <div className="admin-scroll h-full overflow-y-auto px-6 pb-28 pt-5">
              <AssetPreview asset={details} className="aspect-[16/10] w-full rounded-2xl border" sizes="480px" />

              <div className="mt-5 flex items-center gap-2" aria-live="polite">
                {loading ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> جارٍ فحص السلامة…</span>
                ) : integrity?.healthy ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> الملف سليم</span>
                ) : integrity ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-destructive/10 px-3 py-1.5 text-[11px] font-semibold text-destructive"><AlertTriangle className="h-3.5 w-3.5" /> {integrityLabel(integrity.status)}</span>
                ) : null}
              </div>
              {error && <p className="mt-3 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">{error}</p>}

              <dl className="mt-5 divide-y rounded-2xl border bg-card px-4">
                <Info label="اسم العرض" value={details.displayName} auto />
                <Info label="اسم الملف الأصلي" value={details.originalFilename} auto />
                <Info label="الفئة" value={MEDIA_KIND_LABELS[details.mediaKind]} />
                <Info label="نوع MIME" value={details.mimeType} />
                <Info label="الحجم" value={formatBytes(details.byteSize)} />
                <Info label="الأبعاد" value={formatDimensions(details.width, details.height)} />
                <Info label="رفعه" value={details.creator.displayName} />
                <Info label="تاريخ الإنشاء" value={formatDate(details.createdAt)} />
                <Info label="آخر تحديث" value={formatDate(details.updatedAt)} />
                <Info label="المراجعة" value={details.revision.toLocaleString("ar-IQ")} />
              </dl>

              {usage && <section className="mt-4 rounded-2xl border bg-card p-4 text-xs"><h3 className="font-bold">الاستخدام في المحتوى القانوني</h3>{usage.banners.length + usage.materials.length === 0 ? <p className="mt-2 text-muted-foreground">غير مستخدم حاليًا.</p> : <ul className="mt-2 space-y-1 text-muted-foreground">{usage.banners.map((item) => <li key={`banner-${item.id}`}>بانر: {item.title}</li>)}{usage.materials.map((item) => <li key={`material-${item.id}`}>مادة: {item.label}</li>)}</ul>}</section>}

              <details className="mt-4 rounded-2xl border bg-card p-4 text-xs">
                <summary className="cursor-pointer font-semibold text-foreground">معلومات تقنية</summary>
                <dl className="mt-4 space-y-3 text-[11px]">
                  <div><dt className="text-muted-foreground">UUID</dt><dd className="mt-1 break-all font-mono text-foreground">{details.id}</dd></div>
                  <div><dt className="text-muted-foreground">SHA-256</dt><dd className="mt-1 break-all font-mono text-foreground">{details.sha256}</dd></div>
                  {integrity && <div><dt className="text-muted-foreground">فحص الحجم</dt><dd className="mt-1 text-foreground">متوقع {formatBytes(integrity.expectedByteSize)} · فعلي {integrity.actualByteSize === null ? "غير متاح" : formatBytes(integrity.actualByteSize)}</dd></div>}
                </dl>
              </details>

              <Button variant="outline" className="mt-5 w-full" onClick={() => setProposalOpen(true)}><FilePenLine className="h-4 w-4" /> اقتراح تعديل البيانات</Button>
              <Button asChild className="mt-2 w-full">
                <a href={`/api/admin/assets/${details.id}/content`} download><Download className="h-4 w-4" /> تنزيل الملف</a>
              </Button>
              <p className="mt-3 flex items-start gap-2 text-[10px] leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> الملفات الخطرة لا تُعرض كصفحة نشطة، ومفتاح التخزين ومساره غير مكشوفين.</p>
            </div>
          </>
        )}
      </DialogContent>
      {details && <AssetProposalDialog asset={details} open={proposalOpen} onOpenChange={setProposalOpen} />}
    </Dialog>
  );
}

function Info({ label, value, auto = false }: { label: string; value: string; auto?: boolean }) {
  return <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-3"><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="truncate text-xs font-medium text-foreground" dir={auto ? "auto" : undefined} title={value}>{value}</dd></div>;
}

function integrityLabel(status: AssetIntegrityResponse["integrity"]["status"]): string {
  if (status === "missing") return "الملف مفقود من التخزين";
  if (status === "size-mismatch") return "حجم الملف لا يطابق السجل";
  if (status === "hash-mismatch") return "بصمة الملف لا تطابق السجل";
  return "الملف سليم";
}
