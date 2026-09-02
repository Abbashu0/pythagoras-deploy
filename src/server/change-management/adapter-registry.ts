import type { ChangeResourceAdapter, ChangeSetCoordinator, ChangeSetItem, ChangeSetValidationPhase } from "./contracts";
import { ChangeManagementError } from "./errors";
import { AssetMetadataChangeAdapter } from "./asset-metadata-adapter";
import { createCanonicalChangeAdapters } from "../canonical-content/change-adapters";
import { createQuestionChangeAdapters, QuestionChangeSetCoordinator } from "../questions/change-adapters";
import {
  MaterialQuestionBankChangeAdapter,
  MaterialQuestionBankChangeSetCoordinator,
} from "../material-question-bank";
import { AIProviderConfigChangeAdapter } from "../ai/configuration";
import { AIModelConfigChangeAdapter } from "../ai/model-registry";
import { AIRateCardChangeAdapter } from "../ai/economics";
import { AIBudgetPolicyChangeAdapter } from "../ai/budget";
import { AIRateLimitPolicyChangeAdapter } from "../ai/rate-limits";
import { AICircuitBreakerPolicyChangeAdapter } from "../ai/circuit-breaker";

export class ChangeResourceAdapterRegistry {
  private readonly adapters = new Map<string, ChangeResourceAdapter>();

  constructor(
    adapters: ChangeResourceAdapter[],
    private readonly coordinators: ChangeSetCoordinator[] = [],
  ) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.resourceType)) throw new Error(`Duplicate change adapter: ${adapter.resourceType}`);
      this.adapters.set(adapter.resourceType, adapter);
    }
  }

  require(resourceType: string): ChangeResourceAdapter {
    const adapter = this.adapters.get(resourceType);
    if (!adapter) {
      throw new ChangeManagementError("CHANGE_RESOURCE_UNSUPPORTED", "This resource type is not registered for reviewed changes.");
    }
    return adapter;
  }

  listResourceTypes(): string[] {
    return [...this.adapters.keys()];
  }

  validatePublication(database: Parameters<ChangeResourceAdapter["loadCurrent"]>[0], resourceTypes: string[]): void {
    for (const resourceType of new Set(resourceTypes)) {
      this.require(resourceType).validatePublication?.(database);
    }
  }

  validateChangeSet(
    database: Parameters<ChangeResourceAdapter["loadCurrent"]>[0],
    items: ChangeSetItem[],
    phase: ChangeSetValidationPhase,
  ): void {
    for (const coordinator of this.coordinators) coordinator.validate(database, items, phase);
  }

  planPublication(
    database: Parameters<ChangeResourceAdapter["loadCurrent"]>[0],
    items: ChangeSetItem[],
  ): ChangeSetItem[] {
    return this.coordinators.reduce(
      (planned, coordinator) => coordinator.planPublication(database, planned),
      [...items],
    );
  }
}

export function createDefaultChangeResourceRegistry(): ChangeResourceAdapterRegistry {
  return new ChangeResourceAdapterRegistry(
    [
      new AssetMetadataChangeAdapter(),
      ...createCanonicalChangeAdapters(),
      ...createQuestionChangeAdapters(),
      new MaterialQuestionBankChangeAdapter(),
      new AIProviderConfigChangeAdapter(),
      new AIModelConfigChangeAdapter(),
      new AIRateCardChangeAdapter(),
      new AIBudgetPolicyChangeAdapter(),
      new AIRateLimitPolicyChangeAdapter(),
      new AICircuitBreakerPolicyChangeAdapter(),
    ],
    [new QuestionChangeSetCoordinator(), new MaterialQuestionBankChangeSetCoordinator()],
  );
}
