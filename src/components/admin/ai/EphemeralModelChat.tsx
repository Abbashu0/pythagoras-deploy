"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  ArrowDown,
  Check,
  BrainCircuit,
  ChevronDown,
  Code2,
  Copy,
  Eraser,
  GripVertical,
  LoaderCircle,
  Pencil,
  Send,
  Square,
  X,
} from "lucide-react";

import type { EphemeralChatStreamEvent } from "@/lib/ephemeral-chat-contract";
import { isEphemeralChatStreamEvent } from "@/lib/ephemeral-chat-contract";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "@/components/admin-ui/primitives/button";
import { InfoTip, Tooltip } from "@/components/admin-ui/primitives/tooltip";
import { Panel } from "@/components/admin-ui/primitives/surface";
import { ScrollArea } from "@/components/admin-ui/primitives/scroll-area";
import { TextArea } from "@/components/admin-ui/forms/input";
import { Switch } from "@/components/admin-ui/forms/toggle";
import { toast } from "@/components/admin-ui/feedback/toaster";
import {
  normalizeEphemeralMathDelimiters,
  rehypeEphemeralMathFallback,
} from "@/lib/ephemeral-chat-markdown";
import {
  applyEphemeralChatEvent,
  groupEphemeralChatPresentation,
  isNearChatBottom,
  technicalUsageParts,
  toggleWorkExpanded,
  truncateAfterUserTurn,
  type EphemeralChatSegment,
  type EphemeralChatTurn,
  workDurationSeconds,
} from "./ephemeral-chat-state";
import { ModelBrandIcon } from "./model-brand-icon";

export interface EphemeralModelChatTarget {
  modelId: string;
  providerModelId: string;
  providerName: string;
}

interface ChatRequestError extends Error {
  code?: string;
  errorCode?: string;
}

const CHAT_ERROR_MESSAGES: Record<string, string> = {
  AI_EPHEMERAL_CHAT_INVALID: "The chat request is invalid or too large.",
  AI_EPHEMERAL_MODEL_NOT_FOUND: "The selected Model is no longer available.",
  AI_EPHEMERAL_MODEL_UNAVAILABLE: "The selected Model is not ready for testing.",
  AI_EPHEMERAL_PROVIDER_NOT_READY: "Enable the Provider and configure an active API key first.",
  AI_EPHEMERAL_CHAT_FAILED: "The temporary Model request failed.",
  AUTHENTICATION: "The Provider rejected the API key.",
  RATE_LIMITED: "The Provider rate limit was reached.",
  INVALID_REQUEST: "The Provider rejected the request format.",
  CAPABILITY_MISMATCH: "The selected route does not support text generation.",
  CONFIGURATION: "The Provider configuration is invalid.",
  SECRET_UNAVAILABLE: "The Provider credential is unavailable.",
  TIMEOUT: "The Provider request timed out.",
  UNAVAILABLE: "The Provider is unavailable.",
  BAD_RESPONSE: "The Provider returned an unsupported response.",
  TOOL_LIMIT: "Python tool execution limit reached.",
  PYTHON_TOOL_UNSUPPORTED: "Python tool calling is not supported by this Model configuration.",
  CANCELLED: "The request was stopped.",
  UNKNOWN: "The temporary Model request failed.",
};

const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-3 last:mb-0 leading-[1.8]">{children}</p>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-3 mt-5 text-lg font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mb-2 mt-4 text-md font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-2 mt-3 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-3 list-disc space-y-1 ps-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-3 list-decimal space-y-1 ps-5 last:mb-0">{children}</ol>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="mb-3 border-s-2 border-accent-border ps-3 text-fg-secondary last:mb-0">
      {children}
    </blockquote>
  ),
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => (
    <code dir="ltr" className={cn("rounded-sm bg-inset px-1 py-0.5 font-mono text-[0.9em]", className)}>
      {children}
    </code>
  ),
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre dir="ltr" className="mb-3 max-w-full overflow-x-auto rounded-md border border-border-subtle bg-inset p-3 font-mono text-xs leading-[1.7] last:mb-0">
      {children}
    </pre>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="mb-3 max-w-full overflow-x-auto last:mb-0">
      <table className="min-w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-border-subtle bg-inset px-2 py-1.5 text-start font-semibold">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-border-subtle px-2 py-1.5 align-top">{children}</td>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent-text underline decoration-accent-border underline-offset-2"
    >
      {children}
    </a>
  ),
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
  const [turns, setTurns] = React.useState<EphemeralChatTurn[]>([]);
  const [draft, setDraft] = React.useState("");
  const [editingUserId, setEditingUserId] = React.useState<string | null>(null);
  const [editingDraft, setEditingDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [pythonEnabled, setPythonEnabled] = React.useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = React.useState(false);
  const [workExpanded, setWorkExpanded] = React.useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const scrollViewportRef = React.useRef<HTMLDivElement | null>(null);
  const composerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const pinnedToLatestRef = React.useRef(true);
  const requestGenerationRef = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const activeAssistantIdRef = React.useRef<string | null>(null);
  const copiedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  const clampPosition = React.useCallback(
    (next: { left: number; top: number }) => {
      const rect = panelRef.current?.getBoundingClientRect();
      const width = rect?.width ?? Math.min(560, Math.max(280, window.innerWidth - 16));
      return {
        left: Math.min(Math.max(8, next.left), Math.max(8, window.innerWidth - width - 8)),
        top: Math.min(Math.max(8, next.top), Math.max(8, window.innerHeight - 76)),
      };
    },
    [],
  );

  React.useEffect(() => {
    if (!portalRoot || position) return;
    const width = Math.min(560, Math.max(280, window.innerWidth - 16));
    const height = Math.min(760, Math.max(320, window.innerHeight - 48));
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
    return () => {
      requestGenerationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  React.useEffect(() => {
    if (!pinnedToLatestRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const viewport = scrollViewportRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [turns]);

  const onScroll = React.useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    const nearBottom = isNearChatBottom(
      viewport.scrollTop,
      viewport.scrollHeight,
      viewport.clientHeight,
    );
    pinnedToLatestRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom && turns.length > 0);
  }, [turns.length]);

  React.useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, [onScroll, portalRoot]);

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

  const stopGeneration = React.useCallback(() => {
    requestGenerationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    const activeId = activeAssistantIdRef.current;
    activeAssistantIdRef.current = null;
    setSending(false);
    if (activeId) {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === activeId
            ? { ...turn, status: "error", error: "CANCELLED" }
            : turn,
        ),
      );
    }
  }, []);

  const clearSession = React.useCallback(() => {
    stopGeneration();
    setTurns([]);
    setDraft("");
    setEditingUserId(null);
    setEditingDraft("");
    setPythonEnabled(true);
    pinnedToLatestRef.current = true;
    setShowJumpToLatest(false);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }, [stopGeneration]);

  const applyStreamEvent = React.useCallback(
    (assistantId: string, event: EphemeralChatStreamEvent) => {
      const now = Date.now();
      setTurns((current) =>
        current.map((turn) =>
          turn.id === assistantId ? applyEphemeralChatEvent(turn, event, now) : turn,
        ),
      );
    },
    [],
  );

  const startGeneration = React.useCallback(
    async (history: EphemeralChatTurn[]) => {
      const requestMessages = history
        .filter((turn) => turn.role === "user" || turn.status === "completed")
        .map(({ role, content }) => ({ role, content }));
      const assistantId = newTurnId("assistant");
      const assistant: EphemeralChatTurn = {
        id: assistantId,
        role: "assistant",
        content: "",
        reasoningText: "",
        status: "pending",
        reasoningStartedAt: null,
        reasoningCompletedAt: null,
        workStartedAt: null,
        workCompletedAt: null,
        usage: null,
        latencyMs: null,
        finishReason: null,
        segments: [],
      };
      const generation = requestGenerationRef.current + 1;
      requestGenerationRef.current = generation;
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      activeAssistantIdRef.current = assistantId;
      pinnedToLatestRef.current = true;
      setShowJumpToLatest(false);
      setTurns([...history, assistant]);
      setSending(true);

      try {
        const response = await fetch(`/api/admin/local/ai/models/${encodeURIComponent(target.modelId)}/chat`, {
          method: "POST",
          cache: "no-store",
          headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" },
          body: JSON.stringify({ messages: requestMessages, pythonEnabled }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            code?: string;
            errorCode?: string;
          };
          throw requestError(payload.code, payload.errorCode);
        }
        if (!response.body) throw requestError("AI_EPHEMERAL_CHAT_FAILED");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finished = false;
        let receivedCompleted = false;
        let receivedError = false;
          while (!finished) {
          const next = await reader.read();
          if (next.done) break;
          buffer += decoder.decode(next.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const parsed: unknown = JSON.parse(line);
            if (!isEphemeralChatStreamEvent(parsed)) throw requestError("AI_EPHEMERAL_CHAT_FAILED");
            if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
            applyStreamEvent(assistantId, parsed);
            if (parsed.type === "completed") receivedCompleted = true;
            if (parsed.type === "error") {
              receivedError = true;
              finished = true;
              await reader.cancel();
            }
          }
          if (finished) break;
          }
          buffer += decoder.decode();
          const tail = buffer.trim();
        if (tail && !controller.signal.aborted) {
          const parsed: unknown = JSON.parse(tail);
          if (!isEphemeralChatStreamEvent(parsed)) throw requestError("AI_EPHEMERAL_CHAT_FAILED");
          if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
          applyStreamEvent(assistantId, parsed);
          if (parsed.type === "completed") receivedCompleted = true;
        }
        if (!receivedCompleted && !receivedError && !controller.signal.aborted) throw requestError("AI_EPHEMERAL_CHAT_FAILED");
      } catch (error) {
        if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
        const requestErrorValue = error as ChatRequestError;
        applyStreamEvent(assistantId, {
          type: "error",
          code: requestErrorValue.code ?? "AI_EPHEMERAL_CHAT_FAILED",
          ...(requestErrorValue.errorCode ? { errorCode: requestErrorValue.errorCode } : {}),
        });
      } finally {
        if (requestGenerationRef.current === generation) {
          setSending(false);
          activeAssistantIdRef.current = null;
          abortRef.current = null;
        }
      }
    },
    [applyStreamEvent, pythonEnabled, target.modelId],
  );

  const sendMessage = React.useCallback(() => {
    const content = draft.trim();
    if (!content || sending || editingUserId) return;
    const history = [
      ...turns.filter((turn) => turn.status !== "error" && turn.status !== "pending"),
      {
        id: newTurnId("user"),
        role: "user" as const,
        content,
        reasoningText: "",
        status: "completed" as const,
        reasoningStartedAt: null,
        reasoningCompletedAt: null,
        workStartedAt: null,
        workCompletedAt: null,
        usage: null,
        latencyMs: null,
        finishReason: null,
        segments: [],
      },
    ];
    setDraft("");
    void startGeneration(history);
  }, [draft, editingUserId, sending, startGeneration, turns]);

  const saveEditedUser = React.useCallback(() => {
    if (!editingUserId || !editingDraft.trim() || sending) return;
    const history = truncateAfterUserTurn(turns, editingUserId).map((turn) =>
      turn.id === editingUserId ? { ...turn, content: editingDraft.trim() } : turn,
    );
    setEditingUserId(null);
    setEditingDraft("");
    void startGeneration(history);
  }, [editingDraft, editingUserId, sending, startGeneration, turns]);

  const copyText = React.useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedId(null), 1400);
    } catch {
      toast.error("Copy is unavailable in this browser.");
    }
  }, []);

  const jumpToLatest = () => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    pinnedToLatestRef.current = true;
    setShowJumpToLatest(false);
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  };

  const onHeaderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragging({ offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top });
  };

  const closeSession = () => {
    stopGeneration();
    onClose();
  };

  if (!portalRoot) return null;

  return createPortal(
    <Panel
      ref={panelRef}
      role="dialog"
      aria-modal={false}
      aria-label={`Model Chat — ${target.providerModelId}`}
      variant="raised"
      radius="lg"
      className={cn(
        "fixed z-[var(--z-sticky)] grid min-h-0 w-[min(35rem,calc(100vw-1rem))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden",
        "border-border-strong bg-elevated shadow-xl",
        dragging && "cursor-grabbing",
      )}
      style={{
        left: position?.left ?? 8,
        top: position?.top ?? 8,
        height: "min(760px, calc(100dvh - 3rem))",
      }}
    >
      <header
        className={cn(
          "flex min-w-0 touch-none items-start justify-between gap-4 border-b border-border-subtle px-5 py-4",
          !dragging && "cursor-grab",
        )}
        onPointerDown={onHeaderPointerDown}
      >
        <div className="flex min-w-0 items-start gap-3">
          <GripVertical className="mt-1 size-4 shrink-0 text-fg-quaternary" aria-hidden />
          <ModelBrandIcon
            providerModelId={target.providerModelId}
            className="size-9 rounded-lg border-0 bg-accent-subtle text-accent-text"
          />
          <div className="min-w-0">
            <p dir="ltr" title={target.providerModelId} className="line-clamp-2 break-all font-mono text-sm font-semibold leading-[1.45] text-fg">
              {target.providerModelId}
            </p>
            <p className="mt-1 truncate text-xs text-fg-tertiary">{target.providerName} · Model Chat</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip content={pythonEnabled ? "Python is available to the Model when useful." : "Python is off for this chat."}>
            <div className="flex items-center gap-2 rounded-md px-1.5 py-1 text-2xs text-fg-tertiary">
              <Code2 className="size-3.5" aria-hidden />
              <span>Python</span>
              <Switch
                size="sm"
                checked={pythonEnabled}
                onCheckedChange={setPythonEnabled}
                aria-label="Python"
              />
            </div>
          </Tooltip>
          <Tooltip content="Clear chat">
            <IconButton label="Clear chat" size="sm" onClick={clearSession}>
              <Eraser aria-hidden />
            </IconButton>
          </Tooltip>
          <Tooltip content="Close chat">
            <IconButton label="Close chat" size="sm" onClick={closeSession}>
              <X aria-hidden />
            </IconButton>
          </Tooltip>
        </div>
      </header>

      <div className="relative min-h-0 overflow-hidden">
        <ScrollArea
          className="h-full min-h-0"
          viewportRef={scrollViewportRef}
          viewportClassName="h-full px-5 py-5"
        >
          {turns.length === 0 ? (
            <div className="flex min-h-full flex-col items-center justify-center py-20 text-center">
              <ModelBrandIcon
                providerModelId={target.providerModelId}
                className="size-8 border-0 bg-transparent"
                markSize={24}
              />
              <p className="mt-3 text-sm font-medium text-fg">Model ready</p>
            </div>
          ) : (
            <div className="space-y-7">
              {turns.map((turn) => (
                <ChatTurnView
                  key={turn.id}
                  turn={turn}
                  editing={editingUserId === turn.id}
                  editingDraft={editingDraft}
                  workExpanded={workExpanded[turn.id] ?? true}
                  copied={copiedId === turn.id}
                  onCopy={() => void copyText(turn.id, turn.content)}
                  onEdit={() => {
                    setEditingUserId(turn.id);
                    setEditingDraft(turn.content);
                  }}
                  onEditingDraftChange={setEditingDraft}
                  onSaveEdit={saveEditedUser}
                   onCancelEdit={() => {
                     setEditingUserId(null);
                     setEditingDraft("");
                   }}
                   onToggleWork={() => setWorkExpanded((current) => toggleWorkExpanded(current, turn.id))}
                   onCopyTool={(suffix, text) => void copyText(`${turn.id}-${suffix}`, text)}
                 />
              ))}
            </div>
          )}
        </ScrollArea>
        {showJumpToLatest ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <Button
              type="button"
              size="sm"
              variant="quiet"
              icon={<ArrowDown aria-hidden />}
              className="pointer-events-auto shadow-sm"
              onClick={jumpToLatest}
            >
              Jump to latest
            </Button>
          </div>
        ) : null}
      </div>

      <form
        className="shrink-0 border-t border-border-subtle p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (sending) stopGeneration();
          else sendMessage();
        }}
      >
        <div className="rounded-lg border border-border bg-inset p-2 transition-colors focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-subtle)]">
          <TextArea
            ref={composerRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (sending) stopGeneration();
                else sendMessage();
              }
            }}
            autoResize
            minRows={1}
            maxRows={6}
            maxLength={32_000}
            placeholder="Message…"
            aria-label="Message"
            tone="quiet"
            className="min-h-[2.25rem] px-2 py-1.5 text-sm"
            wrapperClassName="border-0 bg-transparent shadow-none"
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <InfoTip
              label="Chat privacy and billing"
              content="Not stored by Pythagoras. Provider API usage may still be billed."
            />
            <IconButton
              label={sending ? "Stop" : "Send"}
              size="sm"
              variant="primary"
              type="submit"
              disabled={!sending && (!draft.trim() || Boolean(editingUserId))}
            >
              {sending ? <Square aria-hidden /> : <Send aria-hidden />}
            </IconButton>
          </div>
        </div>
      </form>
    </Panel>,
    portalRoot,
  );
}

function ChatTurnView({
  turn,
  editing,
  editingDraft,
  workExpanded,
  copied,
  onCopy,
  onEdit,
  onEditingDraftChange,
  onSaveEdit,
  onCancelEdit,
  onToggleWork,
  onCopyTool,
}: {
  turn: EphemeralChatTurn;
  editing: boolean;
  editingDraft: string;
  workExpanded: boolean;
  copied: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onEditingDraftChange: (value: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onToggleWork: () => void;
  onCopyTool: (suffix: string, text: string) => void;
}) {
  if (turn.role === "user") {
    return (
      <div dir="auto" className="group/user-turn ms-auto max-w-[78%]">
        {editing ? (
          <div className="space-y-2 rounded-lg border border-accent-border bg-accent-subtle p-2">
            <TextArea
              value={editingDraft}
              onChange={(event) => onEditingDraftChange(event.target.value)}
              autoResize
              minRows={2}
              maxRows={6}
              aria-label="Edit user message"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={onCancelEdit}>Cancel</Button>
              <Button type="button" size="sm" variant="primary" onClick={onSaveEdit} disabled={!editingDraft.trim()}>Save &amp; Resend</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-lg bg-accent-subtle px-3.5 py-2.5 text-sm leading-[1.75] text-fg">
              <p dir="auto" className="whitespace-pre-wrap break-words">{turn.content}</p>
            </div>
            <div className="mt-1 flex justify-end gap-0.5 opacity-0 transition-opacity group-hover/user-turn:opacity-100 group-focus-within/user-turn:opacity-100">
              <Tooltip content={copied ? "Copied" : "Copy"}>
                <IconButton label={copied ? "Copied" : "Copy user message"} size="xs" onClick={onCopy}>
                  <Copy aria-hidden />
                </IconButton>
              </Tooltip>
              <Tooltip content="Edit">
                <IconButton label="Edit user message" size="xs" onClick={onEdit}>
                  <Pencil aria-hidden />
                </IconButton>
              </Tooltip>
            </div>
          </>
        )}
      </div>
    );
  }

  const usageParts = technicalUsageParts(turn.usage);
  const presentation = groupEphemeralChatPresentation(turn);

  return (
    <article dir="auto" className="group/assistant-turn min-w-0 text-start text-sm text-fg" aria-live={turn.status === "streaming" ? "polite" : undefined}>
      {presentation.workSegments.length ? (
        <WorkSection
          turn={turn}
          segments={presentation.workSegments}
          expanded={workExpanded}
          onToggle={onToggleWork}
          onCopyTool={onCopyTool}
        />
      ) : null}

      {presentation.answerText ? (
        <MarkdownContent text={presentation.answerText} />
      ) : !presentation.workSegments.length && (turn.status === "pending" || turn.status === "streaming") ? (
        <TypingIndicator />
      ) : null}

      {turn.error ? (
        <p dir="ltr" className="mt-3 text-start text-xs text-danger-text">{streamErrorMessage(turn.error)}</p>
      ) : null}

      {turn.status === "completed" && turn.finishReason === "LENGTH" ? (
        <Tooltip content="The Model reached its configured Max Output Tokens.">
          <p dir="ltr" className="mt-3 text-start text-xs text-warning-text">
            Stopped · Max output reached
          </p>
        </Tooltip>
      ) : null}

      {turn.status === "completed" || turn.status === "error" ? (
        <div dir="ltr" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-quaternary">
          {usageParts.length ? <span>{usageParts.join(" · ")}</span> : null}
          {turn.latencyMs !== null ? <span>Latency {formatLatency(turn.latencyMs)}</span> : null}
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/assistant-turn:opacity-100 group-focus-within/assistant-turn:opacity-100">
            <Tooltip content={copied ? "Copied" : "Copy"}>
              <IconButton label={copied ? "Copied" : "Copy assistant response"} size="xs" onClick={onCopy} disabled={!turn.content}>
                <Copy aria-hidden />
              </IconButton>
            </Tooltip>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function WorkSection({
  turn,
  segments,
  expanded,
  onToggle,
  onCopyTool,
}: {
  turn: EphemeralChatTurn;
  segments: Extract<EphemeralChatSegment, { type: "reasoning" | "tool" }>[];
  expanded: boolean;
  onToggle: () => void;
  onCopyTool: (suffix: string, text: string) => void;
}) {
  const duration = workDurationSeconds(turn);
  const label = turn.status === "streaming" && duration === null
    ? "Working…"
    : duration === null
      ? "Work"
      : `Worked for ${duration}s`;
  return (
    <section className="mb-4 border-s border-border-strong ps-3" aria-label="Assistant work">
      <button
        type="button"
        className="flex items-center gap-2 text-xs text-fg-secondary outline-none transition-colors hover:text-fg focus-visible:text-fg"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <BrainCircuit className={cn("size-4", turn.status === "streaming" && "animate-pulse motion-reduce:animate-none")} aria-hidden />
        <span>{label}</span>
        <ChevronDown className={cn("size-3.5 text-fg-quaternary transition-transform", !expanded && "-rotate-90")} aria-hidden />
      </button>
      {expanded ? (
        <div className="mt-3 space-y-4">
          {segments.map((segment, index) => segment.type === "reasoning" ? (
            <div key={`thought-${index}`} dir="auto" className="whitespace-pre-wrap break-words text-xs leading-[1.75] text-fg-tertiary">
              <div className="mb-1 flex items-center gap-1.5 text-2xs text-fg-quaternary">
                <BrainCircuit className="size-3.5" aria-hidden />
                <span>Thought</span>
              </div>
              {segment.text}
            </div>
          ) : (
            <PythonToolBlock key={`tool-${segment.callId}`} segment={segment} onCopy={onCopyTool} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MarkdownContent({ text }: { text: string }) {
  return (
    <div dir="auto" className="ephemeral-markdown max-w-full overflow-hidden">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeKatex, { throwOnError: false, strict: false }],
          rehypeEphemeralMathFallback,
        ]}
        skipHtml
        components={markdownComponents}
        urlTransform={safeMarkdownUrl}
      >
        {normalizeEphemeralMathDelimiters(text)}
      </ReactMarkdown>
    </div>
  );
}

function PythonToolBlock({
  segment,
  onCopy,
}: {
  segment: Extract<EphemeralChatSegment, { type: "tool" }>;
  onCopy: (suffix: string, text: string) => void;
}) {
  const complete = ["ok", "error", "timeout", "cancelled"].includes(segment.status);
  const [expanded, setExpanded] = React.useState(!complete);

  React.useEffect(() => {
    if (segment.status === "ok") setExpanded(false);
    if (segment.status === "error" || segment.status === "timeout") setExpanded(true);
  }, [segment.status]);

  const resultText = [
    segment.stdout ? `stdout\n${segment.stdout}` : "",
    segment.result !== undefined && segment.result !== null ? `result\n${segment.result}` : "",
    segment.stderr ? `stderr\n${segment.stderr}` : "",
  ].filter(Boolean).join("\n\n");
  const statusLabel = segment.status === "calling"
    ? "Calling"
    : segment.status === "running"
      ? "Running…"
      : segment.status === "ok"
        ? "Complete"
        : segment.status === "timeout"
          ? "Timed out"
          : segment.status === "cancelled"
            ? "Stopped"
            : "Error";

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-border-subtle bg-inset text-xs">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {segment.status === "calling" || segment.status === "running" ? (
            <LoaderCircle className="size-3.5 animate-spin text-accent-text motion-reduce:animate-none" aria-hidden />
          ) : segment.status === "ok" ? (
            <Check className="size-3.5 text-success-text" aria-hidden />
          ) : (
            <Code2 className="size-3.5 text-warning-text" aria-hidden />
          )}
          <span className="font-medium text-fg">Python</span>
          <span className="text-fg-quaternary">{statusLabel}</span>
        </div>
        {complete ? (
          <IconButton
            label={expanded ? "Collapse Python result" : "Expand Python result"}
            size="xs"
            onClick={() => setExpanded((current) => !current)}
          >
            <ChevronDown className={cn("transition-transform", !expanded && "-rotate-90")} aria-hidden />
          </IconButton>
        ) : null}
      </div>
      {expanded ? (
        <div className="space-y-2 border-t border-border-subtle px-3 py-3">
          {segment.code ? (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2 text-2xs text-fg-quaternary">
                <span>Code</span>
                <Tooltip content="Copy code">
                  <IconButton label="Copy Python code" size="xs" onClick={() => onCopy("python-code", segment.code)}>
                    <Copy aria-hidden />
                  </IconButton>
                </Tooltip>
              </div>
              <pre dir="ltr" className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-subtle bg-surface px-2.5 py-2 font-mono text-2xs leading-[1.65] text-fg-secondary">{segment.code}</pre>
            </div>
          ) : null}
          {resultText ? (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2 text-2xs text-fg-quaternary">
                <span>Result</span>
                <Tooltip content="Copy result">
                  <IconButton label="Copy Python result" size="xs" onClick={() => onCopy("python-result", resultText)}>
                    <Copy aria-hidden />
                  </IconButton>
                </Tooltip>
              </div>
              <pre dir="ltr" className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-subtle bg-surface px-2.5 py-2 font-mono text-2xs leading-[1.65] text-fg-secondary">{resultText}</pre>
            </div>
          ) : null}
          {segment.message ? <p dir="ltr" className="text-start text-xs text-danger-text">{segment.message}</p> : null}
          {segment.durationMs !== undefined ? <p dir="ltr" className="text-2xs text-fg-quaternary">{formatLatency(segment.durationMs)}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-2 text-fg-quaternary" aria-label="Waiting for response">
      <span className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
      <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms] motion-reduce:animate-none" />
      <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms] motion-reduce:animate-none" />
    </div>
  );
}

function newTurnId(role: "user" | "assistant"): string {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function requestError(code?: string, errorCode?: string): ChatRequestError {
  const error = new Error("The temporary Model chat failed.") as ChatRequestError;
  error.code = code;
  error.errorCode = errorCode;
  return error;
}

function streamErrorMessage(code: string): string {
  return CHAT_ERROR_MESSAGES[code] ?? CHAT_ERROR_MESSAGES.AI_EPHEMERAL_CHAT_FAILED;
}

function formatLatency(value: number): string {
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(2).replace(/\.00$/u, "")}s`;
}

function safeMarkdownUrl(url: string): string {
  return /^(https?:|mailto:)/iu.test(url) ? url : "#";
}
