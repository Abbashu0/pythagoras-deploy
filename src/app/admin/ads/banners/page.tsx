"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import {
  BannerList,
  BannerScheduleFields,
  resolveBannerAvailability,
  type Banner,
} from "@/components/admin-ui/domain/content/content-items";
import {
  AssetPicker,
  AssetThumb,
  type Asset,
  type UploadItem,
} from "@/components/admin-ui/domain/content/assets";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
} from "@/components/admin-ui/overlays/drawer";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
} from "@/components/admin-ui/overlays/dialog";
import { DeleteDialog } from "@/components/admin-ui/governance/destructive";
import { ErrorState } from "@/components/admin-ui/feedback/empty-state";
import { InlineNote } from "@/components/admin-ui/feedback/banner";
import { FormField } from "@/components/admin-ui/forms/field";
import { TextField } from "@/components/admin-ui/forms/input";
import { Switch } from "@/components/admin-ui/forms/toggle";
import { Button } from "@/components/admin-ui/primitives/button";
import { Skeleton } from "@/components/admin-ui/primitives/skeleton";
import { Badge } from "@/components/admin-ui/status/status-badge";
import { PageHeader, PageShell, Section, TwoColumnLayout } from "@/components/admin-ui/layout/page";
import { toast } from "@/components/admin-ui/feedback/toaster";
import {
  BannerArtworkEditor,
  type BannerArtworkDraft,
} from "@/components/admin/banners/banner-artwork-editor";
import { BannerStudentPreview } from "@/components/admin/banners/banner-student-preview";

type BannerModel = Banner & {
  internalTitle: string;
  revision: number;
};

type ApiAsset = {
  id: string;
  name: string;
  kind: Asset["kind"];
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
};

type ApiBanner = {
  id: string;
  title: string;
  internalTitle: string;
  subtitle?: string;
  asset: ApiAsset | null;
  enabled: boolean;
  position: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  startsAt: number | null;
  endsAt: number | null;
  analytics: NonNullable<Banner["analytics"]>;
  revision: number;
  updatedAt: number;
};

function toAsset(value: ApiAsset): Asset {
  return {
    ...value,
    // APCL's generic model has a storageKey slot; the production API does not
    // expose the private path, so only the opaque Asset ID enters the client.
    storageKey: value.id,
    kind: value.kind,
    references: value.references,
  };
}

function toBanner(value: ApiBanner): BannerModel {
  return {
    id: value.id,
    title: value.title,
    internalTitle: value.internalTitle,
    subtitle: value.subtitle,
    asset: value.asset ? toAsset(value.asset) : null,
    enabled: value.enabled,
    position: value.position,
    offsetX: value.offsetX,
    offsetY: value.offsetY,
    scale: value.scale,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    analytics: value.analytics,
    revision: value.revision,
    updatedAt: value.updatedAt,
  };
}

function toDate(value: number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as { code?: string } | null;
  if (!response.ok) throw new Error(payload?.code ?? "REQUEST_FAILED");
  return payload as T;
}

function errorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case "CANONICAL_CONFLICT":
      return "تغيّر هذا البانر قبل الحفظ. حدّث الصفحة وحاول مجددًا.";
    case "CANONICAL_VALIDATION_FAILED":
      return "بيانات البانر غير صالحة أو تتجاوز حدّ البانرات الظاهرة.";
    case "ASSET_CONFLICT":
      return "لا يمكن تنفيذ العملية لأن الملف مرتبط بمحتوى آخر.";
    case "ASSET_UNSUPPORTED_TYPE":
      return "نوع الملف غير مدعوم.";
    case "ASSET_TOO_LARGE":
      return "حجم الملف يتجاوز الحد المسموح.";
    default:
      return "تعذّرت العملية. تحقق من البيانات وحاول مجددًا.";
  }
}

export default function AdminBannersPage() {
  const [banners, setBanners] = React.useState<BannerModel[]>([]);
  const [assets, setAssets] = React.useState<Asset[]>([]);
  const [filterDisabled, setFilterDisabled] = React.useState(false);
  const [editing, setEditing] = React.useState<BannerModel | null>(null);
  const [previewTarget, setPreviewTarget] = React.useState<BannerModel | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<BannerModel | null>(null);
  const [assetPickerOpen, setAssetPickerOpen] = React.useState(false);
  const [uploads, setUploads] = React.useState<UploadItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [reordering, setReordering] = React.useState(false);
  const uploadFiles = React.useRef(new Map<string, File>());
  const uploadTargets = React.useRef(new Map<string, string | null>());

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bannerResponse, assetResponse] = await Promise.all([
        requestJson<{ banners: ApiBanner[] }>("/api/admin/local/content/banners"),
        requestJson<{ items: ApiAsset[] }>("/api/admin/local/assets?limit=200&sort=newest"),
      ]);
      setBanners(bannerResponse.banners.map(toBanner));
      setAssets(assetResponse.items.map(toAsset));
      setLoaded(true);
    } catch (cause) {
      setError(errorMessage(cause));
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const liveCount = React.useMemo(
    () => banners.filter((banner) => resolveBannerAvailability(banner).state === "live").length,
    [banners],
  );

  const shownBanners = React.useMemo(
    () =>
      filterDisabled
        ? banners.filter((banner) => resolveBannerAvailability(banner).state !== "disabled")
        : banners,
    [banners, filterDisabled],
  );

  const updateBanner = (next: BannerModel) => {
    setBanners((current) =>
      current.some((item) => item.id === next.id)
        ? current.map((item) => (item.id === next.id ? next : item))
        : [next, ...current],
    );
  };

  const openNew = () => {
    setEditing({
      id: "new",
      title: "",
      internalTitle: "",
      asset: null,
      enabled: true,
      position: banners.length,
      startsAt: null,
      endsAt: null,
      analytics: { impressions: 0, clicks: 0, trend: [{ value: 0 }] },
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      updatedAt: Date.now(),
      revision: 0,
    });
  };

  const saveBanner = async () => {
    if (!editing?.asset) {
      toast.error("اختر صورة قبل حفظ البانر.");
      return;
    }
    setSaving(true);
    const input = {
      title: editing.internalTitle,
      assetId: editing.asset.id,
      startsAt: typeof editing.startsAt === "number" ? editing.startsAt : null,
      endsAt: typeof editing.endsAt === "number" ? editing.endsAt : null,
      offsetX: editing.offsetX,
      offsetY: editing.offsetY,
      scale: editing.scale,
      enabled: editing.enabled,
    };
    try {
      const response =
        editing.id === "new"
          ? await requestJson<{ banner: ApiBanner }>("/api/admin/local/content/banners", {
              method: "POST",
              body: JSON.stringify(input),
            })
          : await requestJson<{ banner: ApiBanner }>(
              `/api/admin/local/content/banners/${encodeURIComponent(editing.id)}`,
              {
                method: "PATCH",
                body: JSON.stringify({ ...input, expectedRevision: editing.revision }),
              },
            );
      updateBanner(toBanner(response.banner));
      setEditing(null);
      toast.success("تم حفظ البانر.");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const toggleBanner = async (banner: BannerModel, enabled: boolean) => {
    try {
      const response = await requestJson<{ banner: ApiBanner }>(
        `/api/admin/local/content/banners/${encodeURIComponent(banner.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled, expectedRevision: banner.revision }),
        },
      );
      updateBanner(toBanner(response.banner));
      toast.success(enabled ? "تم تفعيل البانر." : "تم تعطيل البانر.");
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };

  const reorderBanners = (next: Banner[]) => {
    if (reordering) return;
    const previous = banners;
    setBanners(next as BannerModel[]);
    setReordering(true);
    void (async () => {
      try {
        const response = await requestJson<{ banners: ApiBanner[] }>(
          "/api/admin/local/content/banners/reorder",
          {
            method: "POST",
            body: JSON.stringify({
              ids: next.map((banner) => banner.id),
              expectedRevisions: Object.fromEntries(
                previous.map((banner) => [banner.id, banner.revision]),
              ),
            }),
          },
        );
        setBanners(response.banners.map(toBanner));
        toast.success("تم حفظ ترتيب البانرات.");
      } catch (cause) {
        setBanners(previous);
        toast.error(errorMessage(cause));
      } finally {
        setReordering(false);
      }
    })();
  };

  const deleteBanner = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await requestJson<{ deleted: true }>(
        `/api/admin/local/content/banners/${encodeURIComponent(deleteTarget.id)}`,
        {
          method: "DELETE",
          body: JSON.stringify({ expectedRevision: deleteTarget.revision }),
        },
      );
      setBanners((current) => current.filter((banner) => banner.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success("تم حذف البانر.");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setDeleting(false);
    }
  };

  const updateUpload = (id: string, patch: Partial<UploadItem>) => {
    setUploads((current) =>
      current.map((upload) => (upload.id === id ? { ...upload, ...patch } : upload)),
    );
  };

  const uploadOne = (id: string, file: File) => {
    updateUpload(id, { state: "uploading", progress: 0, error: undefined });
    return new Promise<Asset>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/admin/local/assets");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          updateUpload(id, { progress: Math.round((event.loaded / event.total) * 100) });
        }
      };
      xhr.onerror = () => reject(new Error("ASSET_UPLOAD_FAILED"));
      xhr.onload = () => {
        let payload: { asset?: ApiAsset; code?: string } | null = null;
        try {
          payload = JSON.parse(xhr.responseText || "null") as
            | { asset?: ApiAsset; code?: string }
            | null;
        } catch {
          payload = null;
        }
        if (xhr.status < 200 || xhr.status >= 300 || !payload?.asset) {
          reject(new Error(payload?.code ?? "ASSET_UPLOAD_FAILED"));
          return;
        }
        resolve(toAsset(payload.asset));
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
      const asset = await uploadOne(id, file);
      setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      const targetId = uploadTargets.current.get(id);
      setEditing((current) =>
        current && current.id === targetId ? { ...current, asset } : current,
      );
      updateUpload(id, { state: "done", progress: 100 });
      uploadFiles.current.delete(id);
      toast.success("تم رفع الملف.");
    } catch (cause) {
      updateUpload(id, { state: "failed", error: errorMessage(cause) });
    }
  };

  const uploadFilesFromPicker = (files: File[]) => {
    const entries = files.map((file) => {
      const id = crypto.randomUUID();
      uploadFiles.current.set(id, file);
      uploadTargets.current.set(id, editing?.id ?? null);
      return {
        id,
        name: file.name,
        sizeBytes: file.size,
        progress: 0,
        state: "queued" as const,
      };
    });
    setUploads((current) => [...current, ...entries]);
    let cursor = 0;
    const worker = async () => {
      while (cursor < entries.length) {
        const entry = entries[cursor++];
        await startUpload(entry.id);
      }
    };
    void Promise.all(Array.from({ length: Math.min(2, entries.length) }, () => worker()));
  };

  const artworkChange = (next: BannerArtworkDraft) => {
    setEditing((current) => (current ? { ...current, ...next } : current));
  };

  return (
    <>
      <PageShell width="wide">
        <PageHeader
          eyebrow="الإعلانات"
          title="بانرات الصفحة الرئيسية"
          description="إدارة صور شريط البانرات الذي يظهر للطالب، مع جدولة وترتيب وتحكم مباشر."
          status={
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="subtle" tone="neutral">{banners.length} بانر</Badge>
              <Badge variant="subtle" tone="success">{liveCount} ظاهر الآن</Badge>
            </div>
          }
          actions={<Button variant="primary" icon={<Plus aria-hidden />} onClick={openNew}>بانر جديد</Button>}
        />

        <div className="pb-24">
          <TwoColumnLayout
            asideWidth="lg"
            asidePosition="end"
            stickyAside
            className="lg:[&>aside]:w-[440px]"
            aside={<BannerStudentPreview banners={banners} />}
          >
            <div className="flex flex-col gap-6">
              <Section
                title="ترتيب البانرات"
                description="الترتيب هنا هو ترتيب الظهور في التطبيق. إعادة الترتيب تحفظ مباشرة بعد نجاح الحركة."
                spacing="none"
                divided
                actions={
                  <Button size="sm" variant="quiet" onClick={() => setFilterDisabled((current) => !current)}>
                    {filterDisabled ? "إظهار المعطلة" : "إخفاء المعطلة"}
                  </Button>
                }
              >
                {loading && !loaded ? (
                  <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
                ) : error ? (
                  <ErrorState title="تعذّر تحميل البانرات" description={error} onRetry={refresh} />
                ) : (
                  <>
                    <BannerList
                      banners={shownBanners}
                      onReorder={reorderBanners}
                      reorderDisabled={filterDisabled || reordering}
                      reorderDisabledReason={filterDisabled ? "أظهر كل البانرات قبل إعادة الترتيب." : "انتظر اكتمال حفظ الترتيب الحالي."}
                      onToggle={(banner, enabled) => void toggleBanner(banner as BannerModel, enabled)}
                      onEdit={(banner) => setEditing({ ...(banner as BannerModel), title: (banner as BannerModel).internalTitle, internalTitle: (banner as BannerModel).internalTitle })}
                      onPreview={(banner) => setPreviewTarget(banner as BannerModel)}
                      onDelete={(banner) => setDeleteTarget(banner as BannerModel)}
                      onAdd={openNew}
                    />
                    <InlineNote tone="info" size="xs" className="mt-4">
                      تحليلات البانرات غير مفعّلة بعد؛ الأرقام المعروضة صفر مقصود وليست نشاطًا حقيقيًا.
                    </InlineNote>
                  </>
                )}
              </Section>
            </div>
          </TwoColumnLayout>
        </div>
      </PageShell>

      <Drawer open={editing !== null} onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}>
        <DrawerContent size="xl">
          <DrawerHeader
            eyebrow="بانر"
            title={editing?.id === "new" ? "بانر جديد" : editing?.title || editing?.asset?.name || "تعديل بانر"}
            description="الصورة هي المحتوى الذي يراه الطالب. الاسم الداخلي للوحة الإدارة فقط."
          />
          <DrawerBody>
            {editing ? (
              <div className="flex flex-col gap-5">
                <FormField label="اسم داخلي" optionalHint description="يظهر داخل لوحة الإدارة فقط ولا يظهر للطالب.">
                  <TextField
                    value={editing.internalTitle}
                    onChange={(event) => setEditing((current) => current ? { ...current, internalTitle: event.target.value, title: event.target.value } : current)}
                    placeholder="اسم اختياري للبانر"
                  />
                </FormField>

                <FormField label="الصورة" required status={editing.asset ? "default" : "invalid"} message={editing.asset ? undefined : "اختر صورة صحيحة قبل الحفظ."}>
                  <div className="flex flex-wrap items-center gap-3">
                    {editing.asset ? <AssetThumb asset={editing.asset} size="lg" /> : null}
                    <Button variant="secondary" onClick={() => setAssetPickerOpen(true)}>{editing.asset ? "تغيير الصورة" : "اختيار صورة"}</Button>
                  </div>
                </FormField>

                <BannerArtworkEditor asset={editing.asset} value={{ offsetX: editing.offsetX, offsetY: editing.offsetY, scale: editing.scale }} onChange={artworkChange} />

                <Section title="الجدولة" description="اترك التاريخين فارغين ليبقى البانر دائمًا." spacing="none">
                  <BannerScheduleFields
                    startsAt={toDate(editing.startsAt)}
                    endsAt={toDate(editing.endsAt)}
                    onChange={({ startsAt, endsAt }) => setEditing((current) => current ? { ...current, startsAt: startsAt ? startsAt.getTime() : null, endsAt: endsAt ? endsAt.getTime() : null } : current)}
                  />
                </Section>

                <FormField label="الظهور" description="يمكن تعطيل البانر دون حذفه.">
                  <Switch checked={editing.enabled} disabled={!editing.asset} aria-label={editing.enabled ? "تعطيل البانر" : "تفعيل البانر"} onCheckedChange={(enabled) => setEditing((current) => current ? { ...current, enabled } : current)} />
                </FormField>
              </div>
            ) : null}
          </DrawerBody>
          <DrawerFooter align="between">
            <span className="text-2xs text-fg-quaternary">لا توجد وجهة أو عنوان ظاهر للطالب في البانر الكامل.</span>
            <div className="flex items-center gap-2">
              <Button variant="quiet" onClick={() => setEditing(null)} disabled={saving}>إلغاء</Button>
              <Button variant="primary" onClick={() => void saveBanner()} loading={saving} disabled={!editing?.asset}>حفظ</Button>
            </div>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <AssetPicker
        key={editing?.id ?? "none"}
        open={assetPickerOpen}
        onOpenChange={setAssetPickerOpen}
        assets={assets}
        value={editing?.asset?.id ?? null}
        kind="image"
        uploads={uploads}
        onUpload={uploadFilesFromPicker}
        onSelect={(asset) => { setEditing((current) => current ? { ...current, asset } : current); setAssetPickerOpen(false); }}
      />

      <Dialog open={previewTarget !== null} onOpenChange={(open) => { if (!open) setPreviewTarget(null); }}>
        <DialogContent size="lg">
          <DialogHeader title="معاينة البانر" description="هذه معاينة تشغيلية للصورة والحالة، وليست ادعاءً بأن البانر ظاهر للطلاب الآن." />
          <DialogBody>{previewTarget ? <BannerStudentPreview banners={[previewTarget]} showAllStatuses /> : null}</DialogBody>
        </DialogContent>
      </Dialog>

      {deleteTarget ? (
        <DeleteDialog
          open
          onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}
          entityType="بانر"
          entityName={deleteTarget.title}
          technicalId={deleteTarget.id}
          onConfirm={() => void deleteBanner()}
          deleting={deleting}
          consequences={["سيُحذف صف البانر فقط.", "لن يتم حذف الصورة المرتبطة من مخزن الملفات."]}
        />
      ) : null}
    </>
  );
}
