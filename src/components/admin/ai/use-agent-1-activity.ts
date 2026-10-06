"use client";

import * as React from "react";
import type { Agent1ActivityResultFilter, Agent1ActivitySnapshot, Agent1ActivityWindow } from "@/server/ai/agent-1-runtime/activity-contracts";

export function useAgent1Activity(timeWindow: Agent1ActivityWindow = "5m", modelConfigId: string | null = null, resultFilter: Agent1ActivityResultFilter = "all") {
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
        const query = new URLSearchParams({ window: timeWindow, result: resultFilter });
        if (modelConfigId) query.set("model", modelConfigId);
        const response = await fetch("/api/admin/local/ai/agent-1/activity?" + query, {
          signal: requestController.signal, cache: "no-store", headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("تعذّر تحديث المراقبة الحية.");
        const snapshot = await response.json() as Agent1ActivitySnapshot;
        if (!snapshot.scope || snapshot.scope.window !== timeWindow || snapshot.scope.modelConfigId !== modelConfigId ||
          snapshot.scope.resultFilter !== resultFilter || !Array.isArray(snapshot.modelPerformance) || !Array.isArray(snapshot.transitions)) {
          throw new Error("تحتاج المراقبة إلى إعادة تشغيل الخادم بعد التحديث.");
        }
        if (controller.signal.aborted) return;
        setActivity(previous => {
          if (previous && previous.sessionStartedAt === snapshot.sessionStartedAt &&
            previous.scope?.window === snapshot.scope.window && previous.scope.modelConfigId === snapshot.scope.modelConfigId &&
            previous.scope.resultFilter === snapshot.scope.resultFilter &&
            previous.points.at(-1)?.timestamp === snapshot.points.at(-1)?.timestamp &&
            JSON.stringify(previous.stats) === JSON.stringify(snapshot.stats) &&
            JSON.stringify(previous.activeModels) === JSON.stringify(snapshot.activeModels) &&
            JSON.stringify(previous.transitions) === JSON.stringify(snapshot.transitions) &&
            JSON.stringify(previous.modelPerformance) === JSON.stringify(snapshot.modelPerformance) &&
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
  }, [timeWindow, modelConfigId, resultFilter]);
  // Do not label the previous filter's response as the newly selected scope.
  const scopedActivity = activity?.scope?.window === timeWindow && activity.scope.modelConfigId === modelConfigId && activity.scope.resultFilter === resultFilter ? activity : null;
  return { activity: scopedActivity, connection, error };
}
