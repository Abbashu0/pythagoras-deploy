import type {
  Agent1ChatStreamEvent,
  ChatMessage,
  ChatReaction,
  ChatTurn,
} from "./chat-types";

export type Agent1ModelMessage = Pick<ChatMessage, "role" | "content">;

export function createAcceptedAgent1ChatTurn(turnId: string, userContent: string): ChatTurn {
  return {
    id: turnId,
    user: { id: turnId, role: "user", content: userContent },
    assistantAttempt: 0,
    assistant: null,
    assistantStatus: "working",
    errorMessage: null,
  };
}

export function buildAgent1HistoryForNewTurn(
  turns: readonly ChatTurn[],
  userMessage: ChatMessage,
): Agent1ModelMessage[] {
  return [...buildCompletedHistory(turns), toModelMessage(userMessage)];
}

export function buildAgent1HistoryForRegenerate(
  turns: readonly ChatTurn[],
  turnId: string,
): Agent1ModelMessage[] | null {
  const targetIndex = turns.findIndex((turn) => turn.id === turnId);
  if (targetIndex < 0 || targetIndex !== turns.length - 1) return null;

  const precedingHistory = buildCompletedHistory(turns.slice(0, targetIndex));
  return [...precedingHistory, toModelMessage(turns[targetIndex].user)];
}

export function applyAgent1ChatStreamEvent(
  turns: readonly ChatTurn[],
  turnId: string,
  event: Agent1ChatStreamEvent,
): ChatTurn[] {
  return updateTurn(turns, turnId, (turn) => {
    if (event.type === "started") {
      if (turn.assistant) return turn;
      return { ...turn, assistantStatus: "working", errorMessage: null };
    }
    if (event.type === "phase") {
      if (turn.assistant) return turn;
      return {
        ...turn,
        assistantStatus: event.phase,
        errorMessage: null,
      };
    }
    if (event.type === "text_delta") {
      if (!event.text) return turn;
      const assistant = turn.assistant
        ? { ...turn.assistant, content: turn.assistant.content + event.text }
          : {
            id: `${turn.id}-assistant-${turn.assistantAttempt}`,
            role: "assistant" as const,
            content: event.text,
          };
      return { ...turn, assistant, assistantStatus: "streaming", errorMessage: null };
    }
    return {
      ...turn,
      assistantStatus: "completed",
      errorMessage: null,
    };
  });
}

/** Marks the active turn as streaming without copying its token buffer into ChatTurn. */
export function markAgent1ChatTurnStreaming(
  turns: ChatTurn[],
  turnId: string,
): ChatTurn[] {
  const current = turns.find((turn) => turn.id === turnId);
  if (!current || current.assistant || current.assistantStatus === "streaming") {
    return turns;
  }
  return updateTurn(turns, turnId, (turn) => {
    return { ...turn, assistantStatus: "streaming", errorMessage: null };
  });
}

/** Commits the accumulated presentation buffer once the provider completes. */
export function completeAgent1ChatTurn(
  turns: readonly ChatTurn[],
  turnId: string,
  assistantContent: string,
): ChatTurn[] {
  return updateTurn(turns, turnId, (turn) => ({
    ...turn,
    assistant: assistantContent.length > 0
      ? {
          id: `${turn.id}-assistant-${turn.assistantAttempt}`,
          role: "assistant",
          content: assistantContent,
        }
      : null,
    assistantStatus: "completed",
    errorMessage: null,
  }));
}

export function failAgent1ChatTurn(
  turns: readonly ChatTurn[],
  turnId: string,
  safeErrorMessage: string,
  partialResponse?: string,
): ChatTurn[] {
  return updateTurn(turns, turnId, (turn) => {
    const accumulatedResponse = partialResponse ?? turn.assistant?.content ?? "";
    const hasPartialResponse = Boolean(accumulatedResponse.trim());
    const partialAssistant = partialResponse === undefined
      ? turn.assistant
      : hasPartialResponse
        ? {
            id: `${turn.id}-assistant-${turn.assistantAttempt}`,
            role: "assistant" as const,
            content: accumulatedResponse,
          }
        : null;
    return {
      ...turn,
      assistant: hasPartialResponse ? partialAssistant : null,
      assistantStatus: hasPartialResponse ? "incomplete" : "error",
      errorMessage: hasPartialResponse
        ? "انقطع الرد قبل اكتماله."
        : safeErrorMessage,
    };
  });
}

export function resetAgent1ChatTurnAttempt(
  turns: readonly ChatTurn[],
  turnId: string,
): ChatTurn[] {
  return updateTurn(turns, turnId, (turn) => ({
    ...turn,
    assistantAttempt: turn.assistantAttempt + 1,
    assistant: null,
    assistantStatus: "working",
    errorMessage: null,
  }));
}

export function canRegenerateAgent1Turn(
  turns: readonly ChatTurn[],
  turnId: string,
  activeTurnId: string | null,
): boolean {
  const latest = turns[turns.length - 1];
  if (!latest || latest.id !== turnId) return false;
  if (activeTurnId === turnId) return false;
  if (!latest.assistant) return false;
  return (
    latest.assistantStatus === "completed" ||
    latest.assistantStatus === "incomplete"
  );
}

export interface Agent1AssistantActionPolicy {
  showStatus: boolean;
  showFeedback: boolean;
  showRegenerate: boolean;
  showIncompleteNotice: boolean;
  showError: boolean;
}

export function getAgent1AssistantActionPolicy(
  turn: ChatTurn,
  isLatest: boolean,
  isActive: boolean,
): Agent1AssistantActionPolicy {
  const hasAssistant = Boolean(turn.assistant);
  const isCompleted = turn.assistantStatus === "completed" && hasAssistant;
  const isIncomplete = turn.assistantStatus === "incomplete" && hasAssistant;
  return {
    showStatus:
      isActive &&
      !hasAssistant &&
      (turn.assistantStatus === "working" || turn.assistantStatus === "thinking"),
    showFeedback: !isActive && isCompleted,
    showRegenerate:
      !isActive &&
      isLatest &&
      (isCompleted || isIncomplete),
    showIncompleteNotice: !isActive && isIncomplete,
    showError: !isActive && turn.assistantStatus === "error",
  };
}

export function toggleChatReaction(
  current: ChatReaction | undefined,
  selected: ChatReaction,
): ChatReaction | undefined {
  return current === selected ? undefined : selected;
}

function buildCompletedHistory(turns: readonly ChatTurn[]): Agent1ModelMessage[] {
  const history: Agent1ModelMessage[] = [];
  for (const turn of turns) {
    history.push(toModelMessage(turn.user));
    if (turn.assistantStatus === "completed" && turn.assistant) {
      history.push(toModelMessage(turn.assistant));
    }
  }
  return history;
}

function toModelMessage(message: ChatMessage): Agent1ModelMessage {
  return { role: message.role, content: message.content };
}

function updateTurn(
  turns: readonly ChatTurn[],
  turnId: string,
  update: (turn: ChatTurn) => ChatTurn,
): ChatTurn[] {
  return turns.map((turn) => (turn.id === turnId ? update(turn) : turn));
}

type Agent1ChatRequest = (signal: AbortSignal, generation: number) => Promise<void>;

interface ActiveRequest {
  controller: AbortController;
  generation: number;
  promise: Promise<void>;
}

/** Serializes one ephemeral Agent 1 request and supports abort-before-replace. */
export class Agent1ChatRequestCoordinator {
  private generation = 0;
  private lifecycle = 0;
  private active: ActiveRequest | null = null;
  private replacement: Promise<boolean> | null = null;

  get isBusy(): boolean {
    return this.active !== null || this.replacement !== null;
  }

  start(run: Agent1ChatRequest): boolean {
    if (this.isBusy) return false;
    this.launch(run);
    return true;
  }

  replace(run: Agent1ChatRequest): Promise<boolean> {
    if (this.replacement) return this.replacement.then(() => false);

    const previous = this.active;
    if (!previous) return Promise.resolve(this.start(run));

    const lifecycle = this.lifecycle;
    this.generation += 1;
    previous.controller.abort();
    const replacement = (async () => {
      await previous.promise;
      if (this.lifecycle !== lifecycle) return false;
      if (this.active === previous) this.active = null;
      this.launch(run);
      return true;
    })();
    this.replacement = replacement;
    void replacement.finally(() => {
      if (this.replacement === replacement) this.replacement = null;
    });
    return replacement;
  }

  isCurrent(generation: number): boolean {
    return this.generation === generation && this.active?.generation === generation;
  }

  cancelAll(): void {
    this.lifecycle += 1;
    this.generation += 1;
    this.active?.controller.abort();
  }

  private launch(run: Agent1ChatRequest): void {
    const controller = new AbortController();
    const generation = ++this.generation;
    const active: ActiveRequest = {
      controller,
      generation,
      promise: Promise.resolve(),
    };
    this.active = active;
    active.promise = Promise.resolve()
      .then(() => run(controller.signal, generation))
      .catch(() => {})
      .finally(() => {
        if (this.active === active) this.active = null;
      });
  }
}
