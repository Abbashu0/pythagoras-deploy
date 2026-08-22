import type { ChangeResourceAdapter } from "./contracts";
import { ChangeManagementError } from "./errors";
import { AssetMetadataChangeAdapter } from "./asset-metadata-adapter";
import { createCanonicalChangeAdapters } from "../canonical-content/change-adapters";

export class ChangeResourceAdapterRegistry {
  private readonly adapters = new Map<string, ChangeResourceAdapter>();

  constructor(adapters: ChangeResourceAdapter[]) {
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
}

export function createDefaultChangeResourceRegistry(): ChangeResourceAdapterRegistry {
  return new ChangeResourceAdapterRegistry([new AssetMetadataChangeAdapter(), ...createCanonicalChangeAdapters()]);
}
