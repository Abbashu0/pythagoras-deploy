"use client";
import { useSyncExternalStore } from "react";
import { getMaterialsStore, getToolsStore } from "./content-store";

export function useMaterialsStore() {
  const store = getMaterialsStore();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot
  );
}

export function useToolsStore() {
  const store = getToolsStore();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot
  );
}
