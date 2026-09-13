"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  Download,
  FileImage,
  FileText,
  Film,
  Grid2x2,
  Image as ImageIcon,
  List,
  Music,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatBytes, formatExact, formatRelative } from "@/lib/format";
import { Button, IconButton } from "../../primitives/button";
import { Panel, PanelHeader, Well } from "../../primitives/surface";
import { Badge, StatusBadge } from "../../status/status-badge";
import { Checkbox } from "../../forms/toggle";
import { Tooltip } from "../../primitives/tooltip";
import { TechnicalId } from "../../primitives/mono";
import { ProgressBar } from "../../primitives/progress";
import { SegmentedControl } from "../../forms/segmented";
import { DefinitionItem, DefinitionList } from "../../primitives/surface";
import { InlineNote } from "../../feedback/banner";
import { EmptyState } from "../../feedback/empty-state";
import { Slider } from "../../forms/slider";
import { InlineEditableField, TagsEditor } from "../../forms/editable";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "../../overlays/dialog";
import { SearchInput } from "../../forms/input";
import { DependencyBadge, type Dependent } from "../../governance/destructive";

/* ============================================================================
   Asset library
   ---------------------------------------------------------------------------
   Assets are referenced by banners, materials and question content, so the two
   things this UI must never let an operator do blindly are: delete an asset that
   is in use, and upload something that silently fails validation.

   Hence:
   - Every asset row/tile carries its reference count. Zero references reads as
     "safe to remove"; a non-zero count is a link to what uses it.
   - The upload zone reports per-file progress and per-file failure, with the
     reason. A batch upload where one file fails must not look like success.
   - Integrity state is explicit: an asset whose file is missing from storage is
     a real condition and it gets its own status rather than a broken image.
   ========================================================================== */

export type AssetKind =
  | "image"
  | "document"
  | "audio"
  | "video"
  | "json"
  | "other-safe-file";

export type AssetIntegrity = "ok" | "missing" | "processing" | "failed";

export interface Asset {
  id: string;
  /** Display name, editable. */
  name: string;
  /** Storage key / path — technical, LTR. */
  storageKey: string;
  kind: AssetKind;
  mimeType: string;
  sizeBytes: number;
  /** Preview URL. Absent for non-visual assets. */
  previewUrl?: string | null;
  width?: number;
  height?: number;
  /** How many entities reference this asset. */
  referenceCount: number;
  /** What references it, for the delete dialog. */
  references?: Dependent[];
  integrity: AssetIntegrity;
  integrityDetail?: string;
  tags: string[];
  uploadedAt: Date | string | number;
  uploadedBy?: string;
  /** Focal point for cropping, 0–100 on each axis. */
  focalPoint?: { x: number; y: number };
}

const KIND_ICON: Record<AssetKind, typeof FileImage> = {
  image: ImageIcon,
  document: FileText,
  audio: Music,
  video: Film,
  json: FileText,
  "other-safe-file": FileText,
};

const INTEGRITY_STATUS = {
  ok: "healthy",
  missing: "failed",
  processing: "processing",
  failed: "failed",
} as const;

/* ---------------------------------------------------------------------------
   AssetThumb — one preview treatment, reused everywhere.
   ------------------------------------------------------------------------ */

export function AssetThumb({
  asset,
  size = "md",
  className,
  showKind = true,
}: {
  asset: Asset;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  showKind?: boolean;
}) {
  const Icon = KIND_ICON[asset.kind];
  const sizes = {
    sm: "size-8 rounded-md",
    md: "size-11 rounded-md",
    lg: "size-16 rounded-lg",
    xl: "aspect-[4/3] w-full rounded-lg",
  } as const;

  const broken = asset.integrity === "missing" || asset.integrity === "failed";

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden border border-border-subtle bg-inset",
        sizes[size],
        className,
      )}
    >
      {asset.previewUrl && !broken ? (
        // Intentionally a plain <img>: assets come from an arbitrary storage
        // origin, and the lab has no image-optimisation backend.
        <img
          src={asset.previewUrl}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          style={
            asset.focalPoint
              ? {
                  objectPosition: `${asset.focalPoint.x}% ${asset.focalPoint.y}%`,
                }
              : undefined
          }
        />
      ) : (
        <span className="grid size-full place-items-center text-fg-quaternary">
          {broken ? (
            <AlertTriangle className="size-4 text-danger-text" aria-hidden />
          ) : (
            <Icon className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden />
          )}
        </span>
      )}

      {showKind && asset.kind !== "image" ? (
        <span className="absolute bottom-0.5 end-0.5 rounded-[3px] bg-scrim px-1 text-[9px] font-medium text-white">
          {asset.kind === "document"
            ? "PDF"
            : asset.kind === "audio"
              ? "صوت"
              : asset.kind === "video"
                ? "فيديو"
                : asset.kind === "json"
                  ? "JSON"
                  : "ملف"}
        </span>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   AssetGrid / AssetList
   ------------------------------------------------------------------------ */

export interface AssetActions {
  onOpen?: (asset: Asset) => void;
  onDelete?: (asset: Asset) => void;
  onDownload?: (asset: Asset) => void;
  onRename?: (asset: Asset, name: string) => void;
  onViewReferences?: (asset: Asset) => void;
}

export function AssetGrid({
  assets,
  actions = {},
  selectedIds,
  onSelectionChange,
  activeId,
  className,
  columns = 4,
}: {
  assets: Asset[];
  actions?: AssetActions;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  activeId?: string | null;
  className?: string;
  columns?: 3 | 4 | 5 | 6;
}) {
  const selectable = Boolean(onSelectionChange);
  const selected = selectedIds ?? [];

  const toggle = (id: string) =>
    onSelectionChange?.(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );

  return (
    <ul
      className={cn(
        "grid gap-3",
        columns === 3 && "grid-cols-2 sm:grid-cols-3",
        columns === 4 && "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
        columns === 5 && "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
        columns === 6 && "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6",
        className,
      )}
    >
      {assets.map((asset) => {
        const isSelected = selected.includes(asset.id);
        return (
          <li key={asset.id} className="min-w-0">
            <div
              className={cn(
                "group/at relative min-w-0 overflow-hidden rounded-lg border bg-surface transition-colors",
                isSelected
                  ? "border-accent-border ring-2 ring-[var(--accent-subtle)]"
                  : activeId === asset.id
                    ? "border-accent-border"
                    : "border-border hover:border-border-strong",
              )}
            >
              <button
                type="button"
                onClick={() => actions.onOpen?.(asset)}
                className="block w-full text-start focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]"
              >
                <AssetThumb asset={asset} size="xl" className="rounded-none border-0 border-b" />
              </button>

              {selectable ? (
                <span
                  className={cn(
                    "absolute start-2 top-2 transition-opacity",
                    isSelected ? "opacity-100" : "opacity-0 group-hover/at:opacity-100",
                  )}
                >
                  <Checkbox
                    size="sm"
                    checked={isSelected}
                    onCheckedChange={() => toggle(asset.id)}
                    aria-label={`تحديد ${asset.name}`}
                    className="rounded-[4px] bg-surface"
                  />
                </span>
              ) : null}

              {asset.integrity !== "ok" ? (
                <span className="absolute end-2 top-2">
                  <StatusBadge
                    status={INTEGRITY_STATUS[asset.integrity]}
                    size="sm"
                    label={
                      asset.integrity === "missing"
                        ? "ملف مفقود"
                        : asset.integrity === "processing"
                          ? "قيد المعالجة"
                          : "فشل"
                    }
                  />
                </span>
              ) : null}

              <div className="min-w-0 p-2.5">
                <p className="truncate text-xs font-medium text-fg" title={asset.name}>
                  {asset.name}
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-fg-quaternary tnum">
                    {formatBytes(asset.sizeBytes)}
                    {asset.width && asset.height
                      ? ` · ${asset.width}×${asset.height}`
                      : null}
                  </span>
                  {asset.referenceCount > 0 ? (
                    <Tooltip content="عدد العناصر التي تستخدم هذا الملف">
                      <span className="cursor-default">
                        <DependencyBadge count={asset.referenceCount} label="استخدام" />
                      </span>
                    </Tooltip>
                  ) : (
                    <span className="text-[10px] text-fg-quaternary">غير مستخدم</span>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function AssetList({
  assets,
  actions = {},
  activeId,
  className,
}: {
  assets: Asset[];
  actions?: AssetActions;
  activeId?: string | null;
  className?: string;
}) {
  return (
    <Panel padding="none" clip className={cn("min-w-0", className)}>
      <ul className="divide-y divide-border-subtle">
        {assets.map((asset) => (
          <li
            key={asset.id}
            className={cn(
              "group/ar flex min-w-0 items-center gap-3 px-3.5 py-2.5 transition-colors",
              activeId === asset.id ? "bg-selected" : "hover:bg-hover",
            )}
          >
            <AssetThumb asset={asset} size="md" />
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => actions.onOpen?.(asset)}
                className="block min-w-0 truncate text-sm font-medium text-fg hover:underline"
              >
                {asset.name}
              </button>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <TechnicalId value={asset.id} size="sm" truncate={32} />
                <span className="text-2xs text-fg-quaternary tnum">
                  {formatBytes(asset.sizeBytes)}
                </span>
                {asset.width && asset.height ? (
                  <span className="text-2xs text-fg-quaternary tnum">
                    {asset.width}×{asset.height}
                  </span>
                ) : null}
              </div>
            </div>

            {asset.integrity !== "ok" ? (
              <StatusBadge
                status={INTEGRITY_STATUS[asset.integrity]}
                size="sm"
                label={asset.integrity === "missing" ? "ملف مفقود" : undefined}
              />
            ) : null}

            {asset.referenceCount > 0 ? (
              <button
                type="button"
                onClick={() => actions.onViewReferences?.(asset)}
                className="shrink-0"
              >
                <DependencyBadge count={asset.referenceCount} label="استخدام" />
              </button>
            ) : (
              <span className="shrink-0 text-2xs text-fg-quaternary">غير مستخدم</span>
            )}

            <Tooltip content={formatExact(asset.uploadedAt)}>
              <span className="hidden w-20 shrink-0 cursor-default text-2xs text-fg-quaternary sm:block">
                {formatRelative(asset.uploadedAt)}
              </span>
            </Tooltip>

            <div className="flex shrink-0 items-center gap-0.5">
              {actions.onDownload ? (
                <IconButton
                  label="تنزيل"
                  size="sm"
                  variant="ghost"
                  onClick={() => actions.onDownload?.(asset)}
                >
                  <Download aria-hidden />
                </IconButton>
              ) : null}
              {actions.onDelete ? (
                <Tooltip
                  content={
                    asset.referenceCount > 0
                      ? `مستخدم بواسطة ${asset.referenceCount} عنصرًا`
                      : "حذف الملف"
                  }
                >
                  <IconButton
                    label="حذف"
                    size="sm"
                    variant="ghost"
                    className="hover:text-danger-text"
                    onClick={() => actions.onDelete?.(asset)}
                  >
                    <Trash2 aria-hidden />
                  </IconButton>
                </Tooltip>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** View switch shared by the asset library toolbar. */
export function AssetViewToggle({
  value,
  onValueChange,
}: {
  value: "grid" | "list";
  onValueChange: (value: "grid" | "list") => void;
}) {
  return (
    <SegmentedControl
      size="sm"
      aria-label="طريقة العرض"
      value={value}
      onValueChange={onValueChange}
      options={[
        { value: "grid", icon: <Grid2x2 aria-hidden />, ariaLabel: "شبكة", tooltip: "شبكة" },
        { value: "list", icon: <List aria-hidden />, ariaLabel: "قائمة", tooltip: "قائمة" },
      ]}
    />
  );
}

/* ============================================================================
   UploadZone
   ========================================================================== */

export interface UploadItem {
  id: string;
  name: string;
  sizeBytes: number;
  progress: number;
  state: "queued" | "uploading" | "done" | "failed";
  /** Humanised failure reason. */
  error?: string;
}

export function UploadZone({
  onFiles,
  uploads = [],
  onRemoveUpload,
  onRetryUpload,
  accept = "image/png, image/jpeg, image/webp, image/svg+xml, application/pdf",
  maxSizeBytes = 8 * 1024 * 1024,
  className,
  hint,
}: {
  onFiles: (files: File[]) => void;
  uploads?: UploadItem[];
  onRemoveUpload?: (id: string) => void;
  onRetryUpload?: (id: string) => void;
  accept?: string;
  maxSizeBytes?: number;
  className?: string;
  hint?: React.ReactNode;
}) {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handle = (files: FileList | null) => {
    if (!files?.length) return;
    onFiles(Array.from(files));
  };

  const active = uploads.filter((u) => u.state !== "done");
  const failed = uploads.filter((u) => u.state === "failed");

  return (
    <div className={cn("min-w-0", className)}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handle(e.dataTransfer.files);
        }}
        className={cn(
          "rounded-lg border-2 border-dashed p-6 text-center transition-colors",
          dragging
            ? "border-accent bg-accent-subtle"
            : "border-border bg-inset/50",
        )}
      >
        <span className="mx-auto grid size-10 place-items-center rounded-full bg-surface text-fg-tertiary">
          <Upload className="size-4" aria-hidden />
        </span>
        <p className="mt-3 text-sm font-medium text-fg">
          اسحب الملفات هنا أو اخترها من جهازك
        </p>
        <p className="mt-1 text-xs text-fg-tertiary">
          {hint ?? (
            <>
              الصور و PDF حتى {formatBytes(maxSizeBytes)} للملف الواحد.
            </>
          )}
        </p>
        <Button
          size="sm"
          variant="secondary"
          className="mt-3"
          onClick={() => inputRef.current?.click()}
        >
          اختيار ملفات
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          onChange={(e) => handle(e.target.files)}
          className="sr-only"
          aria-label="اختيار ملفات للرفع"
        />
      </div>

      {failed.length > 0 ? (
        <InlineNote tone="danger" className="mt-3">
          فشل رفع {failed.length} ملفًا. راجع السبب لكل ملف أدناه.
        </InlineNote>
      ) : null}

      {uploads.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {uploads.map((u) => (
            <li
              key={u.id}
              className={cn(
                "flex min-w-0 items-center gap-3 rounded-md border px-3 py-2.5",
                u.state === "failed"
                  ? "border-danger-border bg-danger-subtle"
                  : "border-border bg-surface",
              )}
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-md",
                  u.state === "done"
                    ? "bg-success-subtle text-success-text"
                    : u.state === "failed"
                      ? "bg-danger-subtle text-danger-text"
                      : "bg-inset text-fg-tertiary",
                )}
              >
                {u.state === "done" ? (
                  <Check className="size-3.5" aria-hidden />
                ) : u.state === "failed" ? (
                  <AlertTriangle className="size-3.5" aria-hidden />
                ) : (
                  <FileImage className="size-3.5" aria-hidden />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-xs font-medium text-fg">
                    {u.name}
                  </span>
                  <span className="shrink-0 text-2xs text-fg-quaternary tnum">
                    {formatBytes(u.sizeBytes)}
                  </span>
                </div>
                {u.state === "uploading" || u.state === "queued" ? (
                  <ProgressBar
                    value={u.progress}
                    size="xs"
                    className="mt-1.5"
                    tone="accent"
                  />
                ) : u.error ? (
                  <p className="mt-1 text-2xs text-danger-text">{u.error}</p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                {u.state === "failed" && onRetryUpload ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => onRetryUpload(u.id)}
                  >
                    إعادة
                  </Button>
                ) : null}
                {onRemoveUpload && u.state !== "uploading" ? (
                  <IconButton
                    label="إزالة"
                    size="xs"
                    variant="ghost"
                    onClick={() => onRemoveUpload(u.id)}
                  >
                    <X aria-hidden />
                  </IconButton>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {active.length > 0 ? (
        <p className="mt-2 text-2xs text-fg-quaternary tnum">
          {active.length} ملفًا قيد الرفع
        </p>
      ) : null}
    </div>
  );
}

/* ============================================================================
   AssetInspector — metadata panel for the selected asset.
   ========================================================================== */

export function AssetInspector({
  asset,
  onRename,
  onTagsChange,
  onFocalPointChange,
  onDelete,
  onDownload,
  onViewReferences,
  className,
}: {
  asset: Asset;
  onRename?: (name: string) => void;
  onTagsChange?: (tags: string[]) => void;
  onFocalPointChange?: (point: { x: number; y: number }) => void;
  onDelete?: () => void;
  onDownload?: () => void;
  onViewReferences?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-5", className)}>
      <AssetThumb asset={asset} size="xl" />

      {asset.integrity !== "ok" ? (
        <InlineNote tone="danger">
          {asset.integrityDetail ??
            "الملف غير موجود في وحدة التخزين. العناصر التي تستخدمه ستظهر بلا صورة."}
        </InlineNote>
      ) : null}

      <div>
        <p className="eyebrow mb-1.5">الاسم</p>
        {onRename ? (
          <InlineEditableField
            value={asset.name}
            onCommit={onRename}
            variant="title"
            ariaLabel="تعديل اسم الملف"
          />
        ) : (
          <p className="text-sm font-medium text-fg">{asset.name}</p>
        )}
      </div>

      <DefinitionList columns={1} density="compact">
        <DefinitionItem label="المعرّف" inline>
          <TechnicalId value={asset.id} size="sm" truncate={24} />
        </DefinitionItem>
        <DefinitionItem label="النوع" inline>
          <span dir="ltr" className="ltr-island font-mono text-2xs">
            {asset.mimeType}
          </span>
        </DefinitionItem>
        <DefinitionItem label="الحجم" inline>
          {formatBytes(asset.sizeBytes)}
        </DefinitionItem>
        {asset.width && asset.height ? (
          <DefinitionItem label="الأبعاد" inline>
            <span className="tnum">
              {asset.width} × {asset.height}
            </span>
          </DefinitionItem>
        ) : null}
        <DefinitionItem label="أُضيف" inline>
          <Tooltip content={formatExact(asset.uploadedAt)}>
            <span className="cursor-default">
              {formatRelative(asset.uploadedAt)}
            </span>
          </Tooltip>
        </DefinitionItem>
        {asset.uploadedBy ? (
          <DefinitionItem label="بواسطة" inline>
            {asset.uploadedBy}
          </DefinitionItem>
        ) : null}
      </DefinitionList>

      <div>
        <p className="eyebrow mb-1.5">الاستخدام</p>
        {asset.referenceCount === 0 ? (
          <p className="text-xs text-fg-tertiary">
            غير مستخدم في أي مكان. يمكن حذفه بأمان.
          </p>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <DependencyBadge count={asset.referenceCount} label="عنصرًا يستخدمه" />
            {onViewReferences ? (
              <Button size="xs" variant="link" onClick={onViewReferences}>
                عرض الاستخدامات
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {onTagsChange ? (
        <div>
          <p className="eyebrow mb-1.5">الوسوم</p>
          <TagsEditor
            value={asset.tags}
            onValueChange={onTagsChange}
            placeholder="أضف وسمًا"
          />
        </div>
      ) : null}

      {asset.kind === "image" && onFocalPointChange ? (
        <ImagePositionControl
          value={asset.focalPoint ?? { x: 50, y: 50 }}
          onChange={onFocalPointChange}
          previewUrl={asset.previewUrl ?? undefined}
        />
      ) : null}

      <div className="flex items-center gap-2 border-t border-border-subtle pt-4">
        {onDownload ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<Download aria-hidden />}
            onClick={onDownload}
          >
            تنزيل
          </Button>
        ) : null}
        {onDelete ? (
          <Button
            size="sm"
            variant="dangerGhost"
            icon={<Trash2 aria-hidden />}
            onClick={onDelete}
          >
            حذف
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   ImagePositionControl — the focal point an operator sets so a banner crop
   keeps the important part of the image. Live preview, because guessing
   percentages is not a design task anyone should have to do in their head.
   ------------------------------------------------------------------------ */

export function ImagePositionControl({
  value,
  onChange,
  previewUrl,
  className,
  aspectRatio = "16 / 9",
}: {
  value: { x: number; y: number };
  onChange: (value: { x: number; y: number }) => void;
  previewUrl?: string;
  className?: string;
  aspectRatio?: string;
}) {
  const boxRef = React.useRef<HTMLDivElement>(null);

  const setFromPointer = (clientX: number, clientY: number) => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onChange({
      x: Math.round(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100))),
      y: Math.round(Math.min(100, Math.max(0, ((clientY - r.top) / r.height) * 100))),
    });
  };

  return (
    <div className={cn("min-w-0", className)}>
      <p className="eyebrow mb-1.5">نقطة التركيز</p>
      <p className="mb-2 text-xs leading-relaxed text-fg-tertiary">
        انقر على الجزء الذي يجب أن يبقى ظاهرًا عند اقتصاص الصورة.
      </p>

      <div
        ref={boxRef}
        role="application"
        aria-label="تحديد نقطة التركيز"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromPointer(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) setFromPointer(e.clientX, e.clientY);
        }}
        className="relative w-full cursor-crosshair overflow-hidden rounded-lg border border-border bg-inset"
        style={{ aspectRatio }}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            className="size-full object-cover"
            style={{ objectPosition: `${value.x}% ${value.y}%` }}
          />
        ) : null}
        <span
          aria-hidden
          className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.5)]"
          style={{ left: `${value.x}%`, top: `${value.y}%` }}
        />
      </div>

      <div className="mt-3 space-y-2.5">
        <Slider
          value={value.x}
          onValueChange={(x) => onChange({ ...value, x })}
          min={0}
          max={100}
          size="sm"
          showValue
          formatValue={(v) => `أفقي ${v}%`}
        />
        <Slider
          value={value.y}
          onValueChange={(y) => onChange({ ...value, y })}
          min={0}
          max={100}
          size="sm"
          showValue
          formatValue={(v) => `عمودي ${v}%`}
        />
      </div>
    </div>
  );
}

/* ============================================================================
   AssetPicker — choose an existing asset, or upload one, from inside another
   form (banner editor, material editor).
   ========================================================================== */

export function AssetPicker({
  open,
  onOpenChange,
  assets,
  value,
  onSelect,
  onUpload,
  uploads,
  kind,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assets: Asset[];
  value?: string | null;
  onSelect: (asset: Asset) => void;
  onUpload?: (files: File[]) => void;
  uploads?: UploadItem[];
  kind?: AssetKind;
  className?: string;
}) {
  const [query, setQuery] = React.useState("");
  const [picked, setPicked] = React.useState<string | null>(value ?? null);

  const filtered = React.useMemo(() => {
    const byKind = kind ? assets.filter((a) => a.kind === kind) : assets;
    if (!query.trim()) return byKind;
    const q = query.toLowerCase();
    return byKind.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [assets, kind, query]);

  const chosen = assets.find((a) => a.id === picked) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className={className}>
        <DialogHeader
          title="اختيار ملف"
          description="اختر من مكتبة الملفات أو ارفع ملفًا جديدًا."
        />
        <DialogBody className="space-y-4">
          <SearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery("")}
            placeholder="ابحث بالاسم أو الوسم"
            resultCount={filtered.length}
          />

          {filtered.length === 0 ? (
            <EmptyState
              kind="noResults"
              size="sm"
              title="لا توجد ملفات مطابقة"
              description="جرّب كلمة أخرى أو ارفع ملفًا جديدًا."
            />
          ) : (
            <AssetGrid
              assets={filtered}
              columns={5}
              activeId={picked}
              actions={{ onOpen: (a) => setPicked(a.id) }}
            />
          )}

          {onUpload ? (
            <Well padding="sm">
              <UploadZone onFiles={onUpload} uploads={uploads} />
            </Well>
          ) : null}
        </DialogBody>
        <DialogFooter align="between">
          {chosen ? (
            <span className="flex min-w-0 items-center gap-2">
              <AssetThumb asset={chosen} size="sm" />
              <span className="min-w-0 truncate text-xs text-fg-secondary">
                {chosen.name}
              </span>
            </span>
          ) : (
            <span className="text-xs text-fg-quaternary">لم يُحدَّد ملف</span>
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button
              variant="primary"
              disabled={!chosen}
              onClick={() => {
                if (chosen) {
                  onSelect(chosen);
                  onOpenChange(false);
                }
              }}
            >
              استخدام هذا الملف
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------
   AssetIntegritySummary — a small operational panel for the library header.
   ------------------------------------------------------------------------ */

export function AssetIntegritySummary({
  total,
  missing,
  processing,
  unused,
  onReviewMissing,
  onReviewUnused,
  className,
}: {
  total: number;
  missing: number;
  processing: number;
  unused: number;
  onReviewMissing?: () => void;
  onReviewUnused?: () => void;
  className?: string;
}) {
  return (
    <Panel className={cn("min-w-0", className)}>
      <PanelHeader title="سلامة المكتبة" density="compact" bordered={false} />
      <div className="grid divide-border-subtle px-1 pb-1 sm:grid-cols-4 sm:divide-x sm:rtl:divide-x-reverse">
        {[
          { label: "إجمالي الملفات", value: total, tone: "neutral" as const },
          {
            label: "ملفات مفقودة",
            value: missing,
            tone: missing > 0 ? ("danger" as const) : ("neutral" as const),
            action: missing > 0 ? onReviewMissing : undefined,
          },
          {
            label: "قيد المعالجة",
            value: processing,
            tone: "info" as const,
          },
          {
            label: "غير مستخدمة",
            value: unused,
            tone: "neutral" as const,
            action: unused > 0 ? onReviewUnused : undefined,
          },
        ].map((cell) => (
          <div key={cell.label} className="min-w-0 px-3 py-3">
            <p className="text-2xs text-fg-quaternary">{cell.label}</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span
                className={cn(
                  "text-lg font-semibold tracking-tighter tnum",
                  cell.tone === "danger" ? "text-danger-text" : "text-fg",
                )}
              >
                {cell.value}
              </span>
              {cell.action ? (
                <Button size="xs" variant="link" onClick={cell.action}>
                  مراجعة
                </Button>
              ) : null}
            </p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export { Badge };
