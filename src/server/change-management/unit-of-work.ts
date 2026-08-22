import type { ContentDatabase } from "../content/database";

export class ContentUnitOfWork {
  constructor(private readonly database: ContentDatabase) {}

  run<T>(operation: () => T): T {
    return this.database.client.transaction(operation).immediate();
  }
}
