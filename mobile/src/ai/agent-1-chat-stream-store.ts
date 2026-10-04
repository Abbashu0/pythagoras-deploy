export interface Agent1ChatStreamSnapshot {
  readonly key: string | null;
  readonly text: string;
  readonly revision: number;
}

export interface Agent1ChatStreamScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

const EMPTY_SNAPSHOT: Agent1ChatStreamSnapshot = Object.freeze({
  key: null,
  text: "",
  revision: 0,
});

const defaultScheduler: Agent1ChatStreamScheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Keeps the complete network stream immediately, but publishes only bounded
 * presentation snapshots. Canonical ChatTurn state is committed separately at
 * a terminal event.
 */
export class Agent1ChatStreamStore {
  private activeKey: string | null = null;
  private accumulatedText = "";
  private snapshot = EMPTY_SNAPSHOT;
  private revision = 0;
  private pendingTimer: unknown = null;
  private finished = false;
  private disposed = false;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(
    private readonly throttleMs = 32,
    private readonly scheduler: Agent1ChatStreamScheduler = defaultScheduler,
  ) {}

  readonly getSnapshot = (key: string): Agent1ChatStreamSnapshot =>
    this.activeKey === key ? this.snapshot : EMPTY_SNAPSHOT;

  readonly subscribe = (key: string, listener: () => void): (() => void) => {
    let keyListeners = this.listeners.get(key);
    if (!keyListeners) {
      keyListeners = new Set();
      this.listeners.set(key, keyListeners);
    }
    keyListeners.add(listener);
    return () => {
      keyListeners?.delete(listener);
      if (keyListeners?.size === 0) this.listeners.delete(key);
    };
  };

  begin(key: string): void {
    if (this.disposed) return;
    const previousKey = this.activeKey;
    this.cancelPendingTimer();
    this.activeKey = key;
    this.accumulatedText = "";
    this.finished = false;
    this.snapshot = Object.freeze({ key, text: "", revision: ++this.revision });
    if (previousKey && previousKey !== key) this.notify(previousKey);
    this.notify(key);
  }

  append(key: string, delta: string): void {
    if (
      this.disposed ||
      this.finished ||
      !delta ||
      this.activeKey !== key
    ) {
      return;
    }
    this.accumulatedText += delta;
    if (this.pendingTimer !== null) return;
    this.pendingTimer = this.scheduler.schedule(() => {
      this.pendingTimer = null;
      this.publishAccumulatedText();
    }, this.throttleMs);
  }

  getAccumulatedText(key: string): string {
    return this.activeKey === key ? this.accumulatedText : "";
  }

  flush(key: string): string {
    if (this.activeKey !== key) return "";
    this.cancelPendingTimer();
    this.publishAccumulatedText();
    return this.accumulatedText;
  }

  finish(key: string): string {
    const text = this.flush(key);
    if (this.activeKey === key) this.finished = true;
    return text;
  }

  discard(key: string): void {
    if (this.activeKey !== key) return;
    this.cancelPendingTimer();
    this.activeKey = null;
    this.accumulatedText = "";
    this.finished = false;
    this.snapshot = EMPTY_SNAPSHOT;
    this.notify(key);
  }

  clear(): void {
    const previousKey = this.activeKey;
    this.cancelPendingTimer();
    this.disposed = false;
    this.activeKey = null;
    this.accumulatedText = "";
    this.finished = false;
    this.snapshot = EMPTY_SNAPSHOT;
    if (previousKey) this.notify(previousKey);
  }

  dispose(): void {
    this.clear();
    this.disposed = true;
    this.listeners.clear();
  }

  private publishAccumulatedText(): void {
    if (this.activeKey === null || this.snapshot.text === this.accumulatedText) return;
    this.snapshot = Object.freeze({
      key: this.activeKey,
      text: this.accumulatedText,
      revision: ++this.revision,
    });
    this.notify(this.activeKey);
  }

  private notify(key: string): void {
    this.listeners.get(key)?.forEach((listener) => listener());
  }

  private cancelPendingTimer(): void {
    if (this.pendingTimer === null) return;
    this.scheduler.cancel(this.pendingTimer);
    this.pendingTimer = null;
  }
}

export function agent1ChatStreamKey(turnId: string, attempt: number): string {
  return `${turnId}-assistant-${attempt}`;
}
