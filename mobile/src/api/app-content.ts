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

export interface PublicMaterial {
  id: string;
  subjectKey: string;
  label: string;
  englishTitle: string;
  iconKey: string;
  available: boolean;
  displayOrder: number;
  gradient: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  imageUrl: string | null;
}

export interface PublicMaterialSettings {
  id: 'global';
  fadeIntensity: number;
  textVerticalPosition: number;
  textScale: number;
  cardHeight: number;
}

export interface AppContentData {
  banners: PublicBanner[];
  autoSlideInterval: number;
  materials: PublicMaterial[];
  materialSettings: PublicMaterialSettings;
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

function isPublicMaterial(value: unknown): value is PublicMaterial {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string' &&
    typeof value.subjectKey === 'string' &&
    typeof value.label === 'string' &&
    typeof value.englishTitle === 'string' &&
    typeof value.iconKey === 'string' &&
    typeof value.available === 'boolean' &&
    isFiniteNumber(value.displayOrder) &&
    typeof value.gradient === 'string' &&
    isFiniteNumber(value.offsetX) &&
    isFiniteNumber(value.offsetY) &&
    isFiniteNumber(value.scale) &&
    (value.imageUrl === null || typeof value.imageUrl === 'string')
  );
}

function isPublicMaterialSettings(value: unknown): value is PublicMaterialSettings {
  if (!isRecord(value)) return false;

  return (
    value.id === 'global' &&
    isFiniteNumber(value.fadeIntensity) &&
    value.fadeIntensity >= 0 &&
    value.fadeIntensity <= 1 &&
    isFiniteNumber(value.textVerticalPosition) &&
    isFiniteNumber(value.textScale) &&
    value.textScale > 0 &&
    isFiniteNumber(value.cardHeight) &&
    value.cardHeight > 0
  );
}

export const DEFAULT_MATERIAL_SETTINGS: PublicMaterialSettings = {
  id: 'global',
  fadeIntensity: 0.72,
  textVerticalPosition: 0,
  textScale: 1,
  cardHeight: 213,
};

const EMPTY_APP_CONTENT: AppContentData = {
  banners: [],
  autoSlideInterval: 0,
  materials: [],
  materialSettings: DEFAULT_MATERIAL_SETTINGS,
};

export function parseAppContent(payload: unknown): AppContentData {
  if (!isRecord(payload) || payload.ok !== true) {
    throw new Error('The app content response was not successful');
  }

  if (payload.runtimeSourceMode === 'LEGACY' || payload.content === null) {
    return EMPTY_APP_CONTENT;
  }

  if (payload.runtimeSourceMode !== 'CANONICAL' || !isRecord(payload.content)) {
    throw new Error('The app content response has an unsupported source mode');
  }

  const rawBanners = payload.content.banners;
  const rawMaterials = payload.content.materials;
  const carouselSettings = payload.content.carouselSettings;
  const materialSettings = payload.content.materialSettings;
  if (
    !Array.isArray(rawBanners) ||
    !Array.isArray(rawMaterials) ||
    !isRecord(carouselSettings) ||
    !isPublicMaterialSettings(materialSettings)
  ) {
    throw new Error('The app content response is missing material or carousel data');
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

  const materials = rawMaterials
    .filter(isPublicMaterial)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));

  return { banners, autoSlideInterval, materials, materialSettings };
}

let cachedAppContent: AppContentData | null = null;

export async function fetchAppContent(signal?: AbortSignal) {
  if (cachedAppContent) return cachedAppContent;

  const payload = await getJson<unknown>('/api/content/app', signal);
  const content = parseAppContent(payload);
  cachedAppContent = content;
  return content;
}

export function clearAppContentCache() {
  cachedAppContent = null;
}
