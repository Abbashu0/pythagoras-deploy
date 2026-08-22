export const reviewStatuses = ["SUBMITTED", "NEEDS_CHANGES", "APPROVED", "CONFLICTED", "DRAFT", "PUBLISHED", "REJECTED", "CANCELLED"] as const;
export type ReviewStatus = typeof reviewStatuses[number];

export interface ChangeSummary {
  changeSet: { id: string; title: string; description: string | null; status: ReviewStatus; revision: number; createdAt: number; updatedAt: number; basePublicationRevision: number; reviewNote: string | null };
  author: { id: string; displayName: string; role: "OWNER" | "ADMIN" };
  itemCount: number;
  areaLabels: string[];
}

export interface ChangeDetails extends ChangeSummary {
  items: Array<{
    id: string;
    revision: number;
    resourceId: string;
    resourceType: string;
    conflictState: "NONE" | "BLOCKING" | "AUTO_MERGED";
    conflictDetails: { base?: Record<string, unknown>; current?: Record<string, unknown>; proposed?: Record<string, unknown> } | null;
    beforeSnapshot: Record<string, unknown>;
    proposedSnapshot: Record<string, unknown>;
    currentSnapshot: Record<string, unknown>;
    currentResourceRevision: number;
    presentation: { resourceLabel: string; resourceSubtitle: string; changeSummary: string; areaLabel: string; fieldDiffs: Array<{ path: string; label: string; before?: unknown; after?: unknown }> };
  }>;
  events: Array<{ id: string; eventType: string; createdAt: number; note: string | null; actor: { displayName: string; role: "OWNER" | "ADMIN" } }>;
}

export async function reviewApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as { code?: string };
  if (response.status === 401) { window.location.replace(new URL("/admin/login", window.location.origin)); throw new Error("ADMIN_AUTH_REQUIRED"); }
  if (!response.ok) throw new Error(body.code ?? "CHANGE_REQUEST_FAILED");
  return body as T;
}
