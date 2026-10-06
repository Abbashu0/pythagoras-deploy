"use client";
import * as React from "react";
import { useUnsavedChangesGuard } from "@/lib/hooks";
const warning = "لديك مسودة تعليمات غير منشورة. هل تريد مغادرة الصفحة وفقدان التغييرات؟";
export function useInstructionDraftGuard(dirty: boolean) {
  useUnsavedChangesGuard(dirty);
  React.useEffect(() => {
    if (!dirty) return;
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const next = new URL(link.href, window.location.href);
      if (next.origin !== window.location.origin) return; // Native beforeunload owns hard navigation.
      if (next.pathname === window.location.pathname && next.search === window.location.search) return;
      if (!window.confirm(warning)) { event.preventDefault(); event.stopPropagation(); }
    };
    const navigation = (event: Event) => {
      const href = (event as CustomEvent<{ href: string }>).detail.href;
      const next = new URL(href, window.location.href);
      if (next.pathname === window.location.pathname && next.search === window.location.search) return;
      if (!window.confirm(warning)) event.preventDefault();
    };
    // Chrome's Navigation API can cancel back/forward BEFORE Next changes the route.
    const api = (window as unknown as { navigation?: EventTarget }).navigation;
    const traverse = (event: Event) => {
      const navigation = event as Event & { navigationType?: string; destination?: { url: string } };
      if (navigation.navigationType !== "traverse") return;
      const destination = navigation.destination ? new URL(navigation.destination.url) : null;
      if (destination?.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (!window.confirm(warning)) event.preventDefault();
    };
    document.addEventListener("click", click, true);
    window.addEventListener("pythagoras:admin-navigation", navigation);
    api?.addEventListener("navigate", traverse);
    return () => { document.removeEventListener("click", click, true); window.removeEventListener("pythagoras:admin-navigation", navigation); api?.removeEventListener("navigate", traverse); };
  }, [dirty]);
}
