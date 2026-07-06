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
  /** Machine-readable action verb (uploaded, deleted, edited, reordered, duplicated, enabled, disabled). */
  action: ActivityAction;
  /** Human-readable Arabic label, e.g. "تم رفع بانر" — shown in the UI. */
  label: string;
  /** Title of the banner the action affected. */
  bannerTitle: string;
}

export type ActivityAction =
  | "uploaded"
  | "deleted"
  | "edited"
  | "reordered"
  | "duplicated"
  | "enabled"
  | "disabled";

export const ACTIVITY_LABELS: Record<ActivityAction, string> = {
  uploaded: "رفع بانر",
  deleted: "حذف بانر",
  edited: "تعديل بانر",
  reordered: "إعادة ترتيب",
  duplicated: "تكرار بانر",
  enabled: "تفعيل بانر",
  disabled: "تعطيل بانر",
};
