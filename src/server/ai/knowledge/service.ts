import { v7 as uuidv7 } from "uuid";
import type { AdminActor } from "../../admin-auth/contracts";
import { createChangeManagementService } from "../../change-management/service";
import type { ChangeSetDetails } from "../../change-management/contracts";
import type { ContentDatabase } from "../../content/database";
import { canonicalMaterials } from "../../content/schema";
import { LocalAIKnowledgePackageArtifactStore } from "./artifact-store";
import type { AIKnowledgeSourceContent } from "./contracts";
import { AIKnowledgeError } from "./errors";
import { SQLiteAIKnowledgePackageRepository } from "./package-repository";
import { SQLiteAIKnowledgeSourceRepository } from "./source-repository";
import { inspectAIKnowledgePackageJson } from "./validation";

export class AIKnowledgeDomainService {
  private readonly changes;
  private readonly sources;
  private readonly packages;
  private readonly artifacts;

  constructor(private readonly database: ContentDatabase) {
    this.changes = createChangeManagementService(database);
    this.sources = new SQLiteAIKnowledgeSourceRepository(database);
    this.packages = new SQLiteAIKnowledgePackageRepository(database);
    this.artifacts = new LocalAIKnowledgePackageArtifactStore(database);
  }

  inspectPackage(value: unknown) {
    const subjects = new Set(databaseSubjects(this.database));
    return inspectAIKnowledgePackageJson(value, { canonicalSubjectKeys: subjects, sourceResolver: this.sources });
  }

  stageSource(content: AIKnowledgeSourceContent, actor: AdminActor): ChangeSetDetails {
    const current = this.sources.getByKey(content.key);
    const id = current?.id ?? cryptoUuid();
    return this.changes.createChangeSet({
      title: `${current ? "تحديث" : "إنشاء"} مصدر معرفة: ${content.displayName}`,
      description: "مصدر معرفة محكوم ينتظر المراجعة والنشر قبل إتاحته لإسقاطات المعرفة.",
      initialItem: {
        resourceType: "ai.knowledge-source",
        resourceId: id,
        expectedRevision: current?.currentRevision ?? 0,
        operation: current ? "UPDATE" : "CREATE",
        desired: content,
      },
    }, actor);
  }

  stagePackage(value: unknown, actor: AdminActor, acknowledgeWarnings = false): ChangeSetDetails {
    const inspection = this.inspectPackage(value);
    if (!inspection.package || inspection.status === "INVALID" || inspection.status === "UNSUPPORTED_VERSION") throw new AIKnowledgeError("AI_KNOWLEDGE_INVALID", "The Knowledge Package is not eligible for staging.");
    if (inspection.status === "VALID_WITH_WARNINGS" && !acknowledgeWarnings) throw new AIKnowledgeError("AI_KNOWLEDGE_INVALID", "Knowledge Package warnings must be acknowledged before staging.");
    const artifact = this.artifacts.put(inspection.package);
    const current = this.packages.getById(inspection.package.package.id);
    const content = {
      key: inspection.package.package.key,
      subjectKey: inspection.package.package.subjectKey,
      title: inspection.package.package.title,
      language: inspection.package.package.language,
      contentRevision: inspection.package.package.contentRevision,
      sourceId: inspection.package.source.id,
      sourceRevision: inspection.package.source.revision,
      artifactRef: artifact.artifactRef,
      artifactSha256: artifact.sha256,
      artifactByteSize: artifact.byteSize,
    };
    return this.changes.createChangeSet({
      title: `${current ? "تحديث" : "إنشاء"} حزمة معرفة: ${content.title}`,
      description: "حزمة معرفة hash-pinned؛ Change Set يحمل metadata محدودة فقط، والمحتوى يظل في artifact محلي.",
      initialItem: {
        resourceType: "ai.knowledge-package",
        resourceId: inspection.package.package.id,
        expectedRevision: current?.package.currentRevision ?? 0,
        operation: current ? "UPDATE" : "CREATE",
        desired: content,
      },
    }, actor);
  }

  listProjectionEligibleKnowledge(subjectKey: string) {
    return this.packages.listProjectionEligibleKnowledge(subjectKey);
  }
}

export function createAIKnowledgeDomainService(database: ContentDatabase): AIKnowledgeDomainService {
  return new AIKnowledgeDomainService(database);
}

function databaseSubjects(database: ContentDatabase): string[] {
  return database.db.select({ subjectKey: canonicalMaterials.subjectKey }).from(canonicalMaterials).all().map((row) => row.subjectKey);
}

function cryptoUuid(): string {
  return uuidv7();
}
