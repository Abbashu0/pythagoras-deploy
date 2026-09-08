import { getContentDatabase, type ContentDatabase } from "../content";
import { AIDeidentifiedAnalyticsReadService } from "./telemetry";
import type { AITelemetryOverview, AITelemetryTimeSeriesPoint } from "./telemetry";

export type AIAdminStatus = "READY" | "NEEDS_CONFIGURATION" | "WARNING" | "UNAVAILABLE";

export interface AIAdminReadinessItem {
  id: string;
  label: string;
  status: AIAdminStatus;
  detail: string;
  href: string;
  value: number;
}

export interface AIAdminSubjectMatrixRow {
  subjectKey: string;
  label: string;
  englishTitle: string;
  available: boolean;
  instructions: AIAdminStatus;
  retrieval: AIAdminStatus;
  tutor: AIAdminStatus;
  memory: AIAdminStatus;
  evals: AIAdminStatus;
  overall: AIAdminStatus;
}

export interface AIAdminRecentEvent {
  eventType: string;
  subjectKey: string | null;
  failureCode: string | null;
  occurredAt: number;
}

export interface AIAdminOverview {
  generatedAt: number;
  status: AIAdminStatus;
  statusLabel: string;
  readiness: AIAdminReadinessItem[];
  subjects: AIAdminSubjectMatrixRow[];
  metrics: {
    overview: AITelemetryOverview;
    timeSeries: AITelemetryTimeSeriesPoint[];
  };
  recentEvents: AIAdminRecentEvent[];
  counts: {
    providers: number;
    enabledProviders: number;
    models: number;
    enabledModels: number;
    knowledgeSources: number;
    readyProjections: number;
    jobs: number;
    openJobs: number;
    outboxPending: number;
    circuitBreakersOpen: number;
  };
}

export interface AIAdminCatalog {
  providers: Array<{
    id: string;
    key: string;
    displayName: string;
    enabled: boolean;
    revision: number;
    baseUrl: string;
    credentialConfigured: boolean;
    credentialStatus: "ACTIVE" | "MISSING" | "REVOKED" | "NOT_CONFIGURED";
    retentionPolicy: string;
    trainingPolicy: string;
    zdrSupported: boolean;
    zdrRequired: boolean;
    updatedAt: number;
  }>;
  models: Array<{
    id: string;
    key: string;
    displayName: string;
    providerConfigId: string;
    capability: string;
    providerDisplayName: string;
    providerModelId: string;
    adapterKey: string;
    enabled: boolean;
    revision: number;
    contextWindowTokens: number | null;
    maxOutputTokens: number | null;
    supportsStreaming: boolean;
    supportsReasoning: boolean;
    supportsStructuredOutput: boolean;
  }>;
  tutorConfigs: Array<{
    id: string;
    key: string;
    displayName: string;
    subjectKey: string;
    revision: number;
    enabled: boolean;
    generationModelConfigId: string;
    fallbackGenerationModelConfigIds: string[];
  }>;
  policies: Array<{
    id: string;
    area: string;
    label: string;
    key: string;
    subjectKey: string | null;
    revision: number;
    enabled: boolean;
    updatedAt: number;
  }>;
  retrieval: {
    configs: Array<{ id: string; key: string; subjectKey: string; revision: number; displayName: string; enabled: boolean; fusionAlgorithm: string }>;
    projections: { sets: number; ready: number; building: number; stale: number };
  };
  memory: { policies: number; enabledPolicies: number; activeMemories: number; proposedMemories: number };
  evals: { suites: number; enabledSuites: number; runs: number; recentRuns: Array<{ id: string; suiteId: string; status: string; recommendation: string | null; startedAt: number; completedAt: number | null }> };
  operations: {
    jobs: Array<{ status: string; count: number }>;
    outbox: Array<{ status: string; count: number }>;
    circuitBreakers: Array<{ status: string; count: number }>;
    costs: Array<{ status: string; count: number }>;
  };
}

type CountRow = { count: number };
type ProviderQueryRow = { id: string; key: string; displayName: string; enabled: number; revision: number; baseUrl: string; credentialConfigured: number; credentialStatus: "ACTIVE" | "MISSING" | "REVOKED" | "NOT_CONFIGURED"; retentionPolicy: string; trainingPolicy: string; zdrSupported: number; zdrRequired: number; updatedAt: number };
type ModelQueryRow = { id: string; key: string; displayName: string; providerConfigId: string; capability: string; providerDisplayName: string; providerModelId: string; adapterKey: string; enabled: number; revision: number; contextWindowTokens: number | null; maxOutputTokens: number | null; supportsStreaming: number; supportsReasoning: number; supportsStructuredOutput: number };
type TutorQueryRow = { id: string; key: string; displayName: string; subjectKey: string; revision: number; enabled: number; generationModelConfigId: string; fallbackGenerationModelConfigIds: string };

export class AIAdminReadService {
  private readonly analytics: AIDeidentifiedAnalyticsReadService;

  constructor(private readonly database: ContentDatabase) {
    this.analytics = new AIDeidentifiedAnalyticsReadService(database);
  }

  static forDatabase(database: ContentDatabase): AIAdminReadService {
    return new AIAdminReadService(database);
  }

  getOverview(now = Date.now()): AIAdminOverview {
    const from = Math.max(0, now - 30 * 86_400_000);
    const to = now + 1;
    const metrics = { overview: this.analytics.overview({ from, to }), timeSeries: this.analytics.timeSeries({ from, to }, "day") };
    const counts = {
      providers: this.count("select count(*) as count from ai_provider_configs"),
      enabledProviders: this.count("select count(*) as count from ai_provider_configs where enabled = 1"),
      models: this.count("select count(*) as count from ai_model_configs"),
      enabledModels: this.count("select count(*) as count from ai_model_configs where enabled = 1"),
      knowledgeSources: this.count("select count(*) as count from ai_knowledge_sources"),
      readyProjections: this.count("select count(*) as count from ai_retrieval_projection_revisions where status = 'READY'"),
      jobs: this.count("select count(*) as count from ai_jobs"),
      openJobs: this.count("select count(*) as count from ai_jobs where status in ('PENDING','RUNNING','RETRY_WAIT')"),
      outboxPending: this.count("select count(*) as count from ai_outbox_events where status in ('PENDING','DISPATCHING')"),
      circuitBreakersOpen: this.count("select count(*) as count from ai_circuit_breaker_states where state = 'OPEN'"),
    };
    const readiness = this.readiness(counts);
    const subjects = this.subjectMatrix();
    const status = overallStatus(readiness);
    const recentEvents = this.database.client.prepare("select event_type as eventType, subject_key as subjectKey, failure_code as failureCode, occurred_at as occurredAt from ai_telemetry_events order by occurred_at desc, id desc limit 8").all() as AIAdminRecentEvent[];
    return { generatedAt: now, status, statusLabel: statusLabel(status), readiness, subjects, metrics, recentEvents, counts };
  }

  getCatalog(): AIAdminCatalog {
    const providers = this.database.client.prepare("select provider.id, provider.provider_key as key, provider.display_name as displayName, provider.enabled, provider.revision, provider.base_url as baseUrl, case when provider.credential_ref is not null and secret.status = 'ACTIVE' then 1 else 0 end as credentialConfigured, case when provider.credential_ref is null then 'NOT_CONFIGURED' when secret.status = 'ACTIVE' then 'ACTIVE' when secret.status = 'REVOKED' then 'REVOKED' else 'MISSING' end as credentialStatus, provider.retention_policy as retentionPolicy, provider.training_policy as trainingPolicy, provider.zdr_supported as zdrSupported, provider.zdr_required as zdrRequired, provider.updated_at as updatedAt from ai_provider_configs provider left join ai_secret_refs secret on secret.credential_ref = provider.credential_ref order by provider.display_name asc, provider.id asc limit 100").all() as ProviderQueryRow[];
    const models = this.database.client.prepare("select model.id, model.model_key as key, model.display_name as displayName, model.provider_config_id as providerConfigId, model.capability, provider.display_name as providerDisplayName, model.provider_model_id as providerModelId, model.adapter_key as adapterKey, model.enabled, model.revision, model.context_window_tokens as contextWindowTokens, model.max_output_tokens as maxOutputTokens, model.supports_streaming as supportsStreaming, model.supports_reasoning as supportsReasoning, model.supports_structured_output as supportsStructuredOutput from ai_model_configs model join ai_provider_configs provider on provider.id = model.provider_config_id order by model.capability asc, model.display_name asc, model.id asc limit 200").all() as ModelQueryRow[];
    const fallbackColumn = this.hasColumn("ai_tutor_config_revisions", "fallback_generation_model_config_ids");
    const tutors = this.database.client.prepare(`select config.id, config.key, revision.display_name as displayName, config.subject_key as subjectKey, config.current_revision as revision, revision.enabled, revision.generation_model_config_id as generationModelConfigId, ${fallbackColumn ? "revision.fallback_generation_model_config_ids" : "'[]'"} as fallbackGenerationModelConfigIds from ai_tutor_configs config left join ai_tutor_config_revisions revision on revision.tutor_config_id = config.id and revision.revision = config.current_revision order by config.subject_key, config.key limit 100`).all() as TutorQueryRow[];
    const policies = [
      ...this.database.client.prepare("select policy.id, 'instructions' as area, revision.display_name as label, policy.key, policy.subject_key as subjectKey, policy.current_revision as revision, revision.enabled, policy.updated_at as updatedAt from ai_instruction_policies policy left join ai_instruction_policy_revisions revision on revision.policy_id = policy.id and revision.revision = policy.current_revision").all(),
      ...this.database.client.prepare("select policy.id, 'context' as area, revision.display_name as label, policy.key, null as subjectKey, policy.current_revision as revision, revision.enabled, policy.updated_at as updatedAt from ai_context_policies policy left join ai_context_policy_revisions revision on revision.context_policy_id = policy.id and revision.revision = policy.current_revision").all(),
      ...this.database.client.prepare("select config.id, 'retrieval' as area, revision.display_name as label, config.key, config.subject_key as subjectKey, config.current_revision as revision, revision.enabled, config.updated_at as updatedAt from ai_retrieval_configs config left join ai_retrieval_config_revisions revision on revision.retrieval_config_id = config.id and revision.revision = config.current_revision").all(),
      ...this.database.client.prepare("select config.id, 'tutor' as area, revision.display_name as label, config.key, config.subject_key as subjectKey, config.current_revision as revision, revision.enabled, config.updated_at as updatedAt from ai_tutor_configs config left join ai_tutor_config_revisions revision on revision.tutor_config_id = config.id and revision.revision = config.current_revision").all(),
      ...this.database.client.prepare("select policy.id, 'memory' as area, revision.display_name as label, policy.key, policy.subject_key as subjectKey, policy.current_revision as revision, revision.enabled, policy.updated_at as updatedAt from ai_memory_policies policy left join ai_memory_policy_revisions revision on revision.memory_policy_id = policy.id and revision.revision = policy.current_revision").all(),
      ...this.database.client.prepare("select policy.id, 'budget' as area, revision.display_name as label, policy.budget_policy_key as key, null as subjectKey, policy.current_revision as revision, revision.enabled, policy.updated_at as updatedAt from ai_budget_policies policy left join ai_budget_policy_revisions revision on revision.budget_policy_id = policy.id and revision.revision = policy.current_revision").all(),
      ...this.database.client.prepare("select policy.id, 'rate-limit' as area, revision.display_name as label, policy.rate_limit_policy_key as key, null as subjectKey, policy.current_revision as revision, revision.enabled, policy.updated_at as updatedAt from ai_rate_limit_policies policy left join ai_rate_limit_policy_revisions revision on revision.rate_limit_policy_id = policy.id and revision.revision = policy.current_revision").all(),
    ] as AIAdminCatalog["policies"];
    const retrievalConfigs = this.database.client.prepare("select config.id, config.key, config.subject_key as subjectKey, config.current_revision as revision, revision.display_name as displayName, revision.enabled, revision.fusion_algorithm_key || '@' || revision.fusion_algorithm_revision as fusionAlgorithm from ai_retrieval_configs config left join ai_retrieval_config_revisions revision on revision.retrieval_config_id = config.id and revision.revision = config.current_revision order by config.subject_key, config.key limit 100").all() as AIAdminCatalog["retrieval"]["configs"];
    const memory = { policies: this.count("select count(*) as count from ai_memory_policies"), enabledPolicies: this.count("select count(*) as count from ai_memory_policies policy join ai_memory_policy_revisions revision on revision.memory_policy_id = policy.id and revision.revision = policy.current_revision where revision.enabled = 1"), activeMemories: this.count("select count(*) as count from ai_memories where status = 'ACTIVE'"), proposedMemories: this.count("select count(*) as count from ai_memories where status = 'PROPOSED'") };
    const evalRuns = this.database.client.prepare("select id, suite_id as suiteId, status, recommendation, started_at as startedAt, completed_at as completedAt from ai_eval_runs order by started_at desc, id desc limit 12").all() as AIAdminCatalog["evals"]["recentRuns"];
    return {
      providers: providers.map((row) => ({ ...row, enabled: Boolean(row.enabled), credentialConfigured: Boolean(row.credentialConfigured), zdrSupported: Boolean(row.zdrSupported), zdrRequired: Boolean(row.zdrRequired) })),
      models: models.map((row) => ({ ...row, enabled: Boolean(row.enabled), supportsStreaming: Boolean(row.supportsStreaming), supportsReasoning: Boolean(row.supportsReasoning), supportsStructuredOutput: Boolean(row.supportsStructuredOutput) })),
      tutorConfigs: tutors.map((row) => ({ ...row, enabled: Boolean(row.enabled), fallbackGenerationModelConfigIds: parseFallbackIds(row.fallbackGenerationModelConfigIds) })),
      policies,
      retrieval: { configs: retrievalConfigs, projections: { sets: this.count("select count(*) as count from ai_retrieval_projection_sets"), ready: this.count("select count(*) as count from ai_retrieval_projection_revisions where status = 'READY'"), building: this.count("select count(*) as count from ai_retrieval_projection_revisions where status = 'BUILDING'"), stale: this.count("select count(*) as count from ai_retrieval_projection_revisions where status = 'STALE'") } },
      memory,
      evals: { suites: this.count("select count(*) as count from ai_eval_suites"), enabledSuites: this.count("select count(*) as count from ai_eval_suites suite join ai_eval_suite_revisions revision on revision.suite_id = suite.id and revision.revision = suite.current_revision where revision.enabled = 1"), runs: this.count("select count(*) as count from ai_eval_runs"), recentRuns: evalRuns },
      operations: { jobs: this.group("select status, count(*) as count from ai_jobs group by status order by status"), outbox: this.group("select status, count(*) as count from ai_outbox_events group by status order by status"), circuitBreakers: this.group("select state as status, count(*) as count from ai_circuit_breaker_states group by state order by state"), costs: this.group("select status, count(*) as count from ai_cost_operations group by status order by status") },
    };
  }

  private readiness(counts: AIAdminOverview["counts"]): AIAdminReadinessItem[] {
    const has = (id: string, label: string, value: number, href: string, detail: string, missing: AIAdminStatus = "NEEDS_CONFIGURATION"): AIAdminReadinessItem => ({ id, label, value, href, detail, status: value > 0 ? "READY" : missing });
    return [
      has("provider", "المزوّد", counts.enabledProviders, "/admin/ai/models", counts.enabledProviders ? `${counts.enabledProviders} مفعّل` : "لم يتم ربط مزوّد بعد", "UNAVAILABLE"),
      has("generation-model", "نموذج التوليد", this.count("select count(*) as count from ai_model_configs where capability = 'GENERATION' and enabled = 1"), "/admin/ai/models", "نموذج توليد مفعّل"),
      has("model-route", "مسار النموذج والمزوّد", this.count("select count(*) as count from ai_model_configs model join ai_provider_configs provider on provider.id = model.provider_config_id where model.capability = 'GENERATION' and model.enabled = 1 and provider.enabled = 1"), "/admin/ai/models", "العلاقة قابلة للاستخدام"),
      has("global-policy", "التعليمات العامة", this.count("select count(*) as count from ai_instruction_policies policy join ai_instruction_policy_revisions revision on revision.policy_id = policy.id and revision.revision = policy.current_revision where policy.scope = 'GLOBAL' and revision.enabled = 1"), "/admin/ai/policies", "إصدار عام منشور"),
      has("subject-policy", "تعليمات المواد", this.count("select count(*) as count from ai_instruction_policies policy join ai_instruction_policy_revisions revision on revision.policy_id = policy.id and revision.revision = policy.current_revision where policy.scope = 'SUBJECT' and revision.enabled = 1"), "/admin/ai/policies", "إصدار مادة منشور"),
      has("context-policy", "سياسة السياق", this.count("select count(*) as count from ai_context_policies policy join ai_context_policy_revisions revision on revision.context_policy_id = policy.id and revision.revision = policy.current_revision where revision.enabled = 1"), "/admin/ai/policies", "سياسة سياق مفعّلة"),
      has("retrieval", "إعداد الاسترجاع", this.count("select count(*) as count from ai_retrieval_configs config join ai_retrieval_config_revisions revision on revision.retrieval_config_id = config.id and revision.revision = config.current_revision where revision.enabled = 1"), "/admin/ai/retrieval", "إعداد Retrieval منشور"),
      has("tutor", "إعداد Pi", this.count("select count(*) as count from ai_tutor_configs config join ai_tutor_config_revisions revision on revision.tutor_config_id = config.id and revision.revision = config.current_revision where revision.enabled = 1"), "/admin/ai/pi", "إعداد Tutor مفعّل"),
      has("rate-card", "بطاقة الأسعار", this.count("select count(*) as count from ai_rate_cards card join ai_rate_card_revisions revision on revision.rate_card_id = card.id and revision.revision = card.current_revision where revision.enabled = 1"), "/admin/ai/economics", "بطاقة أسعار مفعّلة"),
      has("budget", "سياسة الميزانية", this.count("select count(*) as count from ai_budget_policies policy join ai_budget_policy_revisions revision on revision.budget_policy_id = policy.id and revision.revision = policy.current_revision where revision.enabled = 1"), "/admin/ai/economics", "سياسة ميزانية مفعّلة"),
      has("rate-limit", "حدود الطلبات", this.count("select count(*) as count from ai_rate_limit_policies policy join ai_rate_limit_policy_revisions revision on revision.rate_limit_policy_id = policy.id and revision.revision = policy.current_revision where revision.enabled = 1"), "/admin/ai/economics", "سياسة حدود مفعّلة"),
      has("memory", "سياسة الذاكرة", this.count("select count(*) as count from ai_memory_policies policy join ai_memory_policy_revisions revision on revision.memory_policy_id = policy.id and revision.revision = policy.current_revision where revision.enabled = 1"), "/admin/ai/memory", "سياسة Memory مفعّلة"),
      has("retrieval-projection", "إسقاطات المعرفة", counts.readyProjections, "/admin/ai/retrieval", counts.readyProjections ? `${counts.readyProjections} جاهز` : "لا توجد إسقاطات جاهزة"),
      { id: "telemetry", label: "التليمتري", value: this.count("select count(*) as count from sqlite_master where type = 'table' and name = 'ai_telemetry_events'"), status: "READY", detail: "بنية telemetry متاحة", href: "/admin/ai/analytics" },
    ];
  }

  private subjectMatrix(): AIAdminSubjectMatrixRow[] {
    const rows = this.database.client.prepare("select subject_key as subjectKey, label, english_title as englishTitle, available from canonical_materials order by display_order asc, subject_key asc limit 100").all() as Array<{ subjectKey: string; label: string; englishTitle: string; available: number }>;
    return rows.map((row) => {
      const instructions = this.subjectStatus("ai_instruction_policies", "ai_instruction_policy_revisions", "scope = 'SUBJECT' and identity_row.subject_key = ?", "policy_id", row.subjectKey);
      const retrieval = this.subjectStatus("ai_retrieval_configs", "ai_retrieval_config_revisions", "identity_row.subject_key = ?", "retrieval_config_id", row.subjectKey);
      const tutor = this.subjectStatus("ai_tutor_configs", "ai_tutor_config_revisions", "identity_row.subject_key = ?", "tutor_config_id", row.subjectKey);
      const memory = this.subjectStatus("ai_memory_policies", "ai_memory_policy_revisions", "scope = 'SUBJECT' and identity_row.subject_key = ?", "memory_policy_id", row.subjectKey);
      const evals = this.subjectStatus("ai_eval_suites", "ai_eval_suite_revisions", "identity_row.subject_key = ?", "suite_id", row.subjectKey);
      const statuses = [instructions, retrieval, tutor, memory, evals];
      return { subjectKey: row.subjectKey, label: row.label, englishTitle: row.englishTitle, available: Boolean(row.available), instructions, retrieval, tutor, memory, evals, overall: statuses.includes("UNAVAILABLE") ? "UNAVAILABLE" : statuses.includes("NEEDS_CONFIGURATION") ? "NEEDS_CONFIGURATION" : statuses.includes("WARNING") ? "WARNING" : "READY" };
    });
  }

  private subjectStatus(identityTable: string, revisionTable: string, predicate: string, revisionForeignKey: string, subjectKey: string): AIAdminStatus {
    const sql = `select count(*) as count from ${identityTable} identity_row join ${revisionTable} revision on revision.${revisionForeignKey} = identity_row.id and revision.revision = identity_row.current_revision where ${predicate} and revision.enabled = 1`;
    const value = this.database.client.prepare(sql).get(subjectKey) as CountRow;
    return Number(value?.count ?? 0) > 0 ? "READY" : "NEEDS_CONFIGURATION";
  }

  private count(sql: string): number { return Number((this.database.client.prepare(sql).get() as CountRow | undefined)?.count ?? 0); }
  private group(sql: string): Array<{ status: string; count: number }> { return (this.database.client.prepare(sql).all() as Array<{ status: string; count: number }>).map((row) => ({ status: String(row.status), count: Number(row.count) })); }
  private hasColumn(table: string, column: string): boolean { return (this.database.client.prepare(`pragma table_info(${JSON.stringify(table)})`).all() as Array<{ name: string }>).some((row) => row.name === column); }
}

function parseFallbackIds(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed.slice(0, 3) as string[] : [];
  } catch { return []; }
}

let singleton: AIAdminReadService | undefined;
export function getAIAdminReadService(): AIAdminReadService { singleton ??= new AIAdminReadService(getContentDatabase()); return singleton; }

function overallStatus(items: readonly AIAdminReadinessItem[]): AIAdminStatus {
  if (items.some((item) => item.status === "UNAVAILABLE")) return "UNAVAILABLE";
  if (items.some((item) => item.status === "NEEDS_CONFIGURATION")) return "NEEDS_CONFIGURATION";
  return items.some((item) => item.status === "WARNING") ? "WARNING" : "READY";
}

function statusLabel(status: AIAdminStatus): string { return ({ READY: "جاهز", NEEDS_CONFIGURATION: "يحتاج إعدادًا", WARNING: "يحتاج انتباهًا", UNAVAILABLE: "غير متاح" })[status]; }
