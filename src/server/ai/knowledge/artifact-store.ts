import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ContentDatabase } from "../../content/database";
import type { AIKnowledgePackageArtifactStore, AIKnowledgePackageV1 } from "./contracts";
import { AIKnowledgeError } from "./errors";

const ARTIFACT_REF_PATTERN = /^[0-9a-f]{64}$/u;

/** Local content-addressed artifact storage; the package itself never contains a filesystem path. */
export class LocalAIKnowledgePackageArtifactStore implements AIKnowledgePackageArtifactStore {
  private readonly directory: string;

  constructor(database: ContentDatabase) {
    this.directory = path.join(database.paths.storageDirectory, "ai-knowledge", "packages");
  }

  put(value: AIKnowledgePackageV1): { artifactRef: string; sha256: string; byteSize: number } {
    const bytes = Buffer.from(JSON.stringify(value), "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const artifactRef = sha256;
    mkdirSync(this.directory, { recursive: true });
    const target = this.filePath(artifactRef);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
      renameSync(temporary, target);
    } catch (error) {
      rmSync(temporary, { force: true });
      if (existsSync(target)) return { artifactRef, sha256, byteSize: bytes.byteLength };
      throw new AIKnowledgeError("AI_KNOWLEDGE_ARTIFACT_INVALID", "Knowledge Package artifact could not be stored.", {}, { cause: error });
    }
    return { artifactRef, sha256, byteSize: bytes.byteLength };
  }

  read(input: { artifactRef: string; sha256: string }): AIKnowledgePackageV1 {
    if (!ARTIFACT_REF_PATTERN.test(input.artifactRef) || !ARTIFACT_REF_PATTERN.test(input.sha256) || input.artifactRef !== input.sha256) {
      throw new AIKnowledgeError("AI_KNOWLEDGE_ARTIFACT_INVALID", "Knowledge Package artifact reference is invalid.");
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(this.filePath(input.artifactRef));
    } catch (error) {
      throw new AIKnowledgeError("AI_KNOWLEDGE_ARTIFACT_NOT_FOUND", "The Knowledge Package artifact is not available.", {}, { cause: error });
    }
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== input.sha256) throw new AIKnowledgeError("AI_KNOWLEDGE_ARTIFACT_INVALID", "Knowledge Package artifact integrity could not be verified.");
    try {
      return JSON.parse(bytes.toString("utf8")) as AIKnowledgePackageV1;
    } catch (error) {
      throw new AIKnowledgeError("AI_KNOWLEDGE_ARTIFACT_INVALID", "Knowledge Package artifact is not valid JSON.", {}, { cause: error });
    }
  }

  private filePath(artifactRef: string): string {
    if (!ARTIFACT_REF_PATTERN.test(artifactRef)) throw new AIKnowledgeError("AI_KNOWLEDGE_ARTIFACT_INVALID", "Knowledge Package artifact reference is invalid.");
    return path.join(this.directory, `${artifactRef}.json`);
  }

}
