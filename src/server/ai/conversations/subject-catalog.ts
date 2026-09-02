import { eq } from "drizzle-orm";

import type { ContentDatabase } from "../../content/database";
import { canonicalMaterials } from "../../content/schema";
import type { AIConversationSubject, AIConversationSubjectCatalog } from "./contracts";
import { normalizeConversationSubjectKey } from "./validation";

export class SQLiteAIConversationSubjectCatalog implements AIConversationSubjectCatalog {
  constructor(private readonly database: ContentDatabase) {}

  getSubject(subjectKey: string): AIConversationSubject | null {
    const normalized = normalizeConversationSubjectKey(subjectKey);
    const row = this.database.db.select({
      subjectKey: canonicalMaterials.subjectKey,
      label: canonicalMaterials.label,
      available: canonicalMaterials.available,
    }).from(canonicalMaterials).where(eq(canonicalMaterials.subjectKey, normalized)).get();
    return row ?? null;
  }
}
