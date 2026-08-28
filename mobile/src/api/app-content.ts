import { getJson } from '@/api/client';

export type PublicBannerType = 'FULL' | 'SPLIT';
export type PublicBannerStatus = 'ACTIVE' | 'ARCHIVED';

export interface PublicBanner {
  id: string;
  bannerType: PublicBannerType;
  title: string;
  subtitle: string;
  iconKey: string;
  gradient: string;
  status: PublicBannerStatus;
  displayOrder: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  imageUrl: string | null;
}

export interface AppContentData {
  banners: PublicBanner[];
  autoSlideInterval: number;
}

interface JsonRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPublicBanner(value: unknown): value is PublicBanner {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string' &&
    (value.bannerType === 'FULL' || value.bannerType === 'SPLIT') &&
    typeof value.title === 'string' &&
    typeof value.subtitle === 'string' &&
    typeof value.iconKey === 'string' &&
    typeof value.gradient === 'string' &&
    (value.status === 'ACTIVE' || value.status === 'ARCHIVED') &&
    isFiniteNumber(value.displayOrder) &&
    isFiniteNumber(value.offsetX) &&
    isFiniteNumber(value.offsetY) &&
    isFiniteNumber(value.scale) &&
    (value.imageUrl === null || typeof value.imageUrl === 'string')
  );
}

export function parseAppContent(payload: unknown): AppContentData {
  if (!isRecord(payload) || payload.ok !== true) {
    throw new Error('The app content response was not successful');
  }

  if (payload.runtimeSourceMode === 'LEGACY' || payload.content === null) {
    return { banners: [], autoSlideInterval: 0 };
  }

  if (payload.runtimeSourceMode !== 'CANONICAL' || !isRecord(payload.content)) {
    throw new Error('The app content response has an unsupported source mode');
  }

  const rawBanners = payload.content.banners;
  const carouselSettings = payload.content.carouselSettings;
  if (!Array.isArray(rawBanners) || !isRecord(carouselSettings)) {
    throw new Error('The app content response is missing carousel data');
  }

  const banners = rawBanners
    .filter(isPublicBanner)
    .filter((banner) => banner.status === 'ACTIVE' && banner.scale > 0)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id))
    .slice(0, 5);

  const autoSlideInterval =
    isFiniteNumber(carouselSettings.autoSlideInterval) && carouselSettings.autoSlideInterval > 0
      ? carouselSettings.autoSlideInterval
      : 0;

  return { banners, autoSlideInterval };
}

export async function fetchAppContent(signal?: AbortSignal) {
  const payload = await getJson<unknown>('/api/content/app', signal);
  return parseAppContent(payload);
}
