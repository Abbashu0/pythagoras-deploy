"use client";

import * as React from "react";
import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";
import { useParams } from "next/navigation";
import { ErrorState, EmptyState } from "@/components/admin-ui/feedback/empty-state";
import { Panel, PanelBody, PanelHeader } from "@/components/admin-ui/primitives/surface";
import { Button } from "@/components/admin-ui/primitives/button";
import { PageHeader, PageShell, Section } from "@/components/admin-ui/layout/page";
import { Badge, StatusBadge } from "@/components/admin-ui/status/status-badge";
import type { MaterialBankWorkspace } from "@/components/admin/materials/material-question-bank";

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as { code?: string } | null;
  if (!response.ok) throw new Error(payload?.code ?? "REQUEST_FAILED");
  return payload as T;
}

export default function MaterialBankReadWorkspacePage() {
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

  if (loading) return <PageShell width="wide"><Panel><PanelBody><div className="h-10 w-64 animate-pulse rounded-md bg-inset" /></PanelBody></Panel></PageShell>;
  if (error || !workspace) return <PageShell width="wide"><ErrorState title="تعذّر تحميل بنك الأسئلة" description={error ?? "المادة غير موجودة."} onRetry={load} /></PageShell>;

  const node = workspace.layout?.nodes.find((item) => item.id === nodeId);
  const option = node?.packageId ? workspace.packages.find((item) => item.id === node.packageId) : null;
  return (
    <PageShell width="wide">
      <PageHeader
        eyebrow="المواد / بنك الأسئلة"
        title={node?.label ?? "مساحة الحزمة"}
        description="هذه مساحة قراءة مؤقتة للحزمة المرتبطة. محرر الأسئلة الحقيقي هو المرحلة التالية."
        icon={<BookOpen className="size-5 text-fg-tertiary" aria-hidden />}
        status={node ? <StatusBadge status={option ? "active" : "notConfigured"} label={option ? "حزمة مرتبطة" : "لا توجد حزمة"} size="sm" /> : undefined}
        actions={<Button variant="secondary" asChild><Link href={`/admin/content/materials/${encodeURIComponent(subjectKey)}`}><ChevronRight aria-hidden /> العودة إلى المادة</Link></Button>}
      />
      <div className="pb-24 pt-6">
        <Section title="الحزمة الحالية" spacing="none">
          {node && option ? (
            <Panel>
              <PanelHeader title={option.title} description={option.sourceFilename ? `المصدر: ${option.sourceFilename}` : undefined} density="compact" />
              <PanelBody>
                <div className="flex flex-wrap gap-2"><Badge variant="subtle" tone="neutral">{option.questionCount} سؤال</Badge><Badge variant="subtle" tone="neutral">{option.variantCount} صيغة</Badge><Badge variant="subtle" tone="neutral">{option.occurrenceCount} ورود</Badge><Badge variant="subtle" tone="neutral">rev {option.contentRevision}</Badge></div>
                <EmptyState kind="future" size="sm" className="mt-4" title="محرر الأسئلة سيُبنى لاحقًا" description="يمكن إدارة ارتباط الحزمة من تبويب بنك الأسئلة، دون تعديل محتوى السؤال في هذه المرحلة." />
              </PanelBody>
            </Panel>
          ) : (
            <EmptyState kind="noData" title="لا توجد حزمة مرتبطة" description="اختر حزمة من تبويب بنك الأسئلة أولًا." />
          )}
        </Section>
      </div>
    </PageShell>
  );
}
