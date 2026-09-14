"use client";

import * as React from "react";
import { Archive, FileUp } from "lucide-react";

import {
  AssetGrid,
  AssetInspector,
  AssetIntegritySummary,
  AssetList,
  AssetViewToggle,
  UploadZone,
  type Asset,
  type UploadItem,
} from "@/components/admin-ui/domain/content/assets";
import {
  DependencyList,
  DeleteDialog,
} from "@/components/admin-ui/governance/destructive";
import {
  EmptyState,
  ErrorState,
} from "@/components/admin-ui/feedback/empty-state";
import { InlineNote } from "@/components/admin-ui/feedback/banner";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/admin-ui/overlays/dialog";
import { Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader } from "@/components/admin-ui/overlays/drawer";
import { FormField } from "@/components/admin-ui/forms/field";
import { SearchInput } from "@/components/admin-ui/forms/input";
import {
  PageHeader,
  PageShell,
  Section,
  Toolbar,
  ToolbarSpacer,
  TwoColumnLayout,
} from "@/components/admin-ui/layout/page";
import { Button } from "@/components/admin-ui/primitives/button";
import { Panel, PanelBody, PanelHeader } from "@/components/admin-ui/primitives/surface";
import { Skeleton } from "@/components/admin-ui/primitives/skeleton";
import { Badge } from "@/components/admin-ui/status/status-badge";
import { StatusBadge } from "@/components/admin-ui/status/status-badge";
import { QuickFilterGroup } from "@/components/admin-ui/tables/filters";
import { toast } from "@/components/admin-ui/feedback/toaster";
import { formatBytes } from "@/lib/format";

type AssetKind = Asset["kind"];
type ApiInspection = {
  status: "GENERIC_JSON" | "VALID" | "VALID_WITH_WARNINGS" | "INVALID" | "UNSUPPORTED_VERSION";
  format: string | null;
  schemaVersion: string | null;
  packageId: string | null;
  packageKey: string | null;
  title: string | null;
  subjectKey: string | null;
  questionCount: number;
  variantCount: number;
  errorCount: number;
  warningCount: number;
  diagnostics: Array<{ severity: "ERROR" | "WARNING" | "INFO"; code: string; message: string; jsonPointer: string }>;
  inspectedAt: number;
};

type ApiPreflight = {
  status: ApiInspection["status"];
  operation: "CREATE" | "UPDATE";
  eligible: boolean;
  acknowledgementRequired: boolean;
  alreadyImported: boolean;
  update: { contentRevision: { from: number; to: number } } | null;
  package: {
    id: string;
    key: string;
    title: string;
    subjectKey: string;
    language: string;
    schemaVersion: string;
    contentRevision: number;
    bankBrowseMode: "ALL_PACKAGE_QUESTIONS" | "TREE";
    bankBrowseEntry: { key: string; label: string; order: number };
  } | null;
  counts: {
    taxonomy: number;
    browseNodes: number;
    questions: number;
    variants: number;
    occurrences: number;
    manifestAssets: number;
    usedAssets: number;
    resolvedAssets: number;
    unresolvedAssets: number;
    estimatedChangeItems: number;
  };
  warnings: ApiInspection["diagnostics"];
  blockers: Array<{ code: string; message: string; entityId?: string }>;
};

type AdminAsset = Asset & {
  revision: number;
  questionPackageInspection: ApiInspection | null;
  questionPackagePreflight?: ApiPreflight | null;
};

type ApiAsset = {
  id: string;
  name: string;
  kind: AssetKind;
  mimeType: string;
  sizeBytes: number;
  previewUrl: string | null;
  width?: number;
  height?: number;
  referenceCount: number;
  references: NonNullable<Asset["references"]>;
  integrity: Asset["integrity"];
  integrityDetail?: string;
  tags: string[];
  uploadedAt: number;
  uploadedBy?: string;
  revision: number;
  questionPackageInspection?: ApiInspection | null;
};

type AssetStats = {
  totalCount: number;
  totalBytes: number;
  byMediaKind: Record<AssetKind, number>;
  missing: number;
  processing: number;
  unused: number;
};

type UploadResult = { asset: AdminAsset; reused: boolean };

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const UPLOAD_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/*",
  "audio/*",
  "application/pdf",
  "application/json",
  "text/plain",
].join(",");

const ASSET_FILTERS: Array<{ value: AssetKind; label: string }> = [
  { value: "image", label: "صور" },
  { value: "video", label: "فيديو" },
  { value: "audio", label: "صوت" },
  { value: "document", label: "مستندات" },
  { value: "json", label: "JSON" },
  { value: "other-safe-file", label: "ملفات أخرى" },
];

function toAsset(value: ApiAsset): AdminAsset {
  return {
    ...value,
    storageKey: value.id,
    questionPackageInspection: value.questionPackageInspection ?? null,
  };
}

function inspectionStatus(inspection: ApiInspection): { status: "active" | "warning" | "failed" | "notConfigured" | "unknown"; label: string } {
  switch (inspection.status) {
    case "VALID": return { status: "active", label: "صالحة" };
    case "VALID_WITH_WARNINGS": return { status: "warning", label: "صالحة مع تحذيرات" };
    case "INVALID": return { status: "failed", label: "غير صالحة" };
    case "UNSUPPORTED_VERSION": return { status: "notConfigured", label: "إصدار غير مدعوم" };
    default: return { status: "unknown", label: "JSON عام" };
  }
}

function PackageInspectionPanel({ inspection }: { inspection: ApiInspection }) {
  const state = inspectionStatus(inspection);
  if (inspection.status === "GENERIC_JSON") {
    return (
      <Panel>
        <PanelHeader title="تعرف الملف" description="هذا ملف JSON عام، وليس حزمة أسئلة Pythagoras." density="compact" />
      </Panel>
    );
  }
  const errors = inspection.diagnostics.filter((item) => item.severity === "ERROR");
  const warnings = inspection.diagnostics.filter((item) => item.severity === "WARNING");
  return (
    <Panel>
      <PanelHeader
        title="حزمة أسئلة"
        description="نتيجة الفحص البنيوي والدلالي من validator الحالي."
        density="compact"
        actions={<StatusBadge status={state.status} label={state.label} size="sm" />}
      />
      <PanelBody>
        {inspection.title ? <p className="text-sm font-medium text-fg">{inspection.title}</p> : null}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-fg-secondary">
          <span>المادة: <b className="text-fg">{inspection.subjectKey ?? "—"}</b></span>
          <span>الإصدار: <b className="text-fg" dir="ltr">{inspection.schemaVersion ?? "—"}</b></span>
          <span>الأسئلة: <b className="text-fg tnum">{inspection.questionCount}</b></span>
          <span>الصيغ: <b className="text-fg tnum">{inspection.variantCount}</b></span>
        </div>
        {errors.length ? <InlineNote tone="danger" size="xs" className="mt-3">{errors.length} مانع يمنع الاستيراد الآمن.</InlineNote> : null}
        {warnings.length ? <InlineNote tone="warning" size="xs" className="mt-2">{warnings.length} تحذير يحتاج مراجعة قبل التطبيق.</InlineNote> : null}
        {inspection.packageKey ? <p className="mt-3 text-2xs text-fg-quaternary" dir="ltr">{inspection.packageKey}</p> : null}
      </PanelBody>
    </Panel>
  );
}

function PackagePreflightDetails({ preflight }: { preflight: ApiPreflight }) {
  if (!preflight.package) return null;
  const { counts } = preflight;
  return (
    <Panel>
      <PanelHeader
        title="جاهزية الحزمة"
        description="بيانات الاستيراد المحسوبة من المصدر الحالي."
        density="compact"
      />
      <PanelBody>
        <div className="grid grid-cols-2 gap-2 text-xs text-fg-secondary">
          <span>الإصدار المنطقي: <b className="text-fg tnum">{preflight.package.contentRevision}</b></span>
          <span>التصنيفات: <b className="text-fg tnum">{counts.taxonomy}</b></span>
          <span>الورود: <b className="text-fg tnum">{counts.occurrences}</b></span>
          <span>الأصول المحلولة: <b className="text-fg tnum">{counts.resolvedAssets}/{counts.manifestAssets}</b></span>
        </div>
        {counts.unresolvedAssets > 0 ? <InlineNote tone="danger" size="xs" className="mt-3">هناك أصول مطلوبة لم تُحل بصمتها بعد.</InlineNote> : null}
        {preflight.blockers.length > 0 ? <InlineNote tone="danger" size="xs" className="mt-2">{preflight.blockers.length} مانع يمنع التطبيق المباشر.</InlineNote> : null}
        {preflight.warnings.length > 0 ? <InlineNote tone="warning" size="xs" className="mt-2">{preflight.warnings.length} تحذير يحتاج تأكيدًا صريحًا.</InlineNote> : null}
      </PanelBody>
    </Panel>
  );
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as
    | { code?: string }
    | null;
  if (!response.ok) throw new Error(payload?.code ?? "REQUEST_FAILED");
  return payload as T;
}

function errorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case "ASSET_CONFLICT":
      return "لا يمكن تنفيذ العملية؛ تغيّر الملف أو ما زال مرتبطًا بمحتوى.";
    case "ASSET_NOT_FOUND":
      return "لم يعد الملف موجودًا. حدّث القائمة وحاول مجددًا.";
    case "ASSET_TOO_LARGE":
      return "حجم الملف يتجاوز الحد المسموح.";
    case "ASSET_UNSUPPORTED_TYPE":
      return "نوع الملف غير مدعوم.";
    case "ASSET_INTEGRITY_FAILED":
      return "تعذّر التحقق من سلامة الملف.";
    case "ASSET_STORAGE_UNAVAILABLE":
      return "وحدة التخزين غير متاحة حاليًا.";
    default:
      return "تعذّرت العملية. تحقّق من البيانات وحاول مجددًا.";
  }
}

function initialStats(): AssetStats {
  return {
    totalCount: 0,
    totalBytes: 0,
    byMediaKind: {
      image: 0,
      video: 0,
      audio: 0,
      document: 0,
      json: 0,
      "other-safe-file": 0,
    },
    missing: 0,
    processing: 0,
    unused: 0,
  };
}

export default function AdminStoragePage() {
  const [assets, setAssets] = React.useState<AdminAsset[]>([]);
  const [matchingCount, setMatchingCount] = React.useState(0);
  const [stats, setStats] = React.useState<AssetStats>(initialStats);
  const [query, setQuery] = React.useState("");
  const [kind, setKind] = React.useState<AssetKind | null>(null);
  const [view, setView] = React.useState<"grid" | "list">("grid");
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [activePreflight, setActivePreflight] = React.useState<ApiPreflight | null>(null);
  const [referencesTarget, setReferencesTarget] = React.useState<AdminAsset | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<AdminAsset | null>(null);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [uploads, setUploads] = React.useState<UploadItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const uploadFiles = React.useRef(new Map<string, File>());

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams({ limit: "200", sort: "newest" });
      if (query.trim()) queryParams.set("q", query.trim());
      if (kind) queryParams.set("mediaKind", kind);
      const [assetResponse, statsResponse] = await Promise.all([
        requestJson<{ items: ApiAsset[]; total: number }>(`/api/admin/local/assets?${queryParams}`),
        requestJson<{ stats: AssetStats }>("/api/admin/local/assets/stats"),
      ]);
      setAssets(assetResponse.items.map(toAsset));
      setMatchingCount(assetResponse.total);
      setStats(statsResponse.stats);
      setLoaded(true);
    } catch (cause) {
      setError(errorMessage(cause));
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [kind, query]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeAsset = assets.find((asset) => asset.id === activeId) ?? null;

  React.useEffect(() => {
    if (activeId && !activeAsset) {
      setActiveId(null);
      setActivePreflight(null);
    }
  }, [activeAsset, activeId]);

  React.useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    void requestJson<{
      asset: ApiAsset;
      integrity: { ok: boolean; status: string };
      questionPackagePreflight?: ApiPreflight | null;
    }>(`/api/admin/local/assets/${encodeURIComponent(activeId)}`)
      .then((response) => {
        if (cancelled) return;
        const next = toAsset(response.asset);
        if (!response.integrity.ok) {
          next.integrity = response.integrity.status === "missing" ? "missing" : "failed";
          next.integrityDetail = "تعذّر التحقق من تطابق ملف التخزين مع بصمته المسجلة.";
        }
        setAssets((current) =>
          current.map((asset) => (asset.id === next.id ? next : asset)),
        );
        setActivePreflight(response.questionPackagePreflight ?? null);
      })
      .catch(() => {
        // The list remains usable when an on-demand integrity read is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const replaceAsset = (next: AdminAsset) => {
    setAssets((current) =>
      current.map((asset) => (asset.id === next.id ? next : asset)),
    );
    if (referencesTarget?.id === next.id) setReferencesTarget(next);
    if (deleteTarget?.id === next.id) setDeleteTarget(next);
  };

  const downloadAsset = (asset: Asset) => {
    const link = document.createElement("a");
    link.href = `/api/admin/local/assets/${encodeURIComponent(asset.id)}/content?download=1`;
    link.download = asset.name;
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const renameAsset = async (asset: AdminAsset, name: string) => {
    try {
      const response = await requestJson<{ asset: ApiAsset }>(
        `/api/admin/local/assets/${encodeURIComponent(asset.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ displayName: name, expectedRevision: asset.revision }),
        },
      );
      replaceAsset(toAsset(response.asset));
      toast.success("تم تحديث اسم الملف.");
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };

  const updateUpload = (id: string, patch: Partial<UploadItem>) => {
    setUploads((current) =>
      current.map((upload) => (upload.id === id ? { ...upload, ...patch } : upload)),
    );
  };

  const uploadOne = (id: string, file: File) => {
    updateUpload(id, { state: "uploading", progress: 0, error: undefined });
    return new Promise<UploadResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/admin/local/assets");
      xhr.setRequestHeader("Accept", "application/json");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          updateUpload(id, {
            progress: Math.round((event.loaded / event.total) * 100),
          });
        }
      };
      xhr.onerror = () => reject(new Error("ASSET_UPLOAD_FAILED"));
      xhr.onload = () => {
        let payload: { asset?: ApiAsset; reused?: boolean; code?: string } | null = null;
        try {
          payload = JSON.parse(xhr.responseText || "null") as
            | { asset?: ApiAsset; reused?: boolean; code?: string }
            | null;
        } catch {
          payload = null;
        }
        if (xhr.status < 200 || xhr.status >= 300 || !payload?.asset) {
          reject(new Error(payload?.code ?? "ASSET_UPLOAD_FAILED"));
          return;
        }
        resolve({ asset: toAsset(payload.asset), reused: payload.reused === true });
      };
      const form = new FormData();
      form.append("file", file, file.name);
      xhr.send(form);
    });
  };

  const startUpload = async (id: string) => {
    const file = uploadFiles.current.get(id);
    if (!file) return;
    try {
      const result = await uploadOne(id, file);
      if (!result.reused) await refresh();
      updateUpload(id, { state: "done", progress: 100 });
      uploadFiles.current.delete(id);
      toast.success("تم رفع الملف.");
    } catch (cause) {
      updateUpload(id, { state: "failed", error: errorMessage(cause) });
    }
  };

  const uploadFilesFromDrop = (files: File[]) => {
    const entries = files.map((file) => {
      const id = crypto.randomUUID();
      if (file.size <= MAX_UPLOAD_BYTES) uploadFiles.current.set(id, file);
      return {
        id,
        name: file.name,
        sizeBytes: file.size,
        progress: 0,
        state: file.size <= MAX_UPLOAD_BYTES ? ("queued" as const) : ("failed" as const),
        ...(file.size > MAX_UPLOAD_BYTES ? { error: "حجم الملف يتجاوز 100 MB." } : {}),
      };
    });
    setUploads((current) => [...current, ...entries]);
    const queue = entries.filter((entry) => entry.state === "queued");
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const entry = queue[cursor++];
        await startUpload(entry.id);
      }
    };
    void Promise.all(Array.from({ length: Math.min(2, queue.length) }, () => worker()));
  };

  const removeUpload = (id: string) => {
    uploadFiles.current.delete(id);
    setUploads((current) => current.filter((upload) => upload.id !== id));
  };

  const deleteAsset = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await requestJson<{ deleted: true }>(
        `/api/admin/local/assets/${encodeURIComponent(deleteTarget.id)}`,
        {
          method: "DELETE",
          body: JSON.stringify({ expectedRevision: deleteTarget.revision }),
        },
      );
      setAssets((current) => current.filter((asset) => asset.id !== deleteTarget.id));
      setStats((current) => ({
        ...current,
        totalCount: Math.max(0, current.totalCount - 1),
        totalBytes: Math.max(0, current.totalBytes - deleteTarget.sizeBytes),
        byMediaKind: {
          ...current.byMediaKind,
          [deleteTarget.kind]: Math.max(0, current.byMediaKind[deleteTarget.kind] - 1),
        },
        unused: Math.max(0, current.unused - 1),
      }));
      setDeleteTarget(null);
      setActiveId(null);
      setActivePreflight(null);
      toast.success("تم حذف الملف.");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <PageShell width="wide">
        <PageHeader
          eyebrow="إدارة المحتوى"
          title="مخزن صفحة الأدمن"
          description="مكتبة الملفات المستخدمة داخل منصة فيثاغورس، مع فحص السلامة ومعرفة أماكن الاستخدام."
          icon={<Archive className="size-5 text-fg-tertiary" aria-hidden />}
          status={
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="subtle" tone="neutral">{stats.totalCount} ملف</Badge>
              <Badge variant="subtle" tone="neutral">{formatBytes(stats.totalBytes)}</Badge>
            </div>
          }
          actions={
            <Button variant="primary" icon={<FileUp aria-hidden />} onClick={() => setUploadOpen(true)}>
              رفع ملفات
            </Button>
          }
        />

        <div className="pb-24">
          <AssetIntegritySummary
            total={stats.totalCount}
            missing={stats.missing}
            processing={stats.processing}
            unused={stats.unused}
            className="mt-7"
          />

          <TwoColumnLayout
            asideWidth="lg"
            asidePosition="end"
            stickyAside
            className="mt-7 lg:[&>aside]:w-[360px]"
            aside={
              activeAsset ? (
                <div className="space-y-4">
                  <AssetInspector
                    asset={activeAsset}
                    onRename={(name) => void renameAsset(activeAsset, name)}
                    onDownload={() => downloadAsset(activeAsset)}
                    onDelete={() => setDeleteTarget(activeAsset)}
                    onViewReferences={() => setReferencesTarget(activeAsset)}
                  />
                  {activeAsset.questionPackageInspection ? (
                    <PackageInspectionPanel inspection={activeAsset.questionPackageInspection} />
                  ) : null}
                  {activePreflight ? <PackagePreflightDetails preflight={activePreflight} /> : null}
                </div>
              ) : (
                <EmptyState
                  kind="noData"
                  size="sm"
                  bordered
                  title="اختر ملفًا"
                  description="ستظهر هنا المعاينة والبيانات والمراجع عند اختيار ملف من المكتبة."
                />
              )
            }
          >
            <Section
              title="الملفات"
              description="بيانات حقيقية من مخزن الملفات المحلي، مرتبة بالأحدث."
              spacing="none"
              divided
              actions={
                <Button size="sm" variant="secondary" icon={<FileUp aria-hidden />} onClick={() => setUploadOpen(true)}>
                  رفع ملف
                </Button>
              }
            >
              <Toolbar density="compact" className="gap-2">
                <SearchInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onClear={() => setQuery("")}
                  placeholder="ابحث باسم الملف"
                  resultCount={loaded ? matchingCount : null}
                  className="min-w-[220px] flex-1 sm:max-w-sm"
                />
                <ToolbarSpacer />
                <AssetViewToggle value={view} onValueChange={setView} />
              </Toolbar>

              <div className="border-b border-border py-2">
                <QuickFilterGroup
                  options={ASSET_FILTERS.map((option) => ({
                    ...option,
                    count: stats.byMediaKind[option.value],
                  }))}
                  value={kind}
                  onValueChange={(value) => setKind(value as AssetKind | null)}
                />
              </div>

              {loading && !loaded ? (
                <div className="grid grid-cols-2 gap-3 py-5 sm:grid-cols-3 lg:grid-cols-4">
                  {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="aspect-[4/3] rounded-lg" />)}
                </div>
              ) : error ? (
                <ErrorState title="تعذّر تحميل مخزن الملفات" description={error} onRetry={refresh} />
              ) : assets.length === 0 ? (
                query || kind ? (
                  <EmptyState
                    kind="noResults"
                    title="لا توجد ملفات مطابقة"
                    description="جرّب تعديل البحث أو المرشّح الحالي."
                  />
                ) : (
                  <EmptyState
                    kind="empty"
                    title="مخزن الملفات فارغ"
                    description="ارفع أول ملف لاستخدامه لاحقًا في صفحات المحتوى."
                    action={<Button variant="primary" icon={<FileUp aria-hidden />} onClick={() => setUploadOpen(true)}>رفع ملفات</Button>}
                  />
                )
              ) : view === "grid" ? (
                <AssetGrid
                  assets={assets}
                  activeId={activeId}
                  columns={4}
                  actions={{
                    onOpen: (asset) => { setActiveId(asset.id); setActivePreflight(null); },
                    onDownload: downloadAsset,
                    onDelete: (asset) => setDeleteTarget(asset as AdminAsset),
                  }}
                  className="py-5"
                />
              ) : (
                <AssetList
                  assets={assets}
                  activeId={activeId}
                  actions={{
                    onOpen: (asset) => { setActiveId(asset.id); setActivePreflight(null); },
                    onDownload: downloadAsset,
                    onDelete: (asset) => setDeleteTarget(asset as AdminAsset),
                    onViewReferences: (asset) => setReferencesTarget(asset as AdminAsset),
                  }}
                  className="mt-4"
                />
              )}
            </Section>
          </TwoColumnLayout>
        </div>
      </PageShell>

      <Drawer open={uploadOpen} onOpenChange={setUploadOpen}>
        <DrawerContent size="lg">
          <DrawerHeader
            eyebrow="مخزن الملفات"
            title="رفع ملفات"
            description="يُفحص كل ملف ويُخزّن مرة واحدة فقط عند تطابق بصمته."
          />
          <DrawerBody>
            <FormField label="الملفات" description="الرفع المتزامن محدود بملفين، ولا يُعرض تقدّم وهمي.">
              <UploadZone
                onFiles={uploadFilesFromDrop}
                uploads={uploads}
                onRemoveUpload={removeUpload}
                onRetryUpload={(id) => void startUpload(id)}
                accept={UPLOAD_ACCEPT}
                maxSizeBytes={MAX_UPLOAD_BYTES}
                hint="صور وفيديو وصوت وPDF وJSON وملفات نصية حتى 100 MB للملف الواحد."
              />
            </FormField>
          </DrawerBody>
          <DrawerFooter>
            <Button variant="secondary" onClick={() => setUploadOpen(false)}>إغلاق</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Dialog open={referencesTarget !== null} onOpenChange={(open) => { if (!open) setReferencesTarget(null); }}>
        <DialogContent size="lg">
          <DialogHeader
            title="أماكن استخدام الملف"
            description={referencesTarget ? `المعرّف: ${referencesTarget.id}` : undefined}
          />
          <DialogBody>
            {referencesTarget?.references?.length ? (
              <DependencyList dependents={referencesTarget.references ?? []} title="المراجع الحالية" />
            ) : (
              <EmptyState size="sm" title="لا توجد مراجع" description="يمكن حذف هذا الملف إذا لم يظهر ارتباط جديد." />
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReferencesTarget(null)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}
        entityType="الملف"
        entityName={deleteTarget?.name ?? ""}
        technicalId={deleteTarget?.id}
        dependents={deleteTarget?.references}
        onConfirm={() => void deleteAsset()}
        deleting={deleting}
      />
    </>
  );
}
