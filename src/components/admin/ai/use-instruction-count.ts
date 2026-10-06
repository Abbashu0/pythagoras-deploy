"use client";
import * as React from "react";
import { compileInstructionSections, instructionCountKey, type InstructionSection } from "@/lib/ai-instruction-sections";
import type { InstructionTokenResult } from "@/server/ai/policy/instruction-token-service";
export const isCurrentInstructionCount = (requested: string, current: string, sequence: number, latest: number) => requested === current && sequence === latest;
export function useInstructionCount(sections: InstructionSection[]) {
  const key = instructionCountKey(sections);
  const sequence = React.useRef(0);
  const [refresh, setRefresh] = React.useState(0);
  const [state, setState] = React.useState<{ key: string; result: InstructionTokenResult; parts: ReturnType<typeof compileInstructionSections>["parts"] } | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const requestSections = React.useRef(sections);
  requestSections.current = sections;
  React.useEffect(() => {
    const id = ++sequence.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const captured = requestSections.current;
        const response = await fetch("/api/admin/local/ai/agent-1/instructions/count", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sections: captured }), signal: controller.signal, cache: "no-store" });
        const body = await response.json();
        if (!response.ok || !body.result) throw new Error("تعذّر تحديث العدّ؛ لا يزال التحرير والنشر متاحَين.");
        if (isCurrentInstructionCount(key, instructionCountKey(requestSections.current), id, sequence.current) && !controller.signal.aborted) {
          setState({ key, result: body.result, parts: compileInstructionSections(captured).parts }); setFailure(null);
        }
      } catch (error) { if (!controller.signal.aborted && id === sequence.current) setFailure(error instanceof Error ? error.message : "تعذّر العدّ."); }
    }, 550);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key, refresh]);
  React.useEffect(() => {
    const update = () => setRefresh((value) => value + 1);
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, []);
  const parts = compileInstructionSections(sections).parts;
  return { result: state?.key === key ? state.result : null, basis: state?.result.basis ?? null, failure,
    refresh: () => setRefresh((value) => value + 1),
    section: (id: string) => {
      const part = parts.find((item) => item.id === id);
      if (!part?.text) return { tokens: 0, precision: "exact" as const };
      return state?.parts.find((item) => item.id === id)?.text === part.text ? state.result.sections.find((item) => item.id === id) : undefined;
    },
  };
}
