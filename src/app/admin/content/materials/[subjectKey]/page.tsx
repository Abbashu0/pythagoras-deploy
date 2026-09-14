"use client";

import * as React from "react";
import { BookOpen, Pencil } from "lucide-react";
import { useParams } from "next/navigation";

import { AssetPicker, AssetThumb, type Asset } from "@/components/admin-ui/domain/content/assets";
import { ErrorState, EmptyState } from "@/components/admin-ui/feedback/empty-state";
import { Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader } from "@/components/admin-ui/overlays/drawer";
import { FormField, SettingRow } from "@/components/admin-ui/forms/field";
import { TextField } from "@/components/admin-ui/forms/input";
import { Switch } from "@/components/admin-ui/forms/toggle";
import { Tabs } from "@/components/admin-ui/navigation/tabs";
import { Button } from "@/components/admin-ui/primitives/button";
import { Panel, PanelBody, PanelHeader, Well } from "@/components/admin-ui/primitives/surface";
import { Skeleton } from "@/components/admin-ui/primitives/skeleton";
import { Badge, StatusBadge } from "@/components/admin-ui/status/status-badge";
import { PageHeader, PageShell, Section, TwoColumnLayout } from "@/components/admin-ui/layout/page";
import { toast } from "@/components/admin-ui/feedback/toaster";
import { formatNumber } from "@/lib/format";
import { MaterialArtworkEditor, type MaterialArtworkDraft } from "@/components/admin/materials/material-artwork-editor";
import { MaterialQuestionBankPanel, type MaterialBankWorkspace, type PackageInspection, type QuestionPackageAsset } from "@/components/admin/materials/material-question-bank";
import { NativeMaterialCardPreview, type MaterialPreviewModel, type MaterialPreviewSettings } from "@/components/admin/materials/material-student-preview";

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
  questionPackageInspection?: PackageInspection | null;
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

type MaterialModel = Omit<ApiMaterial, "asset"> & { asset: Asset | null };

function toAsset(value: ApiAsset): Asset {
  return { ...value, storageKey: value.id };
}

function toMaterial(value: ApiMaterial): MaterialModel {
  return { ...value, asset: value.asset ? toAsset(value.asset) : null };
}

function previewMaterial(material: MaterialModel): MaterialPreviewModel {
  return {
    id: material.id,
    label: material.label,
    englishTitle: material.englishTitle,
    gradient: material.gradient,
    asset: material.asset,
    available: material.available,
    offsetX: material.offsetX,
    offsetY: material.offsetY,
    scale: material.scale,
  };
}

function previewSettings(settings: ApiSettings): MaterialPreviewSettings {
  return {
    fadeIntensity: settings.fadeIntensity,
    textVerticalPosition: settings.textVerticalPosition,
    textScale: settings.textScale,
    cardHeight: settings.cardHeight,
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
  if (code === "CANONICAL_CONFLICT") return "تغيّرت المادة قبل الحفظ. حدّث الصفحة وحاول مجددًا.";
  if (code === "CANONICAL_NOT_FOUND") return "المادة غير موجودة.";
  return "تعذّرت العملية. تحقّق من البيانات وحاول مجددًا.";
}

export default function AdminMaterialDetailPage() {
  const { subjectKey: rawSubjectKey } = useParams<{ subjectKey: string }>();
  const subjectKey = Array.isArray(rawSubjectKey) ? rawSubjectKey[0] : rawSubjectKey;
  const [material, setMaterial] = React.useState<MaterialModel | null>(null);
  const [settings, setSettings] = React.useState<ApiSettings | null>(null);
  const [bank, setBank] = React.useState<MaterialBankWorkspace | null>(null);
  const [imageAssets, setImageAssets] = React.useState<Asset[]>([]);
  const [packageAssets, setPackageAssets] = React.useState<QuestionPackageAsset[]>([]);
  const [tab, setTab] = React.useState<"general" | "bank" | "tests">("general");
  const [editing, setEditing] = React.useState<MaterialModel | null>(null);
  const [assetPickerOpen, setAssetPickerOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const refresh = React.useCallback(async () => {
    if (!subjectKey) return;
    setLoading(true);
    setError(null);
    try {
      const encoded = encodeURIComponent(subjectKey);
      const [materialResponse, settingsResponse, bankResponse, imagesResponse, packagesResponse] = await Promise.all([
        requestJson<{ material: ApiMaterial }>(`/api/admin/local/content/materials/${encoded}`),
        requestJson<{ settings: ApiSettings }>("/api/admin/local/content/materials/settings"),
        requestJson<{ workspace: MaterialBankWorkspace }>(`/api/admin/local/content/materials/${encoded}/question-bank`),
        requestJson<{ items: ApiAsset[] }>("/api/admin/local/assets?limit=200&sort=newest&mediaKind=image"),
        requestJson<{ items: ApiAsset[] }>("/api/admin/local/assets?limit=200&sort=newest&mediaKind=json"),
      ]);
      setMaterial(toMaterial(materialResponse.material));
      setSettings(settingsResponse.settings);
      setBank(bankResponse.workspace);
      setImageAssets(imagesResponse.items.map(toAsset));
      setPackageAssets(packagesResponse.items.map((asset) => ({
        ...toAsset(asset),
        questionPackageInspection: asset.questionPackageInspection ?? null,
      })));
      setLoaded(true);
    } catch (cause) {
      setError(errorMessage(cause));
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [subjectKey]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const saveMaterial = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const response = await requestJson<{ material: ApiMaterial }>(
        `/api/admin/local/content/materials/${encodeURIComponent(editing.subjectKey)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            label: editing.label,
            englishTitle: editing.englishTitle,
            available: editing.available,
            assetId: editing.asset?.id ?? null,
            offsetX: editing.offsetX,
            offsetY: editing.offsetY,
            scale: editing.scale,
            expectedRevision: editing.revision,
          }),
        },
      );
      setMaterial(toMaterial(response.material));
      setEditing(null);
      toast.success("تم حفظ المادة.");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !loaded) {
    return <PageShell width="wide"><Skeleton className="h-12 w-72" /><div className="mt-8 grid gap-5 lg:grid-cols-[1fr_22rem]"><Skeleton className="h-80 rounded-lg" /><Skeleton className="h-96 rounded-lg" /></div></PageShell>;
  }
  if (error || !material || !settings || !bank) {
    return <PageShell width="wide"><ErrorState title="تعذّر تحميل المادة" description={error ?? "المادة غير موجودة."} onRetry={refresh} /></PageShell>;
  }

  const settingsView = previewSettings(settings);

  return (
    <>
      <PageShell width="wide">
        <PageHeader
          eyebrow="إدارة المحتوى / المواد"
          title={material.label}
          description="التحكم في بيانات المادة وبطاقة الطالب وبنك الأسئلة المرتبط بها."
          icon={<BookOpen className="size-5 text-fg-tertiary" aria-hidden />}
          status={<StatusBadge status={material.available ? "active" : "disabled"} label={material.available ? "ظاهرة للطالب" : "مخفية عن الطالب"} size="sm" />}
          actions={<Button variant="secondary" icon={<Pencil aria-hidden />} onClick={() => setEditing({ ...material })}>تعديل المادة</Button>}
          tabs={
            <Tabs
              value={tab}
              onValueChange={(value) => setTab(value as "general" | "bank" | "tests")}
              items={[
                { value: "general", label: "عام" },
                { value: "bank", label: "بنك الأسئلة", count: material.stats.packages },
                { value: "tests", label: <span className="inline-flex items-center gap-2">الاختبارات <Badge size="sm" variant="subtle" tone="future">لاحقًا</Badge></span>, disabled: true, disabledReason: "ستُبنى إدارة الاختبارات في مرحلة لاحقة." },
              ]}
            />
          }
        />

        <div className="pb-24 pt-6">
          {tab === "general" ? (
            <TwoColumnLayout asideWidth="lg" asidePosition="end" stickyAside className="lg:[&>aside]:w-[360px]" aside={
              <Panel>
                <PanelHeader title="معاينة بطاقة الطالب" description="نفس نسب الصورة والطبقة والنص المستخدمة في Mobile." density="compact" />
                <PanelBody>
                  <NativeMaterialCardPreview material={previewMaterial(material)} settings={settingsView} />
                </PanelBody>
              </Panel>
            }>
              <div className="flex flex-col gap-6">
                <Section title="بيانات المادة" description="الهوية ثابتة من المجموعة القانونية، والحقول التالية قابلة للتعديل مباشرة." spacing="none" divided>
                  <Panel>
                    <PanelBody>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div><p className="eyebrow mb-1">الاسم العربي</p><p className="text-sm font-medium text-fg">{material.label}</p></div>
                        <div><p className="eyebrow mb-1">الاسم الإنجليزي</p><p dir="ltr" className="text-sm font-medium text-fg">{material.englishTitle}</p></div>
                        <div><p className="eyebrow mb-1">subjectKey</p><p dir="ltr" className="font-mono text-xs text-fg-secondary">{material.subjectKey}</p></div>
                        <div><p className="eyebrow mb-1">بنك الأسئلة</p><p className="text-sm text-fg-secondary">{formatNumber(material.stats.packages)} حزمة · {formatNumber(material.stats.questions)} سؤال</p></div>
                      </div>
                      <div className="mt-5 border-t border-border-subtle pt-4">
                        <SettingRow label="متاحة للطالب" description="لا تُخلط هذه الحالة مع جاهزية بنك الأسئلة." bordered={false}><StatusBadge status={material.available ? "active" : "disabled"} label={material.available ? "نعم" : "لا"} size="sm" /></SettingRow>
                      </div>
                    </PanelBody>
                  </Panel>
                </Section>
                <Section title="الصورة الحالية" description="الصورة مرجع إلى Asset Library ولا تُنسخ داخل المادة." spacing="none" divided>
                  {material.asset ? <div className="flex items-center gap-4"><AssetThumb asset={material.asset} size="lg" /><div><p className="text-sm font-medium text-fg">{material.asset.name}</p><p className="mt-1 text-xs text-fg-tertiary">{material.asset.mimeType} · {formatNumber(material.asset.sizeBytes)} بايت</p></div></div> : <Well padding="md"><p className="text-center text-xs text-fg-tertiary">لا توجد صورة مرتبطة بالمادة.</p></Well>}
                </Section>
              </div>
            </TwoColumnLayout>
          ) : tab === "bank" ? (
            <Section title="بنك الأسئلة" description="التوزيع العربي ثابت من المنتج؛ هذه الصفحة تدير ارتباط الحزم داخل BANK فقط." spacing="none">
              <MaterialQuestionBankPanel workspace={bank} packageAssets={packageAssets} onSaved={(next) => setBank(next)} />
            </Section>
          ) : (
            <EmptyState kind="future" title="إدارة الاختبارات لاحقًا" description="لا توجد واجهة أو بيانات اختبارات في هذه المرحلة." />
          )}
        </div>
      </PageShell>

      <Drawer open={editing !== null} onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}>
        <DrawerContent size="xl">
          <DrawerHeader eyebrow="مادة" title={editing?.label ?? "تعديل المادة"} description="كل التغييرات تبقى محلية حتى تضغط حفظ." />
          <DrawerBody>
            {editing ? (
              <div className="flex flex-col gap-5">
                <FormField label="الاسم العربي" required><TextField value={editing.label} onChange={(event) => setEditing((current) => current ? { ...current, label: event.target.value } : current)} /></FormField>
                <FormField label="الاسم الإنجليزي" required><TextField ltr value={editing.englishTitle} onChange={(event) => setEditing((current) => current ? { ...current, englishTitle: event.target.value } : current)} /></FormField>
                <FormField label="الصورة"><div className="flex items-center gap-3">{editing.asset ? <AssetThumb asset={editing.asset} size="md" /> : <Well padding="sm"><span className="text-xs text-fg-quaternary">لا توجد صورة</span></Well>}<Button size="sm" variant="secondary" onClick={() => setAssetPickerOpen(true)}>{editing.asset ? "تغيير الصورة" : "اختيار صورة"}</Button></div></FormField>
                <MaterialArtworkEditor material={previewMaterial(editing)} settings={settingsView} value={{ offsetX: editing.offsetX, offsetY: editing.offsetY, scale: editing.scale }} onChange={(draft: MaterialArtworkDraft) => setEditing((current) => current ? { ...current, ...draft } : current)} />
                <Panel><PanelBody><SettingRow label="متاحة للطالب" description="تغيير هذه الحالة ينعكس على قائمة الطالب فورًا." bordered={false}><Switch checked={editing.available} onCheckedChange={(available) => setEditing((current) => current ? { ...current, available } : current)} /></SettingRow></PanelBody></Panel>
              </div>
            ) : null}
          </DrawerBody>
          <DrawerFooter align="between"><span className="text-2xs text-fg-quaternary">المعرّف والرتبة ثابتان في هذه المرحلة.</span><div className="flex gap-2"><Button variant="quiet" onClick={() => setEditing(null)} disabled={saving}>إلغاء</Button><Button variant="primary" loading={saving} onClick={() => void saveMaterial()} disabled={!editing?.label.trim() || !editing?.englishTitle.trim()}>حفظ</Button></div></DrawerFooter>
        </DrawerContent>
      </Drawer>
      <AssetPicker open={assetPickerOpen} onOpenChange={setAssetPickerOpen} assets={imageAssets} value={editing?.asset?.id ?? null} kind="image" onSelect={(asset) => setEditing((current) => current ? { ...current, asset } : current)} />
    </>
  );
}
