"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { ErrorState } from "@/components/admin-ui/feedback/empty-state";
import { Panel, PanelBody } from "@/components/admin-ui/primitives/surface";
import { PageShell } from "@/components/admin-ui/layout/page";
import type { MaterialBankWorkspace } from "@/components/admin/materials/material-question-bank";

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as { code?: string } | null;
  if (!response.ok) throw new Error(payload?.code ?? "REQUEST_FAILED");
  return payload as T;
}

export default function MaterialBankReadWorkspacePage() {
  const router = useRouter();
  const { subjectKey: rawSubjectKey, nodeId: rawNodeId } = useParams<{ subjectKey: string; nodeId: string }>();
  const subjectKey = Array.isArray(rawSubjectKey) ? rawSubjectKey[0] : rawSubjectKey;
  const nodeId = Array.isArray(rawNodeId) ? rawNodeId[0] : rawNodeId;
  const [workspace, setWorkspace] = React.useState<MaterialBankWorkspace | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!subjectKey) return;
    setLoading(true);
    setError(null);
    try {
      const response = await requestJson<{ workspace: MaterialBankWorkspace }>(`/api/admin/local/content/materials/${encodeURIComponent(subjectKey)}/question-bank`);
      setWorkspace(response.workspace);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "REQUEST_FAILED");
    } finally {
      setLoading(false);
    }
  }, [subjectKey]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    if (!workspace || !subjectKey || !nodeId) return;
    const node = workspace.layout?.nodes.find((item) => item.id === nodeId);
    if (!node?.packageId) {
      setError(node ? "لا توجد حزمة مرتبطة بهذه المساحة." : "مساحة بنك الأسئلة غير موجودة.");
      return;
    }
    const query = new URLSearchParams({ fromSubjectKey: subjectKey, fromNodeId: nodeId });
    router.replace(`/admin/content/question-packages/${encodeURIComponent(node.packageId)}?${query.toString()}`);
  }, [nodeId, router, subjectKey, workspace]);

  if (loading) return <PageShell width="wide"><Panel><PanelBody><div className="h-10 w-64 animate-pulse rounded-md bg-inset" /></PanelBody></Panel></PageShell>;
  if (error || !workspace) return <PageShell width="wide"><ErrorState title="تعذّر تحميل بنك الأسئلة" description={error ?? "المادة غير موجودة."} onRetry={load} /></PageShell>;

  return (
    <PageShell width="wide">
      <div className="pb-24 pt-6">
        <Panel>
          <PanelBody>
            <p className="text-sm text-fg-secondary">جارٍ فتح مساحة الحزمة canonical…</p>
          </PanelBody>
        </Panel>
      </div>
    </PageShell>
  );
}
