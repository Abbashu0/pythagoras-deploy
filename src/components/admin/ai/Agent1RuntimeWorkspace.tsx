"use client";

import * as React from "react";
import Link from "next/link";
import {
  Bot,
  Check,
  Power,
  RotateCcw,
  Save,
  Server,
  ShieldAlert,
  Trash2,
  Zap,
} from "lucide-react";

import type { AIAgent1RuntimeSnapshot } from "@/server/ai/agent-1-runtime/contracts";
import { cn } from "@/lib/cn";
import { formatContextWindow, formatNumber } from "@/lib/format";
import { Button, IconButton } from "@/components/admin-ui/primitives/button";
import { EmptyState, ErrorState } from "@/components/admin-ui/feedback/empty-state";
import { InlineNote } from "@/components/admin-ui/feedback/banner";
import { PageHeader, PageShell } from "@/components/admin-ui/layout/page";
import { PipelineFlow, type PipelineStage } from "@/components/admin-ui/charts/matrix";
import {
  LiveMetricChart,
  LiveTelemetryChart,
  type LiveTelemetryPoint,
} from "@/components/admin-ui/charts/live";
import { ReorderableList } from "@/components/admin-ui/domain/content/reorderable";
import {
  AgentModelSelector,
  ModelAssignmentPanel,
} from "@/components/admin-ui/domain/agents/model-selector";
import { Panel, PanelHeader } from "@/components/admin-ui/primitives/surface";
import { Spinner } from "@/components/admin-ui/primitives/spinner";
import { Badge, StatusBadge } from "@/components/admin-ui/status/status-badge";
import { Agent1DevPairingPanel } from "./Agent1DevPairingPanel";

interface RuntimeResponse extends AIAgent1RuntimeSnapshot {
  ok: true;
}

interface ApiError extends Error {
  code?: string;
  details?: Record<string, unknown>;
}

const TOKEN_SERIES = [
  { key: "inputTokens", label: "الإدخال", unit: "رمز" },
  { key: "outputTokens", label: "الإخراج", unit: "رمز" },
  { key: "reasoningTokens", label: "الاستدلال", unit: "رمز" },
];

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
  if (!response.ok || body.ok === false) {
    const error = new Error(body.message ?? body.code ?? "AI_AGENT_1_RUNTIME_REQUEST_FAILED") as ApiError;
    error.code = body.code;
    error.details = body.details;
    throw error;
  }
  return body as T;
}

export function Agent1RuntimeWorkspace() {
  const [snapshot, setSnapshot] = React.useState<AIAgent1RuntimeSnapshot | null>(null);
  const [draftPrimary, setDraftPrimary] = React.useState<string | null>(null);
  const [draftFallbacks, setDraftFallbacks] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const [savingRoute, setSavingRoute] = React.useState(false);
  const [savingEnabled, setSavingEnabled] = React.useState(false);

  const applySnapshot = React.useCallback((next: AIAgent1RuntimeSnapshot) => {
    setSnapshot(next);
    setDraftPrimary(next.config.primaryModelConfigId);
    setDraftFallbacks(next.config.fallbackModelConfigIds);
    setConflict(false);
  }, []);

  const refresh = React.useCallback(async () => {
    setLoadError(null);
    try {
      const result = await requestJson<RuntimeResponse>(
        "/api/admin/local/ai/agent-1/runtime",
      );
      applySnapshot(result);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [applySnapshot]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const routeDirty = Boolean(
    snapshot &&
      (draftPrimary !== snapshot.config.primaryModelConfigId ||
        !sameArray(draftFallbacks, snapshot.config.fallbackModelConfigIds)),
  );
  const draftPrimaryModel = snapshot?.models.find((model) => model.id === draftPrimary) ?? null;
  const primaryFallbackDuplicate = Boolean(draftPrimary && draftFallbacks.includes(draftPrimary));
  const readyForEnable = Boolean(draftPrimaryModel?.ready) && !primaryFallbackDuplicate;

  const saveRoute = async () => {
    if (!snapshot || !routeDirty || primaryFallbackDuplicate) return;
    setActionError(null);
    setConflict(false);
    setSavingRoute(true);
    try {
      const result = await requestJson<RuntimeResponse>(
        "/api/admin/local/ai/agent-1/runtime",
        {
          method: "PUT",
          body: JSON.stringify({
            expectedRevision: snapshot.config.revision,
            primaryModelConfigId: draftPrimary,
            fallbackModelConfigIds: draftFallbacks,
          }),
        },
      );
      applySnapshot(result);
    } catch (error) {
      if (isConflict(error)) setConflict(true);
      setActionError(errorMessage(error));
    } finally {
      setSavingRoute(false);
    }
  };

  const setEnabled = async (enabled: boolean) => {
    if (!snapshot || routeDirty || (enabled && !readyForEnable)) return;
    setActionError(null);
    setConflict(false);
    setSavingEnabled(true);
    try {
      const result = await requestJson<RuntimeResponse>(
        "/api/admin/local/ai/agent-1/runtime",
        {
          method: "PATCH",
          body: JSON.stringify({
            expectedRevision: snapshot.config.revision,
            enabled,
          }),
        },
      );
      applySnapshot(result);
    } catch (error) {
      if (isConflict(error)) setConflict(true);
      setActionError(errorMessage(error));
    } finally {
      setSavingEnabled(false);
    }
  };

  const reloadAfterConflict = async () => {
    await refresh();
    setActionError(null);
  };

  if (loading) {
    return (
      <PageShell width="full" padding="default" className="gap-5">
        <PageHeader
          eyebrow="الذكاء الاصطناعي"
          title="Agent 1 — التشغيل"
          description="تحكم بتشغيل Agent 1 ومسار النماذج الذي يستخدمه للرد على الطلاب."
        />
        <Panel>
          <div className="flex min-h-48 items-center justify-center text-fg-tertiary">
            <Spinner size="lg" label="جارٍ تحميل إعداد التشغيل" />
          </div>
        </Panel>
      </PageShell>
    );
  }

  if (loadError || !snapshot) {
    return (
      <PageShell width="full" padding="default" className="gap-5">
        <PageHeader
          eyebrow="الذكاء الاصطناعي"
          title="Agent 1 — التشغيل"
          description="تحكم بتشغيل Agent 1 ومسار النماذج الذي يستخدمه للرد على الطلاب."
        />
        <ErrorState
          title="تعذّر تحميل إعداد Agent 1"
          description={loadError ?? "لا تتوفر بيانات إعداد التشغيل."}
          onRetry={() => void refresh()}
        />
      </PageShell>
    );
  }

  const enabled = snapshot.config.enabled;
  const status = !enabled
    ? "disabled"
    : snapshot.state === "NEEDS_ATTENTION"
      ? "notReady"
      : "ready";
  const statusLabel = !enabled
    ? "متوقف"
    : snapshot.state === "NEEDS_ATTENTION"
      ? "يحتاج انتباهًا"
      : "مفعّل — لا توجد طلبات جارية";
  // Only the unaccounted development test route is connected; no production
  // Student execution or Agent-1-attributed M11 event source exists yet.
  // Keep telemetry empty rather than borrowing Tutor measurements.
  const tokenPoints: LiveTelemetryPoint[] = [];
  const attemptPoints: LiveTelemetryPoint[] = [];

  return (
    <PageShell width="full" padding="default" className="gap-5">
      <PageHeader
        eyebrow="الذكاء الاصطناعي"
        title="Agent 1 — التشغيل"
        description="تحكم بتشغيل Agent 1 ومسار النماذج الذي يستخدمه للرد على الطلاب."
        status={<StatusBadge status={status} label={statusLabel} size="sm" />}
        icon={
          <span className="grid size-9 place-items-center rounded-lg bg-accent-subtle text-accent-text">
            <Bot className="size-5" aria-hidden />
          </span>
        }
      />

      <PowerPanel
        snapshot={snapshot}
        status={status}
        statusLabel={statusLabel}
        routeDirty={routeDirty}
        readyForEnable={readyForEnable}
        pending={savingEnabled}
        onToggle={() => void setEnabled(!enabled)}
      />

      <Agent1DevPairingPanel ready={Boolean(snapshot.config.enabled && snapshot.primary?.ready)} />

      {actionError ? (
        <InlineNote tone={conflict ? "warning" : "danger"}>
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>{actionError}</span>
            {conflict ? (
              <Button size="sm" variant="secondary" onClick={() => void reloadAfterConflict()}>
                تحميل النسخة الأحدث
              </Button>
            ) : null}
          </span>
        </InlineNote>
      ) : null}

      <Panel padding="none">
        <PanelHeader
          title="ملخص التشغيل"
          description="حالة الإعداد والمسار الحالي، دون نسب حركة غير مرتبطة بـAgent 1."
          bordered
          density="compact"
        />
        <dl className="grid gap-x-8 gap-y-4 p-4 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryItem label="حالة Agent 1">
            <StatusBadge status={status} label={statusLabel} size="sm" />
          </SummaryItem>
          <SummaryItem label="النموذج الرئيسي">
            {snapshot.primary ? (
              <span className="min-w-0">
                <span className="block truncate font-medium text-fg">
                  {snapshot.primary.displayName}
                </span>
                <span className="mt-0.5 block truncate text-2xs text-fg-tertiary">
                  {snapshot.primary.providerName}
                </span>
              </span>
            ) : (
              <span className="text-warning-text">غير معيّن</span>
            )}
          </SummaryItem>
          <SummaryItem label="الطلب الجاري">
            <span className="text-fg-secondary">لا يوجد مسار طالب إنتاجي؛ اختبار الهاتف تطويري فقط</span>
          </SummaryItem>
          <SummaryItem label="آخر latency معروف">
            <span className="font-medium text-fg tnum">—</span>
          </SummaryItem>
          <SummaryItem label="استخدام التوكنات">
            <span className="font-medium text-fg tnum">—</span>
          </SummaryItem>
        </dl>
      </Panel>

      <Panel padding="none">
        <PanelHeader
          title="النموذج الرئيسي"
          description="يُستخدم أولًا. لا يمكن تفعيل Agent 1 ما لم تكن جاهزية المسار المحلي سليمة."
          bordered
          density="compact"
        />
        <div className="p-4">
          {!snapshot.models.some((model) => model.capability === "GENERATION") ? (
            <EmptyState
              size="sm"
              align="start"
              title="لا توجد نماذج توليد متاحة."
              description="أضف مزوّدًا ونموذج Generation أولًا؛ لن يُفعّل Agent 1 من دون نموذج رئيسي صالح."
              icon={<Server aria-hidden />}
              action={
                <Button variant="outline" asChild>
                  <Link href="/admin/ai/models">فتح النماذج والمزوّدين</Link>
                </Button>
              }
            />
          ) : (
            <ModelAssignmentPanel
              models={snapshot.models}
              value={draftPrimary}
              changed={Boolean(snapshot && draftPrimary !== snapshot.config.primaryModelConfigId)}
              onValueChange={(nextId) => {
                setDraftPrimary(nextId);
                if (nextId) {
                  setDraftFallbacks((current) => current.filter((id) => id !== nextId));
                }
              }}
            />
          )}
        </div>
      </Panel>

      <Panel padding="none">
        <PanelHeader
          title="النماذج الاحتياطية"
          description="تُجرَّب بالترتيب عند تعذر استخدام المسار السابق. يُحفظ الترتيب مع النموذج الرئيسي دفعة واحدة."
          bordered
          density="compact"
          actions={
            routeDirty ? (
              <StatusBadge status="warning" label="مسودة غير محفوظة" size="sm" />
            ) : null
          }
        />
        <div className="space-y-4 p-4">
          {draftFallbacks.length > 0 ? (
            <ReorderableList
              items={draftFallbacks.map((id) => ({ id }))}
              onReorder={(items) => setDraftFallbacks(items.map((item) => item.id))}
              itemLabel="نموذج احتياطي"
              showPosition
              emptyState={null}
              renderItem={(item, index) => {
                const selectedFallback = snapshot.models.find((model) => model.id === item.id) ?? null;
                const occupied = new Set([
                  ...(draftPrimary ? [draftPrimary] : []),
                  ...draftFallbacks.filter((id) => id !== item.id),
                ]);
                return (
                  <div className="flex min-w-0 flex-wrap items-start gap-2">
                    <div className="min-w-56 flex-1">
                      <AgentModelSelector
                        ariaLabel={`اختيار النموذج الاحتياطي ${index + 1}`}
                        models={snapshot.models}
                        value={item.id}
                        excludedIds={occupied}
                        onValueChange={(nextId) => {
                          if (!nextId) return;
                          setDraftFallbacks((current) =>
                            current.map((id) => id === item.id ? nextId : id),
                          );
                        }}
                        placeholder={`النموذج الاحتياطي ${index + 1}`}
                      />
                      {selectedFallback ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge size="sm" variant="inset">
                            <span className="tnum">
                              {selectedFallback.contextWindowTokens == null
                                ? "نافذة غير محددة"
                                : `${formatContextWindow(selectedFallback.contextWindowTokens)} رمز`}
                            </span>
                          </Badge>
                          <StatusBadge
                            status={selectedFallback.ready ? "ready" : "notReady"}
                            label={selectedFallback.readinessLabel}
                            size="sm"
                          />
                          {selectedFallback.readinessReason ? (
                            <span className="text-2xs text-warning-text">
                              {selectedFallback.readinessReason}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <IconButton
                      label={`إزالة النموذج الاحتياطي ${index + 1}`}
                      size="sm"
                      variant="dangerGhost"
                      onClick={() => setDraftFallbacks((current) => current.filter((id) => id !== item.id))}
                    >
                      <Trash2 aria-hidden />
                    </IconButton>
                  </div>
                );
              }}
            />
          ) : (
            <EmptyState
              size="sm"
              align="start"
              title="لا توجد نماذج احتياطية."
              description="يمكنك إضافة حتى ثلاثة نماذج، وسيُحافظ النظام على ترتيبها عند الحفظ."
              icon={<Server aria-hidden />}
            />
          )}

          {draftFallbacks.length < 3 ? (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <AgentModelSelector
                ariaLabel="إضافة نموذج احتياطي"
                models={snapshot.models}
                value={null}
                excludedIds={new Set([
                  ...(draftPrimary ? [draftPrimary] : []),
                  ...draftFallbacks,
                ])}
                onValueChange={(nextId) => {
                  if (!nextId || draftFallbacks.includes(nextId) || nextId === draftPrimary) return;
                  setDraftFallbacks((current) => [...current, nextId]);
                }}
                disabled={!draftPrimary}
                placeholder="إضافة نموذج احتياطي"
              />
              <span className="text-2xs text-fg-quaternary">
                {formatNumber(draftFallbacks.length)} من 3
              </span>
            </div>
          ) : (
            <p className="text-xs text-fg-tertiary">وصلت إلى الحد الأقصى: ثلاثة نماذج احتياطية.</p>
          )}

          {!draftPrimary ? (
            <InlineNote tone="warning">
              اختر النموذج الرئيسي قبل إضافة نماذج احتياطية.
            </InlineNote>
          ) : null}
          {primaryFallbackDuplicate ? (
            <InlineNote tone="danger">
              لا يمكن تكرار النموذج الرئيسي داخل سلسلة النماذج الاحتياطية.
            </InlineNote>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle pt-4">
            {routeDirty ? (
              <Button
                variant="ghost"
                disabled={savingRoute}
                icon={<RotateCcw aria-hidden />}
                onClick={() => {
                  setDraftPrimary(snapshot.config.primaryModelConfigId);
                  setDraftFallbacks(snapshot.config.fallbackModelConfigIds);
                  setActionError(null);
                  setConflict(false);
                }}
              >
                تراجع عن المسودة
              </Button>
            ) : null}
            <Button
              variant={routeDirty && !primaryFallbackDuplicate ? "primary" : "outline"}
              disabled={!routeDirty || savingRoute || primaryFallbackDuplicate}
              loading={savingRoute}
              icon={<Save aria-hidden />}
              onClick={() => void saveRoute()}
            >
              حفظ مسار التشغيل
            </Button>
          </div>
        </div>
      </Panel>

      <Panel padding="none">
        <PanelHeader
          title="مسار التوجيه"
          description="معاينة مرتبة للمسار الحالي؛ لا يظهر أي نموذج كأنه يعمل ما لم يصل حدث تشغيل حقيقي."
          bordered
          density="compact"
        />
        <div className="p-4">
          <PipelineFlow stages={pipelineStages(snapshot, draftPrimary, draftFallbacks)} />
          <p className="mt-3 text-2xs leading-relaxed text-fg-quaternary">
            {routeDirty
              ? "المسار أعلاه يعرض المسودة الحالية؛ لن يتغير إعداد الخادم حتى تحفظها."
              : "المسار أعلاه هو الإعداد المحفوظ؛ لم تُرسل أي طلبات إلى المزوّدين."}
          </p>
        </div>
      </Panel>

      <div className="grid min-w-0 gap-5 2xl:grid-cols-2">
        <LiveTelemetryChart
          title="استهلاك التوكنات المباشر"
          description="قياسات الإدخال والإخراج والاستدلال التي يرسلها مسار Agent 1 فقط."
          data={tokenPoints}
          series={TOKEN_SERIES}
          status="paused"
          showTimeWindow
          footnote="وتيرة التحديث تعتمد على تقارير الاستخدام التي يرسلها المزوّد. لن تُنسب قياسات Tutor إلى Agent 1."
          emptyState={
            <EmptyState
              size="sm"
              title="لا توجد قياسات استخدام من Agent 1 بعد."
              description="ستبقى النافذة فارغة حتى يتصل مسار تنفيذ Agent 1 ويصل تقرير استخدام حقيقي."
              icon={<Zap aria-hidden />}
            />
          }
        />
        <LiveMetricChart
          title="محاولات التشغيل"
          description="عدد محاولات Agent 1 الفعلية ضمن النافذة المحددة."
          data={attemptPoints}
          series={{ key: "attempts", label: "المحاولات", role: "neutral", unit: "محاولة" }}
          status="paused"
          showTimeWindow
          footnote="لا تُعرض أصفار زمنية أو عينات افتراضية؛ يظهر الرسم بعد وصول أحداث Agent 1 الفعلية."
          emptyState={
            <EmptyState
              size="sm"
              title="لا توجد محاولات مسجلة بعد."
              description="لا يوجد حاليًا مسار طالب متصل بهذا الإعداد، لذلك لا توجد أحداث تشغيل قابلة للنسب إلى Agent 1."
              icon={<ShieldAlert aria-hidden />}
            />
          }
        />
      </div>
    </PageShell>
  );
}

function PowerPanel({
  snapshot,
  status,
  statusLabel,
  routeDirty,
  readyForEnable,
  pending,
  onToggle,
}: {
  snapshot: AIAgent1RuntimeSnapshot;
  status: "disabled" | "notReady" | "ready";
  statusLabel: string;
  routeDirty: boolean;
  readyForEnable: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const enabled = snapshot.config.enabled;
  const buttonDisabled = pending || routeDirty || (!enabled && !readyForEnable);
  const disabledReason = routeDirty
    ? "احفظ أو تراجع عن مسودة المسار قبل تغيير حالة التشغيل."
    : !snapshot.primary
      ? "اختر نموذج Generation رئيسيًا أولًا."
      : snapshot.primary.readinessReason;
  const statusNote = routeDirty
    ? disabledReason
    : !enabled && !readyForEnable
      ? disabledReason ?? "المسار غير جاهز للتفعيل."
      : "التشغيل والإيقاف يُحفظان في إعداد الخادم بإصدار متفائل؛ لا يرسلان طلبات إلى أي مزوّد.";

  return (
    <Panel padding="none" className="border-border">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg",
              enabled ? "bg-success-subtle text-success-text" : "bg-inset text-fg-tertiary",
            )}
          >
            {enabled ? <Check className="size-5" aria-hidden /> : <Zap className="size-5" aria-hidden />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-md font-semibold text-fg">تشغيل Agent 1</h2>
              <StatusBadge status={status} label={statusLabel} size="sm" />
            </div>
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-fg-secondary">
              {enabled
                ? "حالة التفعيل محفوظة. واجهة الطالب لم تُربط بمسار Agent 1 في هذه المرحلة."
                : "الإعداد متوقف. يمكنك ضبط السلسلة ثم تفعيلها عندما يكون النموذج الرئيسي جاهزًا."}
            </p>
          </div>
        </div>
        <Button
          variant={enabled
            ? "secondary"
            : readyForEnable && !routeDirty
              ? "primary"
              : "outline"}
          size="lg"
          disabled={buttonDisabled}
          loading={pending}
          icon={enabled ? <Power aria-hidden /> : <Zap aria-hidden />}
          onClick={onToggle}
          className="shrink-0"
        >
          {enabled ? "إيقاف Agent 1" : "تشغيل Agent 1"}
        </Button>
      </div>
      <div className="border-t border-border-subtle px-4 py-3 sm:px-5">
        <p className={cn("text-xs", buttonDisabled && !enabled ? "text-warning-text" : "text-fg-tertiary")}>
          {statusNote}
        </p>
      </div>
    </Panel>
  );
}

function SummaryItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-fg-tertiary">{label}</dt>
      <dd className="mt-1 min-w-0 text-xs">{children}</dd>
    </div>
  );
}

function pipelineStages(
  snapshot: AIAgent1RuntimeSnapshot,
  primaryId: string | null,
  fallbackIds: string[],
): PipelineStage[] {
  const primary = snapshot.models.find((model) => model.id === primaryId) ?? null;
  const stages: PipelineStage[] = [
    {
      key: "agent-1",
      label: "Agent 1",
      state: !snapshot.config.enabled || primary?.ready ? "skipped" : "warning",
      statusLabel: !snapshot.config.enabled
        ? "متوقف"
        : primary?.ready
          ? "مفعّل · بانتظار مسار الطالب"
          : "يحتاج انتباهًا",
      note: !snapshot.config.enabled
        ? "متوقف"
        : snapshot.execution.connected
          ? undefined
          : "الإعداد مفعّل؛ مسار الطالب غير متصل.",
    },
  ];

  if (!primary) {
    stages.push({
      key: "primary-missing",
      label: "النموذج الرئيسي",
      state: "warning",
      statusLabel: "غير معيّن",
      note: "لم يُعيّن نموذج Generation بعد.",
    });
    return stages;
  }

  stages.push(modelStage("primary", primary, snapshot.config.enabled));
  fallbackIds.forEach((id, index) => {
    const model = snapshot.models.find((candidate) => candidate.id === id);
    if (model) stages.push(modelStage(`fallback-${index + 1}`, model, false, index + 1));
  });
  return stages;
}

function modelStage(
  key: string,
  model: AIAgent1RuntimeSnapshot["models"][number],
  primary: boolean,
  fallbackPosition?: number,
): PipelineStage {
  const ready = model.ready;
  return {
    key,
    label: primary
      ? `الرئيسي · ${model.displayName}`
      : `احتياطي ${fallbackPosition} · ${model.displayName}`,
    state: ready ? (primary ? "ok" : "skipped") : "warning",
    statusLabel: !ready
      ? "غير جاهز"
      : primary
        ? "جاهز محليًا"
        : "احتياطي · لم يُجرَّب",
    detail: [
      { label: "المزوّد", value: model.providerName },
      {
        label: "نافذة السياق",
        value: model.contextWindowTokens == null
          ? "غير محددة"
          : `${formatContextWindow(model.contextWindowTokens)} رمز`,
      },
      { label: "الجاهزية", value: model.readinessLabel },
    ],
    note: primary
      ? ready
        ? "جاهز محليًا؛ لم يُفحص الاتصال الخارجي عند تحميل الإعداد."
        : model.readinessReason ?? undefined
      : "لم تتم محاولة أي طلب احتياطي حتى الآن.",
  };
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error &&
    (error as ApiError).code === "AI_AGENT_1_RUNTIME_CONFLICT");
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "تعذّر إكمال العملية. حدّث الصفحة وحاول مجددًا.";
}
