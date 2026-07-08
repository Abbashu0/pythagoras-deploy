"use client";
import { useSyncExternalStore } from "react";
import { getAdminStore } from "./admin-store";

export function useAdminStore() {
  const store = getAdminStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
