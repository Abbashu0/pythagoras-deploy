import type {
  AssetInventoryStats,
  AssetMediaKind,
  AssetSort,
  SafeAssetWithCreator,
} from "@/server/assets";

export type LibraryAsset = SafeAssetWithCreator;
export type LibraryStats = AssetInventoryStats;
export type LibraryMediaKind = AssetMediaKind;
export type LibrarySort = AssetSort;

export interface AssetPageResponse {
  ok: true;
  items: LibraryAsset[];
  total: number;
  limit: number;
  offset: number;
}

export interface AssetStatsResponse {
  ok: true;
  stats: LibraryStats;
}

export interface AssetIntegrityResponse {
  ok: true;
  integrity: {
    assetId: string;
    healthy: boolean;
    status: "ok" | "missing" | "size-mismatch" | "hash-mismatch";
    expectedByteSize: number;
    actualByteSize: number | null;
  };
}

export const MEDIA_KIND_LABELS: Record<LibraryMediaKind, string> = {
  image: "صور",
  video: "فيديو",
  audio: "صوت",
  document: "مستندات",
  json: "JSON",
  "other-safe-file": "ملفات أخرى",
};

export const SORT_LABELS: Record<LibrarySort, string> = {
  newest: "الأحدث أولًا",
  oldest: "الأقدم أولًا",
  name: "الاسم",
  size: "الحجم",
};

const ERROR_MESSAGES: Record<string, string> = {
  ADMIN_AUTH_REQUIRED: "انتهت جلسة الإدارة. يرجى تسجيل الدخول مجددًا.",
  ADMIN_FORBIDDEN: "ليس لديك صلاحية تنفيذ هذا الإجراء.",
  ADMIN_UNTRUSTED_ORIGIN: "رُفض الطلب لأنه لم يصدر من لوحة الإدارة الحالية.",
  ASSET_CONFLICT: "تغيّر هذا الملف في جلسة أخرى. حدّث الصفحة وحاول مجددًا.",
  ASSET_INTEGRITY_FAILED: "تعذّر قراءة الملف لأن فحص سلامته لم ينجح.",
  ASSET_NOT_FOUND: "لم يعد هذا الملف موجودًا.",
  ASSET_STORAGE_UNAVAILABLE: "التخزين المحلي غير متاح حاليًا.",
  ASSET_TOO_LARGE: "حجم الملف أكبر من الحد المسموح.",
  ASSET_UNSUPPORTED_TYPE: "نوع هذا الملف غير مدعوم أو غير آمن.",
  ASSET_UPLOAD_INVALID: "ملف الرفع أو بياناته غير صالحة.",
  ASSET_VALIDATION_FAILED: "بيانات الملف غير صالحة.",
  ASSET_UNAVAILABLE: "تعذّر إكمال الطلب بسبب خطأ غير متوقع.",
};

export class LibraryApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(ERROR_MESSAGES[code] ?? "تعذّر الاتصال بمكتبة المحتوى.");
    this.name = "LibraryApiError";
  }
}

export async function parseApiResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { code?: string };
  if (!response.ok) {
    throw new LibraryApiError(response.status, body.code ?? "ASSET_UNAVAILABLE");
  }
  return body as T;
}

export function handleExpiredSession(error: unknown): boolean {
  if (error instanceof LibraryApiError && error.status === 401) {
    window.location.reload();
    return true;
  }
  return false;
}
