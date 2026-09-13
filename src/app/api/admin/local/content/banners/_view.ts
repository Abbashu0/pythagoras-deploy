import { getAssetService } from "@/server/assets";
import { toLocalAdminAssetView, type LocalAdminAssetView } from "@/server/assets/admin-view";
import { getContentDatabase } from "@/server/content";
import type { CanonicalBanner } from "@/server/canonical-content";

export interface LocalAdminBannerView {
  id: string;
  title: string;
  internalTitle: string;
  subtitle?: string;
  asset: LocalAdminAssetView | null;
  enabled: boolean;
  position: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  startsAt: number | null;
  endsAt: number | null;
  analytics: {
    impressions: number;
    clicks: number;
    trend: Array<{ value: number }>;
  };
  revision: number;
  updatedAt: number;
}

export async function toLocalAdminBannerView(
  banner: CanonicalBanner,
): Promise<LocalAdminBannerView> {
  const database = getContentDatabase();
  const service = getAssetService();
  const assetRecord = banner.assetId
    ? service.getByIdWithCreator(banner.assetId)
    : null;
  const asset = assetRecord
    ? await toLocalAdminAssetView(database, service, assetRecord)
    : null;

  return {
    id: banner.id,
    title: banner.title || asset?.name || "بانر بدون اسم",
    internalTitle: banner.title,
    ...(banner.subtitle ? { subtitle: banner.subtitle } : {}),
    asset,
    enabled: banner.status === "ACTIVE",
    position: banner.displayOrder,
    offsetX: banner.offsetX,
    offsetY: banner.offsetY,
    scale: banner.scale,
    startsAt: banner.startsAt,
    endsAt: banner.endsAt,
    // Analytics instrumentation is intentionally not part of this milestone.
    analytics: {
      impressions: 0,
      clicks: 0,
      trend: Array.from({ length: 7 }, () => ({ value: 0 })),
    },
    revision: banner.revision,
    updatedAt: banner.updatedAt,
  };
}
