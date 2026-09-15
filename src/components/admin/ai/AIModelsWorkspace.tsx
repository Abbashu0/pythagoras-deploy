"use client";

import * as React from "react";
import {
  Archive,
  BrainCircuit,
  Check,
  ChevronLeft,
  FileText,
  Image as ImageIcon,
  KeyRound,
  Pencil,
  Plus,
  Radio,
  Server,
  ShieldCheck,
  Trash2,
  Video,
  X,
} from "lucide-react";

import {
  AI_PROVIDER_API_FORMAT_LABELS,
  AI_PROVIDER_API_FORMAT_PATHS,
  AI_PROVIDER_API_FORMATS,
  type AIProviderApiFormat,
} from "@/lib/ai-provider-format";
import {
  AI_MODEL_INPUT_MODALITIES,
  AI_MODEL_MODALITY_LABELS,
  type AIModelInputModality,
} from "@/lib/ai-model-modalities";
import { cn } from "@/lib/cn";
import { formatContextWindow, formatNumber } from "@/lib/format";
import { Button, IconButton } from "@/components/admin-ui/primitives/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/components/admin-ui/overlays/dialog";
import {
  EmptyState,
  ErrorState,
} from "@/components/admin-ui/feedback/empty-state";
import { toast } from "@/components/admin-ui/feedback/toaster";
import { FormField } from "@/components/admin-ui/forms/field";
import { NumberInput, TextField, URLInput } from "@/components/admin-ui/forms/input";
import { Select } from "@/components/admin-ui/forms/select";
import { Checkbox, Switch } from "@/components/admin-ui/forms/toggle";
import { Breadcrumbs } from "@/components/admin-ui/navigation/breadcrumbs";
import { PageHeader, PageShell } from "@/components/admin-ui/layout/page";
import { Badge, StatusBadge, StatusDot } from "@/components/admin-ui/status/status-badge";
import { Tooltip } from "@/components/admin-ui/primitives/tooltip";
import { Panel } from "@/components/admin-ui/primitives/surface";
import { Spinner } from "@/components/admin-ui/primitives/spinner";

type Provider = {
  id: string;
  key: string;
  displayName: string;
  baseUrl: string;
  apiFormat: AIProviderApiFormat;
  enabled: boolean;
  credentialConfigured: boolean;
  credentialStatus: "NOT_CONFIGURED" | "ACTIVE" | "REVOKED" | "MISSING";
  createdAt: number;
  updatedAt: number;
  revision: number;
  modelCount: number;
  enabledModelCount: number;
  models: Model[];
};

type Model = {
  id: string;
  key: string;
  displayName: string;
  providerConfigId: string;
  providerModelId: string;
  capability: "GENERATION" | "EMBEDDING" | "RERANK";
  adapterKey: string;
  enabled: boolean;
  contextWindowTokens: number | null;
  maxOutputTokens: number | null;
  embeddingDimensions: number | null;
  supportsStreaming: boolean;
  supportsReasoning: boolean;
  supportsStructuredOutput: boolean;
  inputModalities: AIModelInputModality[];
  outputModalities: ["TEXT"];
  revision: number;
  updatedAt: number;
};

type ProvidersResponse = { ok: true; providers: Provider[] };
type ProviderResponse = { ok: true; provider: Provider };
type ModelResponse = { ok: true; model: Model };

type RequestError = Error & {
  code?: string;
  payload?: { details?: { dependencies?: Array<{ label: string; count: number }> } };
};

type TestOutcome = {
  ok: boolean;
  latencyMs: number | null;
  errorMessage?: string;
};

const API_FORMAT_OPTIONS = AI_PROVIDER_API_FORMATS.map((value) => ({
  value,
  label: AI_PROVIDER_API_FORMAT_LABELS[value],
}));

const MODALITY_ICONS: Partial<Record<AIModelInputModality, React.ReactNode>> = {
  IMAGE: <ImageIcon aria-hidden />,
  VIDEO: <Video aria-hidden />,
  PDF: <FileText aria-hidden />,
};

async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
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
    details?: { dependencies?: Array<{ label: string; count: number }> };
  };
  if (!response.ok || body.ok === false) {
    const error = new Error(body.code ?? "AI_ADMIN_REQUEST_FAILED") as RequestError;
    error.code = body.code;
    error.payload = { details: body.details };
    throw error;
  }
  return body as T;
}

function apiErrorMessage(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  return ({
    AI_ADMIN_PROVIDER_KEY_CONFLICT: "يوجد مزوّد آخر بهذا الاسم. اختر اسمًا مختلفًا.",
    AI_ADMIN_MODEL_ID_CONFLICT: "هذا النموذج مضاف مسبقًا لهذا المزوّد.",
    AI_ADMIN_REVISION_CONFLICT: "تغيّرت البيانات في جلسة أخرى. حدّث الصفحة وحاول مجددًا.",
    AI_ADMIN_PROVIDER_NOT_READY: "أضف مفتاح API فعّالًا وفعّل المزوّد أولًا.",
    AI_ADMIN_PROVIDER_DELETE_BLOCKED: "لا يمكن حذف المزوّد قبل إزالة النماذج أو المراجع المرتبطة به.",
    AI_ADMIN_MODEL_DELETE_BLOCKED: "لا يمكن حذف هذا النموذج لأنه مستخدم في إعداد أو سجل محفوظ.",
    AI_ADMIN_CREDENTIAL_REQUIRED: "مفتاح API مطلوب.",
    AI_ADMIN_MODEL_TEST_FAILED: "تعذّر اختبار النموذج.",
    AI_SECRET_STORE_UNAVAILABLE: "مخزن أسرار الذكاء الاصطناعي غير متاح. تحقّق من إعداد الخادم.",
  } as Record<string, string>)[code] ?? "تعذّر إكمال العملية. حاول مجددًا.";
}

function connectionErrorMessage(code?: string): string {
  return ({
    AUTHENTICATION: "رفض المزوّد مفتاح API.",
    RATE_LIMITED: "المزوّد حدّ عدد الطلبات مؤقتًا.",
    CONFIGURATION: "إعداد صيغة API أو عنوان المزوّد غير صالح.",
    INVALID_REQUEST: "رفض المزوّد طلب الاختبار.",
    CAPABILITY_MISMATCH: "لا يدعم هذا المسار صيغة النموذج.",
    TIMEOUT: "انتهت مهلة اتصال المزوّد.",
    UNAVAILABLE: "المزوّد غير متاح حاليًا.",
    BAD_RESPONSE: "أعاد المزوّد استجابة غير مدعومة.",
    SECRET_UNAVAILABLE: "مفتاح API غير متاح على الخادم.",
    CANCELLED: "أُلغي اختبار الاتصال.",
  } as Record<string, string>)[code ?? ""] ?? "تعذّر الاتصال بالمزوّد.";
}

function providerStatus(provider: Provider): {
  status: "active" | "disabled" | "warning";
  description: string;
} {
  if (!provider.enabled) return { status: "disabled", description: "معطّل" };
  if (provider.credentialConfigured) return { status: "active", description: "مهيأ ومفعّل" };
  return { status: "warning", description: "مفتاح API غير مهيأ" };
}

function baseUrlFieldValue(value: string): string {
  return value.replace(/^https?:\/\//iu, "").replace(/\/$/u, "");
}

function normaliseBaseUrl(value: string): string {
  const trimmed = value.trim();
  return /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function AIModelsWorkspace() {
  const [providers, setProviders] = React.useState<Provider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = React.useState<string | null>(null);
  const [addingProvider, setAddingProvider] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);

  const refresh = React.useCallback(async (preferredProviderId?: string) => {
    setError(null);
    try {
      const result = await requestJson<ProvidersResponse>("/api/admin/local/ai/providers");
      setProviders(result.providers);
      setSelectedProviderId((current) => {
        const candidate = preferredProviderId ?? current;
        return result.providers.some((provider) => provider.id === candidate)
          ? candidate
          : result.providers[0]?.id ?? null;
      });
    } catch (nextError) {
      setError(nextError);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const showProviderForm = addingProvider || providers.length === 0;

  const createProvider = async (input: {
    displayName: string;
    baseUrl: string;
    apiFormat: AIProviderApiFormat;
    apiKey: string;
  }) => {
    try {
      const result = await requestJson<ProviderResponse>("/api/admin/local/ai/providers", {
        method: "POST",
        body: JSON.stringify(input),
      });
      toast.success("تمت إضافة المزوّد وتفعيله.");
      setAddingProvider(false);
      await refresh(result.provider.id);
    } catch (nextError) {
      toast.error(apiErrorMessage(nextError));
      throw nextError;
    }
  };

  const updateProvider = async (
    providerId: string,
    input: {
      displayName: string;
      baseUrl: string;
      apiFormat: AIProviderApiFormat;
      expectedRevision: number;
    },
  ) => {
    try {
      const result = await requestJson<ProviderResponse>(`/api/admin/local/ai/providers/${providerId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      toast.success("تم حفظ إعدادات المزوّد.");
      await refresh(result.provider.id);
    } catch (nextError) {
      toast.error(apiErrorMessage(nextError));
      throw nextError;
    }
  };

  const updateProviderEnabled = async (
    providerId: string,
    enabled: boolean,
    expectedRevision: number,
  ) => {
    try {
      const result = await requestJson<ProviderResponse>(`/api/admin/local/ai/providers/${providerId}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled, expectedRevision }),
      });
      toast.success(enabled ? "تم تفعيل المزوّد." : "تم تعطيل المزوّد.");
      await refresh(result.provider.id);
    } catch (nextError) {
      toast.error(apiErrorMessage(nextError));
      throw nextError;
    }
  };

  const replaceCredential = async (
    providerId: string,
    apiKey: string,
    expectedRevision: number,
  ) => {
    try {
      const result = await requestJson<ProviderResponse>(`/api/admin/local/ai/providers/${providerId}/credential`, {
        method: "POST",
        body: JSON.stringify({ apiKey, expectedRevision }),
      });
      toast.success("تم حفظ مفتاح API بشكل آمن.");
      await refresh(result.provider.id);
    } catch (nextError) {
      toast.error(apiErrorMessage(nextError));
      throw nextError;
    }
  };

  const deleteProvider = async (provider: Provider) => {
    try {
      await requestJson(`/api/admin/local/ai/providers/${provider.id}`, {
        method: "DELETE",
        body: JSON.stringify({ expectedRevision: provider.revision }),
      });
      toast.success("تم حذف المزوّد.");
      setAddingProvider(false);
      await refresh();
    } catch (nextError) {
      toast.error(apiErrorMessage(nextError));
      throw nextError;
    }
  };

  const createModel = async (
    providerId: string,
    input: {
      providerModelId: string;
      contextWindowTokens: number;
      maxOutputTokens: number;
      inputModalities: AIModelInputModality[];
    },
  ) => {
    try {
      await requestJson<ModelResponse>(`/api/admin/local/ai/providers/${providerId}/models`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      toast.success("تمت إضافة النموذج.");
      await refresh(providerId);
    } catch (nextError) {
      toast.error(apiErrorMessage(nextError));
      throw nextError;
    }
  };

  const updateModel = async (
    modelId: string,
    input: {
      providerModelId: string;
      contextWindowTokens: number;
      maxOutputTokens: number;
      inputModalities: AIModelInputModality[];
      expectedRevision: number;
    },
  ) => {
    try {
      const result = await requestJson<ModelResponse>(`/api/admin/local/ai/models/${modelId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      toast.success("تم حفظ إعدادات النموذج.");
      await refresh(result.model.providerConfigId);
    } catch (nextError) {
      toast.error(apiErrorMessage(nextError));
      throw nextError;
    }
  };

  const updateModelEnabled = async (model: Model, enabled: boolean) => {
    try {
      const result = await requestJson<ModelResponse>(`/api/admin/local/ai/models/${model.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled, expectedRevision: model.revision }),
      });
      toast.success(enabled ? "تم تفعيل النموذج." : "تم تعطيل النموذج.");
      await refresh(result.model.providerConfigId);
    } catch (nextError) {
      toast.error(apiErrorMessage(nextError));
      throw nextError;
    }
  };

  const deleteModel = async (model: Model) => {
    try {
      await requestJson(`/api/admin/local/ai/models/${model.id}`, {
        method: "DELETE",
        body: JSON.stringify({ expectedRevision: model.revision }),
      });
      toast.success("تم حذف النموذج.");
      await refresh(model.providerConfigId);
    } catch (nextError) {
      const requestError = nextError as RequestError;
      const dependencies = requestError.payload?.details?.dependencies ?? [];
      const suffix = dependencies.length
        ? ` (${dependencies.map((dependency) => `${dependency.label}: ${dependency.count}`).join("، ")})`
        : "";
      toast.error(`${apiErrorMessage(nextError)}${suffix}`);
      throw nextError;
    }
  };

  return (
    <PageShell width="full" padding="default" className="gap-6">
      <PageHeader
        eyebrow="الذكاء الاصطناعي"
        title="النماذج والمزوّدون"
        description="أضف مزوّدي الذكاء الاصطناعي ونماذجهم واختبر مسار التوليد الحقيقي مباشرة."
        breadcrumb={<Breadcrumbs items={[{ label: "الذكاء الاصطناعي" }, { label: "النماذج والمزوّدون" }]} />}
        icon={<span className="grid size-9 place-items-center rounded-lg bg-accent-subtle text-accent-text"><BrainCircuit className="size-5" aria-hidden /></span>}
      />

      {loading ? (
        <Panel>
          <div className="flex min-h-48 items-center justify-center text-fg-tertiary"><Spinner size="lg" label="جارٍ تحميل المزوّدين" /></div>
        </Panel>
      ) : error ? (
        <ErrorState title="تعذّر تحميل المزوّدين" description={apiErrorMessage(error)} onRetry={() => void refresh()} />
      ) : (
        <Panel className="min-h-fit">
          <div dir="ltr" className="grid min-h-[34rem] min-w-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_17.5rem]">
            <main dir="rtl" className="order-1 min-w-0">
              {showProviderForm ? (
                <ProviderCreatePane
                  canCancel={providers.length > 0}
                  onCancel={() => {
                    setAddingProvider(false);
                    setSelectedProviderId(providers[0]?.id ?? null);
                  }}
                  onCreate={createProvider}
                />
              ) : selectedProvider ? (
                <ProviderDetailPane
                  provider={selectedProvider}
                  onUpdate={updateProvider}
                  onToggleEnabled={updateProviderEnabled}
                  onReplaceCredential={replaceCredential}
                  onDelete={deleteProvider}
                  onCreateModel={createModel}
                  onUpdateModel={updateModel}
                  onToggleModel={updateModelEnabled}
                  onDeleteModel={deleteModel}
                />
              ) : null}
            </main>
            <aside dir="rtl" className="order-2 min-w-0 border-t border-border lg:border-t-0 lg:border-l">
              <ProviderRail
                providers={providers}
                selectedProviderId={selectedProviderId}
                addingProvider={addingProvider}
                onSelect={(providerId) => {
                  setAddingProvider(false);
                  setSelectedProviderId(providerId);
                }}
                onAdd={() => {
                  setAddingProvider(true);
                  setSelectedProviderId(null);
                }}
              />
            </aside>
          </div>
        </Panel>
      )}
    </PageShell>
  );
}

function ProviderRail({
  providers,
  selectedProviderId,
  addingProvider,
  onSelect,
  onAdd,
}: {
  providers: Provider[];
  selectedProviderId: string | null;
  addingProvider: boolean;
  onSelect: (providerId: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start gap-2.5 border-b border-border-subtle px-4 py-3.5">
        <Server className="mt-0.5 size-4 shrink-0 text-fg-tertiary" aria-hidden />
        <div className="min-w-0"><h2 className="text-md font-semibold text-fg">المزوّدون</h2><p className="mt-1 text-xs text-fg-tertiary">{providers.length ? `${formatNumber(providers.length)} مزوّد` : "ابدأ من هنا"}</p></div>
      </div>
      <div className="min-h-0 flex-1 p-2">
        {providers.length ? (
          <div className="space-y-1">
            {providers.map((provider) => {
              const state = providerStatus(provider);
              const selected = !addingProvider && provider.id === selectedProviderId;
              return (
                <button key={provider.id} type="button" onClick={() => onSelect(provider.id)} className={cn("flex w-full min-w-0 items-start gap-2.5 rounded-md px-2.5 py-2.5 text-start transition-colors", "hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", selected && "bg-accent-subtle") }>
                  <Tooltip content={state.description} side="left"><span className="mt-1.5 shrink-0"><StatusDot status={state.status} size="sm" /></span></Tooltip>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-fg">{provider.displayName}</span><span className="mt-0.5 block text-2xs text-fg-tertiary">{formatNumber(provider.modelCount)} نموذج</span></span>
                  {selected ? <ChevronLeft className="mt-1 size-3.5 shrink-0 text-accent" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        ) : <EmptyState size="sm" title="لا يوجد مزوّدون بعد" description="أضف أول اتصال من الزر أدناه." />}
      </div>
      <div className="shrink-0 border-t border-border-subtle p-3"><Button variant="outline" size="sm" block icon={<Plus aria-hidden />} onClick={onAdd}>إضافة مزوّد</Button></div>
    </div>
  );
}

function ProviderCreatePane({
  canCancel,
  onCancel,
  onCreate,
}: {
  canCancel: boolean;
  onCancel: () => void;
  onCreate: (input: { displayName: string; baseUrl: string; apiFormat: AIProviderApiFormat; apiKey: string }) => Promise<void>;
}) {
  const [draft, setDraft] = React.useState({ displayName: "", baseUrl: "", apiFormat: "OPENAI_CHAT_COMPLETIONS" as AIProviderApiFormat, apiKey: "" });
  const [saving, setSaving] = React.useState(false);
  const valid = Boolean(draft.displayName.trim() && draft.baseUrl.trim() && draft.apiKey.trim());
  return (
    <div className="min-w-0 p-5 sm:p-6">
      <div className="flex items-start gap-3 border-b border-border-subtle pb-4"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-subtle text-accent-text"><Server className="size-4" aria-hidden /></span><div><div className="eyebrow mb-1">إضافة مزوّد</div><h2 className="text-lg font-semibold text-fg">إعداد اتصال جديد</h2><p className="mt-1.5 max-w-prose text-sm leading-[1.7] text-fg-secondary">يحفظ المزوّد ويصبح متاحًا فورًا. يُشتق المعرّف التقني من الاسم على الخادم.</p></div></div>
      <div className="max-w-2xl space-y-5 py-5">
        <FormField label="اسم المزوّد" required description="الاسم الذي سيظهر في هذه الصفحة."><TextField value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} placeholder="مثال: OpenRouter" autoFocus autoComplete="off" /></FormField>
        <FormField label="Base URL" required description={`يُستخدم المسار ${AI_PROVIDER_API_FORMAT_PATHS[draft.apiFormat]} حسب صيغة API.`}><URLInput value={draft.baseUrl} onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="api.example.com/v1" /></FormField>
        <FormField label="صيغة API" required description="تحدد بروتوكول السلك الذي يستخدمه المحول."><Select options={API_FORMAT_OPTIONS} value={draft.apiFormat} onValueChange={(value) => setDraft((current) => ({ ...current, apiFormat: value }))} /></FormField>
        <FormField label="مفتاح API" required description="يُخزّن مشفّرًا ولا يُعاد إلى المتصفح بعد الحفظ." labelAction={<span className="inline-flex items-center gap-1 text-xs text-fg-tertiary"><ShieldCheck className="size-3" aria-hidden /> كتابة فقط</span>}><TextField type="password" ltr value={draft.apiKey} onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))} prefix={<KeyRound aria-hidden />} placeholder="الصق المفتاح هنا" autoComplete="off" spellCheck={false} /></FormField>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle pt-4">{canCancel ? <Button variant="ghost" onClick={onCancel} disabled={saving}>إلغاء</Button> : null}<Button variant="primary" icon={<Check aria-hidden />} loading={saving} disabled={!valid} onClick={() => { setSaving(true); void onCreate({ ...draft, baseUrl: normaliseBaseUrl(draft.baseUrl) }).catch(() => undefined).finally(() => setSaving(false)); }}>حفظ وتفعيل</Button></div>
    </div>
  );
}

function ProviderDetailPane({
  provider,
  onUpdate,
  onToggleEnabled,
  onReplaceCredential,
  onDelete,
  onCreateModel,
  onUpdateModel,
  onToggleModel,
  onDeleteModel,
}: {
  provider: Provider;
  onUpdate: (providerId: string, input: { displayName: string; baseUrl: string; apiFormat: AIProviderApiFormat; expectedRevision: number }) => Promise<void>;
  onToggleEnabled: (providerId: string, enabled: boolean, expectedRevision: number) => Promise<void>;
  onReplaceCredential: (providerId: string, apiKey: string, expectedRevision: number) => Promise<void>;
  onDelete: (provider: Provider) => Promise<void>;
  onCreateModel: (providerId: string, input: { providerModelId: string; contextWindowTokens: number; maxOutputTokens: number; inputModalities: AIModelInputModality[] }) => Promise<void>;
  onUpdateModel: (modelId: string, input: { providerModelId: string; contextWindowTokens: number; maxOutputTokens: number; inputModalities: AIModelInputModality[]; expectedRevision: number }) => Promise<void>;
  onToggleModel: (model: Model, enabled: boolean) => Promise<void>;
  onDeleteModel: (model: Model) => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [credentialOpen, setCredentialOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [modelOpen, setModelOpen] = React.useState(false);
  const [editingModel, setEditingModel] = React.useState<Model | null>(null);
  const [savingToggle, setSavingToggle] = React.useState(false);
  const [draft, setDraft] = React.useState({ displayName: provider.displayName, baseUrl: baseUrlFieldValue(provider.baseUrl), apiFormat: provider.apiFormat });

  React.useEffect(() => {
    setDraft({ displayName: provider.displayName, baseUrl: baseUrlFieldValue(provider.baseUrl), apiFormat: provider.apiFormat });
    setEditing(false);
  }, [provider.id, provider.revision, provider.displayName, provider.baseUrl, provider.apiFormat]);

  const state = providerStatus(provider);
  const saveProvider = () => {
    void onUpdate(provider.id, { displayName: draft.displayName, baseUrl: normaliseBaseUrl(draft.baseUrl), apiFormat: draft.apiFormat, expectedRevision: provider.revision }).then(() => setEditing(false)).catch(() => undefined);
  };
  const deleteBlockedReason = provider.modelCount > 0 ? `لا يمكن الحذف قبل إزالة ${formatNumber(provider.modelCount)} نموذج.` : undefined;

  return (
    <div className="min-w-0 p-5 sm:p-6">
      <header className="flex min-w-0 items-start justify-between gap-4 border-b border-border-subtle pb-4">
        <div className="flex min-w-0 items-start gap-3"><Tooltip content={state.description}><span className="mt-2"><StatusDot status={state.status} size="md" /></span></Tooltip><div className="min-w-0"><div className="eyebrow mb-1">المزوّد</div><h2 className="truncate text-lg font-semibold text-fg">{provider.displayName}</h2><p className="mt-1 truncate text-xs text-fg-tertiary">{AI_PROVIDER_API_FORMAT_LABELS[provider.apiFormat]}</p></div></div>
        <div className="flex shrink-0 items-center gap-1"><Tooltip content={provider.enabled ? "تعطيل المزوّد" : "تفعيل المزوّد"}><span><Switch size="sm" checked={provider.enabled} pending={savingToggle} aria-label={provider.enabled ? "تعطيل المزوّد" : "تفعيل المزوّد"} onCheckedChange={(checked) => { setSavingToggle(true); void onToggleEnabled(provider.id, checked, provider.revision).catch(() => undefined).finally(() => setSavingToggle(false)); }} /></span></Tooltip><Tooltip content={editing ? "إلغاء التعديل" : "تعديل إعدادات المزوّد"}><IconButton label={editing ? "إلغاء التعديل" : "تعديل إعدادات المزوّد"} size="sm" onClick={() => setEditing((value) => !value)}>{editing ? <X aria-hidden /> : <Pencil aria-hidden />}</IconButton></Tooltip><Tooltip content={deleteBlockedReason ?? "حذف المزوّد"}><span><IconButton label="حذف المزوّد" size="sm" variant="dangerGhost" disabled={Boolean(deleteBlockedReason)} onClick={() => setDeleteOpen(true)}><Trash2 aria-hidden /></IconButton></span></Tooltip></div>
      </header>

      <section className="pt-4" aria-labelledby="provider-settings-heading">
        <div className="eyebrow" id="provider-settings-heading">إعدادات الاتصال</div>
        {editing ? <div className="max-w-2xl space-y-4 py-3"><FormField label="اسم المزوّد" required><TextField value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} /></FormField><FormField label="Base URL" required description={`المسار المستخدم: ${AI_PROVIDER_API_FORMAT_PATHS[draft.apiFormat]}`}><URLInput value={draft.baseUrl} onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} /></FormField><FormField label="صيغة API" required><Select options={API_FORMAT_OPTIONS} value={draft.apiFormat} onValueChange={(value) => setDraft((current) => ({ ...current, apiFormat: value }))} /></FormField></div> : <div className="divide-y divide-border-subtle"><SettingRow label="Base URL"><span dir="ltr" className="block truncate font-mono text-xs text-fg">{provider.baseUrl}</span></SettingRow><SettingRow label="صيغة API"><span className="text-sm text-fg">{AI_PROVIDER_API_FORMAT_LABELS[provider.apiFormat]}</span></SettingRow></div>}
        <div className="divide-y divide-border-subtle"><SettingRow label="مفتاح API" hint="القيمة السرية لا تُعرض بعد الحفظ."><div className="flex flex-wrap items-center justify-between gap-3"><StatusBadge status={provider.credentialConfigured ? "configured" : provider.credentialStatus === "REVOKED" ? "revoked" : "notConfigured"} label={provider.credentialConfigured ? "تم إعداد المفتاح" : provider.credentialStatus === "REVOKED" ? "المفتاح مُبطل" : "مفتاح غير مهيأ"} size="sm" /><Button size="sm" variant="secondary" onClick={() => setCredentialOpen(true)}>{provider.credentialConfigured ? "استبدال المفتاح" : "إضافة مفتاح"}</Button></div></SettingRow></div>
        {editing ? <div className="flex flex-wrap justify-end gap-2 border-t border-border-subtle pt-4"><Button variant="ghost" onClick={() => setEditing(false)}>إلغاء</Button><Button variant="primary" icon={<Check aria-hidden />} disabled={!draft.displayName.trim() || !draft.baseUrl.trim()} onClick={saveProvider}>حفظ التغييرات</Button></div> : null}
      </section>

      <ModelsSection provider={provider} onAdd={() => { setEditingModel(null); setModelOpen(true); }} onEdit={(model) => { setEditingModel(model); setModelOpen(true); }} onToggle={onToggleModel} onDelete={onDeleteModel} onTest={async (model) => { try { const result = await requestJson<{ ok: true; result?: { ok?: boolean; latencyMs: number | null; errorCode?: string } }>(`/api/admin/local/ai/models/${model.id}/test`, { method: "POST", body: JSON.stringify({}) }); return { ok: result.result?.ok ?? false, latencyMs: result.result?.latencyMs ?? null, errorMessage: result.result?.ok ? undefined : connectionErrorMessage(result.result?.errorCode) }; } catch (error) { return { ok: false, latencyMs: null, errorMessage: apiErrorMessage(error) }; } }} />
      <CredentialDialog open={credentialOpen} onOpenChange={setCredentialOpen} onSave={async (apiKey) => { await onReplaceCredential(provider.id, apiKey, provider.revision); setCredentialOpen(false); }} />
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="حذف المزوّد؟" description="سيُزال إعداد المزوّد ويُبطل مفتاحه. لا يمكن التراجع عن هذه العملية." actionLabel="حذف المزوّد" onConfirm={async () => { await onDelete(provider); setDeleteOpen(false); }} />
      <ModelDialog open={modelOpen} onOpenChange={setModelOpen} model={editingModel} onSave={async (input) => { if (editingModel) await onUpdateModel(editingModel.id, { ...input, expectedRevision: editingModel.revision }); else await onCreateModel(provider.id, input); setModelOpen(false); }} />
    </div>
  );
}

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="grid gap-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center"><div><p className="text-xs text-fg-tertiary">{label}</p>{hint ? <p className="mt-1 text-2xs text-fg-quaternary">{hint}</p> : null}</div><div className="min-w-0">{children}</div></div>;
}

function ModelsSection({
  provider,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
  onTest,
}: {
  provider: Provider;
  onAdd: () => void;
  onEdit: (model: Model) => void;
  onToggle: (model: Model, enabled: boolean) => Promise<void>;
  onDelete: (model: Model) => Promise<void>;
  onTest: (model: Model) => Promise<TestOutcome>;
}) {
  return <section className="mt-5 border-t border-border-subtle pt-5" aria-labelledby="models-heading"><div className="flex items-baseline justify-between gap-3"><div><div className="eyebrow">إدارة التوليد</div><h3 id="models-heading" className="mt-1 text-md font-semibold text-fg">النماذج <span className="font-mono text-xs font-normal text-fg-tertiary">{formatNumber(provider.modelCount)}</span></h3></div></div>{provider.models.length ? <div className="mt-2 divide-y divide-border-subtle">{provider.models.map((model) => <ModelRow key={model.id} model={model} onEdit={onEdit} onToggle={onToggle} onDelete={onDelete} onTest={onTest} />)}</div> : <EmptyState size="sm" title="لا توجد نماذج لهذا المزوّد." description="أضف Model ID وإمكاناته الفيزيائية ليصبح جاهزًا للاختبار." /> }<div className="mt-3 border-t border-border-subtle pt-3"><Button variant="outline" size="sm" block icon={<Plus aria-hidden />} onClick={onAdd}>إضافة نموذج</Button></div></section>;
}

function ModelRow({ model, onEdit, onToggle, onDelete, onTest }: { model: Model; onEdit: (model: Model) => void; onToggle: (model: Model, enabled: boolean) => Promise<void>; onDelete: (model: Model) => Promise<void>; onTest: (model: Model) => Promise<TestOutcome> }) {
  const [testing, setTesting] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [outcome, setOutcome] = React.useState<TestOutcome | null>(null);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  const test = () => { setTesting(true); setOutcome(null); void onTest(model).then((result) => { setOutcome(result); if (timeoutRef.current) clearTimeout(timeoutRef.current); timeoutRef.current = setTimeout(() => setOutcome(null), 6000); }).catch(() => setOutcome({ ok: false, latencyMs: null, errorMessage: "تعذّر اختبار النموذج." })).finally(() => setTesting(false)); };
  return <div className={cn("min-w-0 py-3", !model.enabled && "opacity-65")}><div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2"><div className="min-w-0 flex-1"><div className="flex min-w-0 flex-wrap items-center gap-2"><span dir="ltr" className="min-w-0 truncate font-mono text-sm font-medium text-fg">{model.providerModelId}</span><Badge variant="inset" size="sm">{model.contextWindowTokens != null ? formatContextWindow(model.contextWindowTokens) : "—"}</Badge>{model.maxOutputTokens != null ? <Badge variant="inset" size="sm">{formatNumber(model.maxOutputTokens)} إخراج</Badge> : null}{model.inputModalities.filter((modality) => modality !== "TEXT").map((modality) => <Badge key={modality} variant="subtle" tone="info" size="sm" icon={MODALITY_ICONS[modality]}>{AI_MODEL_MODALITY_LABELS[modality]}</Badge>)}</div></div><div className="flex shrink-0 items-center gap-0.5"><Tooltip content={model.enabled ? "تعطيل النموذج" : "تفعيل النموذج"}><span><Switch size="sm" checked={model.enabled} pending={toggling} aria-label={model.enabled ? "تعطيل النموذج" : "تفعيل النموذج"} onCheckedChange={(checked) => { setToggling(true); void onToggle(model, checked).catch(() => undefined).finally(() => setToggling(false)); }} /></span></Tooltip><Tooltip content={model.enabled ? "اختبار اتصال حقيقي خفيف" : "فعّل النموذج قبل الاختبار"}><IconButton label="اختبار اتصال النموذج" size="sm" variant="ghost" disabled={!model.enabled || testing} onClick={test}>{testing ? <Spinner size="sm" /> : <Radio aria-hidden />}</IconButton></Tooltip><Tooltip content="تعديل النموذج"><IconButton label="تعديل النموذج" size="sm" variant="ghost" onClick={() => onEdit(model)}><Pencil aria-hidden /></IconButton></Tooltip><Tooltip content="حذف النموذج"><IconButton label="حذف النموذج" size="sm" variant="dangerGhost" onClick={() => setDeleteOpen(true)}><Trash2 aria-hidden /></IconButton></Tooltip></div></div>{outcome ? <div role="status" aria-live="polite" className={cn("mt-2 text-xs", outcome.ok ? "text-success-text" : "text-danger-text")}>{outcome.ok ? `✓ تم الاتصال${outcome.latencyMs != null ? ` · ${formatNumber(outcome.latencyMs)}ms` : ""}` : `تعذّر الاتصال${outcome.errorMessage ? ` · ${outcome.errorMessage}` : ""}`}</div> : null}<ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="حذف النموذج؟" description="سيُحذف سجل النموذج فقط إذا لم يكن مستخدمًا في إعدادات أو سجلات AI أخرى." actionLabel="حذف النموذج" loading={deleting} onConfirm={async () => { setDeleting(true); try { await onDelete(model); setDeleteOpen(false); } finally { setDeleting(false); } }} /> </div>;
}

function CredentialDialog({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; onSave: (apiKey: string) => Promise<void> }) {
  const [apiKey, setApiKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { if (!open) setApiKey(""); }, [open]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent size="sm"><DialogHeader title="استبدال مفتاح API" description="القيمة كتابة فقط؛ لن تظهر مرة أخرى بعد الحفظ." icon={<KeyRound aria-hidden />} /><DialogBody scroll={false} className="space-y-4 py-4"><FormField label="مفتاح API" required><TextField type="password" ltr value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoFocus autoComplete="off" spellCheck={false} prefix={<ShieldCheck aria-hidden />} /></FormField></DialogBody><DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>إلغاء</Button><Button variant="primary" loading={saving} disabled={!apiKey.trim()} onClick={() => { setSaving(true); void onSave(apiKey).catch(() => undefined).finally(() => setSaving(false)); }}>حفظ المفتاح</Button></DialogFooter></DialogContent></Dialog>;
}

function ModelDialog({ open, onOpenChange, model, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; model: Model | null; onSave: (input: { providerModelId: string; contextWindowTokens: number; maxOutputTokens: number; inputModalities: AIModelInputModality[] }) => Promise<void> }) {
  const [draft, setDraft] = React.useState({ providerModelId: "", contextWindowTokens: null as number | null, maxOutputTokens: null as number | null, inputModalities: ["TEXT"] as AIModelInputModality[] });
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { if (open) setDraft({ providerModelId: model?.providerModelId ?? "", contextWindowTokens: model?.contextWindowTokens ?? null, maxOutputTokens: model?.maxOutputTokens ?? null, inputModalities: model?.inputModalities ?? ["TEXT"] }); }, [open, model]);
  const valid = Boolean(draft.providerModelId.trim() && draft.contextWindowTokens && draft.maxOutputTokens && draft.maxOutputTokens <= (draft.contextWindowTokens ?? 0));
  const toggleModality = (modality: AIModelInputModality, checked: boolean) => { if (modality === "TEXT") return; setDraft((current) => ({ ...current, inputModalities: checked ? [...new Set([...current.inputModalities, modality])] : current.inputModalities.filter((item) => item !== modality) })); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent size="md"><DialogHeader title={model ? "تعديل النموذج" : "إضافة نموذج"} description="هذه بيانات القدرة الفيزيائية للنموذج، ولا تغيّر ميزانية Agent أو أي إسناد." icon={<Archive aria-hidden />} /><DialogBody className="space-y-5 py-4"><FormField label="Model ID" required description="القيمة الدقيقة التي يقبلها المزوّد، مثل model-name:free."><TextField ltr value={draft.providerModelId} onChange={(event) => setDraft((current) => ({ ...current, providerModelId: event.target.value }))} placeholder="provider/model-id" autoFocus autoComplete="off" spellCheck={false} /></FormField><div className="grid gap-4 sm:grid-cols-2"><FormField label="نافذة السياق" required><NumberInput value={draft.contextWindowTokens} onValueChange={(value) => setDraft((current) => ({ ...current, contextWindowTokens: value }))} min={1} stepper="none" unit="token" /></FormField><FormField label="الحد الأقصى للإخراج" required description="يجب ألا يتجاوز نافذة السياق."><NumberInput value={draft.maxOutputTokens} onValueChange={(value) => setDraft((current) => ({ ...current, maxOutputTokens: value }))} min={1} max={draft.contextWindowTokens ?? undefined} stepper="none" unit="token" status={draft.maxOutputTokens && draft.contextWindowTokens && draft.maxOutputTokens > draft.contextWindowTokens ? "invalid" : undefined} /></FormField></div><FormField label="أنواع الإدخال" required description="النص إلزامي؛ والأنواع الأخرى metadata فعلية."><div className="grid gap-2 sm:grid-cols-2">{AI_MODEL_INPUT_MODALITIES.map((modality) => <Checkbox key={modality} checked={draft.inputModalities.includes(modality)} disabled={modality === "TEXT"} onCheckedChange={(checked) => toggleModality(modality, Boolean(checked))} label={AI_MODEL_MODALITY_LABELS[modality]} description={modality === "TEXT" ? "مطلوب لكل نموذج توليد." : undefined} block />)}</div></FormField><div className="rounded-md border border-border-subtle bg-inset p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-fg">نوع الإخراج</p><p className="mt-1 text-xs text-fg-tertiary">مخرجات نصية فقط لهذا المسار.</p></div><Checkbox checked disabled label="نص" /></div></div></DialogBody><DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>إلغاء</Button><Button variant="primary" icon={<Check aria-hidden />} loading={saving} disabled={!valid} onClick={() => { setSaving(true); void onSave({ providerModelId: draft.providerModelId.trim(), contextWindowTokens: draft.contextWindowTokens as number, maxOutputTokens: draft.maxOutputTokens as number, inputModalities: draft.inputModalities }).catch(() => undefined).finally(() => setSaving(false)); }}>حفظ النموذج</Button></DialogFooter></DialogContent></Dialog>;
}

function ConfirmDialog({ open, onOpenChange, title, description, actionLabel, onConfirm, loading = false }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; actionLabel: string; onConfirm: () => Promise<void>; loading?: boolean }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent size="sm"><DialogHeader title={title} description={description} icon={<Trash2 aria-hidden />} /><DialogBody scroll={false} className="py-4"><p className="text-xs leading-[1.75] text-fg-secondary">تأكد من أن هذه العملية لا تؤثر على إعدادات تشغيل أخرى.</p></DialogBody><DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>إلغاء</Button><Button variant="destructive" loading={loading} onClick={() => { void onConfirm().catch(() => undefined); }}>{actionLabel}</Button></DialogFooter></DialogContent></Dialog>;
}
