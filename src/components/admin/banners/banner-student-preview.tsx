"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Smartphone } from "lucide-react";

import {
  resolveBannerAvailability,
  type Banner,
} from "@/components/admin-ui/domain/content/content-items";
import { AssetThumb, type Asset } from "@/components/admin-ui/domain/content/assets";
import { Panel, PanelHeader, Well } from "@/components/admin-ui/primitives/surface";
import { IconButton } from "@/components/admin-ui/primitives/button";
import { StatusBadge } from "@/components/admin-ui/status/status-badge";
import { useSyncedState } from "@/lib/hooks";
import { cn } from "@/lib/cn";

const BANNER_STATUS = {
  live: "active",
  scheduled: "scheduled",
  expired: "archived",
  disabled: "disabled",
  missingAsset: "failed",
} as const;

export function BannerArtworkFrame({
  asset,
  offsetX,
  offsetY,
  scale,
  className,
}: {
  asset: Asset | null;
  offsetX: number;
  offsetY: number;
  scale: number;
  className?: string;
}) {
  const usable = asset?.previewUrl && asset.integrity === "ok";
  return (
    <div
      className={cn(
        "relative aspect-[5/2] overflow-hidden rounded-[30px] border border-border-strong bg-inset",
        className,
      )}
    >
      {usable ? (
        <div
          className="absolute inset-0"
          style={{ transform: `translate3d(${offsetX}%, ${offsetY}%, 0)` }}
        >
          <img
            src={asset.previewUrl ?? undefined}
            alt=""
            className="absolute inset-0 size-full object-contain"
            style={{ transform: `scale(${scale})`, transformOrigin: "center" }}
          />
        </div>
      ) : (
        <div className="grid size-full place-items-center text-fg-quaternary">
          {asset ? <AssetThumb asset={asset} size="xl" className="border-0" /> : null}
        </div>
      )}
    </div>
  );
}

export function BannerStudentPreview({
  banners,
  selectedId,
  onSelectedIdChange,
  showAllStatuses = false,
  title = "كما يراه الطالب",
  className,
}: {
  banners: Banner[];
  selectedId?: string | null;
  onSelectedIdChange?: (id: string) => void;
  showAllStatuses?: boolean;
  title?: string;
  className?: string;
}) {
  const candidates = React.useMemo(
    () =>
      showAllStatuses
        ? banners
        : banners.filter((banner) => resolveBannerAvailability(banner).state === "live"),
    [banners, showAllStatuses],
  );
  const preferredId =
    selectedId && candidates.some((banner) => banner.id === selectedId)
      ? selectedId
      : candidates[0]?.id ?? null;
  const [activeId, setActiveId] = useSyncedState<string | null>(preferredId);
  const activeIndex = candidates.findIndex((banner) => banner.id === activeId);
  const active = activeIndex >= 0 ? candidates[activeIndex] : null;

  const select = (index: number) => {
    const banner = candidates[index];
    if (!banner) return;
    setActiveId(banner.id);
    onSelectedIdChange?.(banner.id);
  };

  return (
    <Panel className={cn("min-w-0", className)}>
      <PanelHeader
        title={title}
        description="معاينة لإطار البانر الفعلي داخل تطبيق الطالب."
        density="compact"
        icon={<Smartphone aria-hidden />}
      />
      <div className="p-4">
        {active ? (
          <>
            <div className="mx-auto w-full max-w-[440px]">
              <BannerArtworkFrame
                asset={active.asset}
                offsetX={active.offsetX ?? 0}
                offsetY={active.offsetY ?? 0}
                scale={active.scale ?? 1}
              />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <StatusBadge
                status={BANNER_STATUS[resolveBannerAvailability(active).state]}
                label={resolveBannerAvailability(active).label}
                size="sm"
              />
              {candidates.length > 1 ? (
                <div className="flex items-center gap-1">
                  <IconButton
                    label="البانر السابق"
                    size="sm"
                    variant="ghost"
                    onClick={() => select((activeIndex - 1 + candidates.length) % candidates.length)}
                  >
                    <ChevronRight aria-hidden />
                  </IconButton>
                  <span className="text-2xs text-fg-quaternary tnum">
                    {activeIndex + 1} / {candidates.length}
                  </span>
                  <IconButton
                    label="البانر التالي"
                    size="sm"
                    variant="ghost"
                    onClick={() => select((activeIndex + 1) % candidates.length)}
                  >
                    <ChevronLeft aria-hidden />
                  </IconButton>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <Well padding="md">
            <p className="text-center text-xs text-fg-tertiary">
              لا يظهر أي بانر مؤهل للطلاب حاليًا.
            </p>
          </Well>
        )}
      </div>
    </Panel>
  );
}
