import { AIJobError } from "./errors";
import type { AIJobHandlerDefinition } from "./contracts";

const KIND_PATTERN = /^[a-z][a-z0-9.-]{0,119}$/u;

export class AIJobHandlerRegistry {
  private readonly definitions = new Map<string, AIJobHandlerDefinition>();

  register(definition: AIJobHandlerDefinition): void {
    if (!KIND_PATTERN.test(definition.kind)) throw new AIJobError("AI_JOB_INVALID", "Job handler kind is invalid.");
    if (!Number.isSafeInteger(definition.payloadVersion) || definition.payloadVersion < 1 || definition.payloadVersion > 100) {
      throw new AIJobError("AI_JOB_INVALID", "Job handler payload version is invalid.");
    }
    if (typeof definition.validatePayload !== "function" || typeof definition.execute !== "function") {
      throw new AIJobError("AI_JOB_INVALID", "Job handler definition is incomplete.");
    }
    const key = this.key(definition.kind, definition.payloadVersion);
    if (this.definitions.has(key)) throw new AIJobError("AI_JOB_INVALID", "Duplicate Job handler registration.");
    this.definitions.set(key, definition);
  }

  get(kind: string, payloadVersion: number): AIJobHandlerDefinition | null {
    return this.definitions.get(this.key(kind, payloadVersion)) ?? null;
  }

  supportedKinds(): string[] {
    return [...new Set([...this.definitions.values()].map((definition) => definition.kind))].sort();
  }

  supportedVersions(kind: string): number[] {
    return [...this.definitions.values()]
      .filter((definition) => definition.kind === kind)
      .map((definition) => definition.payloadVersion)
      .sort((left, right) => left - right);
  }

  supportedJobs(): Array<{ kind: string; payloadVersion: number }> {
    return [...this.definitions.values()]
      .map((definition) => ({ kind: definition.kind, payloadVersion: definition.payloadVersion }))
      .sort((left, right) => left.kind.localeCompare(right.kind) || left.payloadVersion - right.payloadVersion);
  }

  private key(kind: string, payloadVersion: number): string {
    return `${kind}\u0000${payloadVersion}`;
  }
}
