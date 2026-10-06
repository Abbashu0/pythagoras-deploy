"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, ArrowLeft, ArrowUp, Bot, Check, Pause, Play, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import type { AIAgent1RuntimeModel, AIAgent1RuntimeSnapshot } from "@/server/ai/agent-1-runtime/contracts";
import type { Agent1ActivityResultFilter, Agent1ActivitySnapshot, Agent1ActivityWindow, Agent1FailureCategory } from "@/server/ai/agent-1-runtime/activity-contracts";
import { cn } from "@/lib/cn";
import { formatContextWindow, formatNumber, formatTime } from "@/lib/format";
import { Button, IconButton } from "@/components/admin-ui/primitives/button";
import { Panel, PanelHeader } from "@/components/admin-ui/primitives/surface";
import { Tooltip, DisabledReason } from "@/components/admin-ui/primitives/tooltip";
import { Spinner } from "@/components/admin-ui/primitives/spinner";
import { Switch } from "@/components/admin-ui/forms/toggle";
import { Select } from "@/components/admin-ui/forms/select";
import { SegmentedControl } from "@/components/admin-ui/forms/segmented";
import { ErrorState, EmptyState } from "@/components/admin-ui/feedback/empty-state";
import { InlineNote } from "@/components/admin-ui/feedback/banner";
import { PageHeader, PageShell } from "@/components/admin-ui/layout/page";
import { AgentModelSelector } from "@/components/admin-ui/domain/agents/model-selector";
import { LivePulseIndicator, LiveTelemetryChart, LiveMetricChart } from "@/components/admin-ui/charts/live";
import { CompactMetric, MetricRow } from "@/components/admin-ui/charts/metrics";
import { StatusBadge } from "@/components/admin-ui/status/status-badge";
import { ModelBrandIcon } from "./model-brand-icon";
import { useAgent1Activity } from "./use-agent-1-activity";
import { promoteFallback, reorderFallbacks } from "./agent-1-route-draft";
import { RuntimeModelOrder, SortableRuntimeModel } from "./runtime-model-sortable";

const FAILURE_LABELS: Record<Agent1FailureCategory, string> = {
  timeout: "انتهت مهلة المزوّد", "rate-limit": "تجاوز حد الطلبات", authentication: "تعذّرت المصادقة",
  unavailable: "المزوّد غير متاح / دائرة الحماية مفتوحة", "bad-response": "استجابة غير صالحة", configuration: "إعداد غير صالح", unknown: "سبب غير مصنّف",
};
const WINDOW_OPTIONS = [{ value: "1m", label: "1د" }, { value: "5m", label: "5د" }, { value: "15m", label: "15د" }, { value: "1h", label: "1س" }];
const seconds = (value: number | null | undefined) => value == null ? "—" : (value / 1_000).toFixed(1) + " ث";

const TOKEN_SERIES = [
  { key: "totalTokens", label: "الإجمالي" },
  { key: "inputTokens", label: "الإدخال", dashed: true },
  { key: "outputTokens", label: "الإخراج", dashed: true },
];
const CONCURRENT_SERIES = { key: "concurrentRequests", label: "الطلبات المتزامنة", unit: "طلب" };
const liveClock = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const formatLiveTime = (value: number | string) => liveClock.format(new Date(value));
const PHASE_LABELS = { connecting: "جارٍ الاتصال", thinking: "يفكّر الآن", responding: "يردّ الآن" };
const OUTCOMES = {
  completed: { status: "ready", label: "اكتمل" },
  failed: { status: "failed", label: "تعذّر" },
  cancelled: { status: "inactive", label: "أُلغي" },
  expired: { status: "stale", label: "انتهت المراقبة" },
} as const;

interface ApiError extends Error { code?: string }
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: {
    Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers,
  } });
  const body = await response.json();
  if (!response.ok || body.ok === false) {
    const error = new Error(body.message ?? "تعذّر إكمال العملية.") as ApiError;
    error.code = body.code;
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
  const [pending, setPending] = React.useState<"route" | "power" | null>(null);
  const [paused, setPaused] = React.useState<Agent1ActivitySnapshot | null>(null);
  const [timeWindow, setTimeWindow] = React.useState<Agent1ActivityWindow>("5m");
  const [modelFilter, setModelFilter] = React.useState<string | null>(null);
  const [logFilter, setLogFilter] = React.useState<Agent1ActivityResultFilter>("all");
  const [reviewedId, setReviewedId] = React.useState<string | null>(null);
  const { activity, connection, error: activityError } = useAgent1Activity(timeWindow, modelFilter, logFilter);

  const applySnapshot = React.useCallback((next: AIAgent1RuntimeSnapshot) => {
    setSnapshot(next);
    setDraftPrimary(next.config.primaryModelConfigId);
    setDraftFallbacks(next.config.fallbackModelConfigIds);
    setReviewedId(next.config.primaryModelConfigId);
    setConflict(false);
  }, []);
  const refresh = React.useCallback(async () => {
    try {
      applySnapshot(await requestJson<AIAgent1RuntimeSnapshot>("/api/admin/local/ai/agent-1/runtime"));
      setLoadError(null);
    } catch (error) { setLoadError(errorMessage(error)); }
    finally { setLoading(false); }
  }, [applySnapshot]);
  React.useEffect(() => { void refresh(); }, [refresh]);

  const dirty = Boolean(snapshot && (draftPrimary !== snapshot.config.primaryModelConfigId ||
    draftFallbacks.join("\0") !== snapshot.config.fallbackModelConfigIds.join("\0")));
  const primary = snapshot?.models.find(model => model.id === draftPrimary) ?? null;
  const reviewed = snapshot?.models.find(model => model.id === (reviewedId ?? draftPrimary)) ?? primary;
  const validRoute = Boolean(primary?.ready && !draftFallbacks.includes(draftPrimary ?? "") &&
    draftFallbacks.every(id => snapshot?.models.some(model => model.id === id && model.ready)));
  const displayed = paused ?? activity;
  const tokenPoints = React.useMemo(() => displayed?.stats.usageReports ? displayed.points.map(point => ({
    ...point, totalTokens: point.inputTokens === null || point.outputTokens === null ? null : point.inputTokens + point.outputTokens,
  })) : [], [displayed]);
  const requestPoints = React.useMemo(() => displayed?.points.map(point => ({
    timestamp: point.timestamp, concurrentRequests: point.concurrentRequests,
  })) ?? [], [displayed]);

  const saveRoute = async () => {
    if (!snapshot || !dirty || !validRoute || pending) return;
    setPending("route"); setActionError(null);
    try {
      applySnapshot(await requestJson<AIAgent1RuntimeSnapshot>("/api/admin/local/ai/agent-1/runtime", {
        method: "PUT", body: JSON.stringify({ expectedRevision: snapshot.config.revision,
          primaryModelConfigId: draftPrimary, fallbackModelConfigIds: draftFallbacks }),
      }));
    } catch (error) {
      setConflict((error as ApiError).code === "AI_AGENT_1_RUNTIME_CONFLICT");
      setActionError(errorMessage(error));
    } finally { setPending(null); }
  };
  const togglePower = async (enabled: boolean) => {
    if (!snapshot || pending || (enabled && (dirty || !validRoute))) return;
    setPending("power"); setActionError(null);
    try {
      const result = await requestJson<AIAgent1RuntimeSnapshot>("/api/admin/local/ai/agent-1/runtime", {
        method: "PATCH", body: JSON.stringify({ expectedRevision: snapshot.config.revision, enabled }),
      });
      // Stopping remains available while editing and does not discard the draft.
      setSnapshot(result); setConflict(false);
    } catch (error) {
      setConflict((error as ApiError).code === "AI_AGENT_1_RUNTIME_CONFLICT");
      setActionError(errorMessage(error));
    } finally { setPending(null); }
  };
  const selectFallback = (index: number, value: string | null) => {
    setDraftFallbacks(previous => value === null ? previous.filter((_, i) => i !== index)
      : index >= previous.length ? [...previous, value] : previous.map((id, i) => i === index ? value : id));
  };
  const moveFallback = (index: number, direction: -1 | 1) => setDraftFallbacks(previous => reorderFallbacks(previous, index, index + direction));
  const promote = (index: number) => {
    const result = promoteFallback(draftPrimary, draftFallbacks, index);
    setDraftPrimary(result.primary); setDraftFallbacks(result.fallbacks); setReviewedId(result.primary);
  };

  const header = <PageHeader eyebrow="الذكاء الاصطناعي" title="تشغيل Agent 1"
    description="مسار النماذج، النشاط المباشر، وأداء الوكيل في مكان واحد."
    actions={<Button variant="ghost" size="sm" icon={<RotateCcw aria-hidden />} onClick={() => void refresh()}
      disabled={Boolean(pending) || dirty} title={dirty ? "احفظ التغييرات أو تراجع عنها قبل التحديث." : undefined}>تحديث الإعداد</Button>} />;
  if (loading) return <PageShell width="full" className="gap-5">{header}<Panel><div className="grid min-h-72 place-items-center"><Spinner label="جارٍ تحميل لوحة التشغيل" size="lg" /></div></Panel></PageShell>;
  if (!snapshot || loadError) return <PageShell width="full" className="gap-5">{header}<ErrorState title="تعذّر تحميل لوحة التشغيل" description={loadError ?? undefined} onRetry={() => void refresh()} /></PageShell>;

  const powerBlocked = pending !== null || (!snapshot.config.enabled && (dirty || !validRoute || !snapshot.canEnable));
  const powerReason = pending ? "جارٍ حفظ الإعداد." : dirty ? "احفظ مسار النماذج قبل التفعيل." : primary?.readinessReason ?? "عيّن نموذجًا رئيسيًا جاهزًا أولًا.";
  const stats = displayed?.stats;
  const performance = displayed?.modelPerformance.find(item => item.modelConfigId === reviewed?.id);
  const recent = displayed?.recent ?? [];
  const transition = connection === "live" ? activity?.transitions[0] : undefined;
  const detachedModels = activity?.activeModels.filter(model => ![draftPrimary, ...draftFallbacks].includes(model.modelConfigId)) ?? [];
  const totalTokens = stats?.inputTokens != null && stats.outputTokens != null ? stats.inputTokens + stats.outputTokens : null;
  const chartStatus = paused ? "paused" : connection;
  const successRate = stats && stats.completedRequests + stats.failedRequests > 0
    ? Math.round(stats.completedRequests / (stats.completedRequests + stats.failedRequests) * 100) + "%" : "—";

  return (
    <PageShell width="full" className="gap-5">
      {header}
      {actionError ? <InlineNote tone={conflict ? "warning" : "danger"}><span className="flex flex-wrap items-center justify-between gap-3">
        <span>{actionError}</span>{conflict ? <Button size="sm" variant="secondary" onClick={() => { void refresh(); setActionError(null); }}>تحميل أحدث إعداد</Button> : null}
      </span></InlineNote> : null}

      <Panel padding="none" className="min-w-0">
        <PanelHeader title="التشغيل ومسار النماذج" as="h2" bordered description="الرئيسي يبدأ أولًا، والاحتياطية تُجرّب حسب ترتيبها."
          actions={<div className="flex items-center gap-3">
            <StatusBadge status={!snapshot.config.enabled ? "disabled" : snapshot.canEnable ? "ready" : "notReady"}
              label={!snapshot.config.enabled ? "متوقف" : snapshot.canEnable ? "مفعّل" : "يحتاج انتباهًا"} size="sm" />
            <DisabledReason reason={powerBlocked ? powerReason : null}><Switch checked={snapshot.config.enabled} pending={pending === "power"}
              disabled={powerBlocked} onCheckedChange={(enabled) => void togglePower(enabled)} aria-label="تشغيل Agent 1" /></DisabledReason>
          </div>} />
        {connection === "live" && detachedModels.length ? <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-5 py-2 text-xs text-info-text">
          <span>طلبات من المسار السابق ما زالت جارية:</span>{detachedModels.map(model => <span key={model.modelConfigId}><bdi>{snapshot.models.find(candidate => candidate.id === model.modelConfigId)?.displayName ?? "نموذج سابق"}</bdi> · {model.count}</span>)}
        </div> : null}
        <div className="grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="relative min-w-0 px-5 py-4 sm:px-8">
            <div className="mx-auto flex max-w-lg flex-col items-center">
              <ModelSlot primary position={0} model={primary} models={snapshot.models} selectedId={draftPrimary}
                excludedIds={new Set(draftFallbacks)} disabled={Boolean(pending)} onSelect={setDraftPrimary}
                onReview={setReviewedId}
                running={connection === "live" ? activity?.activeModels.find(model => model.modelConfigId === draftPrimary) : undefined} />
              <RouteConnections primary={draftPrimary} fallbacks={draftFallbacks} transition={transition} />
              <RuntimeModelOrder ids={draftFallbacks} disabled={Boolean(pending)} onReorder={setDraftFallbacks}>
              <div className="grid w-full grid-cols-3 gap-3 sm:gap-5">
                {[0, 1, 2].map(index => {
                  const id = draftFallbacks[index] ?? null;
                  const model = snapshot.models.find(candidate => candidate.id === id) ?? null;
                  return <SortableRuntimeModel key={id ?? "empty-" + index} id={id ?? "empty-" + index} position={index + 1} disabled={!id || Boolean(pending)}>
                    <ModelSlot position={index + 1} model={model} models={snapshot.models} selectedId={id}
                      excludedIds={new Set([draftPrimary ?? "", ...draftFallbacks.filter((_, i) => i !== index)])}
                      disabled={Boolean(pending) || index > draftFallbacks.length} onSelect={value => selectFallback(index, value)}
                      onReview={setReviewedId}
                      running={connection === "live" ? activity?.activeModels.find(model => model.modelConfigId === id) : undefined} />
                    {id ? <div className="flex max-w-full flex-wrap items-center justify-center gap-1">
                      <IconButton label={"تقديم الاحتياطي " + (index + 1)} size="xs" variant="ghost" disabled={index === 0 || Boolean(pending)} onClick={() => moveFallback(index, -1)}><ArrowRight aria-hidden /></IconButton>
                      <IconButton label={"تأخير الاحتياطي " + (index + 1)} size="xs" variant="ghost" disabled={index === draftFallbacks.length - 1 || Boolean(pending)} onClick={() => moveFallback(index, 1)}><ArrowLeft aria-hidden /></IconButton>
                      <IconButton label={"تعيين الاحتياطي " + (index + 1) + " رئيسيًا"} size="xs" variant="ghost" disabled={!model?.ready || Boolean(pending)} onClick={() => promote(index)}><ArrowUp aria-hidden /></IconButton>
                      <IconButton label={"إزالة الاحتياطي " + (index + 1)} size="xs" variant="ghost" disabled={Boolean(pending)} onClick={() => selectFallback(index, null)}><Trash2 aria-hidden /></IconButton>
                    </div> : null}
                  </SortableRuntimeModel>;
                })}
              </div>
              </RuntimeModelOrder>
              {transition ? <p className="mt-3 max-w-full text-center text-2xs leading-relaxed text-info-text">
                انتقال فعلي: <bdi>{snapshot.models.find(item => item.id === transition.fromModelConfigId)?.displayName ?? "نموذج سابق"}</bdi>
                {" ← "}<bdi>{snapshot.models.find(item => item.id === transition.toModelConfigId)?.displayName ?? "احتياطي"}</bdi>
                {transition.reason ? " · " + FAILURE_LABELS[transition.reason] : ""}
              </p> : null}
            </div>
          </div>
          <div className="flex min-w-0 flex-col justify-center gap-6 border-t border-border-subtle p-6 lg:border-s lg:border-t-0 lg:p-8">
            <div><p className="eyebrow mb-2">تفاصيل النموذج {reviewed?.id === draftPrimary ? "الرئيسي" : "الاحتياطي"}</p>
              <h3 className="break-words text-lg font-medium text-fg"><bdi>{reviewed?.displayName ?? "اختر النموذج الذي سيبدأ المحادثات"}</bdi></h3>
              <p className="mt-1 text-xs text-fg-tertiary">{reviewed?.providerName ?? "اضغط الدائرة الكبيرة لتعيين نموذج."}</p>
              {reviewed ? <div className="mt-3"><StatusBadge status={reviewed.ready ? "ready" : "notReady"} label={reviewed.ready ? "اتصال جاهز" : reviewed.readinessLabel} size="sm" /></div> : null}</div>
            {reviewed ? <dl className="grid grid-cols-2 gap-4 text-xs">
              <div><dt className="text-fg-tertiary">نافذة السياق</dt><dd className="mt-1 font-medium tnum">{reviewed.contextWindowTokens === null ? "—" : formatContextWindow(reviewed.contextWindowTokens)}</dd></div>
              <div><dt className="text-fg-tertiary">محاولاته في المدى المحدد</dt><dd className="mt-1 font-medium tnum">{performance ? formatNumber(performance.attempts) : "—"}</dd></div>
              <div><dt className="text-fg-tertiary">أول نص من المزوّد</dt><dd className="mt-1 font-medium tnum">{seconds(performance?.averageFirstTextMs)}</dd></div>
              <div><dt className="text-fg-tertiary">مدة محاولاته الناجحة</dt><dd className="mt-1 font-medium tnum">{seconds(performance?.averageDurationMs)}</dd></div>
            </dl> : null}
            <div className="space-y-2 text-xs leading-relaxed text-fg-secondary">
              <p>اضغط الدائرة لاختيار النموذج واسمه لمراجعة تفاصيله. اسحب مقبض الترتيب أو استخدم الأسهم؛ السهم للأعلى يبدّل الاحتياطي مع الرئيسي.</p>
              <p>الأداء من المحاولات المرصودة في المدى المحدد، وليس اختبارًا لصحة المزوّد. حلقة النشاط والمسار المضيء يظهران فقط مع نشاط فعلي.</p>
            </div>
            {reviewed && !reviewed.ready ? <InlineNote tone="warning">{reviewed.readinessReason ?? "النموذج غير جاهز للتشغيل."}</InlineNote> : null}
            <Link href="/admin/ai/models" className="text-xs text-accent-text hover:underline">إدارة النماذج والمزوّدين ←</Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
          <p className="max-w-3xl text-2xs leading-relaxed text-fg-tertiary">يُستخدم الاحتياطي عند فشل قابل لإعادة المحاولة، قبل وصول أي محتوى أو استخدام مُبلّغ. إيقاف الوكيل يمنع الطلبات الجديدة؛ لا يقطع ردًا جاريًا.</p>
          {dirty ? <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={Boolean(pending)} onClick={() => applySnapshot(snapshot)}>تراجع</Button>
            <DisabledReason reason={!validRoute ? "عيّن نموذجًا رئيسيًا جاهزًا لحفظ المسار." : null}><Button size="sm" icon={<Save aria-hidden />}
              loading={pending === "route"} disabled={!validRoute || Boolean(pending)} onClick={() => void saveRoute()}>حفظ المسار</Button></DisabledReason>
          </div> : <span className="flex items-center gap-1.5 text-2xs text-fg-tertiary"><Check className="size-3" aria-hidden />المسار محفوظ</span>}
        </div>
        {dirty ? <div className="border-t border-border-subtle bg-accent-subtle px-5 py-3 text-xs leading-relaxed">
          <span className="font-medium text-accent-text">معاينة غير محفوظة · </span>
          <bdi>{primary?.displayName ?? "رئيسي غير معيّن"}</bdi>
          {draftFallbacks.map((id, i) => <React.Fragment key={id}>{" ← "}<span className="text-fg-secondary">{i + 1}. <bdi>{snapshot.models.find(item => item.id === id)?.displayName ?? "نموذج غير متاح"}</bdi></span></React.Fragment>)}
          <p className="mt-1 text-2xs text-fg-tertiary">الطلبات الجديدة ما زالت تستخدم المسار المحفوظ حتى تضغط «حفظ المسار»؛ الطلبات الجارية لا تتغير.</p>
        </div> : null}
      </Panel>

      <section aria-labelledby="agent1-monitoring" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 id="agent1-monitoring" className="text-lg font-medium">المراقبة المباشرة</h2><p className="mt-1 text-xs text-fg-tertiary">نشاط شات الآيفون في جلسة الخادم الحالية، بتحديث كل ثانية.</p></div>
          <div className="flex items-center gap-3"><LivePulseIndicator status={connection} label={connection === "live" ? "التحديث متصل" : "جارٍ الاتصال"} />
            <Button variant="ghost" size="sm" disabled={!activity} icon={paused ? <Play aria-hidden /> : <Pause aria-hidden />}
              onClick={() => setPaused(previous => previous ? null : activity)}>{paused ? "استئناف الرسم" : "إيقاف الرسم مؤقتًا"}</Button></div>
        </div>
        {activityError ? <InlineNote tone="warning">{activityError}</InlineNote> : null}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-surface px-4 py-3">
          <span className="text-xs text-fg-secondary">نطاق جميع القياسات</span>
          <SegmentedControl size="sm" aria-label="المدى الزمني لجميع القياسات" options={WINDOW_OPTIONS} value={timeWindow}
            onValueChange={value => { setTimeWindow(value as Agent1ActivityWindow); setPaused(null); }} />
          <Select size="sm" aria-label="فلتر نموذج المراقبة" className="w-full sm:max-w-64" value={modelFilter ?? "all"}
            onValueChange={value => { setModelFilter(value === "all" ? null : value); setPaused(null); }}
            options={[{ value: "all", label: "كل النماذج" }, ...snapshot.models.filter(model => [modelFilter, draftPrimary, ...draftFallbacks, ...snapshot.config.fallbackModelConfigIds, snapshot.config.primaryModelConfigId,
              ...activity?.modelPerformance.map(item => item.modelConfigId) ?? []].includes(model.id)).map(model => ({ value: model.id, label: <bdi>{model.displayName}</bdi> }))]} />
          <span className="text-2xs text-fg-tertiary sm:ms-auto">{paused ? "لقطة متوقفة عند " + formatLiveTime(paused.capturedAt) : "المدى نفسه للرسوم والمؤشرات والسجل"}</span>
        </div>
        {displayed?.scope.historyLimited ? <InlineNote tone="warning">بلغ سجل الجلسة حدّه البالغ 10,000 طلب؛ مؤشرات المدة والنتائج تعرض الجزء المحتفظ به فقط.</InlineNote> : null}
        <MetricRow columns={5}>
          <CompactMetric variant="bare" label="الطلبات الجارية" value={(paused || connection === "live") && stats ? formatNumber(stats.activeRequests) : "—"} />
          <CompactMetric variant="bare" label="الردود المكتملة" value={stats ? formatNumber(stats.completedRequests) : "—"} />
          <CompactMetric variant="bare" label="نجاح الطلبات" value={successRate}
            context={stats ? formatNumber(stats.failedRequests) + " تعذّر · " + formatNumber(stats.cancelledRequests) + " أُلغي" : undefined} />
          <CompactMetric variant="bare" label="متوسط مدة الرد" value={stats?.averageLatencyMs == null ? "—" : (stats.averageLatencyMs / 1_000).toFixed(1)} unit="ث" />
          <CompactMetric variant="bare" label="التوكنات المُبلّغة" value={totalTokens === null ? "—" : formatNumber(totalTokens)}
            context={stats?.reasoningTokens != null ? formatNumber(stats.reasoningTokens) + " استدلال ضمن الإخراج" : undefined} />
        </MetricRow>
        <MetricRow columns={3}>
          <CompactMetric variant="bare" label="متوسط وصول أول نص" value={seconds(stats?.averageFirstTextMs)} context="من بدء الطلب؛ لا يشمل نص الاستدلال المخفي" />
          <CompactMetric variant="bare" label="مدة الرد · p95" value={seconds(stats?.p95LatencyMs)}
            context={stats && stats.latencySamples >= 20 ? "95% من الردود المكتملة أسرع من هذه المدة" : "يظهر بعد 20 ردًا مكتملًا · " + (stats?.latencySamples ?? 0) + "/20"} />
          <CompactMetric variant="bare" label="محاولات الاحتياطي" value={stats ? formatNumber(stats.fallbackAttempts) : "—"} context="محاولات فعلية؛ لا تعني تلقائيًا فشل الطلب النهائي" />
        </MetricRow>
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <LiveTelemetryChart title="تدفّق التوكنات" description="التقارير التي وصلت من المزوّد في كل 5 ثوانٍ."
            data={tokenPoints} series={TOKEN_SERIES} status={chartStatus} valueUnit="رمز / 5 ث" startAtZero formatTimestamp={formatLiveTime} allowDecimals={false}
            timeWindow={timeWindow} showTimeWindow={false}
            loading={!activity && !activityError} error={!activity && activityError ? { message: activityError } : null}
            emptyState={<EmptyState size="sm" title="في انتظار أول تقرير استخدام" description="سيبدأ الرسم عند إرسال المزوّد أرقام التوكنات، أثناء الرد أو عند اكتماله." />}
            footnote="لا تُقدّر التوكنات من النص. الاستدلال جزء من الإخراج، ولا يُضاف إلى الإجمالي مرة ثانية." />
          <LiveMetricChart title="نشاط الطلبات" description="أعلى عدد من الطلبات المتزامنة خلال كل 5 ثوانٍ."
            data={requestPoints} series={CONCURRENT_SERIES} status={chartStatus} formatTimestamp={formatLiveTime} allowDecimals={false}
            timeWindow={timeWindow} showTimeWindow={false}
            loading={!activity && !activityError} error={!activity && activityError ? { message: activityError } : null}
            footnote="صفر يعني عدم وجود طلبات جارية في الفترة المرصودة. القياس لا يحتوي معرفات الطلاب أو نصوص المحادثات." />
        </div>
      </section>

      <Panel padding="none">
        <PanelHeader title="آخر عمليات التشغيل" as="h2" description="أحدث 12 طلبًا في المدى والنموذج المحددين. افتح العملية لرؤية سلسلة المحاولات." bordered
          actions={<Select size="sm" aria-label="فلتر نتائج سجل التشغيل" value={logFilter} onValueChange={value => { setLogFilter(value as Agent1ActivityResultFilter); setPaused(null); }} className="w-44"
            options={[{ value: "all", label: "كل النتائج" }, { value: "failed", label: "المتعذّرة" }, { value: "cancelled", label: "الملغاة" }, { value: "fallback", label: "استخدمت احتياطيًا" },
              ...Object.entries(FAILURE_LABELS).map(([value, label]) => ({ value, label }))]} />} />
        {!recent.length ? <div className="px-5 py-8 text-center text-xs text-fg-tertiary">{activity ? "لا توجد عمليات مطابقة في النطاق المحدد." : "جارٍ تحميل سجل هذا النطاق…"}</div>
          : <ul className="divide-y divide-border-subtle">{recent.map((item, index) => {
            const model = snapshot.models.find(model => model.id === item.modelConfigId);
            const state = OUTCOMES[item.outcome];
            return <li key={String(item.endedAt) + "-" + index} className="px-5 py-3"><details className="group">
              <summary className="focus-ring flex cursor-pointer list-none flex-wrap items-center gap-3 rounded">
              {model ? <ModelBrandIcon providerModelId={model.providerModelId} displayName={model.displayName} /> : <Bot className="size-5 text-fg-tertiary" aria-hidden />}
              <span className="min-w-0 flex-1 truncate text-sm text-fg"><bdi>{model?.displayName ?? "طلب دون نموذج متاح"}</bdi></span>
              <span className="text-2xs text-fg-tertiary tnum">{formatTime(item.endedAt)}</span>
              <span className="text-xs text-fg-secondary tnum">{(item.latencyMs / 1_000).toFixed(1)} ث</span>
              <span className="text-xs text-fg-secondary tnum">{item.outputTokens === null ? "استخدام غير مُبلّغ" : formatNumber(item.outputTokens) + " إخراج"}</span>
              <StatusBadge status={state.status} label={state.label} size="sm" />
              <span className="text-2xs text-accent-text group-open:hidden">التفاصيل</span>
              </summary>
              <div className="mt-3 space-y-2 rounded-lg border border-border-subtle bg-inset p-3 text-xs">
                <p className="text-fg-secondary">أول نص: {seconds(item.firstTextMs)} · {item.attempts} محاولة{item.reason ? " · " + FAILURE_LABELS[item.reason] : ""}</p>
                <ol className="space-y-2">{item.chain.map((attempt, i) => <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className="tnum text-fg-tertiary">{i + 1}.</span><bdi className="break-all">{snapshot.models.find(model => model.id === attempt.modelConfigId)?.displayName ?? "نموذج غير متاح"}</bdi>
                  <span className="text-fg-secondary">{attempt.status === "succeeded" ? "نجحت" : attempt.status === "cancelled" ? "أُلغيت" : attempt.status === "running" ? "جارية" : "تعذّرت"}</span>
                  <span className="text-fg-tertiary">{attempt.endedAt === null ? "—" : seconds(Math.max(0, attempt.endedAt - attempt.startedAt))}{attempt.reason ? " · " + FAILURE_LABELS[attempt.reason] : ""}</span>
                </li>)}</ol>
                {!item.chain.length ? <p className="text-fg-tertiary">لم تبدأ محاولة مزوّد.</p> : null}
              </div>
            </details></li>;
          })}</ul>}
      </Panel>
      <p className="text-2xs leading-relaxed text-fg-tertiary">المصدر: مسار شات التطوير الحالي. تُصفّر القياسات عند إعادة تشغيل الخادم، ويُحتفظ بآخر ساعة في الذاكرة فقط. الدقة الزمنية 5 ثوانٍ. فلتر النموذج ينسب نتيجة الطلب إلى آخر نموذج حاول تنفيذه؛ التوكنات تُنسب إلى المزوّد الذي أبلغها، وتفاصيل الدوائر تعرض محاولات كل نموذج في المدى نفسه.
        {stats?.missingUsageRequests ? " " + formatNumber(stats.missingUsageRequests) + " طلب لم يرسل تقرير استخدام." : ""}</p>
    </PageShell>
  );
}

function ModelSlot({ primary = false, position, model, models, selectedId, excludedIds, disabled, onSelect, onReview, running }: {
  primary?: boolean; position: number; model: AIAgent1RuntimeModel | null; models: AIAgent1RuntimeModel[];
  selectedId: string | null; excludedIds: ReadonlySet<string>; disabled: boolean;
  onSelect: (id: string | null) => void; running?: Agent1ActivitySnapshot["activeModels"][number];
  onReview: (id: string | null) => void;
}) {
  const label = primary ? "النموذج الرئيسي" : "الاحتياطي " + position;
  return <div className="flex w-full min-w-0 flex-col items-center gap-2 text-center">
    <span className="text-xs text-fg-secondary">{label}{primary ? <span className="ms-1 text-2xs text-fg-tertiary">· مطلوب</span> : null}</span>
    <AgentModelSelector models={models} value={selectedId} onValueChange={id => { onSelect(id); onReview(id); }} excludedIds={excludedIds} clearable={!primary && model !== null}
      clearLabel="إزالة هذا الاحتياطي" disabled={disabled} ariaLabel={"اختيار " + label}
      renderModelIcon={model => <ModelBrandIcon providerModelId={model.providerModelId} displayName={model.displayName} />}
      trigger={<button type="button" aria-label={"اختيار " + label} disabled={disabled} onFocus={() => { if (selectedId) onReview(selectedId); }}
        title={disabled ? "عيّن الاحتياطي السابق أولًا، أو انتظر اكتمال الحفظ." : model ? model.displayName + (model.ready ? "" : " · " + model.readinessReason) : "اختيار " + label}
        className={cn("relative grid shrink-0 place-items-center rounded-full border bg-bg transition-colors duration-[var(--dur-base)] focus-ring disabled:cursor-not-allowed disabled:opacity-45",
          primary ? "size-24 sm:size-28" : "size-16 sm:size-20",
          model ? primary ? "border-accent-border bg-accent-subtle" : "border-border-strong hover:border-accent" : "border-dashed border-border-strong hover:border-accent hover:bg-hover",
          running && "border-info-border ring-2 ring-info-border")}>
        {running ? <span aria-hidden className="pointer-events-none absolute -inset-2 rounded-full border border-info-border motion-safe:animate-pulse" /> : null}
        {model ? <ModelBrandIcon providerModelId={model.providerModelId} displayName={model.displayName} markSize={primary ? 48 : 30} className="size-full border-0 bg-transparent" />
          : <Plus className={primary ? "size-7 text-fg-tertiary" : "size-5 text-fg-tertiary"} aria-hidden />}
        {model && !model.ready ? <span className="absolute bottom-0 end-0 grid size-5 place-items-center rounded-full border border-warning-border bg-surface text-warning-text"><AlertTriangle className="size-3" aria-hidden /></span> : null}
      </button>} />
    {model ? <Tooltip content={model.displayName + " · " + model.providerName + " · " + model.readinessLabel}>
      <button type="button" aria-label={"تفاصيل " + model.displayName} onClick={() => onReview(model.id)} dir="auto"
        className="focus-ring max-w-full truncate rounded px-1 text-xs font-medium text-fg hover:text-accent-text">{primary ? "تفاصيل النموذج" : model.displayName}</button>
    </Tooltip> : !primary ? <span className="text-xs text-fg-tertiary">اختيار نموذج</span> : null}
    <span className="min-h-4 text-2xs text-info-text">{running ? PHASE_LABELS[running.phase] + " · " + running.count : ""}</span>
  </div>;
}

function RouteConnections({ primary, fallbacks, transition }: {
  primary: string | null; fallbacks: string[]; transition?: Agent1ActivitySnapshot["transitions"][number];
}) {
  // RTL physical slots, with actual attempt identities (never an invented cycle).
  const x = (id: string) => id === primary ? 50 : [83, 50, 17][fallbacks.indexOf(id)];
  const from = transition ? x(transition.fromModelConfigId) : undefined;
  const to = transition ? x(transition.toModelConfigId) : undefined;
  const path = from !== undefined && to !== undefined
    ? `M ${from} ${transition?.fromModelConfigId === primary ? 0 : 30} L ${from} 10 L ${to} 10 L ${to} 30` : null;
  return <svg aria-hidden viewBox="0 0 100 30" preserveAspectRatio="none" className="my-3 h-8 w-full overflow-visible text-border-strong">
    <path d="M50 0 V10 M17 30 V10 H83 V30 M50 10 V30" fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    {path ? <path d={path} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke"
      className={cn("text-info-border", transition?.active && "motion-safe:animate-pulse")} /> : null}
  </svg>;
}

function errorMessage(error: unknown) {
  const messages: Record<string, string> = {
    AI_AGENT_1_RUNTIME_CONFLICT: "تغيّر الإعداد من جلسة أخرى. حمّل أحدث نسخة قبل متابعة التعديل.",
    AI_AGENT_1_RUNTIME_PRIMARY_REQUIRED: "اختر نموذجًا رئيسيًا قبل تشغيل الوكيل.",
    AI_AGENT_1_RUNTIME_MODEL_NOT_READY: "أحد النماذج غير جاهز. راجع تفعيله وإعداد المزوّد.",
    AI_AGENT_1_RUNTIME_MODEL_NOT_FOUND: "أحد النماذج لم يعد متاحًا. حدّث الإعداد واختر بديلًا.",
    AI_AGENT_1_RUNTIME_INVALID: "راجع اختيار النماذج وترتيبها؛ لا يمكن تكرار النموذج داخل المسار.",
    AI_AGENT_1_RUNTIME_CORRUPT: "تعذّر قراءة الإعداد المحفوظ. راجع إعدادات الخادم.",
  };
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return messages[code] ?? "تعذّر الاتصال أو إكمال العملية. حدّث الصفحة وحاول مجددًا.";
}
