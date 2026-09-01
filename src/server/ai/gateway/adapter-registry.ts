import {
  AI_MODEL_CAPABILITIES,
  type AIModelCapability,
} from "../model-registry";
import {
  AIProviderAdapterRegistryError,
} from "./errors";
import type {
  AIProviderAdapter,
  EmbeddingProviderAdapter,
  GenerationProviderAdapter,
  RerankerProviderAdapter,
} from "./contracts";

const ADAPTER_KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;

export class ProviderAdapterRegistry {
  private readonly adapters = new Map<string, AIProviderAdapter>();

  constructor(adapters: readonly AIProviderAdapter[] = []) {
    for (const adapter of adapters) {
      if (
        typeof adapter.adapterKey !== "string" ||
        !ADAPTER_KEY_PATTERN.test(adapter.adapterKey) ||
        adapter.adapterKey.length > 120 ||
        !AI_MODEL_CAPABILITIES.includes(adapter.capability as AIModelCapability)
      ) {
        throw new AIProviderAdapterRegistryError(
          "AI_PROVIDER_ADAPTER_INVALID",
          "The Provider adapter key is invalid.",
        );
      }
      if (this.adapters.has(adapter.adapterKey)) {
        throw new AIProviderAdapterRegistryError(
          "AI_PROVIDER_ADAPTER_DUPLICATE",
          "The Provider adapter key is registered more than once.",
        );
      }
      this.adapters.set(adapter.adapterKey, adapter);
    }
  }

  get(adapterKey: string): AIProviderAdapter | null {
    return this.adapters.get(adapterKey) ?? null;
  }

  require(
    adapterKey: string,
    capability: "GENERATION",
  ): GenerationProviderAdapter;
  require(
    adapterKey: string,
    capability: "EMBEDDING",
  ): EmbeddingProviderAdapter;
  require(
    adapterKey: string,
    capability: "RERANK",
  ): RerankerProviderAdapter;
  require(adapterKey: string, capability: AIModelCapability): AIProviderAdapter;
  require(adapterKey: string, capability: AIModelCapability): AIProviderAdapter {
    const adapter = this.adapters.get(adapterKey);
    if (!adapter) {
      throw new AIProviderAdapterRegistryError(
        "AI_PROVIDER_ADAPTER_NOT_FOUND",
        "The configured Provider adapter is not registered.",
      );
    }
    if (adapter.capability !== capability) {
      throw new AIProviderAdapterRegistryError(
        "AI_PROVIDER_ADAPTER_CAPABILITY_MISMATCH",
        "The registered Provider adapter capability does not match the model.",
      );
    }
    return adapter;
  }

  list(): readonly AIProviderAdapter[] {
    return [...this.adapters.values()];
  }
}
