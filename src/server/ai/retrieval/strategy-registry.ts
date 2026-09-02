import type { AIChunkingStrategy, AIChunkingStrategyRegistry } from "./contracts";
import { AIRetrievalError } from "./errors";
import { StructuredRichDocumentChunkingStrategy } from "./structured-rich-strategy";

export class DefaultAIChunkingStrategyRegistry implements AIChunkingStrategyRegistry {
  private readonly strategies = new Map<string, AIChunkingStrategy>();

  constructor(strategies: AIChunkingStrategy[] = [new StructuredRichDocumentChunkingStrategy()]) {
    for (const strategy of strategies) {
      const identity = this.identity(strategy.key, strategy.revision);
      if (this.strategies.has(identity)) throw new AIRetrievalError("AI_RETRIEVAL_STRATEGY_NOT_FOUND", "A chunking strategy is registered more than once.");
      this.strategies.set(identity, strategy);
    }
  }

  get(key: string, revision: number): AIChunkingStrategy {
    const strategy = this.strategies.get(this.identity(key, revision));
    if (!strategy) throw new AIRetrievalError("AI_RETRIEVAL_STRATEGY_NOT_FOUND", "The requested chunking strategy is not registered.");
    return strategy;
  }

  supported(): Array<{ key: string; revision: number }> {
    return [...this.strategies.values()].map((strategy) => ({ key: strategy.key, revision: strategy.revision })).sort((left, right) => left.key.localeCompare(right.key) || left.revision - right.revision);
  }

  private identity(key: string, revision: number): string {
    if (!/^[a-z][a-z0-9.-]{0,119}$/u.test(key) || !Number.isSafeInteger(revision) || revision < 1) throw new AIRetrievalError("AI_RETRIEVAL_STRATEGY_NOT_FOUND", "Chunking strategy identity is invalid.");
    return `${key}:${revision}`;
  }
}

export function createDefaultAIChunkingStrategyRegistry(): AIChunkingStrategyRegistry {
  return new DefaultAIChunkingStrategyRegistry();
}
