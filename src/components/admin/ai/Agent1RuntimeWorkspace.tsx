"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, ArrowLeft, Bot, Check, Pause, Play, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import type { AIAgent1RuntimeModel, AIAgent1RuntimeSnapshot } from "@/server/ai/agent-1-runtime/contracts";
import type { Agent1ActivitySnapshot } from "@/server/ai/agent-1-runtime/activity-contracts";
import { cn } from "@/lib/cn";
import { formatContextWindow, formatNumber, formatTime } from "@/lib/format";
import { Button, IconButton } from "@/components/admin-ui/primitives/button";
import { Panel, PanelHeader } from "@/components/admin-ui/primitives/surface";
import { Tooltip, DisabledReason } from "@/components/admin-ui/primitives/tooltip";
import { Spinner } from "@/components/admin-ui/primitives/spinner";
import { Switch } from "@/components/admin-ui/forms/toggle";
import { ErrorState, EmptyState } from "@/components/admin-ui/feedback/empty-state";
import { InlineNote } from "@/components/admin-ui/feedback/banner";
import { PageHeader, PageShell } from "@/components/admin-ui/layout/page";
import { AgentModelSelector } from "@/components/admin-ui/domain/agents/model-selector";
import { LivePulseIndicator, LiveTelemetryChart, LiveMetricChart } from "@/components/admin-ui/charts/live";
import { CompactMetric, MetricRow } from "@/components/admin-ui/charts/metrics";
import { StatusBadge } from "@/components/admin-ui/status/status-badge";
import { ModelBrandIcon } from "./model-brand-icon";
import { useAgent1Activity } from "./use-agent-1-activity";

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
  const { activity, connection, error: activityError } = useAgent1Activity();

  const applySnapshot = React.useCallback((next: AIAgent1RuntimeSnapshot) => {
    setSnapshot(next);
    setDraftPrimary(next.config.primaryModelConfigId);
    setDraftFallbacks(next.config.fallbackModelConfigIds);
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
  const validRoute = Boolean(primary?.ready && !draftFallbacks.includes(draftPrimary ?? ""));
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
  const moveFallback = (index: number, direction: -1 | 1) => {
    setDraftFallbacks(previous => {
      const next = [...previous]; const target = index + direction;
      if (target < 0 || target >= next.length) return previous;
      [next[index], next[target]] = [next[target], next[index]]; return next;
    });
  };

  const header = <PageHeader eyebrow="الذكاء الاصطناعي" title="تشغيل Agent 1"
    description="مسار النماذج، النشاط المباشر، وأداء الوكيل في مكان واحد."
    actions={<Button variant="ghost" size="sm" icon={<RotateCcw aria-hidden />} onClick={() => void refresh()}
      disabled={Boolean(pending) || dirty} title={dirty ? "احفظ التغييرات أو تراجع عنها قبل التحديث." : undefined}>تحديث الإعداد</Button>} />;
  if (loading) return <PageShell width="full" className="gap-5">{header}<Panel><div className="grid min-h-72 place-items-center"><Spinner label="جارٍ تحميل لوحة التشغيل" size="lg" /></div></Panel></PageShell>;
  if (!snapshot || loadError) return <PageShell width="full" className="gap-5">{header}<ErrorState title="تعذّر تحميل لوحة التشغيل" description={loadError ?? undefined} onRetry={() => void refresh()} /></PageShell>;

  const powerBlocked = pending !== null || (!snapshot.config.enabled && (dirty || !validRoute));
  const powerReason = pending ? "جارٍ حفظ الإعداد." : dirty ? "احفظ مسار النماذج قبل التفعيل." : "عيّن نموذجًا رئيسيًا جاهزًا أولًا.";
  const stats = activity?.stats;
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
                running={connection === "live" ? activity?.activeModels.find(model => model.modelConfigId === draftPrimary) : undefined} />
              <div aria-hidden className="relative my-3 h-7 w-2/3 rounded-t-xl border-x border-t border-border-strong">
                <span className="absolute -top-3 start-1/2 h-3 border-s border-border-strong" />
                <span className="absolute start-1/2 top-0 h-7 border-s border-border-strong" />
              </div>
              <div className="grid w-full grid-cols-3 gap-3 sm:gap-5">
                {[0, 1, 2].map(index => {
                  const id = draftFallbacks[index] ?? null;
                  const model = snapshot.models.find(candidate => candidate.id === id) ?? null;
                  return <div key={index} className="flex min-w-0 flex-col items-center gap-2">
                    <ModelSlot position={index + 1} model={model} models={snapshot.models} selectedId={id}
                      excludedIds={new Set([draftPrimary ?? "", ...draftFallbacks.filter((_, i) => i !== index)])}
                      disabled={Boolean(pending) || index > draftFallbacks.length} onSelect={value => selectFallback(index, value)}
                      running={connection === "live" ? activity?.activeModels.find(model => model.modelConfigId === id) : undefined} />
                    {id ? <div className="flex items-center justify-center gap-1">
                      <IconButton label={"تقديم الاحتياطي " + (index + 1)} size="xs" variant="ghost" disabled={index === 0 || Boolean(pending)} onClick={() => moveFallback(index, -1)}><ArrowRight aria-hidden /></IconButton>
                      <IconButton label={"تأخير الاحتياطي " + (index + 1)} size="xs" variant="ghost" disabled={index === draftFallbacks.length - 1 || Boolean(pending)} onClick={() => moveFallback(index, 1)}><ArrowLeft aria-hidden /></IconButton>
                      <IconButton label={"إزالة الاحتياطي " + (index + 1)} size="xs" variant="ghost" disabled={Boolean(pending)} onClick={() => selectFallback(index, null)}><Trash2 aria-hidden /></IconButton>
                    </div> : null}
                  </div>;
                })}
              </div>
            </div>
          </div>
          <div className="flex min-w-0 flex-col justify-center gap-6 border-t border-border-subtle p-6 lg:border-s lg:border-t-0 lg:p-8">
            <div><p className="eyebrow mb-2">النموذج الرئيسي</p>
              <h3 className="break-words text-lg font-medium text-fg"><bdi>{primary?.displayName ?? "اختر النموذج الذي سيبدأ المحادثات"}</bdi></h3>
              <p className="mt-1 text-xs text-fg-tertiary">{primary?.providerName ?? "اضغط الدائرة الكبيرة لتعيين نموذج."}</p></div>
            {primary ? <dl className="grid grid-cols-2 gap-4 text-xs">
              <div><dt className="text-fg-tertiary">نافذة السياق</dt><dd className="mt-1 font-medium tnum">{primary.contextWindowTokens === null ? "—" : formatContextWindow(primary.contextWindowTokens)}</dd></div>
              <div><dt className="text-fg-tertiary">الاحتياطية المعينة</dt><dd dir="ltr" className="ltr-island mt-1 text-end font-medium tnum">{draftFallbacks.length} / 3</dd></div>
            </dl> : null}
            <div className="space-y-2 text-xs leading-relaxed text-fg-secondary">
              <p>اضغط أي دائرة متاحة لاختيار النموذج. ترتيب الاحتياطية من 1 إلى 3؛ يمكن تقديمها أو تأخيرها.</p>
              <p>تظهر حلقة النشاط حول النموذج الذي يستقبل الطلب حاليًا، بما في ذلك الانتقال إلى احتياطي.</p>
            </div>
            {primary && !primary.ready ? <InlineNote tone="warning">{primary.readinessReason ?? "النموذج الرئيسي غير جاهز للتشغيل."}</InlineNote> : null}
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
      </Panel>

      <section aria-labelledby="agent1-monitoring" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 id="agent1-monitoring" className="text-lg font-medium">المراقبة المباشرة</h2><p className="mt-1 text-xs text-fg-tertiary">نشاط شات الآيفون في جلسة الخادم الحالية، بتحديث كل ثانية.</p></div>
          <div className="flex items-center gap-3"><LivePulseIndicator status={connection} label={connection === "live" ? "التحديث متصل" : "جارٍ الاتصال"} />
            <Button variant="ghost" size="sm" disabled={!activity} icon={paused ? <Play aria-hidden /> : <Pause aria-hidden />}
              onClick={() => setPaused(previous => previous ? null : activity)}>{paused ? "استئناف الرسم" : "إيقاف الرسم مؤقتًا"}</Button></div>
        </div>
        {activityError ? <InlineNote tone="warning">{activityError}</InlineNote> : null}
        <MetricRow columns={5}>
          <CompactMetric variant="bare" label="الطلبات الجارية" value={connection === "live" && stats ? formatNumber(stats.activeRequests) : "—"} />
          <CompactMetric variant="bare" label="الردود المكتملة" value={stats ? formatNumber(stats.completedRequests) : "—"} />
          <CompactMetric variant="bare" label="نجاح الطلبات" value={successRate}
            context={stats ? formatNumber(stats.failedRequests) + " تعذّر · " + formatNumber(stats.cancelledRequests) + " أُلغي" : undefined} />
          <CompactMetric variant="bare" label="متوسط مدة الرد" value={stats?.averageLatencyMs == null ? "—" : (stats.averageLatencyMs / 1_000).toFixed(1)} unit="ث" />
          <CompactMetric variant="bare" label="التوكنات المُبلّغة" value={totalTokens === null ? "—" : formatNumber(totalTokens)}
            context={stats?.reasoningTokens != null ? formatNumber(stats.reasoningTokens) + " استدلال ضمن الإخراج" : undefined} />
        </MetricRow>
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <LiveTelemetryChart title="تدفّق التوكنات" description="التقارير التي وصلت من المزوّد في كل 5 ثوانٍ."
            data={tokenPoints} series={TOKEN_SERIES} status={chartStatus} valueUnit="رمز / 5 ث" startAtZero formatTimestamp={formatLiveTime} allowDecimals={false}
            loading={!activity && !activityError} error={!activity && activityError ? { message: activityError } : null}
            emptyState={<EmptyState size="sm" title="في انتظار أول تقرير استخدام" description="سيبدأ الرسم عند إرسال المزوّد أرقام التوكنات، أثناء الرد أو عند اكتماله." />}
            footnote="لا تُقدّر التوكنات من النص. الاستدلال جزء من الإخراج، ولا يُضاف إلى الإجمالي مرة ثانية." />
          <LiveMetricChart title="نشاط الطلبات" description="أعلى عدد من الطلبات المتزامنة خلال كل 5 ثوانٍ."
            data={requestPoints} series={CONCURRENT_SERIES} status={chartStatus} formatTimestamp={formatLiveTime} allowDecimals={false}
            loading={!activity && !activityError} error={!activity && activityError ? { message: activityError } : null}
            footnote="صفر يعني عدم وجود طلبات جارية في الفترة المرصودة. القياس لا يحتوي معرفات الطلاب أو نصوص المحادثات." />
        </div>
      </section>

      <Panel padding="none">
        <PanelHeader title="آخر عمليات التشغيل" as="h2" description="أحدث 12 طلبًا في جلسة الخادم، دون محتوى المحادثات." bordered
          actions={stats?.fallbackAttempts ? <span className="text-xs text-fg-tertiary">{formatNumber(stats.fallbackAttempts)} محاولة احتياطية</span> : undefined} />
        {!activity?.recent.length ? <div className="px-5 py-8 text-center text-xs text-fg-tertiary">لا توجد عمليات مكتملة بعد. أرسل رسالة من شات الآيفون لمراقبة أول طلب.</div>
          : <ul className="divide-y divide-border-subtle">{activity.recent.map((item, index) => {
            const model = snapshot.models.find(model => model.id === item.modelConfigId);
            const state = OUTCOMES[item.outcome];
            return <li key={String(item.endedAt) + "-" + index} className="flex flex-wrap items-center gap-3 px-5 py-3">
              {model ? <ModelBrandIcon providerModelId={model.providerModelId} displayName={model.displayName} /> : <Bot className="size-5 text-fg-tertiary" aria-hidden />}
              <span className="min-w-0 flex-1 truncate text-sm text-fg"><bdi>{model?.displayName ?? "طلب دون نموذج متاح"}</bdi></span>
              <span className="text-2xs text-fg-tertiary tnum">{formatTime(item.endedAt)}</span>
              <span className="text-xs text-fg-secondary tnum">{(item.latencyMs / 1_000).toFixed(1)} ث</span>
              <span className="text-xs text-fg-secondary tnum">{item.outputTokens === null ? "استخدام غير مُبلّغ" : formatNumber(item.outputTokens) + " إخراج"}</span>
              <StatusBadge status={state.status} label={state.label} size="sm" />
            </li>;
          })}</ul>}
      </Panel>
      <p className="text-2xs leading-relaxed text-fg-tertiary">المصدر: مسار شات التطوير الحالي. تُصفّر القياسات عند إعادة تشغيل الخادم، ويُحتفظ بآخر ساعة في الذاكرة فقط.
        {stats?.missingUsageRequests ? " " + formatNumber(stats.missingUsageRequests) + " طلب لم يرسل تقرير استخدام." : ""}</p>
    </PageShell>
  );
}

function ModelSlot({ primary = false, position, model, models, selectedId, excludedIds, disabled, onSelect, running }: {
  primary?: boolean; position: number; model: AIAgent1RuntimeModel | null; models: AIAgent1RuntimeModel[];
  selectedId: string | null; excludedIds: ReadonlySet<string>; disabled: boolean;
  onSelect: (id: string | null) => void; running?: Agent1ActivitySnapshot["activeModels"][number];
}) {
  const label = primary ? "النموذج الرئيسي" : "الاحتياطي " + position;
  return <div className="flex w-full min-w-0 flex-col items-center gap-2 text-center">
    <span className="text-xs text-fg-secondary">{label}{primary ? <span className="ms-1 text-2xs text-fg-tertiary">· مطلوب</span> : null}</span>
    <AgentModelSelector models={models} value={selectedId} onValueChange={onSelect} excludedIds={excludedIds} clearable={!primary && model !== null}
      clearLabel="إزالة هذا الاحتياطي" disabled={disabled} ariaLabel={"اختيار " + label}
      renderModelIcon={model => <ModelBrandIcon providerModelId={model.providerModelId} displayName={model.displayName} />}
      trigger={<button type="button" aria-label={"اختيار " + label} disabled={disabled}
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
    {!primary ? <Tooltip content={model ? model.displayName + " · " + model.providerName : undefined}>
      <span dir="auto" className="max-w-full truncate px-1 text-xs font-medium text-fg">{model?.displayName ?? "اختيار نموذج"}</span>
    </Tooltip> : null}
    <span className="min-h-4 text-2xs text-info-text">{running ? PHASE_LABELS[running.phase] + " · " + running.count : ""}</span>
  </div>;
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
