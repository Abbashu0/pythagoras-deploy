"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  Database,
  Eye,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LiveBottomNavPreview } from "@/components/admin/LiveBottomNavPreview";
import { LiveCardGridPreview } from "@/components/admin/LiveCardGridPreview";
import { LiveCarouselPreview } from "@/components/admin/LiveCarouselPreview";
import { MaterialCardPreview } from "@/components/admin/MaterialCardPreview";
import type { SponsoredBanner } from "@/lib/admin/banner-model";
import type { CanonicalContentSnapshot } from "@/server/canonical-content/contracts";

export function CanonicalCutoverPanel() {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<CanonicalContentSnapshot | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => {
    void fetch("/api/admin/content", { cache: "no-store" }).then(
      async (response) => {
        const body = (await response.json()) as {
          snapshot?: CanonicalContentSnapshot;
        };
        if (response.ok && body.snapshot) setSnapshot(body.snapshot);
      },
    );
  }, []);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/content/cutover", {
        method: "POST",
      });
      const body = (await response.json()) as {
        changeSet?: { changeSet: { id: string } };
        alreadyCanonical?: boolean;
        code?: string;
      };
      if (!response.ok)
        throw new Error(body.code ?? "تعذر إنشاء قرار التحويل.");
      if (body.changeSet)
        router.push(`/admin/review/${body.changeSet.changeSet.id}`);
      else router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذر إنشاء قرار التحويل.",
      );
      setBusy(false);
    }
  };
  return (
    <section
      className="mb-6 rounded-3xl border bg-card p-5 shadow-sm"
      dir="rtl"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-primary">
              M7 · مصدر تطبيق الطالب
            </p>
            <h2 className="text-lg font-black">
              التحويل المنضبط إلى المحتوى القانوني
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-6 text-muted-foreground">
              هذا الإجراء لا يقرأ أو يحذف بيانات المتصفح. ينشئ Change Set
              مستقلًا، ثم يتطلب اعتماد OWNER ونشره. تُنشأ نسخة SQLite احتياطية
              تلقائيًا لحظة النشر.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!snapshot}
            onClick={() => setPreviewOpen(true)}
          >
            <Eye className="ml-2 h-4 w-4" />
            معاينة Canonical
          </Button>
          {snapshot?.state.runtimeSourceMode === "CANONICAL" ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
              المصدر القانوني مفعّل
            </span>
          ) : (
            <Button disabled={!snapshot || busy} onClick={() => void create()}>
              {busy ? (
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="ml-2 h-4 w-4" />
              )}
              إنشاء قرار التحويل للمراجعة
            </Button>
          )}
        </div>
      </div>
      {snapshot ? (
        <div className="mt-4 grid grid-cols-2 gap-2 border-t pt-4 text-center text-xs sm:grid-cols-5">
          <Metric
            label="المصدر الحالي"
            value={snapshot.state.runtimeSourceMode}
          />
          <Metric label="البانرات" value={String(snapshot.banners.length)} />
          <Metric label="المواد" value={String(snapshot.materials.length)} />
          <Metric label="الأدوات" value={String(snapshot.tools.length)} />
          <Metric label="نسخة النشر" value={`#${snapshot.contentRevision}`} />
        </div>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-xl bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          className="max-h-[92vh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-6xl"
          dir="rtl"
        >
          <DialogHeader>
            <DialogTitle>معاينة المحتوى القانوني قبل التحويل</DialogTitle>
            <DialogDescription>
              عرض عالي الدقة للحالة القانونية الحالية فقط. لا يعرض المسودات ولا
              يغيّر مصدر تطبيق الطالب.
            </DialogDescription>
          </DialogHeader>
          {snapshot ? <CanonicalStudentPreview snapshot={snapshot} /> : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/50 px-3 py-2">
      <div className="font-bold">{value}</div>
      <div className="mt-1 text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
function PreviewSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-bold">{title}</h3>
      {children}
    </section>
  );
}

function previewBanner(
  item: CanonicalContentSnapshot["banners"][number],
): SponsoredBanner {
  return {
    id: item.id,
    bannerType: item.bannerType.toLowerCase() as SponsoredBanner["bannerType"],
    image: item.asset ? `/api/admin/assets/${item.asset.id}/content` : "",
    gradient: item.gradient,
    iconKey: item.iconKey,
    title: item.title,
    subtitle: item.subtitle,
    enabled: item.status === "ACTIVE",
    status: item.status === "ACTIVE" ? "active" : "archived",
    displayOrder: item.displayOrder,
    transform: {
      offsetX: item.offsetX,
      offsetY: item.offsetY,
      scale: item.scale,
    },
    createdAt: new Date(item.createdAt).toISOString(),
    updatedAt: new Date(item.updatedAt).toISOString(),
  };
}

function CanonicalStudentPreview({
  snapshot,
}: {
  snapshot: CanonicalContentSnapshot;
}) {
  const banners = snapshot.banners
    .filter((item) => item.status === "ACTIVE")
    .sort((a, b) => a.displayOrder - b.displayOrder);
  const materials = snapshot.materials
    .filter((item) => item.available)
    .sort((a, b) => a.displayOrder - b.displayOrder);
  return (
    <div className="space-y-7">
      <div className="grid gap-3 rounded-2xl border bg-muted/20 p-4 text-xs sm:grid-cols-4">
        <Metric label="بانرات نشطة" value={String(banners.length)} />
        <Metric label="مواد ظاهرة" value={String(materials.length)} />
        <Metric
          label="فاصل الكاروسيل"
          value={`${snapshot.carouselSettings.autoSlideInterval / 1000} ث`}
        />
        <Metric label="نسخة النشر" value={`#${snapshot.contentRevision}`} />
      </div>
      <PreviewSection title="بانرات الصفحة الرئيسية — بالترتيب">
        <div className="grid gap-4 lg:grid-cols-2">
          {banners.map((item) => (
            <div key={item.id} className="space-y-2">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  #{item.displayOrder} · {item.bannerType}
                </span>
                <span>{item.asset ? item.asset.displayName : "تدرّج"}</span>
              </div>
              <div className="overflow-x-auto rounded-2xl bg-[#070a10] p-4">
                <LiveCarouselPreview
                  banner={previewBanner(item)}
                  allBanners={banners.map(previewBanner)}
                />
              </div>
            </div>
          ))}
        </div>
      </PreviewSection>
      <PreviewSection title="بطاقات المواد — المظهر الفعلي">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {materials.map((item) => (
            <MaterialCardPreview
              key={item.id}
              image={
                item.asset
                  ? `/api/admin/assets/${item.asset.id}/content`
                  : undefined
              }
              gradient={item.gradient}
              transform={{
                offsetX: item.offsetX,
                offsetY: item.offsetY,
                scale: item.scale,
              }}
              title={item.label}
              englishTitle={item.englishTitle}
              fadeIntensity={snapshot.materialSettings.fadeIntensity}
              textVerticalPosition={
                snapshot.materialSettings.textVerticalPosition
              }
              textScale={snapshot.materialSettings.textScale}
              cardHeight={snapshot.materialSettings.cardHeight}
              maxWidth={360}
            />
          ))}
        </div>
      </PreviewSection>
      <PreviewSection title="الأدوات">
        <LiveCardGridPreview
          items={snapshot.tools.map((item, order) => ({
            id: item.id,
            label: item.label,
            icon: item.iconKey,
            available: item.available,
            order,
          }))}
          headerLabel="المتاح وقريبًا"
          variant="list"
        />
      </PreviewSection>
      <PreviewSection title="شريط التنقل">
        <LiveBottomNavPreview
          items={snapshot.navigation
            .filter((item) => item.enabled)
            .map((item, order) => ({
              id: item.id,
              label: item.label,
              icon: item.iconKey,
              enabled: true,
              order,
            }))}
        />
      </PreviewSection>
    </div>
  );
}
