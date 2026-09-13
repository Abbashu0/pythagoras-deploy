import type { AdminActor } from "../admin-auth/contracts";

export const CANONICAL_RUNTIME_SOURCE_MODES = ["LEGACY", "CANONICAL"] as const;
export type CanonicalRuntimeSourceMode = (typeof CANONICAL_RUNTIME_SOURCE_MODES)[number];

export const CANONICAL_BANNER_TYPES = ["FULL", "SPLIT"] as const;
export type CanonicalBannerType = (typeof CANONICAL_BANNER_TYPES)[number];

export const CANONICAL_BANNER_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type CanonicalBannerStatus = (typeof CANONICAL_BANNER_STATUSES)[number];

export interface CanonicalAssetReference {
  id: string;
  displayName: string;
  originalFilename: string;
  mimeType: string;
  url: string;
}

export interface CanonicalBanner {
  id: string;
  bannerType: CanonicalBannerType;
  title: string;
  subtitle: string;
  iconKey: string;
  gradient: string;
  assetId: string | null;
  asset: CanonicalAssetReference | null;
  status: CanonicalBannerStatus;
  displayOrder: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  startsAt: number | null;
  endsAt: number | null;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export interface CanonicalMaterial {
  id: string;
  subjectKey: string;
  label: string;
  englishTitle: string;
  iconKey: string;
  available: boolean;
  displayOrder: number;
  assetId: string | null;
  asset: CanonicalAssetReference | null;
  gradient: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export interface CanonicalMaterialSettings {
  id: "global";
  fadeIntensity: number;
  textVerticalPosition: number;
  textScale: number;
  cardHeight: number;
  updatedAt: number;
  revision: number;
}

export interface CanonicalTool {
  id: string;
  toolKey: string;
  label: string;
  iconKey: string;
  available: boolean;
  displayOrder: number;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export interface CanonicalNavigationItem {
  id: string;
  navKey: string;
  label: string;
  iconKey: string;
  enabled: boolean;
  displayOrder: number;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export interface CanonicalCarouselSettings {
  id: "global";
  autoSlideInterval: number;
  updatedAt: number;
  revision: number;
}

export interface CanonicalContentState {
  id: "global";
  bootstrapVersion: number;
  bootstrapCompletedAt: number;
  runtimeSourceMode: CanonicalRuntimeSourceMode;
  updatedAt: number;
  revision: number;
}

export interface CanonicalContentSnapshot {
  state: CanonicalContentState;
  contentRevision: number;
  banners: CanonicalBanner[];
  materials: CanonicalMaterial[];
  materialSettings: CanonicalMaterialSettings;
  tools: CanonicalTool[];
  navigation: CanonicalNavigationItem[];
  carouselSettings: CanonicalCarouselSettings;
  pendingResourceKeys: string[];
}

export interface PublicCanonicalAppContent {
  runtimeSourceMode: CanonicalRuntimeSourceMode;
  contentRevision: number;
  content: null | {
    banners: Array<Omit<CanonicalBanner, "asset" | "assetId" | "createdAt" | "updatedAt" | "revision" | "startsAt" | "endsAt"> & { imageUrl: string | null }>;
    materials: Array<Omit<CanonicalMaterial, "asset" | "assetId" | "createdAt" | "updatedAt" | "revision"> & { imageUrl: string | null }>;
    materialSettings: Omit<CanonicalMaterialSettings, "updatedAt" | "revision">;
    tools: Array<Omit<CanonicalTool, "createdAt" | "updatedAt" | "revision">>;
    navigation: Array<Omit<CanonicalNavigationItem, "createdAt" | "updatedAt" | "revision">>;
    carouselSettings: Omit<CanonicalCarouselSettings, "updatedAt" | "revision">;
  };
}

export interface CanonicalAssetUsage {
  assetId: string;
  banners: Array<{ id: string; title: string }>;
  materials: Array<{ id: string; subjectKey: string; label: string }>;
}

export interface CanonicalContentRepository {
  bootstrap(): CanonicalContentState;
  getSnapshot(): CanonicalContentSnapshot;
  getPublicContent(): PublicCanonicalAppContent;
  getAssetUsage(assetId: string): CanonicalAssetUsage;
  isStudentVisibleAsset(assetId: string): boolean;
  requireActor(actor: AdminActor): void;
}
