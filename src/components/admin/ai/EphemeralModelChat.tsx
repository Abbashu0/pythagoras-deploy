"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  GripVertical,
  MessageSquare,
  RotateCcw,
  Send,
  Square,
  X,
} from "lucide-react";

import {
  describeAIReasoningControl,
  type AIReasoningControl,
  type AIReasoningEffort,
} from "@/lib/ai-reasoning";
import type { AIProviderApiFormat } from "@/lib/ai-provider-format";
import { formatNumber } from "@/lib/format";
import { Badge } from "@/components/admin-ui/status/status-badge";
import { Button, IconButton } from "@/components/admin-ui/primitives/button";
import { InfoTip, Tooltip } from "@/components/admin-ui/primitives/tooltip";
import { Panel } from "@/components/admin-ui/primitives/surface";
import { ScrollArea } from "@/components/admin-ui/primitives/scroll-area";
import { Spinner } from "@/components/admin-ui/primitives/spinner";
import { TextArea } from "@/components/admin-ui/forms/input";
import { Select } from "@/components/admin-ui/forms/select";
import { cn } from "@/lib/cn";

export interface EphemeralModelChatTarget {
  modelId: string;
  providerModelId: string;
  providerName: string;
  apiFormat: AIProviderApiFormat;
  providerEnabled: boolean;
  modelEnabled: boolean;
  credentialConfigured: boolean;
  supportsStreaming: boolean;
  supportsReasoning: boolean;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  usage?: ChatUsage;
  latencyMs?: number | null;
}

interface ChatUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  cachedInputTokens: number | null;
  cacheMissInputTokens: number | null;
}

interface ChatResponse {
  ok: true;
  text: string;
  usage: ChatUsage;
  latencyMs: number | null;
  reasoningControl: AIReasoningControl;
}

interface ChatRequestError extends Error {
  code?: string;
  errorCode?: string;
}

const REASONING_LABELS: Record<AIReasoningEffort, string> = {
  AUTO: "تلقائي",
  NONE: "بدون",
  LOW: "منخفض",
  MEDIUM: "متوسط",
  HIGH: "عالٍ",
};

const CHAT_ERROR_MESSAGES: Record<string, string> = {
  AI_EPHEMERAL_CHAT_INVALID: "رسالة الاختبار غير صالحة أو تتجاوز الحد المسموح.",
  AI_EPHEMERAL_MODEL_NOT_FOUND: "لم يعد هذا النموذج متاحًا.",
  AI_EPHEMERAL_MODEL_UNAVAILABLE: "النموذج غير جاهز للمحادثة المؤقتة.",
  AI_EPHEMERAL_PROVIDER_NOT_READY: "فعّل المزوّد وأضف مفتاح API فعّالًا أولًا.",
  AI_EPHEMERAL_REASONING_UNSUPPORTED: "إعداد التفكير المطلوب غير مدعوم لهذا المسار.",
  AI_EPHEMERAL_CHAT_FAILED: "تعذّر إكمال الطلب المؤقت.",
  AUTHENTICATION: "رفض المزوّد مفتاح API.",
  RATE_LIMITED: "المزوّد حدّ عدد الطلبات مؤقتًا.",
  INVALID_REQUEST: "رفض المزوّد صيغة طلب الاختبار.",
  CAPABILITY_MISMATCH: "لا يدعم هذا المسار قدرة التوليد المطلوبة.",
  CONFIGURATION: "إعداد صيغة API أو عنوان المزوّد غير صالح.",
  SECRET_UNAVAILABLE: "مفتاح API غير متاح على الخادم.",
  TIMEOUT: "انتهت مهلة الاتصال بالمزوّد.",
  UNAVAILABLE: "المزوّد غير متاح حاليًا.",
  BAD_RESPONSE: "أعاد المزوّد استجابة غير مدعومة.",
  CANCELLED: "أُلغي الطلب المؤقت.",
  UNKNOWN: "تعذّر إكمال الطلب المؤقت.",
};

export function EphemeralModelChat({
  target,
  onClose,
}: {
  target: EphemeralModelChatTarget;
  onClose: () => void;
}) {
  const [portalRoot, setPortalRoot] = React.useState<HTMLElement | null>(null);
  const [position, setPosition] = React.useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = React.useState<{ offsetX: number; offsetY: number } | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [draft, setDraft] = React.useState("");
  const [reasoning, setReasoning] = React.useState<AIReasoningEffort>("AUTO");
  const [reasoningControl, setReasoningControl] = React.useState(() =>
    describeAIReasoningControl({
      supportsReasoning: target.supportsReasoning,
      apiFormat: target.apiFormat,
    }),
  );
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const composerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = React.useRef<HTMLDivElement | null>(null);
  const requestGenerationRef = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  const clampPosition = React.useCallback(
    (next: { left: number; top: number }) => {
      const rect = panelRef.current?.getBoundingClientRect();
      const width = rect?.width ?? Math.min(448, Math.max(280, window.innerWidth - 16));
      const headerHeight = 64;
      return {
        left: Math.min(
          Math.max(8, next.left),
          Math.max(8, window.innerWidth - width - 8),
        ),
        top: Math.min(
          Math.max(8, next.top),
          Math.max(8, window.innerHeight - headerHeight - 8),
        ),
      };
    },
    [],
  );

  React.useEffect(() => {
    if (!portalRoot || position) return;
    const width = Math.min(448, Math.max(280, window.innerWidth - 16));
    const height = Math.min(600, Math.max(360, window.innerHeight - 16));
    setPosition(
      clampPosition({
        left: Math.min(24, Math.max(8, window.innerWidth - width - 8)),
        top: Math.max(8, window.innerHeight - height - 24),
      }),
    );
  }, [clampPosition, portalRoot, position]);

  React.useEffect(() => {
    const onResize = () => {
      setPosition((current) => (current ? clampPosition(current) : current));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampPosition]);

  React.useEffect(() => {
    composerRef.current?.focus();
  }, [portalRoot]);

  React.useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  React.useEffect(() => {
    return () => {
      requestGenerationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (!dragging) return;
    const onPointerMove = (event: PointerEvent) => {
      setPosition(
        clampPosition({
          left: event.clientX - dragging.offsetX,
          top: event.clientY - dragging.offsetY,
        }),
      );
    };
    const onPointerUp = () => setDragging(null);
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [clampPosition, dragging]);

  const stopRequest = React.useCallback(() => {
    requestGenerationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
    setMessages((current) => current.filter((message) => !message.pending));
  }, []);

  const clearSession = React.useCallback(() => {
    stopRequest();
    setMessages([]);
    setDraft("");
    setError(null);
    setReasoning("AUTO");
    setReasoningControl(
      describeAIReasoningControl({
        supportsReasoning: target.supportsReasoning,
        apiFormat: target.apiFormat,
      }),
    );
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }, [stopRequest, target.apiFormat, target.supportsReasoning]);

  const closeSession = React.useCallback(() => {
    stopRequest();
    onClose();
  }, [onClose, stopRequest]);

  const sendMessage = React.useCallback(async () => {
    const content = draft.trim();
    if (!content || sending) return;

    const history = messages
      .filter((message) => !message.pending)
      .filter((message) => message.role !== "assistant" || message.content.length > 0)
      .map(({ role, content: messageContent }) => ({ role, content: messageContent }));
    const nextUserMessage: ChatMessage = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      role: "user",
      content,
    };
    const assistantId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const nextMessages = [...history, { role: "user" as const, content }];
    const controller = new AbortController();
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    abortRef.current?.abort();
    abortRef.current = controller;
    setMessages((current) => [
      ...current.filter((message) => !message.pending),
      nextUserMessage,
      { id: assistantId, role: "assistant", content: "", pending: true },
    ]);
    setDraft("");
    setError(null);
    setSending(true);

    try {
      const response = await fetch(`/api/admin/local/ai/models/${encodeURIComponent(target.modelId)}/chat`, {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, reasoningEffort: reasoning }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<ChatResponse> & {
        code?: string;
        errorCode?: string;
      };
      if (!response.ok || payload.ok !== true) {
        const requestError = new Error("The temporary Model chat failed.") as ChatRequestError;
        requestError.code = payload.code;
        requestError.errorCode = payload.errorCode;
        throw requestError;
      }
      if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
      if (
        typeof payload.text !== "string" ||
        !payload.usage ||
        !payload.reasoningControl ||
        !Array.isArray(payload.reasoningControl.options)
      ) {
        const malformed = new Error("The temporary Model chat response was invalid.") as ChatRequestError;
        malformed.code = "AI_EPHEMERAL_CHAT_FAILED";
        throw malformed;
      }
      const chatResult = payload as ChatResponse;
      setReasoningControl(chatResult.reasoningControl);
      if (!chatResult.reasoningControl.options.includes(reasoning)) setReasoning("AUTO");
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: chatResult.text,
                pending: false,
                usage: chatResult.usage,
                latencyMs: chatResult.latencyMs,
              }
            : message,
        ),
      );
    } catch (requestError) {
      if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
      setMessages((current) => current.filter((message) => message.id !== assistantId));
      setError(chatErrorMessage(requestError));
    } finally {
      if (requestGenerationRef.current === generation) {
        setSending(false);
        abortRef.current = null;
      }
    }
  }, [draft, messages, reasoning, sending, target.modelId]);

  const onHeaderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragging({ offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top });
  };

  if (!portalRoot) return null;

  return createPortal(
    <Panel
      ref={panelRef}
      role="dialog"
      aria-modal={false}
      aria-label={`محادثة اختبار مؤقتة — ${target.providerModelId}`}
      variant="raised"
      radius="lg"
      className={cn(
        "fixed z-[var(--z-sticky)] flex min-h-0 w-[min(28rem,calc(100vw-1rem))] flex-col overflow-hidden",
        "border-border-strong bg-elevated shadow-xl",
        dragging && "cursor-grabbing",
      )}
      style={{
        left: position?.left ?? 8,
        top: position?.top ?? 8,
        maxHeight: "min(38rem, calc(100dvh - 1rem))",
      }}
    >
      <div
        className={cn(
          "flex shrink-0 touch-none items-start justify-between gap-3 border-b border-border-subtle px-3.5 py-3",
          !dragging && "cursor-grab",
        )}
        onPointerDown={onHeaderPointerDown}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <GripVertical className="mt-1 size-4 shrink-0 text-fg-quaternary" aria-hidden />
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent-subtle text-accent-text">
            <MessageSquare className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p dir="ltr" className="truncate font-mono text-sm font-medium text-fg">{target.providerModelId}</p>
            <p className="mt-0.5 truncate text-2xs text-fg-tertiary">{target.providerName}</p>
          </div>
          <Badge variant="inset" size="sm">مؤقت</Badge>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <ReasoningControlSelect
            control={reasoningControl}
            value={reasoning}
            onChange={setReasoning}
          />
          <Tooltip content="مسح المحادثة وإعادة التفكير إلى تلقائي">
            <IconButton label="مسح المحادثة" size="sm" onClick={clearSession}>
              <RotateCcw aria-hidden />
            </IconButton>
          </Tooltip>
          <Tooltip content="إغلاق المحادثة المؤقتة">
            <IconButton label="إغلاق المحادثة المؤقتة" size="sm" onClick={closeSession}>
              <X aria-hidden />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      <ScrollArea
        className="min-h-0 flex-1"
        viewportRef={messagesRef}
        viewportClassName="px-3.5 py-3"
      >
        {messages.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center">
            <MessageSquare className="size-7 text-fg-quaternary" aria-hidden />
            <p className="mt-3 text-sm font-medium text-fg">اختبر المودل مباشرة</p>
            <p className="mt-1 max-w-xs text-xs leading-[1.7] text-fg-tertiary">جلسة مؤقتة بلا ذاكرة أو أدوات أو RAG.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => (
              <div key={message.id} className={cn("flex", message.role === "user" ? "justify-start" : "justify-end")}>
                <div className={cn("max-w-[88%] rounded-lg px-3 py-2", message.role === "user" ? "bg-accent-subtle text-fg" : "bg-inset text-fg")}>
                  {message.pending ? (
                    <Spinner size="sm" label="جارٍ انتظار الرد" />
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-sm leading-[1.75]">{message.content}</p>
                  )}
                  {message.role === "assistant" && !message.pending ? (
                    <ChatUsage usage={message.usage} latencyMs={message.latencyMs} />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {error ? (
        <div role="alert" className="mx-3.5 mb-2 rounded-md border border-danger-border bg-danger-subtle px-2.5 py-2 text-xs leading-[1.6] text-danger-text">
          {error}
        </div>
      ) : null}

      <form
        className="shrink-0 border-t border-border-subtle p-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (sending) stopRequest();
          else void sendMessage();
        }}
      >
        <TextArea
          ref={composerRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!sending) void sendMessage();
            }
          }}
          autoResize={false}
          minRows={3}
          maxLength={32_000}
          placeholder="اكتب رسالة اختبارية…"
          aria-label="رسالة الاختبار"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <InfoTip
            label="معلومات عن الجلسة المؤقتة"
            content="لا تُحفظ هذه المحادثة ولا تُسجّل في Telemetry أو Economics. قد يحتسب المزوّد الخارجي استخدام واجهة API."
          />
          <Button
            type="submit"
            size="sm"
            variant="primary"
            icon={sending ? <Square aria-hidden /> : <Send aria-hidden />}
            disabled={!sending && !draft.trim()}
          >
            {sending ? "إيقاف" : "إرسال"}
          </Button>
        </div>
      </form>
    </Panel>,
    portalRoot,
  );
}

function ReasoningControlSelect({
  control,
  value,
  onChange,
}: {
  control: AIReasoningControl;
  value: AIReasoningEffort;
  onChange: (value: AIReasoningEffort) => void;
}) {
  if (control.kind === "NONE") {
    return (
      <Tooltip content="هذا النموذج لا يعلن دعم التفكير">
        <span>
          <Badge variant="inset" size="sm">التفكير: غير مدعوم</Badge>
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={control.kind === "AUTO_ONLY" ? "يتحكم المزوّد بالتفكير تلقائيًا" : "تفضيل التفكير للجلسة الحالية فقط"}>
      <span>
        <Select
          size="sm"
          className="w-[6.5rem]"
          aria-label="تفضيل التفكير"
          value={control.options.includes(value) ? value : "AUTO"}
          disabled={control.kind === "AUTO_ONLY"}
          options={control.options.map((option) => ({ value: option, label: REASONING_LABELS[option] }))}
          onValueChange={(next) => onChange(next as AIReasoningEffort)}
        />
      </span>
    </Tooltip>
  );
}

function ChatUsage({ usage, latencyMs }: { usage?: ChatUsage; latencyMs?: number | null }) {
  const values = usage
    ? [
        usage.inputTokens !== null ? `إدخال ${formatNumber(usage.inputTokens)}` : null,
        usage.outputTokens !== null ? `إخراج ${formatNumber(usage.outputTokens)}` : null,
        usage.totalTokens !== null ? `المجموع ${formatNumber(usage.totalTokens)}` : null,
        usage.reasoningTokens !== null ? `تفكير ${formatNumber(usage.reasoningTokens)}` : null,
        usage.cachedInputTokens !== null ? `مخزّن ${formatNumber(usage.cachedInputTokens)}` : null,
      ].filter((value): value is string => Boolean(value))
    : [];
  return (
    <div className="mt-1.5 text-2xs text-fg-quaternary" dir="rtl">
      {values.length ? values.join(" · ") : "الاستهلاك غير متاح من المزوّد"}
      {latencyMs !== null && latencyMs !== undefined ? ` · ${formatNumber(latencyMs)}ms` : ""}
    </div>
  );
}

function chatErrorMessage(value: unknown): string {
  const error = value as ChatRequestError;
  return CHAT_ERROR_MESSAGES[error.errorCode ?? ""] ?? CHAT_ERROR_MESSAGES[error.code ?? ""] ?? CHAT_ERROR_MESSAGES.AI_EPHEMERAL_CHAT_FAILED;
}
