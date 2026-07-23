/**
 * base-repository.ts
 * ==================
 * Generic Repository pattern for Supabase (PostgreSQL).
 *
 * This is the ONLY layer that communicates with Supabase.
 * UI components and API routes must use repositories — never
 * access Supabase directly.
 *
 * Features:
 *   - CRUD operations (create, read, update, delete)
 *   - Automatic camelCase (TS) ↔ snake_case (SQL) conversion
 *   - Multi-filter queries (where AND)
 *   - array-contains filter (for tags)
 *   - Ordering + pagination
 *   - Real-time listeners (Supabase channels)
 *
 * Usage:
 *   const bannerRepo = new BaseRepository<Banner>("banners");
 *   const banners = await bannerRepo.getAll({
 *     filters: [{ column: "status", value: "published" }],
 *     orderBy: "createdAt",
 *     ascending: false,
 *   });
 */

import { getSupabaseServer } from "@/lib/supabase/supabase-server";

// ============================================================
// Types
// ============================================================

/**
 * Minimal structural constraint for entities handled by BaseRepository.
 *
 * NOTE: This is intentionally loose — it does NOT include an index
 * signature, because the entity types in `@/lib/entities` don't have
 * one, and TypeScript can't verify they satisfy a constraint that
 * requires `[key: string]: unknown`.
 */
export interface BaseEntity {
  id?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface WhereFilter {
  /** Column name in camelCase (will be converted to snake_case automatically). */
  column: string;
  /** Value to compare against. */
  value: unknown;
  /** Operator (default: "eq"). */
  op?:
    | "eq"
    | "neq"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "like"
    | "ilike"
    | "in"
    | "is"
    | "array-contains";
}

export interface QueryOptions {
  /** Filter conditions (AND-joined). */
  filters?: WhereFilter[];
  /** Order by column (camelCase). */
  orderBy?: string;
  /** Ascending order? Default: true. */
  ascending?: boolean;
  /** Limit number of results. */
  limit?: number;
  /** Skip first N records. */
  offset?: number;
}

// ============================================================
// camelCase ↔ snake_case helpers
// ============================================================

/** Convert a single camelCase string to snake_case. */
function toSnakeCase(str: string): string {
  // Handle already-snake-case strings (with underscores) gracefully.
  if (str.includes("_")) return str;
  return str.replace(/[A-Z]/g, (letter, idx) =>
    idx > 0 ? "_" + letter.toLowerCase() : letter.toLowerCase()
  );
}

/** Convert a single snake_case string to camelCase. */
function toCamelCase(str: string): string {
  if (!str.includes("_")) return str;
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/** Recursively transform all object keys from camelCase to snake_case. */
function transformToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = toSnakeCase(key);
    if (value === null || value === undefined) {
      result[snakeKey] = value;
    } else if (Array.isArray(value)) {
      // Arrays: transform each element if it's an object, otherwise leave as-is.
      result[snakeKey] = value.map((item) =>
        item !== null && typeof item === "object" && !Array.isArray(item)
          ? transformToSnake(item as Record<string, unknown>)
          : item
      );
    } else if (typeof value === "object") {
      result[snakeKey] = transformToSnake(value as Record<string, unknown>);
    } else {
      result[snakeKey] = value;
    }
  }
  return result;
}

/** Recursively transform all object keys from snake_case to camelCase. */
function transformToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = toCamelCase(key);
    if (value === null || value === undefined) {
      result[camelKey] = value;
    } else if (Array.isArray(value)) {
      result[camelKey] = value.map((item) =>
        item !== null && typeof item === "object" && !Array.isArray(item)
          ? transformToCamel(item as Record<string, unknown>)
          : item
      );
    } else if (typeof value === "object") {
      result[camelKey] = transformToCamel(value as Record<string, unknown>);
    } else {
      result[camelKey] = value;
    }
  }
  return result;
}

// ============================================================
// BaseRepository
// ============================================================

export class BaseRepository<T extends BaseEntity> {
  protected tableName: string;
  protected client: ReturnType<typeof getSupabaseServer>;

  constructor(tableName: string) {
    this.tableName = tableName;
    this.client = getSupabaseServer();
  }

  /**
   * Get all records from the table (with optional filters / ordering / limit).
   */
  async getAll(options?: QueryOptions): Promise<T[]> {
    let query = this.client.from(this.tableName).select("*");

    if (options?.filters) {
      for (const filter of options.filters) {
        const col = toSnakeCase(filter.column);
        const op = filter.op || "eq";
        if (op === "array-contains") {
          // Supabase/Postgres uses `cs` (contains) for array inclusion,
          // but for a single value the simpler approach is `ov` (overlap).
          // However, the JS client exposes this via `.contains(col, [value])`.
          query = query.contains(col, [filter.value]);
        } else if (op === "ilike") {
          query = query.ilike(col, `%${filter.value}%`);
        } else if (op === "like") {
          query = query.like(col, `%${filter.value}%`);
        } else if (op === "in") {
          query = query.in(col, filter.value as unknown[]);
        } else if (op === "is") {
          query = query.is(col, filter.value);
        } else if (op === "neq") {
          query = query.neq(col, filter.value);
        } else if (op === "gt") {
          query = query.gt(col, filter.value);
        } else if (op === "gte") {
          query = query.gte(col, filter.value);
        } else if (op === "lt") {
          query = query.lt(col, filter.value);
        } else if (op === "lte") {
          query = query.lte(col, filter.value);
        } else {
          query = query.eq(col, filter.value);
        }
      }
    }

    if (options?.orderBy) {
      query = query.order(toSnakeCase(options.orderBy), {
        ascending: options.ascending ?? true,
      });
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 100) - 1);
    }

    const { data, error } = await query;
    if (error) {
      console.error(`[BaseRepository:${this.tableName}] getAll error:`, error);
      return [];
    }
    if (!data || data.length === 0) return [];
    return data.map((row) => transformToCamel(row as Record<string, unknown>)) as T[];
  }

  /** Get a single record by ID. */
  async getById(id: string): Promise<T | null> {
    const { data, error } = await this.client
      .from(this.tableName)
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      console.error(`[BaseRepository:${this.tableName}] getById error:`, error);
      return null;
    }
    if (!data) return null;
    return transformToCamel(data as Record<string, unknown>) as T;
  }

  /** Create a new record. */
  async create(data: Partial<T>): Promise<T> {
    // Strip system-managed fields (DB defaults handle them).
    const { id, createdAt, updatedAt, ...rest } = data as Record<string, unknown>;
    void id;
    void createdAt;
    void updatedAt;

    const snakeRecord = transformToSnake(rest);

    const { data: result, error } = await this.client
      .from(this.tableName)
      .insert(snakeRecord)
      .select()
      .single();

    if (error) {
      console.error(`[BaseRepository:${this.tableName}] create error:`, error);
      throw new Error(`Failed to create in ${this.tableName}: ${error.message}`);
    }
    return transformToCamel(result as Record<string, unknown>) as T;
  }

  /** Update specific fields of a record. */
  async update(id: string, data: Partial<T>): Promise<T | null> {
    // Strip system-managed fields.
    const { id: _id, createdAt, updatedAt, ...rest } = data as Record<string, unknown>;
    void _id;
    void createdAt;
    void updatedAt;

    const snakeRecord = transformToSnake(rest);

    const { data: result, error } = await this.client
      .from(this.tableName)
      .update(snakeRecord)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error(`[BaseRepository:${this.tableName}] update error:`, error);
      return null;
    }
    if (!result) return null;
    return transformToCamel(result as Record<string, unknown>) as T;
  }

  /** Delete a record. */
  async delete(id: string): Promise<boolean> {
    const { error } = await this.client.from(this.tableName).delete().eq("id", id);

    if (error) {
      console.error(`[BaseRepository:${this.tableName}] delete error:`, error);
      return false;
    }
    return true;
  }

  /** Count records (with optional filters). */
  async count(filters?: WhereFilter[]): Promise<number> {
    let query = this.client
      .from(this.tableName)
      .select("*", { count: "exact", head: true });

    if (filters) {
      for (const filter of filters) {
        const col = toSnakeCase(filter.column);
        const op = filter.op || "eq";
        if (op === "array-contains") {
          query = query.contains(col, [filter.value]);
        } else if (op === "ilike") {
          query = query.ilike(col, `%${filter.value}%`);
        } else if (op === "in") {
          query = query.in(col, filter.value as unknown[]);
        } else if (op === "is") {
          query = query.is(col, filter.value);
        } else if (op === "neq") {
          query = query.neq(col, filter.value);
        } else {
          query = query.eq(col, filter.value);
        }
      }
    }

    const { count, error } = await query;
    if (error) {
      console.error(`[BaseRepository:${this.tableName}] count error:`, error);
      return 0;
    }
    return count || 0;
  }

  /** Search records by text in a specific column (case-insensitive). */
  async search(
    column: string,
    text: string,
    options?: { limit?: number; orderBy?: string; ascending?: boolean }
  ): Promise<T[]> {
    return this.getAll({
      filters: [{ column, value: text, op: "ilike" }],
      limit: options?.limit,
      orderBy: options?.orderBy,
      ascending: options?.ascending,
    });
  }

  /**
   * Listen to real-time changes on this table.
   * Returns an unsubscribe function.
   *
   * NOTE: This must be called client-side. The server Supabase client
   * does not maintain realtime subscriptions in long-running processes.
   */
  listen(
    callback: (items: T[]) => void,
    options?: QueryOptions
  ): () => void {
    const channel = this.client
      .channel(`${this.tableName}_changes`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: this.tableName },
        async () => {
          // Refetch all on any change
          const items = await this.getAll(options);
          callback(items);
        }
      )
      .subscribe();

    return () => {
      this.client.removeChannel(channel);
    };
  }
}
