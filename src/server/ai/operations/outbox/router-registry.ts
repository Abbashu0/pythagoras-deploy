import { AIOutboxError } from "./errors";
import type { AIOutboxRouterDefinition } from "./contracts";

const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9.-]{0,119}$/u;

export class AIOutboxRouterRegistry {
  private readonly definitions = new Map<string, AIOutboxRouterDefinition>();

  register(definition: AIOutboxRouterDefinition): void {
    if (!EVENT_TYPE_PATTERN.test(definition.eventType)) throw new AIOutboxError("AI_OUTBOX_INVALID", "Outbox event type is invalid.");
    if (!Number.isSafeInteger(definition.payloadVersion) || definition.payloadVersion < 1 || definition.payloadVersion > 100) {
      throw new AIOutboxError("AI_OUTBOX_INVALID", "Outbox payload version is invalid.");
    }
    if (typeof definition.validatePayload !== "function" || typeof definition.toJob !== "function") {
      throw new AIOutboxError("AI_OUTBOX_INVALID", "Outbox router definition is incomplete.");
    }
    const key = this.key(definition.eventType, definition.payloadVersion);
    if (this.definitions.has(key)) throw new AIOutboxError("AI_OUTBOX_INVALID", "Duplicate Outbox router registration.");
    this.definitions.set(key, definition);
  }

  get(eventType: string, payloadVersion: number): AIOutboxRouterDefinition | null {
    return this.definitions.get(this.key(eventType, payloadVersion)) ?? null;
  }

  supportedEventTypes(): string[] {
    return [...new Set([...this.definitions.values()].map((definition) => definition.eventType))].sort();
  }

  private key(eventType: string, payloadVersion: number): string {
    return `${eventType}\u0000${payloadVersion}`;
  }
}
