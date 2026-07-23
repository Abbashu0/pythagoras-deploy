/**
 * repositories/index.ts
 * =====================
 * Repository instances for every entity in the platform.
 *
 * These are the ONLY access points for data. UI components and API
 * routes must import from here — never access Supabase directly.
 *
 * Each repository extends BaseRepository with entity-specific methods.
 * Field names use camelCase in TypeScript and are auto-converted to
 * snake_case for PostgreSQL by the BaseRepository.
 */

import { BaseRepository, type QueryOptions, type WhereFilter } from "./base-repository";
import type {
  Subject,
  Section,
  Topic,
  Package,
  Question,
  Resource,
  Source,
  Tag,
  RegistryEntry,
  HistoryEntry,
} from "@/lib/entities";

// ============================================================
// Subject Repository
// ============================================================

class SubjectRepository extends BaseRepository<Subject> {
  constructor() {
    super("subjects");
  }

  async getByReadableId(readableId: string): Promise<Subject | null> {
    const items = await this.getAll({
      filters: [{ column: "readableId", value: readableId }],
      limit: 1,
    });
    return items[0] || null;
  }

  async getActive(): Promise<Subject[]> {
    return this.getAll({
      filters: [{ column: "available", value: true }],
      orderBy: "order",
      ascending: true,
    });
  }
}

// ============================================================
// Section Repository
// ============================================================

class SectionRepository extends BaseRepository<Section> {
  constructor() {
    super("sections");
  }

  async getBySubject(subjectId: string): Promise<Section[]> {
    return this.getAll({
      filters: [{ column: "subjectId", value: subjectId }],
      orderBy: "order",
      ascending: true,
    });
  }
}

// ============================================================
// Topic Repository
// ============================================================

class TopicRepository extends BaseRepository<Topic> {
  constructor() {
    super("topics");
  }

  async getBySection(sectionId: string): Promise<Topic[]> {
    return this.getAll({
      filters: [{ column: "sectionId", value: sectionId }],
      orderBy: "order",
      ascending: true,
    });
  }

  async getBySubject(subjectId: string): Promise<Topic[]> {
    return this.getAll({
      filters: [{ column: "subjectId", value: subjectId }],
      orderBy: "order",
      ascending: true,
    });
  }
}

// ============================================================
// Package Repository
// ============================================================

class PackageRepository extends BaseRepository<Package> {
  constructor() {
    super("packages");
  }

  async getBySubject(subjectId: string): Promise<Package[]> {
    return this.getAll({
      filters: [{ column: "subjectId", value: subjectId }],
      orderBy: "order",
      ascending: true,
    });
  }

  async getByStatus(status: Package["status"]): Promise<Package[]> {
    return this.getAll({
      filters: [{ column: "status", value: status }],
      orderBy: "updatedAt",
      ascending: false,
    });
  }

  async getPublished(): Promise<Package[]> {
    return this.getAll({
      filters: [
        { column: "status", value: "published" },
        { column: "visible", value: true },
      ],
      orderBy: "updatedAt",
      ascending: false,
    });
  }

  async getByTag(tagId: string): Promise<Package[]> {
    return this.getAll({
      filters: [{ column: "tags", value: tagId, op: "array-contains" }],
    });
  }

  async getRecent(limit = 20): Promise<Package[]> {
    return this.getAll({
      orderBy: "updatedAt",
      ascending: false,
      limit,
    });
  }

  listenToPublished(callback: (items: Package[]) => void): () => void {
    return this.listen(callback, {
      filters: [
        { column: "status", value: "published" },
        { column: "visible", value: true },
      ],
      orderBy: "order",
      ascending: true,
    });
  }
}

// ============================================================
// Question Repository
// ============================================================

class QuestionRepository extends BaseRepository<Question> {
  constructor() {
    super("questions");
  }

  async getByPackage(packageId: string): Promise<Question[]> {
    return this.getAll({
      filters: [{ column: "packageId", value: packageId }],
      orderBy: "order",
      ascending: true,
    });
  }

  async getBySubject(subjectId: string, limit = 100): Promise<Question[]> {
    return this.getAll({
      filters: [{ column: "subjectId", value: subjectId }],
      orderBy: "updatedAt",
      ascending: false,
      limit,
    });
  }

  async getByTag(tagId: string, limit = 100): Promise<Question[]> {
    return this.getAll({
      filters: [{ column: "tags", value: tagId, op: "array-contains" }],
      orderBy: "updatedAt",
      ascending: false,
      limit,
    });
  }

  /**
   * Basic full-text search across search_text and question_text columns.
   * For better performance, switch to Postgres FTS on the `search_text`
   * column with a generated tsvector in the future.
   */
  async searchByText(text: string, limit = 100): Promise<Question[]> {
    const bySearchText = await this.getAll({
      filters: [{ column: "searchText", value: text, op: "ilike" }],
      limit,
    });
    if (bySearchText.length > 0) return bySearchText;

    // Fallback: search in question_text.
    return this.getAll({
      filters: [{ column: "questionText", value: text, op: "ilike" }],
      limit,
    });
  }

  listenToPackage(packageId: string, callback: (items: Question[]) => void): () => void {
    return this.listen(callback, {
      filters: [{ column: "packageId", value: packageId }],
      orderBy: "order",
      ascending: true,
    });
  }

  /** Reorder questions within a package by passing an array of IDs in the desired order. */
  async reorder(packageId: string, orderedIds: string[]): Promise<void> {
    void packageId;
    const updates = orderedIds.map((id, idx) =>
      this.update(id, { order: idx } as Partial<Question>)
    );
    await Promise.all(updates);
  }
}

// ============================================================
// Resource Repository
// ============================================================

class ResourceRepository extends BaseRepository<Resource> {
  constructor() {
    super("resources");
  }

  async getByType(type: Resource["type"]): Promise<Resource[]> {
    return this.getAll({
      filters: [{ column: "type", value: type }],
      orderBy: "updatedAt",
      ascending: false,
    });
  }

  async getShared(limit = 50): Promise<Resource[]> {
    return this.getAll({
      filters: [{ column: "shared", value: true }],
      orderBy: "usageCount",
      ascending: false,
      limit,
    });
  }
}

// ============================================================
// Source Repository
// ============================================================

class SourceRepository extends BaseRepository<Source> {
  constructor() {
    super("sources");
  }

  async getByType(type: Source["type"]): Promise<Source[]> {
    return this.getAll({
      filters: [{ column: "type", value: type }],
      orderBy: "year",
      ascending: false,
    });
  }
}

// ============================================================
// Tag Repository
// ============================================================

class TagRepository extends BaseRepository<Tag> {
  constructor() {
    super("tags");
  }

  async getPopular(limit = 50): Promise<Tag[]> {
    return this.getAll({
      orderBy: "usageCount",
      ascending: false,
      limit,
    });
  }

  async getByName(name: string): Promise<Tag | null> {
    const items = await this.getAll({
      filters: [{ column: "name", value: name }],
      limit: 1,
    });
    return items[0] || null;
  }
}

// ============================================================
// Registry Repository
// ============================================================

class RegistryRepository extends BaseRepository<RegistryEntry> {
  constructor() {
    super("registries");
  }

  async getByRegistryName(registry: string): Promise<RegistryEntry[]> {
    return this.getAll({
      filters: [{ column: "registry", value: registry }],
      orderBy: "order",
      ascending: true,
    });
  }

  async getActive(registry: string): Promise<RegistryEntry[]> {
    const all = await this.getByRegistryName(registry);
    return all.filter((r) => r.active);
  }

  async getByKey(registry: string, key: string): Promise<RegistryEntry | null> {
    const items = await this.getAll({
      filters: [
        { column: "registry", value: registry },
        { column: "key", value: key },
      ],
      limit: 1,
    });
    return items[0] || null;
  }

  /** Get all distinct registry names. */
  async getRegistries(): Promise<string[]> {
    const { data, error } = await this.client
      .from("registries")
      .select("registry")
      .order("registry");

    if (error) {
      console.error("[RegistryRepository] getRegistries error:", error);
      return [];
    }
    const set = new Set<string>();
    (data || []).forEach((row: { registry: string }) => set.add(row.registry));
    return Array.from(set).sort();
  }
}

// ============================================================
// History Repository
// ============================================================

class HistoryRepository extends BaseRepository<HistoryEntry> {
  constructor() {
    super("history");
  }

  async getByEntity(
    entityType: string,
    entityId: string,
    limit = 100
  ): Promise<HistoryEntry[]> {
    return this.getAll({
      filters: [
        { column: "entityType", value: entityType },
        { column: "entityId", value: entityId },
      ],
      orderBy: "createdAt",
      ascending: false,
      limit,
    });
  }

  async getByUser(userId: string, limit = 50): Promise<HistoryEntry[]> {
    return this.getAll({
      filters: [{ column: "userId", value: userId }],
      orderBy: "createdAt",
      ascending: false,
      limit,
    });
  }

  async log(entry: Omit<HistoryEntry, "id" | "createdAt" | "updatedAt">): Promise<void> {
    try {
      await this.create(entry as Partial<HistoryEntry>);
    } catch (err) {
      // Logging should never throw and break the calling operation.
      console.error("[HistoryRepository] log error:", err);
    }
  }
}

// ============================================================
// Singleton instances — the ONLY way to access data
// ============================================================

export const subjectRepository = new SubjectRepository();
export const sectionRepository = new SectionRepository();
export const topicRepository = new TopicRepository();
export const packageRepository = new PackageRepository();
export const questionRepository = new QuestionRepository();
export const resourceRepository = new ResourceRepository();
export const sourceRepository = new SourceRepository();
export const tagRepository = new TagRepository();
export const registryRepository = new RegistryRepository();
export const historyRepository = new HistoryRepository();

// Re-export types for convenience
export type { QueryOptions, WhereFilter };
