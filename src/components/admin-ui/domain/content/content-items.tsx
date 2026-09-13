"use client";

import * as React from "react";
import {
  BarChart3,
  Calendar,
  ExternalLink,
  Eye,
  GraduationCap,
  Image as ImageIcon,
  LayoutGrid,
  Pencil,
  Smartphone,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  formatCompact,
  formatDate,
  formatPercent,
  formatRelative,
} from "@/lib/format";
import { Button, IconButton } from "../../primitives/button";
import { Panel, PanelHeader, Well } from "../../primitives/surface";
import { Badge, StatusBadge } from "../../status/status-badge";
import { Switch } from "../../forms/toggle";
import { Tooltip } from "../../primitives/tooltip";
import { InlineStat } from "../../charts/metrics";
import { Sparkline } from "../../charts/sparkline";
import { EmptyState } from "../../feedback/empty-state";
import { InlineNote } from "../../feedback/banner";
import { DatePicker } from "../../forms/date-picker";
import { FormField } from "../../forms/field";
import { TextField } from "../../forms/input";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuOverflowTrigger,
  MenuSeparator,
  MenuTrigger,
} from "../../overlays/menu";
import { AssetThumb, type Asset } from "./assets";
import { ReorderableList } from "./reorderable";

/* ============================================================================
   Banners, materials, navigation tools
   ---------------------------------------------------------------------------
   Three different content types that share one problem: they all appear in the
   student app in a specific order, with a specific availability, and the
   operator needs to see the *student's* view while editing.

   So each one pairs a management row with a preview that approximates the app,
   and each one separates two states that are easy to conflate:

     enabled   the operator's switch
     available whether students can actually reach it right now
               (schedule window, missing asset, unpublished dependency)

   A banner that is enabled but outside its schedule window is not live, and the
   UI says so instead of showing a green dot.
   ========================================================================== */

/* ============================================================================
   Banners
   ========================================================================== */

export interface Banner {
  id: string;
  title: string;
  subtitle?: string;
  asset: Asset | null;
  enabled: boolean;
  /** Order within the carousel. */
  position: number;
  /** Student-app artwork transform, expressed in the approved banner model. */
  offsetX: number;
  offsetY: number;
  scale: number;
  startsAt?: number | null;
  endsAt?: number | null;
  /** Deep link or external URL. */
  linkTarget?: string;
  linkLabel?: string;
  analytics?: {
    impressions: number;
    clicks: number;
    /** Daily impressions for the sparkline. */
    trend?: { value: number }[];
  };
  updatedAt: Date | string | number;
}

export type BannerAvailability =
  | "live"
  | "scheduled"
  | "expired"
  | "disabled"
  | "missingAsset";

export function resolveBannerAvailability(
  banner: Banner,
  now: Date | number = Date.now(),
): { state: BannerAvailability; label: string; detail?: string } {
  if (!banner.asset || banner.asset.integrity !== "ok") {
    return {
      state: "missingAsset",
      label: "صورة مفقودة",
      detail: "لن يظهر البانر للطلاب حتى إسناد صورة صالحة.",
    };
  }
  if (!banner.enabled) {
    return {
      state: "disabled",
      label: "معطّل",
      detail: "لا يظهر للطلاب. الإعدادات محفوظة.",
    };
  }
  const t = new Date(now).getTime();
  if (banner.startsAt && new Date(banner.startsAt).getTime() > t) {
    return {
      state: "scheduled",
      label: "مجدول",
      detail: `يبدأ الظهور في ${formatDate(banner.startsAt)}.`,
    };
  }
  if (banner.endsAt && new Date(banner.endsAt).getTime() <= t) {
    return {
      state: "expired",
      label: "منتهي",
      detail: `انتهى ظهوره في ${formatDate(banner.endsAt)}.`,
    };
  }
  return { state: "live", label: "ظاهر للطلاب" };
}

const BANNER_STATUS = {
  live: "active",
  scheduled: "scheduled",
  expired: "archived",
  disabled: "disabled",
  missingAsset: "failed",
} as const;

export function BannerRow({
  banner,
  onToggle,
  onEdit,
  onPreview,
  onDelete,
  onViewAnalytics,
  className,
}: {
  banner: Banner;
  onToggle?: (enabled: boolean) => void | Promise<void>;
  onEdit?: () => void;
  onPreview?: () => void;
  onDelete?: () => void;
  onViewAnalytics?: () => void;
  className?: string;
}) {
  const availability = resolveBannerAvailability(banner);
  const [busy, setBusy] = React.useState(false);
  const ctr =
    banner.analytics && banner.analytics.impressions > 0
      ? banner.analytics.clicks / banner.analytics.impressions
      : null;

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3", className)}>
      {banner.asset ? (
        <AssetThumb asset={banner.asset} size="lg" className="w-24" />
      ) : (
        <span className="grid size-16 w-24 shrink-0 place-items-center rounded-lg border border-dashed border-border bg-inset text-fg-quaternary">
          <ImageIcon className="size-4" aria-hidden />
        </span>
      )}

      <div className="min-w-48 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={onEdit}
            className="min-w-0 truncate text-sm font-medium text-fg hover:underline"
          >
            {banner.title}
          </button>
          <StatusBadge
            status={BANNER_STATUS[availability.state]}
            label={availability.label}
            size="sm"
          />
        </div>
        {banner.subtitle ? (
          <p className="mt-0.5 truncate text-xs text-fg-tertiary">
            {banner.subtitle}
          </p>
        ) : null}
        {availability.detail ? (
          <p
            className={cn(
              "mt-1 text-2xs",
              availability.state === "missingAsset"
                ? "text-danger-text"
                : "text-fg-quaternary",
            )}
          >
            {availability.detail}
          </p>
        ) : null}
        {banner.linkTarget ? (
          <p className="mt-1 flex items-center gap-1.5">
            <ExternalLink className="size-3 shrink-0 text-fg-quaternary" aria-hidden />
            <span
              dir="ltr"
              className="ltr-island truncate font-mono text-[10px] text-fg-quaternary"
            >
              {banner.linkTarget}
            </span>
          </p>
        ) : null}
      </div>

      {/* Schedule window */}
      <div className="hidden w-36 shrink-0 lg:block">
        {banner.startsAt || banner.endsAt ? (
          <div className="flex items-start gap-1.5 text-2xs text-fg-tertiary">
            <Calendar className="mt-px size-3 shrink-0" aria-hidden />
            <span>
              {banner.startsAt ? formatDate(banner.startsAt) : "بدون بداية"}
              {" — "}
              {banner.endsAt ? formatDate(banner.endsAt) : "بدون نهاية"}
            </span>
          </div>
        ) : (
          <span className="text-2xs text-fg-quaternary">دائم</span>
        )}
      </div>

      {/* Analytics */}
      <div className="hidden w-44 shrink-0 xl:block">
        {banner.analytics ? (
          <div className="flex items-center gap-3">
            {banner.analytics.trend?.length ? (
              <Sparkline data={banner.analytics.trend} height={20} width={44} />
            ) : null}
            <div className="min-w-0 space-y-0.5">
              <InlineStat
                label="ظهور"
                value={formatCompact(banner.analytics.impressions)}
              />
              <InlineStat
                label="نقر"
                value={
                  <span>
                    {formatCompact(banner.analytics.clicks)}
                    {ctr != null ? (
                      <span className="ms-1.5 text-fg-quaternary">
                        {formatPercent(ctr, { decimals: 1 })}
                      </span>
                    ) : null}
                  </span>
                }
              />
            </div>
          </div>
        ) : (
          <span className="text-2xs text-fg-quaternary">لا توجد بيانات</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Tooltip
          content={
            !banner.asset
              ? "أسند صورة قبل التفعيل"
              : banner.enabled
                ? "تعطيل"
                : "تفعيل"
          }
        >
          <Switch
            size="sm"
            checked={banner.enabled}
            pending={busy}
            disabled={!banner.asset}
            aria-label={banner.enabled ? "تعطيل البانر" : "تفعيل البانر"}
            onCheckedChange={async (v) => {
              setBusy(true);
              try {
                await onToggle?.(v);
              } finally {
                setBusy(false);
              }
            }}
          />
        </Tooltip>
        {onPreview ? (
          <IconButton label="معاينة" size="sm" variant="ghost" onClick={onPreview}>
            <Eye aria-hidden />
          </IconButton>
        ) : null}
        {onEdit ? (
          <IconButton label="تعديل" size="sm" variant="ghost" onClick={onEdit}>
            <Pencil aria-hidden />
          </IconButton>
        ) : null}
        <Menu>
          <MenuTrigger asChild>
            <MenuOverflowTrigger label={`إجراءات ${banner.title}`} />
          </MenuTrigger>
          <MenuContent className="min-w-44">
            {onViewAnalytics ? (
              <MenuItem icon={<BarChart3 aria-hidden />} onSelect={onViewAnalytics}>
                تحليلات البانر
              </MenuItem>
            ) : null}
            {onDelete ? (
              <>
                <MenuSeparator />
                <MenuItem icon={<Trash2 aria-hidden />} danger onSelect={onDelete}>
                  حذف البانر
                </MenuItem>
              </>
            ) : null}
          </MenuContent>
        </Menu>
      </div>
    </div>
  );
}

export function BannerList({
  banners,
  onReorder,
  onToggle,
  onEdit,
  onPreview,
  onDelete,
  onAdd,
  reorderDisabled,
  reorderDisabledReason,
  className,
}: {
  banners: Banner[];
  onReorder: (banners: Banner[]) => void;
  onToggle?: (banner: Banner, enabled: boolean) => void | Promise<void>;
  onEdit?: (banner: Banner) => void;
  onPreview?: (banner: Banner) => void;
  onDelete?: (banner: Banner) => void;
  onAdd?: () => void;
  reorderDisabled?: boolean;
  reorderDisabledReason?: React.ReactNode;
  className?: string;
}) {
  return (
    <ReorderableList
      items={banners}
      onReorder={onReorder}
      itemLabel="بانر"
      disabled={reorderDisabled}
      disabledReason={reorderDisabledReason}
      className={className}
      emptyState={
        <EmptyState
          kind="empty"
          bordered
          title="لا توجد بانرات"
          description="البانرات تظهر في أعلى الصفحة الرئيسية للطلاب، بالترتيب الذي تحدّده هنا."
          action={
            onAdd ? (
              <Button variant="primary" onClick={onAdd}>
                إضافة بانر
              </Button>
            ) : undefined
          }
        />
      }
      renderItem={(banner) => (
        <BannerRow
          banner={banner}
          onToggle={(v) => onToggle?.(banner, v)}
          onEdit={onEdit ? () => onEdit(banner) : undefined}
          onPreview={onPreview ? () => onPreview(banner) : undefined}
          onDelete={onDelete ? () => onDelete(banner) : undefined}
        />
      )}
    />
  );
}

/* ---------------------------------------------------------------------------
   BannerPreview — the student's view, at phone width.
   ------------------------------------------------------------------------ */

export function BannerPreview({
  banners,
  className,
  title = "معاينة الطالب",
}: {
  banners: Banner[];
  className?: string;
  title?: string;
}) {
  const live = banners.filter(
    (b) => resolveBannerAvailability(b).state === "live",
  );

  return (
    <Panel className={cn("min-w-0", className)}>
      <PanelHeader
        title={title}
        description="تقريب لما يراه الطالب في التطبيق. يعرض البانرات الظاهرة فقط."
        density="compact"
        icon={<Smartphone aria-hidden />}
      />
      <div className="p-4">
        {live.length === 0 ? (
          <Well padding="md">
            <p className="text-center text-xs text-fg-tertiary">
              لا يظهر أي بانر للطلاب حاليًا.
            </p>
          </Well>
        ) : (
          <div className="mx-auto w-full max-w-[19rem] overflow-hidden rounded-2xl border border-border-strong bg-bg p-2.5 shadow-sm">
            <div className="mb-2.5 flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-fg">فيثاغورس</span>
              <span className="size-5 rounded-full bg-inset" aria-hidden />
            </div>
            <div className="space-y-2">
              {live.slice(0, 3).map((b) => (
                <div
                  key={b.id}
                  className="relative overflow-hidden rounded-xl border border-border-subtle"
                >
                  {b.asset ? (
                    <AssetThumb
                      asset={b.asset}
                      size="xl"
                      className="rounded-none border-0"
                      showKind={false}
                    />
                  ) : null}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[rgba(0,0,0,0.72)] to-transparent p-2.5 pt-6">
                    <p className="truncate text-xs font-semibold text-white">
                      {b.title}
                    </p>
                    {b.subtitle ? (
                      <p className="truncate text-[10px] text-white/85">
                        {b.subtitle}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {live.length > 3 ? (
              <p className="mt-2 text-center text-[10px] text-fg-quaternary tnum">
                و{live.length - 3} بانرًا آخر في الدوّارة
              </p>
            ) : null}
          </div>
        )}
      </div>
    </Panel>
  );
}

/** Schedule fields shared by the banner editor. */
export function BannerScheduleFields({
  startsAt,
  endsAt,
  onChange,
  className,
}: {
  startsAt?: Date | null;
  endsAt?: Date | null;
  onChange: (next: { startsAt: Date | null; endsAt: Date | null }) => void;
  className?: string;
}) {
  const invalid =
    startsAt && endsAt && new Date(startsAt) > new Date(endsAt);

  return (
    <div className={cn("min-w-0 space-y-3", className)}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="بداية الظهور"
          optionalHint
          description="اتركه فارغًا ليظهر فورًا."
        >
          <DatePicker
            value={startsAt ?? null}
            onValueChange={(v) => onChange({ startsAt: v, endsAt: endsAt ?? null })}
          />
        </FormField>
        <FormField
          label="نهاية الظهور"
          optionalHint
          description="اتركه فارغًا ليبقى دائمًا."
          status={invalid ? "invalid" : "default"}
          message={
            invalid ? "تاريخ النهاية يجب أن يكون بعد تاريخ البداية." : undefined
          }
        >
          <DatePicker
            value={endsAt ?? null}
            onValueChange={(v) => onChange({ startsAt: startsAt ?? null, endsAt: v })}
            min={startsAt ?? undefined}
          />
        </FormField>
      </div>
      {startsAt && !invalid ? (
        <InlineNote tone="info" size="xs">
          سيصبح البانر ظاهرًا تلقائيًا في {formatDate(startsAt)} دون تدخل.
        </InlineNote>
      ) : null}
    </div>
  );
}

/* ============================================================================
   Materials
   ========================================================================== */

export interface Material {
  id: string;
  title: string;
  subtitle?: string;
  /** Technical key used by the app. */
  key: string;
  asset: Asset | null;
  enabled: boolean;
  /** Content exists and is published for this material. */
  available: boolean;
  availabilityDetail?: string;
  position: number;
  /** Counts shown on the card. */
  stats?: { questions?: number; lessons?: number };
  /** Accent used by the app for this subject. */
  accentColor?: string;
  updatedAt: Date | string | number;
}

export function MaterialCard({
  material,
  onToggle,
  onEdit,
  onOpen,
  className,
  /** Renders at student-app proportions rather than as an admin row. */
  preview = false,
}: {
  material: Material;
  onToggle?: (enabled: boolean) => void | Promise<void>;
  onEdit?: () => void;
  onOpen?: () => void;
  className?: string;
  preview?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const live = material.enabled && material.available;

  if (preview) {
    return (
      <div
        className={cn(
          "relative min-w-0 overflow-hidden rounded-xl border border-border-subtle",
          !live && "opacity-45 saturate-50",
          className,
        )}
      >
        {material.asset ? (
          <AssetThumb
            asset={material.asset}
            size="xl"
            className="rounded-none border-0"
            showKind={false}
          />
        ) : (
          <div className="grid aspect-[4/3] place-items-center bg-inset text-fg-quaternary">
            <GraduationCap className="size-5" aria-hidden />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[rgba(0,0,0,0.75)] to-transparent p-2.5 pt-7">
          <p className="truncate text-xs font-semibold text-white">
            {material.title}
          </p>
          {material.subtitle ? (
            <p className="truncate text-[10px] text-white/80">
              {material.subtitle}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3", className)}>
      {material.asset ? (
        <AssetThumb asset={material.asset} size="lg" className="w-20" />
      ) : (
        <span className="grid size-16 w-20 shrink-0 place-items-center rounded-lg border border-dashed border-border bg-inset text-fg-quaternary">
          <GraduationCap className="size-4" aria-hidden />
        </span>
      )}

      <div className="min-w-40 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={onOpen ?? onEdit}
            className="min-w-0 truncate text-sm font-medium text-fg hover:underline"
          >
            {material.title}
          </button>
          <span
            dir="ltr"
            className="ltr-island font-mono text-[10px] text-fg-quaternary"
          >
            {material.key}
          </span>
          <StatusBadge
            status={
              live
                ? "active"
                : !material.available
                  ? "notReady"
                  : "disabled"
            }
            label={
              live ? "متاحة للطلاب" : !material.available ? "بلا محتوى منشور" : "معطّلة"
            }
            size="sm"
          />
        </div>
        {material.subtitle ? (
          <p className="mt-0.5 truncate text-xs text-fg-tertiary">
            {material.subtitle}
          </p>
        ) : null}
        {!material.available && material.availabilityDetail ? (
          <p className="mt-1 text-2xs text-warning-text">
            {material.availabilityDetail}
          </p>
        ) : null}
        {material.stats ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {material.stats.questions != null ? (
              <InlineStat
                label="أسئلة"
                value={formatCompact(material.stats.questions)}
              />
            ) : null}
            {material.stats.lessons != null ? (
              <InlineStat
                label="دروس"
                value={formatCompact(material.stats.lessons)}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <span className="hidden w-20 shrink-0 text-2xs text-fg-quaternary sm:block">
        {formatRelative(material.updatedAt)}
      </span>

      <div className="flex shrink-0 items-center gap-1">
        <Tooltip
          content={
            !material.available
              ? "لا يوجد محتوى منشور لهذه المادة"
              : material.enabled
                ? "تعطيل"
                : "تفعيل"
          }
        >
          <Switch
            size="sm"
            checked={material.enabled}
            pending={busy}
            disabled={!material.available}
            aria-label={material.enabled ? "تعطيل المادة" : "تفعيل المادة"}
            onCheckedChange={async (v) => {
              setBusy(true);
              try {
                await onToggle?.(v);
              } finally {
                setBusy(false);
              }
            }}
          />
        </Tooltip>
        {onEdit ? (
          <IconButton label="تعديل" size="sm" variant="ghost" onClick={onEdit}>
            <Pencil aria-hidden />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}

export function MaterialPreviewGrid({
  materials,
  className,
}: {
  materials: Material[];
  className?: string;
}) {
  return (
    <Panel className={cn("min-w-0", className)}>
      <PanelHeader
        title="معاينة شبكة المواد"
        description="ترتيب المواد وظهورها كما يراها الطالب."
        density="compact"
        icon={<LayoutGrid aria-hidden />}
      />
      <div className="p-4">
        <div className="mx-auto grid w-full max-w-[19rem] grid-cols-2 gap-2.5">
          {materials.map((m) => (
            <MaterialCard key={m.id} material={m} preview />
          ))}
        </div>
        <p className="mt-3 text-center text-2xs text-fg-quaternary">
          المواد المعطّلة أو بلا محتوى تظهر باهتة هنا، ولا تظهر للطالب إطلاقًا.
        </p>
      </div>
    </Panel>
  );
}

/* ============================================================================
   Navigation tools — the student app's tool rail.
   ========================================================================== */

export interface NavTool {
  id: string;
  label: string;
  /** Icon name in the app's icon set — technical. */
  iconKey: string;
  /** Route in the student app. */
  destination: string;
  enabled: boolean;
  /** Shipped and reachable. */
  available: boolean;
  /** Shown to students as "coming soon" rather than hidden. */
  comingSoon?: boolean;
  position: number;
  note?: string;
}

export function NavToolRow({
  tool,
  onToggle,
  onEdit,
  onDelete,
  className,
}: {
  tool: NavTool;
  onToggle?: (enabled: boolean) => void | Promise<void>;
  onEdit?: () => void;
  onDelete?: () => void;
  className?: string;
}) {
  const [busy, setBusy] = React.useState(false);

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2", className)}>
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-inset text-fg-tertiary">
        <LayoutGrid className="size-4" aria-hidden />
      </span>

      <div className="min-w-40 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium text-fg">{tool.label}</span>
          {tool.comingSoon ? (
            <Badge size="sm" variant="subtle" tone="future">
              قريبًا للطلاب
            </Badge>
          ) : null}
          <StatusBadge
            status={
              !tool.available
                ? "notReady"
                : tool.comingSoon
                  ? "comingSoon"
                  : tool.enabled
                    ? "active"
                    : "disabled"
            }
            label={
              !tool.available
                ? "غير متاح"
                : tool.comingSoon
                  ? "معروض كقريبًا"
                  : tool.enabled
                    ? "ظاهر"
                    : "مخفي"
            }
            size="sm"
          />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
          <span
            dir="ltr"
            className="ltr-island font-mono text-[10px] text-fg-quaternary"
          >
            {tool.iconKey}
          </span>
          <span
            dir="ltr"
            className="ltr-island truncate font-mono text-[10px] text-fg-quaternary"
          >
            {tool.destination}
          </span>
        </div>
        {tool.note ? (
          <p className="mt-1 text-2xs text-fg-quaternary">{tool.note}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Tooltip
          content={
            !tool.available
              ? "الأداة غير مبنية بعد"
              : tool.enabled
                ? "إخفاء من التطبيق"
                : "إظهار في التطبيق"
          }
        >
          <Switch
            size="sm"
            checked={tool.enabled}
            pending={busy}
            disabled={!tool.available}
            aria-label={tool.enabled ? "إخفاء الأداة" : "إظهار الأداة"}
            onCheckedChange={async (v) => {
              setBusy(true);
              try {
                await onToggle?.(v);
              } finally {
                setBusy(false);
              }
            }}
          />
        </Tooltip>
        {onEdit ? (
          <IconButton label="تعديل" size="sm" variant="ghost" onClick={onEdit}>
            <Pencil aria-hidden />
          </IconButton>
        ) : null}
        {onDelete ? (
          <IconButton
            label="حذف"
            size="sm"
            variant="ghost"
            className="hover:text-danger-text"
            onClick={onDelete}
          >
            <Trash2 aria-hidden />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}

export function NavToolList({
  tools,
  onReorder,
  onToggle,
  onEdit,
  onDelete,
  onAdd,
  className,
}: {
  tools: NavTool[];
  onReorder: (tools: NavTool[]) => void;
  onToggle?: (tool: NavTool, enabled: boolean) => void | Promise<void>;
  onEdit?: (tool: NavTool) => void;
  onDelete?: (tool: NavTool) => void;
  onAdd?: () => void;
  className?: string;
}) {
  return (
    <ReorderableList
      items={tools}
      onReorder={onReorder}
      itemLabel="أداة"
      className={className}
      emptyState={
        <EmptyState
          kind="empty"
          bordered
          title="لا توجد أدوات"
          description="الأدوات تظهر في شريط التنقل السفلي في تطبيق الطالب."
          action={
            onAdd ? (
              <Button variant="primary" onClick={onAdd}>
                إضافة أداة
              </Button>
            ) : undefined
          }
        />
      }
      renderItem={(tool) => (
        <NavToolRow
          tool={tool}
          onToggle={(v) => onToggle?.(tool, v)}
          onEdit={onEdit ? () => onEdit(tool) : undefined}
          onDelete={onDelete ? () => onDelete(tool) : undefined}
        />
      )}
    />
  );
}

/** Small editor used by both the banner and nav-tool forms. */
export function LinkTargetField({
  value,
  onChange,
  label = "الوجهة",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
}) {
  const isExternal = /^https?:\/\//.test(value);
  return (
    <FormField
      label={label}
      className={className}
      description={
        isExternal
          ? "رابط خارجي — سيُفتح في المتصفح خارج التطبيق."
          : "مسار داخلي في تطبيق الطالب، مثل /materials/physics."
      }
      labelAction={
        isExternal ? (
          <Badge size="sm" variant="subtle" tone="warning">
            خارجي
          </Badge>
        ) : undefined
      }
    >
      <TextField
        ltr
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="/materials/physics"
        prefix={<ExternalLink aria-hidden />}
      />
    </FormField>
  );
}
