"use client";

import * as React from "react";
import type { Agent1ActivitySnapshot } from "@/server/ai/agent-1-runtime/activity-contracts";

export function useAgent1Activity() {
  const [activity, setActivity] = React.useState<Agent1ActivitySnapshot | null>(null);
  const [connection, setConnection] = React.useState<"live" | "reconnecting">("reconnecting");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const poll = async () => {
      if (pending || controller.signal.aborted || document.hidden) return;
      pending = true;
      const requestController = new AbortController();
      const abortRequest = () => requestController.abort();
      controller.signal.addEventListener("abort", abortRequest, { once: true });
      const timeout = window.setTimeout(abortRequest, 5_000);
      try {
        const response = await fetch("/api/admin/local/ai/agent-1/activity", {
          signal: requestController.signal, cache: "no-store", headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("تعذّر تحديث المراقبة الحية.");
        const snapshot = await response.json() as Agent1ActivitySnapshot;
        if (controller.signal.aborted) return;
        setActivity(previous => {
          if (previous && previous.sessionStartedAt === snapshot.sessionStartedAt &&
            previous.points.at(-1)?.timestamp === snapshot.points.at(-1)?.timestamp &&
            JSON.stringify(previous.stats) === JSON.stringify(snapshot.stats) &&
            JSON.stringify(previous.activeModels) === JSON.stringify(snapshot.activeModels) &&
            previous.recent[0]?.endedAt === snapshot.recent[0]?.endedAt) return previous;
          return snapshot;
        });
        setConnection("live"); setError(null);
      } catch {
        if (!controller.signal.aborted) {
          setConnection("reconnecting");
          setError("انقطع تحديث القياسات. ستُستأنف تلقائيًا عند عودة الاتصال.");
        }
      } finally {
        window.clearTimeout(timeout);
        controller.signal.removeEventListener("abort", abortRequest);
        pending = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1_000);
    const resume = () => void poll();
    document.addEventListener("visibilitychange", resume);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", resume); };
  }, []);
  return { activity, connection, error };
}
