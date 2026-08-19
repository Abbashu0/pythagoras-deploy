"use client";

/**
 * ActivityHistoryEntry — one immutable record per dashboard action.
 *
 * When the backend arrives, this maps 1:1 to a server-side audit log row.
 * For now we persist to localStorage so the history survives page reloads.
 */
export interface ActivityHistoryEntry {
  id: string;
  /** ISO timestamp. */
  at: string;
  /** Machine-readable action verb. */
  action: ActivityAction;
  /** Human-readable Arabic label, e.g. "إضافة بانر" — shown in the UI. */
  label: string;
  /** Title of the banner the action affected. */
  bannerTitle: string;
  /**
   * Thumbnail for the history row.
   * Either the banner's image data URL (when an image is uploaded) or the
   * banner's gradient string (used as a CSS background when no image).
   * For "settings" actions this is an empty string.
   */
  thumbnail: string;
  /** Optional human-readable list of changes (used for "edited" / "settings"). */
  changeSummary?: string[];
}

export type ActivityAction =
  | "uploaded"
  | "deleted"
  | "edited"
  | "reordered"
  | "duplicated"
  | "enabled"
  | "disabled"
  | "settings";

export const ACTIVITY_LABELS: Record<ActivityAction, string> = {
  uploaded: "إضافة بانر",
  deleted: "حذف بانر",
  edited: "تعديل بانر",
  reordered: "إعادة ترتيب",
  duplicated: "تكرار بانر",
  enabled: "تفعيل بانر",
  disabled: "تعطيل بانر",
  settings: "تعديل الإعدادات",
};

/**
 * Emoji icons shown next to each activity entry.
 * Used as a visual indicator of the action type in the history list.
 */
export const ACTIVITY_ICONS: Record<ActivityAction, string> = {
  uploaded: "🟢",
  deleted: "🔴",
  edited: "🟠",
  reordered: "🔵",
  duplicated: "🟣",
  enabled: "🟢",
  disabled: "⚪",
  settings: "⏱️",
};
