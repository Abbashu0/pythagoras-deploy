"use client";

import * as React from "react";
import { BookOpen, Pencil, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  MaterialCard,
  type Material,
} from "@/components/admin-ui/domain/content/content-items";
import { AssetPicker, AssetThumb, type Asset } from "@/components/admin-ui/domain/content/assets";
import { OrderingNotice, ReorderableList } from "@/components/admin-ui/domain/content/reorderable";
import { EmptyState, ErrorState } from "@/components/admin-ui/feedback/empty-state";
import { InlineNote } from "@/components/admin-ui/feedback/banner";
import { Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader } from "@/components/admin-ui/overlays/drawer";
import { FormField, SettingRow } from "@/components/admin-ui/forms/field";
import { TextField } from "@/components/admin-ui/forms/input";
import { Switch } from "@/components/admin-ui/forms/toggle";
import { Slider } from "@/components/admin-ui/forms/slider";
import { Tabs } from "@/components/admin-ui/navigation/tabs";
import { Button, IconButton } from "@/components/admin-ui/primitives/button";
import { Panel, PanelBody, PanelHeader, Well } from "@/components/admin-ui/primitives/surface";
import { Skeleton } from "@/components/admin-ui/primitives/skeleton";
import { Badge, StatusBadge } from "@/components/admin-ui/status/status-badge";
import { ContentGrid, PageHeader, PageShell, Section, TwoColumnLayout } from "@/components/admin-ui/layout/page";
import { toast } from "@/components/admin-ui/feedback/toaster";
import { formatNumber, formatPercent } from "@/lib/format";
import {
  MaterialArtworkEditor,
  type MaterialArtworkDraft,
} from "@/components/admin/materials/material-artwork-editor";
import {
  MaterialStudentPreview,
  type MaterialPreviewModel,
  type MaterialPreviewSettings,
} from "@/components/admin/materials/material-student-preview";

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
  revision: number;
  tags: string[];
  uploadedAt: number;
  uploadedBy?: string;
  questionPackageInspection?: ApiInspection | null;
};

type ApiMaterial = {
  id: string;
  subjectKey: string;
  label: string;
  englishTitle: string;
  iconKey: string;
  gradient: string;
  available: boolean;
  position: number;
  asset: ApiAsset | null;
  offsetX: number;
  offsetY: number;
  scale: number;
  stats: { packages: number; questions: number };
  updatedAt: number;
  revision: number;
};

type ApiSettings = {
  id: "global";
  fadeIntensity: number;
  textVerticalPosition: number;
  textScale: number;
  cardHeight: number;
  updatedAt: number;
  revision: number;
};

type MaterialModel = Material & {
  subjectKey: string;
  iconKey: string;
  gradient: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  revision: number;
};

type Tab = "manage" | "preview" | "order";

function toAsset(value: ApiAsset): Asset {
  return { ...value, storageKey: value.id };
}

function toMaterial(value: ApiMaterial): MaterialModel {
  return {
    id: value.id,
    title: value.label,
    subtitle: value.englishTitle,
    key: value.subjectKey,
    subjectKey: value.subjectKey,
    iconKey: value.iconKey,
    gradient: value.gradient,
    asset: value.asset ? toAsset(value.asset) : null,
    enabled: value.available,
    available: value.available,
    position: value.position,
    offsetX: value.offsetX,
    offsetY: value.offsetY,
    scale: value.scale,
    revision: value.revision,
    stats: { questions: value.stats.questions },
    updatedAt: value.updatedAt,
  };
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as { code?: string } | null;
  if (!response.ok) throw new Error(payload?.code ?? "REQUEST_FAILED");
  return payload as T;
}

function errorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "CANONICAL_CONFLICT") return "تغيّرت المادة أو الإعدادات قبل الحفظ. حدّث الصفحة وحاول مجددًا.";
  if (code === "CANONICAL_NOT_FOUND") return "لم تعد المادة موجودة في المصدر القانوني.";
  if (code === "ASSET_UNSUPPORTED_TYPE") return "نوع الصورة غير مدعوم.";
  return "تعذّرت العملية. تحقّق من البيانات وحاول مجددًا.";
}

function toPreviewMaterial(material: MaterialModel): MaterialPreviewModel {
  return {
    id: material.id,
    label: material.title,
    englishTitle: material.subtitle ?? material.key,
    gradient: material.gradient,
    asset: material.asset,
    available: material.available,
    offsetX: material.offsetX,
    offsetY: material.offsetY,
    scale: material.scale,
  };
}

function settingsForPreview(settings: ApiSettings): MaterialPreviewSettings {
  return {
    fadeIntensity: settings.fadeIntensity,
    textVerticalPosition: settings.textVerticalPosition,
    textScale: settings.textScale,
    cardHeight: settings.cardHeight,
  };
}

export default function AdminMaterialsPage() {
  const router = useRouter();
  const [materials, setMaterials] = React.useState<MaterialModel[]>([]);
  const [assets, setAssets] = React.useState<Asset[]>([]);
  const [settings, setSettings] = React.useState<ApiSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = React.useState<MaterialPreviewSettings | null>(null);
  const [tab, setTab] = React.useState<Tab>("manage");
  const [editing, setEditing] = React.useState<MaterialModel | null>(null);
  const [assetPickerOpen, setAssetPickerOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [savingSettings, setSavingSettings] = React.useState(false);
  const [reordering, setReordering] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [materialResponse, assetResponse] = await Promise.all([
        requestJson<{ materials: ApiMaterial[]; settings: ApiSettings }>("/api/admin/local/content/materials"),
        requestJson<{ items: ApiAsset[] }>("/api/admin/local/assets?limit=200&sort=newest&mediaKind=image"),
      ]);
      setMaterials(materialResponse.materials.map(toMaterial));
      setSettings(materialResponse.settings);
      setSettingsDraft(settingsForPreview(materialResponse.settings));
      setAssets(assetResponse.items.map(toAsset));
      setLoaded(true);
    } catch (cause) {
      setError(errorMessage(cause));
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const visibleCount = materials.filter((material) => material.available).length;

  const updateMaterial = (next: MaterialModel) => {
    setMaterials((current) => current.map((material) => material.subjectKey === next.subjectKey ? next : material));
  };

  const saveMaterial = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const response = await requestJson<{ material: ApiMaterial }>(
        `/api/admin/local/content/materials/${encodeURIComponent(editing.subjectKey)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            label: editing.title,
            englishTitle: editing.subtitle,
            available: editing.available,
            assetId: editing.asset?.id ?? null,
            offsetX: editing.offsetX,
            offsetY: editing.offsetY,
            scale: editing.scale,
            expectedRevision: editing.revision,
          }),
        },
      );
      updateMaterial(toMaterial(response.material));
      setEditing(null);
      toast.success("تم حفظ المادة.");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const toggleMaterial = async (material: MaterialModel, available: boolean) => {
    try {
      const response = await requestJson<{ material: ApiMaterial }>(
        `/api/admin/local/content/materials/${encodeURIComponent(material.subjectKey)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ available, expectedRevision: material.revision }),
        },
      );
      updateMaterial(toMaterial(response.material));
      toast.success(available ? "تم إظهار المادة للطالب." : "تم إخفاء المادة عن الطالب.");
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };

  const reorderMaterials = (next: Material[]) => {
    if (reordering) return;
    const previous = materials;
    const ordered = next as MaterialModel[];
    setMaterials(ordered);
    setReordering(true);
    void (async () => {
      try {
        const response = await requestJson<{ materials: ApiMaterial[] }>(
          "/api/admin/local/content/materials/reorder",
          {
            method: "POST",
            body: JSON.stringify({
              ids: ordered.map((material) => material.subjectKey),
              expectedRevisions: Object.fromEntries(previous.map((material) => [material.subjectKey, material.revision])),
            }),
          },
        );
        setMaterials(response.materials.map(toMaterial));
        toast.success("تم حفظ ترتيب المواد.");
      } catch (cause) {
        setMaterials(previous);
        toast.error(errorMessage(cause));
      } finally {
        setReordering(false);
      }
    })();
  };

  const commitSettings = async (next: MaterialPreviewSettings) => {
    if (!settings || savingSettings) return;
    const confirmed = settingsForPreview(settings);
    setSettingsDraft(next);
    setSavingSettings(true);
    try {
      const response = await requestJson<{ settings: ApiSettings }>(
        "/api/admin/local/content/materials/settings",
        {
          method: "PATCH",
          body: JSON.stringify({ ...next, expectedRevision: settings.revision }),
        },
      );
      setSettings(response.settings);
      setSettingsDraft(settingsForPreview(response.settings));
      toast.success("تم حفظ مظهر بطاقات المواد.");
    } catch (cause) {
      setSettingsDraft(confirmed);
      toast.error(errorMessage(cause));
    } finally {
      setSavingSettings(false);
    }
  };

  const openEditor = (material: MaterialModel) => setEditing({ ...material });

  return (
    <>
      <PageShell width="wide">
        <PageHeader
          eyebrow="إدارة المحتوى"
          title="المواد"
          description="المواد التي تظهر للطالب، بترتيبها وصورتها وإعدادات مظهرها الفعلية."
          icon={<BookOpen className="size-5 text-fg-tertiary" aria-hidden />}
          status={
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="subtle" tone="neutral">{materials.length} مادة</Badge>
              <Badge variant="subtle" tone="success">{visibleCount} ظاهرة</Badge>
            </div>
          }
        />

        <div className="pb-24">
          <TwoColumnLayout
            asideWidth="lg"
            asidePosition="end"
            stickyAside
            className="mt-7 lg:[&>aside]:w-[360px]"
            aside={
              <div className="space-y-4">
                {settingsDraft ? (
                  <MaterialStudentPreview
                    materials={materials.map(toPreviewMaterial)}
                    settings={settingsDraft}
                  />
                ) : (
                  <Panel><PanelHeader title="كما يراه الطالب" density="compact" /><div className="p-4"><Skeleton className="h-[213px] w-full rounded-[28px]" /></div></Panel>
                )}
                <InlineNote tone="info" size="xs">
                  المعاينة تستخدم نفس حسابات الارتفاع، التعتيم، موضع النص وحجمه الموجودة في تطبيق الطالب.
                </InlineNote>
              </div>
            }
          >
            <div className="flex flex-col gap-6">
              <Tabs
                value={tab}
                onValueChange={(value) => setTab(value as Tab)}
                items={[
                  { value: "manage", label: "المواد", count: materials.length },
                  { value: "preview", label: "مظهر البطاقات" },
                  { value: "order", label: "الترتيب" },
                ]}
              />

              {loading && !loaded ? (
                <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-36 rounded-lg" /><Skeleton className="h-36 rounded-lg" /></div>
              ) : error ? (
                <ErrorState title="تعذّر تحميل المواد" description={error} onRetry={refresh} />
              ) : tab === "manage" ? (
                <Section title="المواد" description="مجموعة المواد ثابتة من المصدر القانوني؛ يمكن تعديل بيانات العرض فقط." spacing="none" divided>
                  {materials.length ? (
                    <ContentGrid columns={2}>
                      {materials.map((material) => (
                        <MaterialCard
                          key={material.id}
                          material={material}
                          onOpen={() => router.push(`/admin/content/materials/${encodeURIComponent(material.subjectKey)}`)}
                          onEdit={() => openEditor(material)}
                          onToggle={(available) => void toggleMaterial(material, available)}
                        />
                      ))}
                    </ContentGrid>
                  ) : (
                    <EmptyState kind="noData" title="لا توجد مواد قانونية" description="لم تُهيّأ مجموعة المواد في قاعدة المحتوى بعد." />
                  )}
                </Section>
              ) : tab === "preview" ? (
                <Section title="مظهر البطاقات" description="الإعدادات التالية مشتركة بين جميع بطاقات المواد وتُحفظ مباشرة بعد تثبيت التفاعل." spacing="none" divided>
                  {settingsDraft ? (
                    <Panel>
                      <PanelHeader title="إعدادات العرض العامة" description="تتغير المعاينة في rail مباشرة أثناء الضبط." density="compact" />
                      <PanelBody>
                        <SettingRow label="شدة التعتيم" description="من 0% إلى 100% لتوضيح النص فوق الصورة." align="start">
                          <div className="w-52">
                            <Slider value={settingsDraft.fadeIntensity} min={0} max={1} step={0.01} showValue disabled={savingSettings} formatValue={(value) => formatPercent(value, { decimals: 0 })} onValueChange={(value) => setSettingsDraft((current) => current ? { ...current, fadeIntensity: value } : current)} onValueCommit={(values) => { const value = values[0]; if (value !== undefined && settingsDraft) void commitSettings({ ...settingsDraft, fadeIntensity: value }); }} aria-label="شدة التعتيم" />
                          </div>
                        </SettingRow>
                        <SettingRow label="موضع النص العمودي" description="إزاحة النص داخل البطاقة، من -100 إلى 100." align="start">
                          <div className="w-52">
                            <Slider value={settingsDraft.textVerticalPosition} min={-100} max={100} step={1} showValue disabled={savingSettings} formatValue={(value) => `${formatNumber(value)}%`} onValueChange={(value) => setSettingsDraft((current) => current ? { ...current, textVerticalPosition: value } : current)} onValueCommit={(values) => { const value = values[0]; if (value !== undefined && settingsDraft) void commitSettings({ ...settingsDraft, textVerticalPosition: value }); }} aria-label="موضع النص العمودي" />
                          </div>
                        </SettingRow>
                        <SettingRow label="حجم النص" description="مقياس عنوان المادة والعنوان الإنجليزي." align="start">
                          <div className="w-52">
                            <Slider value={settingsDraft.textScale} min={0.8} max={1.4} step={0.01} showValue disabled={savingSettings} formatValue={(value) => `${value.toFixed(2)}×`} onValueChange={(value) => setSettingsDraft((current) => current ? { ...current, textScale: value } : current)} onValueCommit={(values) => { const value = values[0]; if (value !== undefined && settingsDraft) void commitSettings({ ...settingsDraft, textScale: value }); }} aria-label="حجم النص" />
                          </div>
                        </SettingRow>
                        <SettingRow label="ارتفاع البطاقة" description="من 160 إلى 340 بكسل، وفق حدود تطبيق الطالب." align="start" bordered={false}>
                          <div className="w-52">
                            <Slider value={settingsDraft.cardHeight} min={160} max={340} step={1} showValue disabled={savingSettings} formatValue={(value) => `${formatNumber(value)}px`} onValueChange={(value) => setSettingsDraft((current) => current ? { ...current, cardHeight: value } : current)} onValueCommit={(values) => { const value = values[0]; if (value !== undefined && settingsDraft) void commitSettings({ ...settingsDraft, cardHeight: value }); }} aria-label="ارتفاع البطاقة" />
                          </div>
                        </SettingRow>
                      </PanelBody>
                    </Panel>
                  ) : <Skeleton className="h-72 w-full rounded-lg" />}
                  <InlineNote tone="info" size="sm" className="mt-4">تعديل هذه القيم لا يغيّر توفر المادة أو بنك الأسئلة؛ إنها إعدادات مظهر عامة فقط.</InlineNote>
                </Section>
              ) : (
                <Section title="ترتيب المواد" description="ترتيب المواد في قائمة الطالب. السحب وأزرار التحريك يحفظان الترتيب مباشرة." spacing="none" divided>
                  {materials.length ? (
                    <>
                      {reordering ? <OrderingNotice reason="جارٍ حفظ الترتيب الحالي…" /> : null}
                      <ReorderableList
                        items={materials}
                        onReorder={reorderMaterials}
                        itemLabel="مادة"
                        disabled={reordering}
                        renderItem={(material) => (
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            {material.asset ? <AssetThumb asset={material.asset} size="sm" /> : <span className="size-8 shrink-0 rounded-md border border-dashed border-border-strong" aria-hidden />}
                            <span className="min-w-0 flex-1 truncate text-xs text-fg-secondary">{material.title}</span>
                            <span dir="ltr" className="ltr-island font-mono text-[10px] text-fg-quaternary">{material.subjectKey}</span>
                            {!material.available ? <StatusBadge status="disabled" size="sm" iconOnly /> : null}
                            <IconButton label="تعديل المادة" size="sm" variant="ghost" onClick={() => openEditor(material)}><Pencil aria-hidden /></IconButton>
                          </div>
                        )}
                      />
                    </>
                  ) : <EmptyState kind="noData" title="لا توجد مواد للترتيب" description="سيظهر ترتيب المواد هنا عند توفر المصدر القانوني." />}
                </Section>
              )}
            </div>
          </TwoColumnLayout>
        </div>
      </PageShell>

      <Drawer open={editing !== null} onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}>
        <DrawerContent size="xl">
          <DrawerHeader eyebrow="مادة" title={editing?.title ?? "تعديل مادة"} description="بيانات المادة وصورتها وحالة ظهورها للطالب." />
          <DrawerBody>
            {editing && settingsDraft ? (
              <div className="flex flex-col gap-5">
                <FormField label="الاسم العربي" required>
                  <TextField value={editing.title} onChange={(event) => setEditing((current) => current ? { ...current, title: event.target.value } : current)} />
                </FormField>
                <FormField label="الاسم الإنجليزي" required>
                  <TextField ltr value={editing.subtitle ?? ""} onChange={(event) => setEditing((current) => current ? { ...current, subtitle: event.target.value } : current)} />
                </FormField>
                <FormField label="الصورة">
                  <div className="flex items-center gap-3">
                    {editing.asset ? <AssetThumb asset={editing.asset} size="md" /> : <Well padding="sm"><span className="text-xs text-fg-quaternary">لا توجد صورة</span></Well>}
                    <Button size="sm" variant="secondary" onClick={() => setAssetPickerOpen(true)}>{editing.asset ? "تغيير الصورة" : "اختيار صورة"}</Button>
                  </div>
                </FormField>
                <MaterialArtworkEditor material={toPreviewMaterial(editing)} settings={settingsDraft} value={{ offsetX: editing.offsetX, offsetY: editing.offsetY, scale: editing.scale }} onChange={(draft: MaterialArtworkDraft) => setEditing((current) => current ? { ...current, ...draft } : current)} />
                <Panel>
                  <PanelBody>
                    <SettingRow label="متاحة للطالب" description="هذا هو القرار القانوني لظهور المادة في تطبيق الطالب." bordered={false}>
                      <Switch checked={editing.available} onCheckedChange={(available) => setEditing((current) => current ? { ...current, available } : current)} aria-label={editing.available ? "إخفاء المادة" : "إظهار المادة"} />
                    </SettingRow>
                  </PanelBody>
                </Panel>
                {!editing.available ? <InlineNote tone="warning">هذه المادة ستبقى محفوظة، لكنها لن تظهر في قائمة المواد للطالب.</InlineNote> : null}
              </div>
            ) : null}
          </DrawerBody>
          <DrawerFooter align="between">
            <span className="text-2xs text-fg-quaternary">الحفظ مباشر مع حماية revision متفائلة.</span>
            <div className="flex gap-2">
              <Button variant="quiet" onClick={() => setEditing(null)} disabled={saving}>إلغاء</Button>
              <Button variant="primary" onClick={() => void saveMaterial()} loading={saving} disabled={!editing?.title.trim() || !editing?.subtitle?.trim()}>حفظ</Button>
            </div>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <AssetPicker
        open={assetPickerOpen}
        onOpenChange={setAssetPickerOpen}
        assets={assets}
        value={editing?.asset?.id ?? null}
        kind="image"
        onSelect={(asset) => setEditing((current) => current ? { ...current, asset } : current)}
      />
    </>
  );
}
