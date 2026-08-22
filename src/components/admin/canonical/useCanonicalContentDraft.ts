"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CanonicalBanner, CanonicalContentSnapshot } from "@/server/canonical-content/contracts";

export type CanonicalArea = "banners" | "materials" | "tools" | "navigation";
export type DraftBanner = CanonicalBanner & { isNew?: boolean };
export type CanonicalDraftSnapshot = Omit<CanonicalContentSnapshot, "banners"> & { banners: DraftBanner[] };

const RESOURCE_TYPE: Record<CanonicalArea, string> = {
  banners: "banner",
  materials: "material",
  tools: "tool",
  navigation: "navigation",
};

function withoutPresentationFields(value: Record<string, unknown>): Record<string, unknown> {
  const ignored = new Set(["id", "asset", "createdAt", "updatedAt", "revision", "isNew"]);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !ignored.has(key)));
}

export function useCanonicalContentDraft(area: CanonicalArea) {
  const router = useRouter();
  const [source, setSource] = useState<CanonicalContentSnapshot | null>(null);
  const [draft, setDraft] = useState<CanonicalDraftSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/content", { cache: "no-store" });
      const body = await response.json() as { snapshot?: CanonicalContentSnapshot; code?: string };
      if (!response.ok || !body.snapshot) throw new Error(body.code ?? "تعذر تحميل المحتوى القانوني.");
      setSource(body.snapshot);
      setDraft(structuredClone(body.snapshot));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل المحتوى القانوني.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(() => {
    if (!source || !draft) return false;
    if (JSON.stringify(source[area]) !== JSON.stringify(draft[area])) return true;
    if (area === "banners" && JSON.stringify(source.carouselSettings) !== JSON.stringify(draft.carouselSettings)) return true;
    return area === "materials" && JSON.stringify(source.materialSettings) !== JSON.stringify(draft.materialSettings);
  }, [area, draft, source]);

  const reset = useCallback(() => {
    if (source) setDraft(structuredClone(source));
  }, [source]);

  const save = useCallback(async (title: string) => {
    if (!source || !draft || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const originalEntries = source[area] as unknown as Array<Record<string, unknown> & { id: string; revision: number }>;
      const currentEntries = draft[area] as unknown as Array<Record<string, unknown> & { id: string; revision: number; isNew?: boolean }>;
      const initialItems: Array<Record<string, unknown>> = [];
      for (const item of currentEntries) {
        const original = originalEntries.find((candidate) => candidate.id === item.id);
        if (!original || JSON.stringify(original) !== JSON.stringify(item)) {
          initialItems.push({
            resourceType: RESOURCE_TYPE[area],
            resourceId: item.id,
            expectedRevision: original?.revision ?? 0,
            operation: original ? "UPDATE" : "CREATE",
            desired: withoutPresentationFields(item),
          });
        }
      }
      if (area === "materials" && JSON.stringify(source.materialSettings) !== JSON.stringify(draft.materialSettings)) {
        initialItems.push({
          resourceType: "materials.settings",
          resourceId: "global",
          expectedRevision: source.materialSettings.revision,
          operation: "UPDATE",
          desired: withoutPresentationFields(draft.materialSettings as unknown as Record<string, unknown>),
        });
      }
      if (area === "banners" && JSON.stringify(source.carouselSettings) !== JSON.stringify(draft.carouselSettings)) {
        initialItems.push({
          resourceType: "carousel.settings",
          resourceId: "global",
          expectedRevision: source.carouselSettings.revision,
          operation: "UPDATE",
          desired: { autoSlideInterval: draft.carouselSettings.autoSlideInterval },
        });
      }
      if (initialItems.length === 0) return;
      const response = await fetch("/api/admin/content/change-sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description: "تعديلات مجمّعة من محرر المحتوى المتخصص.", initialItems }),
      });
      const body = await response.json() as { changeSet?: { changeSet: { id: string } }; code?: string };
      if (!response.ok || !body.changeSet) throw new Error(body.code ?? "تعذر إنشاء مسودة المراجعة.");
      router.push(`/admin/review/${body.changeSet.changeSet.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إنشاء مسودة المراجعة.");
    } finally {
      setSaving(false);
    }
  }, [area, dirty, draft, router, source]);

  return { source, draft, setDraft, loading, saving, error, dirty, load, reset, save };
}

export function moveOrdered<T extends { id: string; displayOrder: number }>(items: T[], id: string, direction: -1 | 1): T[] {
  const sorted = [...items].sort((a, b) => a.displayOrder - b.displayOrder);
  const index = sorted.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= sorted.length) return items;
  const start = Math.min(...sorted.map((item) => item.displayOrder));
  [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
  return sorted.map((item, orderIndex) => ({ ...item, displayOrder: start + orderIndex }));
}
