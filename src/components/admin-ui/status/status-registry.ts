import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  Archive,
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  CircleOff,
  CircleSlash,
  Clock,
  FileEdit,
  Hourglass,
  Info,
  KeyRound,
  Loader2,
  MinusCircle,
  PlugZap,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Unplug,
  UploadCloud,
  XCircle,
  Zap,
} from "lucide-react";

/* ============================================================================
   Status registry
   ---------------------------------------------------------------------------
   Why it exists: the old admin invented a new badge for every page. Here every
   machine state in the platform maps to exactly one tone + one glyph + one
   Arabic label, defined once. Pages pick a *status key*, never a colour.

   Rules encoded here:
   - Colour is never the only signal: every status carries a glyph and a label.
   - `pulse` is reserved for states that are genuinely in motion right now.
   - Tone semantics: success = healthy/done, warning = needs attention soon,
     danger = broken/blocking, info = informational, accent = active/selected,
     future = not available yet, neutral = inert.
   ========================================================================== */

export type StatusTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "future";

export type StatusKey =
  // lifecycle
  | "active"
  | "inactive"
  | "disabled"
  | "archived"
  // governance
  | "draft"
  | "pendingReview"
  | "inReview"
  | "approved"
  | "changesRequested"
  | "published"
  | "unpublished"
  | "scheduled"
  | "superseded"
  // connectivity / credentials
  | "connected"
  | "testing"
  | "notConfigured"
  | "configured"
  | "replacing"
  | "invalid"
  | "revoked"
  | "authFailed"
  | "timeout"
  | "unavailable"
  | "unsupported"
  | "providerError"
  // health
  | "healthy"
  | "degraded"
  | "offline"
  | "stale"
  // jobs
  | "queued"
  | "running"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "retrying"
  | "deadLetter"
  | "circuitOpen"
  // evals / quality
  | "passed"
  | "blocked"
  | "incomplete"
  | "regressed"
  | "improved"
  // readiness
  | "ready"
  | "notReady"
  | "comingSoon"
  | "experimental"
  | "deprecated"
  // generic
  | "warning"
  | "info"
  | "unknown";

export interface StatusDefinition {
  key: StatusKey;
  tone: StatusTone;
  /** Primary Arabic label. */
  label: string;
  /** Optional English secondary label for technical states. */
  labelEn?: string;
  icon: LucideIcon;
  /** Animate the glyph — only for states that are actively progressing. */
  spin?: boolean;
  /** Animate the dot — for continuously live states such as "running". */
  pulse?: boolean;
  /** One-line explanation surfaced in tooltips and detail rows. */
  description?: string;
}

export const STATUS: Record<StatusKey, StatusDefinition> = {
  /* ---- lifecycle ------------------------------------------------------- */
  active: {
    key: "active",
    tone: "success",
    label: "مفعّل",
    labelEn: "Active",
    icon: CircleDot,
    description: "يعمل ويستقبل الطلبات.",
  },
  inactive: {
    key: "inactive",
    tone: "neutral",
    label: "غير نشط",
    labelEn: "Inactive",
    icon: CircleDashed,
  },
  disabled: {
    key: "disabled",
    tone: "neutral",
    label: "معطّل",
    labelEn: "Disabled",
    icon: MinusCircle,
    description: "موقوف يدويًا؛ الإعدادات محفوظة.",
  },
  archived: {
    key: "archived",
    tone: "neutral",
    label: "مؤرشف",
    labelEn: "Archived",
    icon: Archive,
    description: "خارج الاستخدام مع إمكانية الاستعادة.",
  },

  /* ---- governance ------------------------------------------------------ */
  draft: {
    key: "draft",
    tone: "warning",
    label: "مسودة",
    labelEn: "Draft",
    icon: FileEdit,
    description: "تغييرات غير منشورة بعد.",
  },
  pendingReview: {
    key: "pendingReview",
    tone: "warning",
    label: "بانتظار المراجعة",
    labelEn: "Pending review",
    icon: Hourglass,
  },
  inReview: {
    key: "inReview",
    tone: "info",
    label: "قيد المراجعة",
    labelEn: "In review",
    icon: Activity,
  },
  approved: {
    key: "approved",
    tone: "success",
    label: "معتمد",
    labelEn: "Approved",
    icon: CheckCircle2,
  },
  changesRequested: {
    key: "changesRequested",
    tone: "warning",
    label: "مطلوب تعديل",
    labelEn: "Changes requested",
    icon: RotateCcw,
  },
  published: {
    key: "published",
    tone: "success",
    label: "منشور",
    labelEn: "Published",
    icon: UploadCloud,
  },
  unpublished: {
    key: "unpublished",
    tone: "neutral",
    label: "غير منشور",
    labelEn: "Unpublished",
    icon: CircleDashed,
  },
  scheduled: {
    key: "scheduled",
    tone: "info",
    label: "مجدول",
    labelEn: "Scheduled",
    icon: Clock,
  },
  superseded: {
    key: "superseded",
    tone: "neutral",
    label: "مُستبدل",
    labelEn: "Superseded",
    icon: CircleSlash,
  },

  /* ---- connectivity / credentials -------------------------------------- */
  connected: {
    key: "connected",
    tone: "success",
    label: "متصل",
    labelEn: "Connected",
    icon: PlugZap,
    description: "آخر اختبار اتصال نجح.",
  },
  testing: {
    key: "testing",
    tone: "info",
    label: "جارٍ الاختبار",
    labelEn: "Testing",
    icon: Loader2,
    spin: true,
  },
  notConfigured: {
    key: "notConfigured",
    tone: "warning",
    label: "غير مُعد",
    labelEn: "Not configured",
    icon: KeyRound,
    description: "مطلوب إدخال بيانات الاعتماد قبل الاستخدام.",
  },
  configured: {
    key: "configured",
    tone: "success",
    label: "مُعد",
    labelEn: "Configured",
    icon: CheckCircle2,
  },
  replacing: {
    key: "replacing",
    tone: "info",
    label: "جارٍ الاستبدال",
    labelEn: "Replacing",
    icon: RefreshCw,
  },
  invalid: {
    key: "invalid",
    tone: "danger",
    label: "غير صالح",
    labelEn: "Invalid",
    icon: XCircle,
    description: "رفض الموفر بيانات الاعتماد.",
  },
  revoked: {
    key: "revoked",
    tone: "danger",
    label: "مُبطل",
    labelEn: "Revoked",
    icon: Ban,
  },
  authFailed: {
    key: "authFailed",
    tone: "danger",
    label: "فشل المصادقة",
    labelEn: "Authentication failed",
    icon: ShieldAlert,
  },
  timeout: {
    key: "timeout",
    tone: "warning",
    label: "انتهت المهلة",
    labelEn: "Timeout",
    icon: Clock,
  },
  unavailable: {
    key: "unavailable",
    tone: "danger",
    label: "غير متاح",
    labelEn: "Unavailable",
    icon: Unplug,
  },
  unsupported: {
    key: "unsupported",
    tone: "neutral",
    label: "غير مدعوم",
    labelEn: "Unsupported",
    icon: CircleSlash,
  },
  providerError: {
    key: "providerError",
    tone: "danger",
    label: "خطأ من الموفر",
    labelEn: "Provider error",
    icon: AlertTriangle,
  },

  /* ---- health ---------------------------------------------------------- */
  healthy: {
    key: "healthy",
    tone: "success",
    label: "سليم",
    labelEn: "Healthy",
    icon: CheckCircle2,
  },
  degraded: {
    key: "degraded",
    tone: "warning",
    label: "متأثر",
    labelEn: "Degraded",
    icon: AlertTriangle,
    description: "يعمل مع تراجع في الأداء أو نسبة النجاح.",
  },
  offline: {
    key: "offline",
    tone: "danger",
    label: "متوقف",
    labelEn: "Offline",
    icon: CircleOff,
  },
  stale: {
    key: "stale",
    tone: "warning",
    label: "قديم",
    labelEn: "Stale",
    icon: Clock,
    description: "البيانات بحاجة إلى إعادة بناء.",
  },

  /* ---- jobs ------------------------------------------------------------ */
  queued: {
    key: "queued",
    tone: "neutral",
    label: "في الطابور",
    labelEn: "Queued",
    icon: Hourglass,
  },
  running: {
    key: "running",
    tone: "info",
    label: "قيد التشغيل",
    labelEn: "Running",
    icon: Radio,
    pulse: true,
  },
  processing: {
    key: "processing",
    tone: "info",
    label: "قيد المعالجة",
    labelEn: "Processing",
    icon: Loader2,
    spin: true,
  },
  completed: {
    key: "completed",
    tone: "success",
    label: "مكتمل",
    labelEn: "Completed",
    icon: CheckCircle2,
  },
  failed: {
    key: "failed",
    tone: "danger",
    label: "فشل",
    labelEn: "Failed",
    icon: XCircle,
  },
  cancelled: {
    key: "cancelled",
    tone: "neutral",
    label: "ملغى",
    labelEn: "Cancelled",
    icon: CircleSlash,
  },
  retrying: {
    key: "retrying",
    tone: "warning",
    label: "إعادة محاولة",
    labelEn: "Retrying",
    icon: RefreshCw,
  },
  deadLetter: {
    key: "deadLetter",
    tone: "danger",
    label: "طابور الفشل النهائي",
    labelEn: "Dead letter",
    icon: AlertTriangle,
    description: "استُنفدت المحاولات؛ يحتاج تدخلًا يدويًا.",
  },
  circuitOpen: {
    key: "circuitOpen",
    tone: "danger",
    label: "قاطع مفتوح",
    labelEn: "Circuit open",
    icon: Zap,
    description: "أُوقفت الطلبات مؤقتًا لحماية النظام.",
  },

  /* ---- evals ----------------------------------------------------------- */
  passed: {
    key: "passed",
    tone: "success",
    label: "ناجح",
    labelEn: "Passed",
    icon: CheckCircle2,
  },
  blocked: {
    key: "blocked",
    tone: "danger",
    label: "محجوب",
    labelEn: "Blocked",
    icon: Ban,
    description: "لم يجتز بوابة إلزامية.",
  },
  incomplete: {
    key: "incomplete",
    tone: "warning",
    label: "غير مكتمل",
    labelEn: "Incomplete",
    icon: CircleDashed,
  },
  regressed: {
    key: "regressed",
    tone: "danger",
    label: "تراجع",
    labelEn: "Regressed",
    icon: AlertTriangle,
  },
  improved: {
    key: "improved",
    tone: "success",
    label: "تحسّن",
    labelEn: "Improved",
    icon: CheckCircle2,
  },

  /* ---- readiness ------------------------------------------------------- */
  ready: {
    key: "ready",
    tone: "success",
    label: "جاهز",
    labelEn: "Ready",
    icon: CheckCircle2,
  },
  notReady: {
    key: "notReady",
    tone: "warning",
    label: "غير جاهز",
    labelEn: "Not ready",
    icon: AlertTriangle,
  },
  comingSoon: {
    key: "comingSoon",
    tone: "future",
    label: "قريبًا",
    labelEn: "Coming soon",
    icon: Sparkles,
    description: "غير متاح في هذه المرحلة.",
  },
  experimental: {
    key: "experimental",
    tone: "future",
    label: "تجريبي",
    labelEn: "Experimental",
    icon: Sparkles,
  },
  deprecated: {
    key: "deprecated",
    tone: "neutral",
    label: "قيد الإيقاف",
    labelEn: "Deprecated",
    icon: CircleSlash,
  },

  /* ---- generic --------------------------------------------------------- */
  warning: {
    key: "warning",
    tone: "warning",
    label: "تحذير",
    labelEn: "Warning",
    icon: AlertTriangle,
  },
  info: {
    key: "info",
    tone: "info",
    label: "معلومة",
    labelEn: "Info",
    icon: Info,
  },
  unknown: {
    key: "unknown",
    tone: "neutral",
    label: "غير معروف",
    labelEn: "Unknown",
    icon: CircleDashed,
  },
};

export function getStatus(key: StatusKey): StatusDefinition {
  return STATUS[key] ?? STATUS.unknown;
}

/** Tone → token class map, shared by every status-aware surface. */
export const toneClasses: Record<
  StatusTone,
  { text: string; subtle: string; border: string; solid: string; dot: string }
> = {
  neutral: {
    text: "text-fg-secondary",
    subtle: "bg-neutral-subtle",
    border: "border-neutral-border",
    solid: "bg-neutral",
    dot: "bg-neutral",
  },
  accent: {
    text: "text-accent-text",
    subtle: "bg-accent-subtle",
    border: "border-accent-border",
    solid: "bg-accent",
    dot: "bg-accent",
  },
  success: {
    text: "text-success-text",
    subtle: "bg-success-subtle",
    border: "border-success-border",
    solid: "bg-success",
    dot: "bg-success",
  },
  warning: {
    text: "text-warning-text",
    subtle: "bg-warning-subtle",
    border: "border-warning-border",
    solid: "bg-warning",
    dot: "bg-warning",
  },
  danger: {
    text: "text-danger-text",
    subtle: "bg-danger-subtle",
    border: "border-danger-border",
    solid: "bg-danger",
    dot: "bg-danger",
  },
  info: {
    text: "text-info-text",
    subtle: "bg-info-subtle",
    border: "border-info-border",
    solid: "bg-info",
    dot: "bg-info",
  },
  future: {
    text: "text-future-text",
    subtle: "bg-future-subtle",
    border: "border-future-border",
    solid: "bg-future",
    dot: "bg-future",
  },
};
